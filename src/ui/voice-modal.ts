import { App, EditorPosition, MarkdownView, Modal, Notice, TFile } from "obsidian";
import type DeepSeekVoicePlugin from "../main";
import { chatCompletion, ApiError, transcribe } from "../deepseek";
import { buildMessages } from "../prompts";
import { describeResult, guardFileSize, parseResult, writeResult } from "../apply";
import { WavRecorder } from "../audio";
import type { VoiceContext, VoiceMode, VoiceResult } from "../types";

interface ModeDef {
	id: VoiceMode;
	label: string;
}

const MODES: ModeDef[] = [
	{ id: "append", label: "追加" },
	{ id: "replace-note", label: "改写全文" },
	{ id: "replace-selection", label: "改写选中" },
	{ id: "create-note", label: "新建笔记" },
];

const MAX_RECORD_SECONDS = 120;

export interface VoiceModalOptions {
	mode?: VoiceMode;
	/** 快捷指令把识别好的文字直接带进来 */
	presetText?: string;
	autoSubmit?: boolean;
}

export class VoiceModal extends Modal {
	private plugin: DeepSeekVoicePlugin;
	private ctx: VoiceContext;
	private mode: VoiceMode;
	private presetText: string;
	private autoSubmit: boolean;

	private inputEl!: HTMLTextAreaElement;
	private resultEl!: HTMLElement;
	private goBtn!: HTMLButtonElement;
	private recBtn!: HTMLButtonElement;
	private recHint!: HTMLElement;
	private chips = new Map<VoiceMode, HTMLElement>();
	private busy = false;
	private lastResult: VoiceResult | null = null;
	private lastInstruction = "";

	private recorder: WavRecorder | null = null;
	private recTimer: ReturnType<typeof setInterval> | null = null;
	private transcribing = false;

	constructor(app: App, plugin: DeepSeekVoicePlugin, ctx: VoiceContext, options: VoiceModalOptions = {}) {
		super(app);
		this.plugin = plugin;
		this.ctx = ctx;
		this.mode = options.mode ?? plugin.settings.defaultMode;
		this.presetText = options.presetText ?? "";
		this.autoSubmit = options.autoSubmit ?? false;

		// 没有打开的笔记时，只能新建
		if (!ctx.file && this.mode !== "create-note") this.mode = "create-note";
		// 选中为空时「改写选中」没有意义
		if (this.mode === "replace-selection" && !ctx.selection) this.mode = ctx.file ? "append" : "create-note";
	}

	onOpen(): void {
		this.modalEl.addClass("dsv-modal");
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("dsv-content");

		const head = contentEl.createDiv({ cls: "dsv-head" });
		head.createDiv({ cls: "dsv-title", text: "语音笔记" });
		head.createDiv({
			cls: "dsv-sub",
			text: this.ctx.file ? this.ctx.file.path : "当前没有打开的笔记，将新建一篇",
		});

		const chips = contentEl.createDiv({ cls: "dsv-chips" });
		for (const def of MODES) {
			const chip = chips.createEl("button", { cls: "dsv-chip", text: def.label });
			chip.addEventListener("click", () => this.setMode(def.id));
			this.chips.set(def.id, chip);
		}

		if (this.plugin.settings.asrEnabled) {
			const rec = contentEl.createDiv({ cls: "dsv-rec" });
			this.recBtn = rec.createEl("button", { cls: "dsv-recbtn", text: "● 开始说话" });
			this.recBtn.addEventListener("click", () => void this.toggleRecord());
			this.recHint = rec.createDiv({ cls: "dsv-rechint" });
			this.recHint.setText(`点一下开始，说完再点一下（最长 ${MAX_RECORD_SECONDS} 秒），文字会先填进下面，确认后再生成。`);
		}

		this.inputEl = contentEl.createEl("textarea", { cls: "dsv-input" });
		this.inputEl.rows = 5;
		this.inputEl.placeholder = "说话或直接输入…";
		this.inputEl.value = this.presetText;
		this.inputEl.addEventListener("input", () => this.autoGrow());
		this.inputEl.addEventListener("keydown", (evt: KeyboardEvent) => {
			if (evt.key === "Enter" && (evt.metaKey || evt.ctrlKey)) {
				evt.preventDefault();
				void this.submit();
			}
		});

		const hint = contentEl.createDiv({ cls: "dsv-hint" });
		hint.setText("也可以点键盘上的麦克风用系统听写。快捷键 Ctrl/⌘ + Enter");

		const footer = contentEl.createDiv({ cls: "dsv-footer" });
		const closeBtn = footer.createEl("button", { text: "关闭" });
		closeBtn.addEventListener("click", () => this.close());
		this.goBtn = footer.createEl("button", { cls: "mod-cta", text: "生成" });
		this.goBtn.addEventListener("click", () => void this.submit());

		this.resultEl = contentEl.createDiv({ cls: "dsv-result" });

		this.setMode(this.mode);
		this.autoGrow();

		setTimeout(() => {
			if (this.presetText) {
				this.inputEl.focus();
				this.inputEl.setSelectionRange(this.presetText.length, this.presetText.length);
			}
			if (this.autoSubmit && this.presetText.trim()) void this.submit();
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
		this.inputEl.style.height = `${Math.min(this.inputEl.scrollHeight + 2, 260)}px`;
	}

	private canUseMode(mode: VoiceMode): boolean {
		if (mode === "create-note") return true;
		if (!this.ctx.file) return false;
		if (mode === "replace-selection") return this.ctx.selection.length > 0;
		return true;
	}

	private setMode(mode: VoiceMode): void {
		if (!this.canUseMode(mode)) {
			if (mode === "replace-selection") new Notice("先在这篇笔记里选中一段文字，才能改写选中部分。");
			else if (!this.ctx.file) new Notice("当前没有打开的笔记，请在 Obsidian 里打开一篇笔记再触发。");
			return;
		}
		this.mode = mode;
		for (const [id, el] of this.chips) {
			const usable = this.canUseMode(id);
			el.toggleClass("is-active", id === mode);
			el.toggleClass("is-disabled", !usable);
			el.setAttribute("aria-disabled", usable ? "false" : "true");
		}
	}

	private setBusy(busy: boolean, label = "生成"): void {
		this.busy = busy;
		this.goBtn.disabled = busy;
		this.goBtn.setText(busy ? "生成中…" : label);
		this.modalEl.toggleClass("is-busy", busy);
	}

	private startTimer(): void {
		this.stopTimer();
		this.recTimer = setInterval(() => {
			const seconds = Math.floor(this.recorder?.elapsedSeconds ?? 0);
			this.recBtn.setText(`■ 结束并转写（${seconds}s）`);
			this.recBtn.addClass("is-recording");
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
			this.recBtn.setText("■ 结束并转写（0s）");
			this.recBtn.addClass("is-recording");
			this.recHint.setText("正在录音…说完点一下结束");
			this.startTimer();
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			this.recorder = null;
			new Notice(`打不开麦克风：${msg}`, 8000);
			this.recHint.setText(
				"打不开麦克风。到 iPhone「设置 → Obsidian → 麦克风」确认已允许；不行就点键盘上的麦克风用系统听写。"
			);
		}
	}

	private async finishRecording(): Promise<void> {
		const recorder = this.recorder;
		if (!recorder || this.transcribing) return;
		this.stopTimer();
		this.transcribing = true;
		this.recBtn.setText("转写中…");
		this.recBtn.removeClass("is-recording");
		this.recBtn.disabled = true;

		try {
			const wav = await recorder.stop();
			this.recorder = null;
			const text = await transcribe(this.plugin.settings, wav);
			const existing = this.inputEl.value.trim();
			this.inputEl.value = existing ? `${existing}\n${text}` : text;
			this.autoGrow();
			this.inputEl.focus();
			this.inputEl.setSelectionRange(this.inputEl.value.length, this.inputEl.value.length);
			this.recHint.setText("已转成文字，检查一下有没有同音错字，再点「生成」。");
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			this.recorder = null;
			new Notice(msg, 8000);
			this.recHint.setText(msg);
		} finally {
			this.transcribing = false;
			this.recBtn.disabled = false;
			this.recBtn.setText("● 开始说话");
			this.recBtn.removeClass("is-recording");
		}
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

	private async submit(): Promise<void> {
		if (this.busy) return;
		const instruction = this.inputEl.value.trim();
		if (!instruction) {
			new Notice("先说点什么，或者直接打字。");
			this.inputEl.focus();
			return;
		}

		this.lastInstruction = instruction;
		this.lastResult = null;
		this.resultEl.empty();
		this.setBusy(true);

		try {
			const messages = buildMessages(this.ctx, instruction, this.mode, this.plugin.settings);
			const raw = await chatCompletion(this.plugin.settings, messages, { json: true });
			const result = parseResult(raw, this.mode);
			// 模型偶尔会自作主张换落点，强制回落到用户选的那个，避免误写
			if (result.action !== this.mode && result.action !== "create-note") result.action = this.mode;
			this.lastResult = result;

			if (this.plugin.settings.requireConfirm) {
				this.renderPreview(result);
			} else {
				await this.applyResult();
			}
		} catch (err) {
			const msg = err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err);
			this.showError(msg);
		} finally {
			this.setBusy(false);
		}
	}

	private renderPreview(res: VoiceResult): void {
		this.resultEl.empty();
		const summary = this.resultEl.createDiv({ cls: "dsv-summary" });
		summary.setText(res.summary ? `${res.summary}\n${describeResult(res, this.ctx)}` : describeResult(res, this.ctx));

		if (res.notes) {
			this.resultEl.createDiv({ cls: "dsv-notes", text: `注意：${res.notes}` });
		}

		if (res.action === "replace-selection" && this.ctx.selection) {
			const old = this.resultEl.createEl("details", { cls: "dsv-preview" });
			old.createEl("summary", { text: "原来的选中内容" });
			old.createEl("pre", { cls: "dsv-pre" }).setText(this.ctx.selection);
		}

		if (res.action === "replace-note" && this.ctx.noteContent) {
			const old = this.resultEl.createEl("details", { cls: "dsv-preview" });
			old.createEl("summary", { text: "改写前的正文（前 400 字）" });
			old.createEl("pre", { cls: "dsv-pre" }).setText(this.ctx.noteContent.slice(0, 400));
		}

		const preview = this.resultEl.createEl("details", { cls: "dsv-preview" });
		preview.createEl("summary", { text: `要写入的内容（${res.content.length} 字）` });
		preview.createEl("pre", { cls: "dsv-pre" }).setText(res.content);

		const bar = this.resultEl.createDiv({ cls: "dsv-actions" });
		const writeBtn = bar.createEl("button", { cls: "mod-cta", text: "写入笔记" });
		writeBtn.addEventListener("click", () => void this.applyResult());
		const copyBtn = bar.createEl("button", { text: "复制" });
		copyBtn.addEventListener("click", async () => {
			await navigator.clipboard.writeText(res.content);
			new Notice("已复制到剪贴板");
		});
		const retryBtn = bar.createEl("button", { text: "重新生成" });
		retryBtn.addEventListener("click", () => {
			this.inputEl.value = this.lastInstruction;
			this.autoGrow();
			void this.submit();
		});
	}

	private async applyResult(): Promise<void> {
		if (!this.lastResult) return;
		try {
			guardFileSize(this.ctx.file);
			const message = await writeResult(this.plugin, this.ctx, this.lastResult);
			new Notice(message);
			this.close();
		} catch (err) {
			this.showError(err instanceof Error ? err.message : String(err));
		}
	}
}

export function buildContext(app: App, file: TFile | null, noteContent: string): VoiceContext {
	const view = app.workspace.getActiveViewOfType(MarkdownView);
	let selection = "";
	let from: EditorPosition | undefined;
	let to: EditorPosition | undefined;
	if (view && view.file && file && view.file.path === file.path) {
		selection = view.editor.getSelection() ?? "";
		if (selection) {
			from = view.editor.getCursor("from");
			to = view.editor.getCursor("to");
		}
	}
	return { file, noteContent, selection, from, to };
}
