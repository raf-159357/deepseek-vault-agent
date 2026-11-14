import { App, Modal, Notice, setIcon } from "obsidian";
import type DeepSeekVoicePlugin from "../main";
import { ApiError, supportsVision, transcribe } from "../deepseek";
import { commitAgent, continueAgent, runAgent } from "../agent";
import { describeOp } from "../vault-tools";
import { WavRecorder } from "../audio";
import { pickImage } from "../image";
import { clearPending, loadPending, savePending } from "../pending-store";
import { estimateCost, savedByCache, isEmptyUsage, type Usage } from "../usage";
import { F, isEn, s } from "../i18n";
import { AGENT_STEP_LIMIT, MAX_IMAGES } from "../types";
import type { AgentState, AgentStep, PendingOp, PickedImage, StopReason, VoiceContext } from "../types";

const MAX_RECORD_SECONDS = 120;

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
	private shotsEl: HTMLElement | null = null;
	private shotBtns: HTMLButtonElement[] = [];
	private stepsEl!: HTMLElement;
	private stepsHead!: HTMLElement;
	private resultEl!: HTMLElement;
	private busy = false;

	private recorder: WavRecorder | null = null;
	private recTimer: number | null = null;
	private transcribing = false;
	private pending: PendingOp[] = [];
	private images: PickedImage[] = [];
	private state: AgentState | null = null;
	private visionHinted = false;
	private stepCount = 0;

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
		head.createDiv({ cls: "dsv-title", text: s("amTitle") });
		const where = this.ctx.file ? this.ctx.file.path : isEn() ? "no note open" : "当前没有打开的笔记";
		head.createDiv({
			cls: "dsv-sub",
			text: isEn() ? `${where} · web access · reads and writes this vault` : `${where} · 可联网 · 可读写本库`,
		});

		const chips = contentEl.createDiv({ cls: "dsv-chips" });
		for (const text of s("amSamples").split("\n")) {
			const chip = chips.createEl("button", { cls: "dsv-chip", text });
			chip.addEventListener("click", () => {
				this.inputEl.value = text;
				this.inputEl.focus();
				this.autoGrow();
			});
		}

		this.buildShots(contentEl);

		if (this.plugin.settings.asrEnabled) {
			const rec = contentEl.createDiv({ cls: "dsv-rec" });
			this.recBtn = rec.createEl("button", { cls: "dsv-recbtn", text: s("vmStart") });
			this.recBtn.addEventListener("click", () => void this.toggleRecord());
			this.recHint = rec.createDiv({ cls: "dsv-rechint" });
			this.recHint.setText(
				isEn()
					? `Say what it should do, then tap again (max ${MAX_RECORD_SECONDS}s).`
					: `说清楚要它做什么，说完再点一下（最长 ${MAX_RECORD_SECONDS} 秒）。`
			);
		}

		this.inputEl = contentEl.createEl("textarea", { cls: "dsv-input" });
		this.inputEl.rows = 4;
		this.inputEl.placeholder = s("amPlaceholder");
		this.inputEl.value = this.presetText;
		this.inputEl.addEventListener("input", () => this.autoGrow());
		this.inputEl.addEventListener("keydown", (evt: KeyboardEvent) => {
			if (evt.key === "Enter" && (evt.metaKey || evt.ctrlKey)) {
				evt.preventDefault();
				void this.run();
			}
		});

		this.stepsHead = contentEl.createDiv({ cls: "dsv-steps-head" });
		this.stepsEl = contentEl.createDiv({ cls: "dsv-steps" });
		this.resultEl = contentEl.createDiv({ cls: "dsv-result" });

		const footer = contentEl.createDiv({ cls: "dsv-footer" });
		const closeBtn = footer.createEl("button", { cls: "dsv-btn-quiet", text: s("amClose") });
		closeBtn.addEventListener("click", () => this.close());
		this.runBtn = footer.createEl("button", { cls: "mod-cta dsv-btn-main", text: s("amRun") });
		this.runBtn.addEventListener("click", () => void this.run());

		this.autoGrow();
		void this.restoreQueue();

		window.setTimeout(() => {
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

	/** 拍照 / 相册：手机直接调系统相机，桌面上是选文件 */
	private buildShots(parent: HTMLElement): void {
		const wrap = parent.createDiv({ cls: "dsv-shots" });
		const bar = wrap.createDiv({ cls: "dsv-shot-bar" });

		const cam = bar.createEl("button", { cls: "dsv-shot-btn" });
		setIcon(cam, "camera");
		cam.createSpan({ cls: "dsv-shot-label", text: s("amCamera") });
		cam.addEventListener("click", () => void this.addImage(true));
		const gal = bar.createEl("button", { cls: "dsv-shot-btn" });
		setIcon(gal, "image");
		gal.createSpan({ cls: "dsv-shot-label", text: s("amGallery") });
		gal.addEventListener("click", () => void this.addImage(false));
		this.shotBtns = [cam, gal];

		this.shotsEl = wrap.createDiv({ cls: "dsv-shot-list" });
		this.shotsEl.addClass("is-empty");
	}

	/** 上次没执行完的写操作：手机上 App 被系统杀掉也能接着用 */
	private async restoreQueue(): Promise<void> {
		if (this.state || this.pending.length) return;
		const saved = await loadPending(this.app, this.plugin.manifest.id);
		if (!saved.length || this.state || this.pending.length) return;
		this.pending = saved;
		this.renderResult(F.restored(saved.length), saved, "done");
	}

	private async discard(): Promise<void> {
		this.pending = [];
		this.state = null;
		await clearPending(this.app, this.plugin.manifest.id);
		this.resultEl.empty();
	}

	private usageLine(usage: Usage, model: string): HTMLElement {
		const cost = estimateCost(usage, model).toFixed(4);
		const saved = savedByCache(usage, model).toFixed(4);
		return this.resultEl.createDiv({ cls: "dsv-usage", text: F.usageLine(usage.hit, usage.miss, usage.out, cost, saved) });
	}

	private async addImage(useCamera: boolean): Promise<void> {
		if (this.busy) return;
		if (this.images.length >= MAX_IMAGES) {
			new Notice(F.imageLimit(MAX_IMAGES), 5000);
			return;
		}
		try {
			const picked = await pickImage(useCamera);
			if (!picked) return;
			this.images.push(picked);
			this.renderShots();
			if (!this.visionHinted && !supportsVision(this.plugin.settings.model)) {
				this.visionHinted = true;
				new Notice(F.visionSwap(), 7000);
			}
		} catch (err) {
			new Notice(F.imageFail(err instanceof Error ? err.message : String(err)), 8000);
		}
	}

	private renderShots(): void {
		if (!this.shotsEl) return;
		this.shotsEl.empty();
		this.shotsEl.toggleClass("is-empty", this.images.length === 0);

		this.images.forEach((img, index) => {
			const cell = this.shotsEl?.createDiv({ cls: "dsv-shot" });
			if (!cell) return;
			cell.createEl("img", {
				cls: "dsv-shot-img",
				attr: { src: img.dataUrl, alt: img.name },
			});
			const del = cell.createEl("button", { cls: "dsv-shot-x", text: "×" });
			del.setAttribute("aria-label", s("amClose"));
			del.addEventListener("click", () => {
				this.images.splice(index, 1);
				this.renderShots();
			});
		});
	}

	private autoGrow(): void {
		this.inputEl.setCssProps({ height: `${Math.min(this.inputEl.scrollHeight + 2, 220)}px` });
	}

	private setBusy(busy: boolean, label?: string): void {
		this.busy = busy;
		this.runBtn.disabled = busy;
		this.runBtn.setText(busy ? s("amRunning") : label ?? s("amRun"));
		for (const btn of this.shotBtns) btn.disabled = busy;
		this.modalEl.toggleClass("is-busy", busy);
	}

	private startTimer(): void {
		this.stopTimer();
		this.recTimer = window.setInterval(() => {
			const seconds = Math.floor(this.recorder?.elapsedSeconds ?? 0);
			this.recBtn?.setText(F.recElapsed(seconds));
			if (seconds >= MAX_RECORD_SECONDS) void this.finishRecording();
		}, 250);
	}

	private stopTimer(): void {
		if (this.recTimer !== null) {
			window.clearInterval(this.recTimer);
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
			this.recBtn?.setText(F.recElapsed(0));
			this.recBtn?.addClass("is-recording");
			this.recHint?.setText(s("vmRecording"));
			this.startTimer();
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			this.recorder = null;
			new Notice(F.micFail(msg), 8000);
			this.recHint?.setText(F.micFailHint());
		}
	}

	private async finishRecording(): Promise<void> {
		const recorder = this.recorder;
		if (!recorder || this.transcribing) return;
		this.stopTimer();
		this.transcribing = true;
		this.recBtn?.setText(s("vmTranscribing"));
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
			this.recHint?.setText(s("vmTranscribed"));
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			this.recorder = null;
			new Notice(msg, 8000);
			this.recHint?.setText(msg);
		} finally {
			this.transcribing = false;
			if (this.recBtn) {
				this.recBtn.disabled = false;
				this.recBtn.setText(s("vmStart"));
				this.recBtn.removeClass("is-recording");
			}
		}
	}

	private addStep(step: AgentStep): void {
		const row = this.stepsEl.createDiv({ cls: `dsv-step${step.ok ? "" : " is-error"}` });
		row.createSpan({ cls: "dsv-step-dot" });
		row.createSpan({ cls: "dsv-step-text", text: step.label });
		this.stepsEl.scrollTop = this.stepsEl.scrollHeight;
		this.stepCount += 1;
		this.stepsHead.setText(F.stepsUsed(this.stepCount, this.stepBudget()));
	}

	private stepBudget(): number {
		const n = Number(this.plugin.settings.agentMaxSteps) || 8;
		return Math.max(1, Math.min(AGENT_STEP_LIMIT, n));
	}

	private showError(message: string): void {
		this.resultEl.empty();
		const box = this.resultEl.createDiv({ cls: "dsv-error" });
		box.setText(message);
		if (message.includes("API Key") || message.includes("401") || message.includes("API key")) {
			const btn = box.createEl("button", { text: s("amKey") });
			btn.addEventListener("click", () => {
				this.close();
				this.plugin.openSettings();
			});
		}
	}

	private async run(): Promise<void> {
		if (this.busy) return;
		const typed = this.inputEl.value.trim();
		// 只拍了图、没说要求：给它一个稳妥的默认动作
		const instruction = typed || (this.images.length ? s("amPhotoOnly") : "");
		if (!instruction) {
			new Notice(s("amEmpty"));
			this.inputEl.focus();
			return;
		}

		// 保留还没执行的队列（可能是上次恢复的），新一轮在它后面继续排
		this.state = null;
		this.stepsEl.empty();
		this.stepCount = 0;
		this.stepsHead.setText("");
		this.resultEl.empty();
		this.setBusy(true);

		try {
			const result = await runAgent(this.app, this.plugin.settings, this.ctx, instruction, {
				images: this.images.map((img) => img.dataUrl),
				pending: this.pending,
				onStep: (step) => this.addStep(step),
			});
			this.state = result.state;
			this.pending = result.pending;
			this.plugin.recordUsage(result.usage);
			await savePending(this.app, this.plugin.manifest.id, this.pending);
			// 图已经发出去了，清掉缩略图，免得下一句又带同一张
			this.images = [];
			this.renderShots();
			this.renderResult(result.reply, result.pending, result.stopped, result.usage, result.model);
		} catch (err) {
			const msg = err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err);
			this.showError(msg);
		} finally {
			this.setBusy(false);
		}
	}

	private async runMore(): Promise<void> {
		if (this.busy || !this.state) return;
		const before = { ...this.state.usage };
		this.setBusy(true);
		try {
			const result = await continueAgent(this.app, this.plugin.settings, this.state, {
				onStep: (step) => this.addStep(step),
			});
			this.state = result.state;
			this.pending = result.pending;
			// 续跑返回的是累计用量，这里只记新增那几步，避免和上一轮重复计账
			this.plugin.recordUsage({
				hit: result.usage.hit - before.hit,
				miss: result.usage.miss - before.miss,
				out: result.usage.out - before.out,
			});
			await savePending(this.app, this.plugin.manifest.id, this.pending);
			this.renderResult(result.reply, result.pending, result.stopped, result.usage, result.model);
		} catch (err) {
			const msg = err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err);
			this.showError(msg);
		} finally {
			this.setBusy(false);
		}
	}

	private renderResult(
		reply: string,
		pending: PendingOp[],
		stopped: StopReason,
		usage?: Usage,
		model?: string
	): void {
		this.resultEl.empty();

		const body = this.resultEl.createDiv({ cls: "dsv-reply" });
		body.setText(reply);

		if (!pending.length) {
			const bar = this.resultEl.createDiv({ cls: "dsv-actions" });
			if (stopped !== "done") {
				const more = bar.createEl("button", { cls: "mod-cta dsv-btn-main", text: s("amContinue") });
				more.addEventListener("click", () => void this.runMore());
			}
			const copy = bar.createEl("button", { text: s("amCopyReply") });
			copy.addEventListener("click", () => {
				void navigator.clipboard
					.writeText(reply)
					.then(() => new Notice(s("vmCopied")))
					.catch(() => new Notice(s("vmCopyFail")));
			});
			if (usage && model && !isEmptyUsage(usage)) this.usageLine(usage, model);
			return;
		}

		const box = this.resultEl.createDiv({ cls: "dsv-ops" });
		box.createDiv({ cls: "dsv-ops-title", text: F.pendingOps(pending.length) });
		for (const op of pending) {
			const row = box.createDiv({ cls: `dsv-op is-${op.kind}` });
			row.createSpan({ cls: "dsv-op-dot" });
			row.createSpan({ cls: "dsv-op-text", text: describeOp(op) });
		}

		const bar = this.resultEl.createDiv({ cls: "dsv-actions" });
		const go = bar.createEl("button", { cls: "mod-cta dsv-btn-main", text: s("amCommit") });
		go.addEventListener("click", () => void this.commit(go));
		if (stopped !== "done") {
			const more = bar.createEl("button", { text: s("amContinue") });
			more.addEventListener("click", () => void this.runMore());
		}
		const copy = bar.createEl("button", { text: s("amCopyReply") });
		copy.addEventListener("click", () => {
			void navigator.clipboard
				.writeText(reply)
				.then(() => new Notice(s("vmCopied")))
				.catch(() => new Notice(s("vmCopyFail")));
		});
		const drop = bar.createEl("button", { text: s("amDiscard") });
		drop.addEventListener("click", () => void this.discard());
		if (usage && model && !isEmptyUsage(usage)) this.usageLine(usage, model);
	}

	private async commit(btn: HTMLButtonElement): Promise<void> {
		if (!this.pending.length) return;
		btn.disabled = true;
		btn.setText(s("amCommitting"));
		try {
			const done = await commitAgent(this.app, this.pending);
			new Notice(done.length ? F.doneNotice(done[0]) : s("toastApplied"), 6000);
			this.pending = [];
			this.state = null;
			await clearPending(this.app, this.plugin.manifest.id);
			this.addStep({
				tool: "commit",
				label: F.appliedOps(done.length),
				ok: true,
			});
			// 手机上连着做事：执行完不关窗，清空输入等着下一句
			this.resultEl.empty();
			this.resultEl.createDiv({ cls: "dsv-reply", text: s("amDone") });
			this.inputEl.value = "";
			this.autoGrow();
			this.inputEl.focus();
		} catch (err) {
			btn.disabled = false;
			btn.setText(s("amCommit"));
			this.showError(err instanceof Error ? err.message : String(err));
		}
	}
}
