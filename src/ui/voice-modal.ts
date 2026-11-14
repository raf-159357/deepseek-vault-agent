import { App, EditorPosition, MarkdownView, Modal, Notice, TFile, setIcon } from "obsidian";
import type DeepSeekVoicePlugin from "../main";
import { ApiError, chatCompletionDetailed, supportsVision, transcribe } from "../deepseek";
import { buildMessages } from "../prompts";
import { describeResult, guardFileSize, parseResult, writeResult } from "../apply";
import { WavRecorder } from "../audio";
import { cropImage, pickImage } from "../image";
import { openCropSheet } from "../crop";
import { FULL_RECT } from "../crop-math";
import { prepareShot } from "../shot";
import { estimateCost, isEmptyUsage, savedByCache, type Usage } from "../usage";
import { F, s } from "../i18n";
import { MAX_IMAGES } from "../types";
import type { PickedImage, VoiceContext, VoiceMode, VoiceResult } from "../types";

interface ModeDef {
	id: VoiceMode;
	label: () => string;
}

const MODES: ModeDef[] = [
	{ id: "append", label: () => s("vmModeAppend") },
	{ id: "replace-note", label: () => s("vmModeRewrite") },
	{ id: "replace-selection", label: () => s("vmModeSelection") },
	{ id: "create-note", label: () => s("vmModeCreate") },
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
	private recTimer: number | null = null;
	private transcribing = false;
	private images: PickedImage[] = [];
	private shotBtns: HTMLButtonElement[] = [];
	private shotsEl: HTMLElement | null = null;
	private visionHinted = false;
	private usage: Usage | null = null;
	private usedModel = "";

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
		head.createDiv({ cls: "dsv-title", text: s("vmTitle") });
		head.createDiv({
			cls: "dsv-sub",
			text: this.ctx.file ? this.ctx.file.path : s("vmNoNote"),
		});

		const chips = contentEl.createDiv({ cls: "dsv-chips" });
		for (const def of MODES) {
			const chip = chips.createEl("button", { cls: "dsv-chip", text: def.label() });
			chip.addEventListener("click", () => this.setMode(def.id));
			this.chips.set(def.id, chip);
		}

		this.buildShots(contentEl);

		if (this.plugin.settings.asrEnabled) {
			const rec = contentEl.createDiv({ cls: "dsv-rec" });
			this.recBtn = rec.createEl("button", { cls: "dsv-recbtn", text: s("vmStart") });
			this.recBtn.addEventListener("click", () => void this.toggleRecord());
			this.recHint = rec.createDiv({ cls: "dsv-rechint" });
			this.recHint.setText(F.recHint(MAX_RECORD_SECONDS));
		}

		this.inputEl = contentEl.createEl("textarea", { cls: "dsv-input" });
		this.inputEl.rows = 5;
		this.inputEl.placeholder = s("vmPlaceholder");
		this.inputEl.value = this.presetText;
		this.inputEl.addEventListener("input", () => this.autoGrow());
		this.inputEl.addEventListener("keydown", (evt: KeyboardEvent) => {
			if (evt.key === "Enter" && (evt.metaKey || evt.ctrlKey)) {
				evt.preventDefault();
				void this.submit();
			}
		});

		const hint = contentEl.createDiv({ cls: "dsv-hint" });
		hint.setText(F.kbHint());

		const footer = contentEl.createDiv({ cls: "dsv-footer" });
		const closeBtn = footer.createEl("button", { cls: "dsv-btn-quiet", text: s("vmClose") });
		closeBtn.addEventListener("click", () => this.close());
		this.goBtn = footer.createEl("button", { cls: "mod-cta dsv-btn-main", text: s("vmGenerate") });
		this.goBtn.addEventListener("click", () => void this.submit());

		this.resultEl = contentEl.createDiv({ cls: "dsv-result" });

		this.setMode(this.mode);
		this.autoGrow();

		window.setTimeout(() => {
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

	/** 拍照 / 相册：拍一页书或处方，直接转成笔记 */
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

	private async addImage(useCamera: boolean): Promise<void> {
		if (this.busy) return;
		if (this.images.length >= MAX_IMAGES) {
			new Notice(F.imageLimit(MAX_IMAGES), 5000);
			return;
		}
		try {
			const picked = await pickImage(useCamera);
			if (!picked) return;
			const ready = await prepareShot(this.app, picked, {
				crop: this.plugin.settings.cropShot,
				save: this.plugin.settings.shotToNote,
				onSavePref: async (value) => {
					this.plugin.settings.shotToNote = value;
					await this.plugin.saveSettings();
				},
			});
			if (!ready) return;
			this.images.push(ready);
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
			const thumb = cell.createEl("img", { cls: "dsv-shot-img", attr: { src: img.dataUrl, alt: img.name } });
			thumb.setAttribute("title", s("cropRedo"));
			thumb.addEventListener("click", () => void this.recrop(index));
			const del = cell.createEl("button", { cls: "dsv-shot-x", text: "×" });
			del.setAttribute("aria-label", s("amClose"));
			del.addEventListener("click", () => {
				this.images.splice(index, 1);
				this.renderShots();
			});
		});
	}

	/** 点缩略图重开框选：以未裁的原图为底 */
	private async recrop(index: number): Promise<void> {
		const current = this.images[index];
		if (!current || this.busy) return;
		const base = current.original ?? current.dataUrl;
		const choice = await openCropSheet(base, current.crop ?? FULL_RECT, this.plugin.settings.shotToNote);
		if (!choice) return;
		this.images[index] = await cropImage(base, choice.rect, current);
		this.renderShots();
	}

	private autoGrow(): void {
		this.inputEl.setCssProps({ height: `${Math.min(this.inputEl.scrollHeight + 2, 260)}px` });
	}

	private canUseMode(mode: VoiceMode): boolean {
		if (mode === "create-note") return true;
		if (!this.ctx.file) return false;
		if (mode === "replace-selection") return this.ctx.selection.length > 0;
		return true;
	}

	private setMode(mode: VoiceMode): void {
		if (!this.canUseMode(mode)) {
			if (mode === "replace-selection") new Notice(s("vmNeedSelection"));
			else if (!this.ctx.file) new Notice(s("vmNeedNote"));
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

	private setBusy(busy: boolean, label?: string): void {
		this.busy = busy;
		this.goBtn.disabled = busy;
		this.goBtn.setText(busy ? s("vmGenerating") : label ?? s("vmGenerate"));
		for (const btn of this.shotBtns) btn.disabled = busy;
		this.modalEl.toggleClass("is-busy", busy);
	}

	private startTimer(): void {
		this.stopTimer();
		this.recTimer = window.setInterval(() => {
			const seconds = Math.floor(this.recorder?.elapsedSeconds ?? 0);
			this.recBtn.setText(F.recElapsed(seconds));
			this.recBtn.addClass("is-recording");
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
			this.recBtn.setText(F.recElapsed(0));
			this.recBtn.addClass("is-recording");
			this.recHint.setText(s("vmRecording"));
			this.startTimer();
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			this.recorder = null;
			new Notice(F.micFail(msg), 8000);
			this.recHint.setText(F.micFailHint());
		}
	}

	private async finishRecording(): Promise<void> {
		const recorder = this.recorder;
		if (!recorder || this.transcribing) return;
		this.stopTimer();
		this.transcribing = true;
		this.recBtn.setText(s("vmTranscribing"));
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
			this.recHint.setText(s("vmTranscribed"));
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			this.recorder = null;
			new Notice(msg, 8000);
			this.recHint.setText(msg);
		} finally {
			this.transcribing = false;
			this.recBtn.disabled = false;
			this.recBtn.setText(s("vmStart"));
			this.recBtn.removeClass("is-recording");
		}
	}

	private showError(message: string): void {
		this.resultEl.empty();
		const box = this.resultEl.createDiv({ cls: "dsv-error" });
		box.setText(message);
		if (message.includes("API Key") || message.includes("401")) {
			const btn = box.createEl("button", { text: s("vmKey") });
			btn.addEventListener("click", () => {
				this.close();
				this.plugin.openSettings();
			});
		}
	}

	private async submit(): Promise<void> {
		if (this.busy) return;
		const typed = this.inputEl.value.trim();
		const instruction = typed || (this.images.length ? s("amPhotoOnly") : "");
		if (!instruction) {
			new Notice(s("vmEmpty"));
			this.inputEl.focus();
			return;
		}

		this.lastInstruction = instruction;
		this.lastResult = null;
		this.resultEl.empty();
		this.setBusy(true);

		try {
			const messages = buildMessages(this.ctx, instruction, this.mode, this.plugin.settings);
			const detail = await chatCompletionDetailed(this.plugin.settings, messages, {
				json: true,
				images: this.images.map((img) => img.dataUrl),
			});
			const raw = detail.text;
			this.usage = detail.usage;
			this.usedModel = detail.model;
			this.plugin.recordUsage(detail.usage);
			// 图已发出，清掉缩略图，避免重试时重复带同一张
			this.images = [];
			this.renderShots();
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
			this.resultEl.createDiv({ cls: "dsv-notes", text: `${s("vmNote")}${res.notes}` });
		}

		if (res.action === "replace-selection" && this.ctx.selection) {
			const old = this.resultEl.createEl("details", { cls: "dsv-preview" });
			old.createEl("summary", { text: s("vmOldSelection") });
			old.createEl("pre", { cls: "dsv-pre" }).setText(this.ctx.selection);
		}

		if (res.action === "replace-note" && this.ctx.noteContent) {
			const old = this.resultEl.createEl("details", { cls: "dsv-preview" });
			old.createEl("summary", { text: s("vmOldBody") });
			old.createEl("pre", { cls: "dsv-pre" }).setText(this.ctx.noteContent.slice(0, 400));
		}

		const preview = this.resultEl.createEl("details", { cls: "dsv-preview" });
		preview.createEl("summary", { text: F.contentLen(res.content.length) });
		preview.createEl("pre", { cls: "dsv-pre" }).setText(res.content);

		if (this.usage && this.usedModel && !isEmptyUsage(this.usage)) {
			const u = this.usage;
			this.resultEl.createDiv({
				cls: "dsv-usage",
				text: F.usageLine(u.hit, u.miss, u.out, estimateCost(u, this.usedModel).toFixed(4), savedByCache(u, this.usedModel).toFixed(4)),
			});
		}

		const bar = this.resultEl.createDiv({ cls: "dsv-actions" });
		const writeBtn = bar.createEl("button", { cls: "mod-cta", text: s("vmWrite") });
		writeBtn.addEventListener("click", () => void this.applyResult());
		const copyBtn = bar.createEl("button", { text: s("vmCopy") });
		copyBtn.addEventListener("click", () => {
			void navigator.clipboard
				.writeText(res.content)
				.then(() => new Notice(s("vmCopied")))
				.catch(() => new Notice(s("vmCopyFail")));
		});
		const retryBtn = bar.createEl("button", { text: s("vmRetry") });
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
