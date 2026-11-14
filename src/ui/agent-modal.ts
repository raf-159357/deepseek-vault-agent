import { App, Modal, Notice } from "obsidian";
import type DeepSeekVoicePlugin from "../main";
import { ApiError, transcribe } from "../deepseek";
import { commitAgent, runAgent } from "../agent";
import { describeOp } from "../vault-tools";
import { WavRecorder } from "../audio";
import type { AgentStep, PendingOp, VoiceContext } from "../types";

const MAX_RECORD_SECONDS = 120;

const SAMPLES = [
	"搜一下最近关于这个主题的新进展，整理成笔记",
	"把这篇文章的链接读一下，提炼要点存成新笔记",
	"看看我库里有哪些相关笔记，列出来",
];

export interface AgentModalOptions {
	presetText?: string;
	autoRun?: boolean;
}

export class AgentModal extends Modal {
	private plugin: DeepSeekVoicePlugin;
	private ctx: VoiceContext;
	private presetText: string;
	private autoRun: boolean;

	private inputEl!: HTMLTextAreaElement;
	private runBtn!: HTMLButtonElement;
	private recBtn: HTMLButtonElement | null = null;
	private recHint: HTMLElement | null = null;
	private stepsEl!: HTMLElement;
	private resultEl!: HTMLElement;
	private busy = false;

	private recorder: WavRecorder | null = null;
	private recTimer: ReturnType<typeof setInterval> | null = null;
	private transcribing = false;
	private pending: PendingOp[] = [];

	constructor(app: App, plugin: DeepSeekVoicePlugin, ctx: VoiceContext, options: AgentModalOptions = {}) {
		super(app);
		this.plugin = plugin;
		this.ctx = ctx;
		this.presetText = options.presetText ?? "";
		this.autoRun = options.autoRun ?? false;
	}

	onOpen(): void {
		this.modalEl.addClass("dsv-modal");
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("dsv-content");

		const head = contentEl.createDiv({ cls: "dsv-head" });
		head.createDiv({ cls: "dsv-title", text: "AI 指令" });
		head.createDiv({
			cls: "dsv-sub",
			text: `${this.ctx.file ? this.ctx.file.path : "当前没有打开的笔记"} · 可联网 · 可读写本库`,
		});

		const chips = contentEl.createDiv({ cls: "dsv-chips" });
		for (const text of SAMPLES) {
			const chip = chips.createEl("button", { cls: "dsv-chip", text });
			chip.addEventListener("click", () => {
				this.inputEl.value = text;
				this.inputEl.focus();
				this.autoGrow();
			});
		}

		if (this.plugin.settings.asrEnabled) {
			const rec = contentEl.createDiv({ cls: "dsv-rec" });
			this.recBtn = rec.createEl("button", { cls: "dsv-recbtn", text: "● 开始说话" });
			this.recBtn.addEventListener("click", () => void this.toggleRecord());
			this.recHint = rec.createDiv({ cls: "dsv-rechint" });
			this.recHint.setText(`说清楚要它做什么，说完再点一下（最长 ${MAX_RECORD_SECONDS} 秒）。`);
		}

		this.inputEl = contentEl.createEl("textarea", { cls: "dsv-input" });
		this.inputEl.rows = 4;
		this.inputEl.placeholder = "让它查资料、读链接、整理或新建笔记…";
		this.inputEl.value = this.presetText;
		this.inputEl.addEventListener("input", () => this.autoGrow());
		this.inputEl.addEventListener("keydown", (evt: KeyboardEvent) => {
			if (evt.key === "Enter" && (evt.metaKey || evt.ctrlKey)) {
				evt.preventDefault();
				void this.run();
			}
		});

		this.stepsEl = contentEl.createDiv({ cls: "dsv-steps" });
		this.resultEl = contentEl.createDiv({ cls: "dsv-result" });

		const footer = contentEl.createDiv({ cls: "dsv-footer" });
		const closeBtn = footer.createEl("button", { text: "关闭" });
		closeBtn.addEventListener("click", () => this.close());
		this.runBtn = footer.createEl("button", { cls: "mod-cta", text: "执行" });
		this.runBtn.addEventListener("click", () => void this.run());

		this.autoGrow();
		setTimeout(() => {
			if (this.presetText) {
				this.inputEl.focus();
				this.inputEl.setSelectionRange(this.presetText.length, this.presetText.length);
			}
			if (this.autoRun && this.presetText.trim()) void this.run();
		}, 60);
	}

	onClose(): void {
		this.stopTimer();
		if (this.recorder) {
			void this.recorder.cancel();
			this.recorder = null;
		}
		this.contentEl.empty();
	}

	private autoGrow(): void {
		this.inputEl.style.height = "auto";
		this.inputEl.style.height = `${Math.min(this.inputEl.scrollHeight + 2, 220)}px`;
	}

	private setBusy(busy: boolean, label = "执行"): void {
		this.busy = busy;
		this.runBtn.disabled = busy;
		this.runBtn.setText(busy ? "处理中…" : label);
		this.modalEl.toggleClass("is-busy", busy);
	}

	private startTimer(): void {
		this.stopTimer();
		this.recTimer = setInterval(() => {
			const seconds = Math.floor(this.recorder?.elapsedSeconds ?? 0);
			this.recBtn?.setText(`■ 结束并转写（${seconds}s）`);
			if (seconds >= MAX_RECORD_SECONDS) void this.finishRecording();
		}, 250);
	}

	private stopTimer(): void {
		if (this.recTimer !== null) {
			clearInterval(this.recTimer);
			this.recTimer = null;
		}
	}

	private async toggleRecord(): Promise<void> {
		if (this.transcribing) return;
		if (this.recorder?.recording) {
			await this.finishRecording();
			return;
		}
		this.recorder = new WavRecorder();
		try {
			await this.recorder.start({ maxSeconds: MAX_RECORD_SECONDS });
			this.recBtn?.setText("■ 结束并转写（0s）");
			this.recBtn?.addClass("is-recording");
			this.recHint?.setText("正在录音…说完点一下结束");
			this.startTimer();
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			this.recorder = null;
			new Notice(`打不开麦克风：${msg}`, 8000);
			this.recHint?.setText("打不开麦克风。到 iPhone「设置 → Obsidian → 麦克风」确认已允许，或用键盘听写。");
		}
	}

	private async finishRecording(): Promise<void> {
		const recorder = this.recorder;
		if (!recorder || this.transcribing) return;
		this.stopTimer();
		this.transcribing = true;
		this.recBtn?.setText("转写中…");
		this.recBtn?.removeClass("is-recording");
		if (this.recBtn) this.recBtn.disabled = true;

		try {
			const wav = await recorder.stop();
			this.recorder = null;
			const text = await transcribe(this.plugin.settings, wav);
			const existing = this.inputEl.value.trim();
			this.inputEl.value = existing ? `${existing}\n${text}` : text;
			this.autoGrow();
			this.inputEl.focus();
			this.recHint?.setText("已转成文字，检查错字后再点「执行」。");
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			this.recorder = null;
			new Notice(msg, 8000);
			this.recHint?.setText(msg);
		} finally {
			this.transcribing = false;
			if (this.recBtn) {
				this.recBtn.disabled = false;
				this.recBtn.setText("● 开始说话");
				this.recBtn.removeClass("is-recording");
			}
		}
	}

	private addStep(step: AgentStep): void {
		const row = this.stepsEl.createDiv({ cls: `dsv-step${step.ok ? "" : " is-error"}` });
		row.createSpan({ cls: "dsv-step-icon", text: step.ok ? "✓" : "!" });
		row.createSpan({ cls: "dsv-step-text", text: step.label });
		this.stepsEl.scrollTop = this.stepsEl.scrollHeight;
	}

	private showError(message: string): void {
		this.resultEl.empty();
		const box = this.resultEl.createDiv({ cls: "dsv-error" });
		box.setText(message);
		if (message.includes("API Key") || message.includes("401")) {
			const btn = box.createEl("button", { text: "去填 API Key" });
			btn.addEventListener("click", () => {
				this.close();
				this.plugin.openSettings();
			});
		}
	}

	private async run(): Promise<void> {
		if (this.busy) return;
		const instruction = this.inputEl.value.trim();
		if (!instruction) {
			new Notice("先说清楚要它做什么。");
			this.inputEl.focus();
			return;
		}

		this.pending = [];
		this.stepsEl.empty();
		this.resultEl.empty();
		this.setBusy(true);

		try {
			const result = await runAgent(this.app, this.plugin.settings, this.ctx, instruction, {
				onStep: (step) => this.addStep(step),
			});
			this.pending = result.pending;
			this.renderResult(result.reply, result.pending);
		} catch (err) {
			const msg = err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err);
			this.showError(msg);
		} finally {
			this.setBusy(false);
		}
	}

	private renderResult(reply: string, pending: PendingOp[]): void {
		this.resultEl.empty();

		const body = this.resultEl.createDiv({ cls: "dsv-reply" });
		body.setText(reply);

		if (!pending.length) {
			const bar = this.resultEl.createDiv({ cls: "dsv-actions" });
			const copy = bar.createEl("button", { text: "复制回答" });
			copy.addEventListener("click", async () => {
				await navigator.clipboard.writeText(reply);
				new Notice("已复制");
			});
			return;
		}

		const box = this.resultEl.createDiv({ cls: "dsv-ops" });
		box.createDiv({ cls: "dsv-ops-title", text: `待确认的操作（${pending.length}）` });
		for (const op of pending) {
			box.createDiv({ cls: "dsv-op", text: `· ${describeOp(op)}` });
		}

		const bar = this.resultEl.createDiv({ cls: "dsv-actions" });
		const go = bar.createEl("button", { cls: "mod-cta", text: "执行这些操作" });
		go.addEventListener("click", () => void this.commit(go));
		const copy = bar.createEl("button", { text: "复制回答" });
		copy.addEventListener("click", async () => {
			await navigator.clipboard.writeText(reply);
			new Notice("已复制");
		});
	}

	private async commit(btn: HTMLButtonElement): Promise<void> {
		if (!this.pending.length) return;
		btn.disabled = true;
		btn.setText("执行中…");
		try {
			const done = await commitAgent(this.app, this.pending);
			new Notice(done.length ? `完成 ${done.length} 个操作：${done[0]}` : "没有需要执行的", 6000);
			this.pending = [];
			this.close();
		} catch (err) {
			btn.disabled = false;
			btn.setText("执行这些操作");
			this.showError(err instanceof Error ? err.message : String(err));
		}
	}
}
