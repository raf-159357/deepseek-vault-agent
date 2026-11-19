import { App, Modal, Notice, setIcon } from "obsidian";
import type DeepSeekVoicePlugin from "../main";
import { ApiError, supportsVision, transcribe } from "../deepseek";
import { commitAgent, continueAgent, followUpAgent, runAgent } from "../agent";
import { buildSkillPrompt, getSkill } from "../skills";
import { describeOp } from "../vault-tools";
import { WavRecorder } from "../audio";
import { cropImage, pickImage } from "../image";
import { openCropSheet } from "../crop";
import { FULL_RECT } from "../crop-math";
import { prepareShot } from "../shot";
import { replaceShot } from "../shot-save";
import { clearPending, loadPending, savePending } from "../pending-store";
import { estimateCost, savedByCache, isEmptyUsage, type Usage } from "../usage";
import { F, isEn, s } from "../i18n";
import { AGENT_STEP_LIMIT, MAX_IMAGES } from "../types";
import type { AgentRunResult, AgentState, AgentStep, PendingOp, PickedImage, StopReason, VoiceContext } from "../types";

const MAX_RECORD_SECONDS = 120;
/** 对话流里最多显示几轮，再早的收起来，免得手机上翻半天 */
const MAX_THREAD_TURNS = 6;

function errorMessage(err: unknown): string {
	if (err instanceof ApiError) return err.message;
	return err instanceof Error ? err.message : String(err);
}

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
	private threadEl: HTMLElement | null = null;
	private badgeEl!: HTMLElement;
	private newChatBtn!: HTMLButtonElement;
	private busy = false;

	private recorder: WavRecorder | null = null;
	private recTimer: number | null = null;
	private transcribing = false;
	private pending: PendingOp[] = [];
	private images: PickedImage[] = [];
	private state: AgentState | null = null;
	/** 下一句要顺手告诉模型的补充说明（上一批操作执行了 / 被丢弃了） */
	private appliedNote = "";
	private visionHinted = false;
	/** 没存进库时只提醒一次，别每次加图都弹 */
	private shotHinted = false;
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
		const headTop = head.createDiv({ cls: "dsv-head-top" });
		headTop.createDiv({ cls: "dsv-title", text: s("amTitle") });
		this.newChatBtn = headTop.createEl("button", { cls: "dsv-newchat", text: s("amNewChat") });
		this.newChatBtn.addEventListener("click", () => void this.newChat());
		const where = this.ctx.file ? this.ctx.file.path : isEn() ? "no note open" : "当前没有打开的笔记";
		head.createDiv({
			cls: "dsv-sub",
			text: isEn() ? `${where} · web access · reads and writes this vault` : `${where} · 可联网 · 可读写本库`,
		});
		this.badgeEl = head.createDiv({ cls: "dsv-badge" });

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
		this.adoptSession();
		this.syncHead();
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
		if (this.pending.length) return;
		const saved = await loadPending(this.app, this.plugin.manifest.id);
		if (!saved.length || this.pending.length) return;
		this.pending = saved;
		// 接着上次的对话时，队列也要跟着回到这段对话里
		if (this.state) this.state.pending = saved;
		this.renderTurn(null, F.restored(saved.length), saved, "done");
	}

	/** 关掉弹窗再打开，还是同一段对话 —— 用户不必把背景重讲一遍 */
	private adoptSession(): void {
		const saved = this.plugin.agentSession;
		if (!saved || !saved.messages.length) return;
		this.state = saved;
		this.pending = saved.pending ?? [];
		this.renderTurn(null, F.resumed(saved.turns ?? 1), this.pending, "done");
	}

	/** 抬头上的「第几轮 / 新对话」和输入框提示，都跟着当前有没有对话走 */
	private syncHead(): void {
		const turns = this.state?.turns ?? 0;
		this.badgeEl.setText(turns > 1 ? F.turnsHint(turns) : "");
		this.badgeEl.toggleClass("is-empty", turns <= 1);
		this.newChatBtn.toggleClass("is-hidden", !this.state);
		this.inputEl.placeholder = this.state ? s("amPlaceholderNext") : s("amPlaceholder");
		if (!this.busy) this.runBtn.setText(this.state ? s("amSend") : s("amRun"));
	}

	private async discard(): Promise<void> {
		const n = this.pending.length;
		this.pending = [];
		if (this.state) this.state.pending = [];
		await clearPending(this.app, this.plugin.manifest.id);
		this.appliedNote = n ? F.discardedForModel(n) : "";
		this.renderTurn(null, F.discardedContinue(n), [], "done");
		this.syncHead();
	}

	private async newChat(): Promise<void> {
		if (this.busy) return;
		this.state = null;
		this.plugin.agentSession = null;
		this.appliedNote = "";
		this.threadEl = null;
		this.resultEl.empty();
		this.stepsEl.empty();
		this.stepsHead.setText("");
		this.stepCount = 0;
		this.inputEl.value = "";
		this.autoGrow();
		this.syncHead();
		// 待确认的写操作是真实排好的，开新对话不等于丢弃它们
		if (this.pending.length) this.renderTurn(null, F.newChatKept(this.pending.length), this.pending, "done");
		else new Notice(F.newChatStarted());
		this.inputEl.focus();
	}

	private usageText(usage: Usage, model: string): string {
		const cost = estimateCost(usage, model).toFixed(4);
		const saved = savedByCache(usage, model).toFixed(4);
		return F.usageLine(usage.hit, usage.miss, usage.out, cost, saved);
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
			// 没存进库就没有路径，模型没法在笔记里引用它 —— 先说清楚
			if (!ready.savedPath && !this.shotHinted) {
				this.shotHinted = true;
				new Notice(F.shotOffHint(), 9000);
			}
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
			const thumb = cell.createEl("img", {
				cls: "dsv-shot-img",
				attr: { src: img.dataUrl, alt: img.name },
			});
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

	/** 点缩略图重开框选：以未裁的原图为底，反复改也不会越裁越糊 */
	private async recrop(index: number): Promise<void> {
		const current = this.images[index];
		if (!current || this.busy) return;
		const base = current.original ?? current.dataUrl;
		const choice = await openCropSheet(base, current.crop ?? FULL_RECT, this.plugin.settings.shotToNote);
		if (!choice) return;
		this.images[index] = await replaceShot(this.app, await cropImage(base, choice.rect, current));
		this.renderShots();
	}

	private autoGrow(): void {
		this.inputEl.setCssProps({ height: `${Math.min(this.inputEl.scrollHeight + 2, 220)}px` });
	}

	private setBusy(busy: boolean, label?: string): void {
		this.busy = busy;
		this.runBtn.disabled = busy;
		this.runBtn.setText(busy ? s("amRunning") : label ?? (this.state ? s("amSend") : s("amRun")));
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
		// 只清掉按钮和上一次的错误，上面的对话记录留着
		this.clearActions();
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

		const state = this.state;
		const before = state ? { ...state.usage } : null;
		const note = this.appliedNote;
		this.appliedNote = "";

		this.stepsEl.empty();
		this.stepCount = 0;
		this.stepsHead.setText("");
		this.setBusy(true);

		try {
			const images = this.images.map((img) => img.dataUrl);
			const shots = this.images.map((img) => img.savedPath).filter((p): p is string => !!p);
			const onStep = (step: AgentStep): void => this.addStep(step);
			// 当前功能（学 / 文 / 帐）合成的提示词块：基座 + 用户的补充
			const skill = getSkill(this.plugin.settings.currentSkillId);
			const skillBlock = buildSkillPrompt(skill, this.plugin.settings.skillMine?.[skill.id]);
			// 已经在对话里就接着说（上文都在），没有才新开一段
			const result = state
				? await followUpAgent(this.app, this.plugin.settings, state, this.ctx, instruction, {
						images,
						shots,
						note,
						onStep,
						skillBlock,
				  })
				: await runAgent(this.app, this.plugin.settings, this.ctx, instruction, {
						images,
						shots,
						pending: this.pending,
						onStep,
						skillBlock,
				  });

			// 图已经发出去了，清掉缩略图，免得下一句又带同一张
			this.images = [];
			this.renderShots();
			this.applyResult(instruction, result, before);
		} catch (err) {
			this.showError(errorMessage(err));
		} finally {
			this.setBusy(false);
		}
		this.syncHead();
	}

	/** 一次运行的结果落到界面上：对话流里追加一轮，按钮跟着换 */
	private applyResult(ask: string, result: AgentRunResult, before: Usage | null): void {
		this.state = result.state;
		this.plugin.agentSession = result.state;
		this.pending = result.pending;
		// 接口给的是这一段对话的累计用量，账本只记这一轮新增的
		const delta = before
			? {
					hit: result.usage.hit - before.hit,
					miss: result.usage.miss - before.miss,
					out: result.usage.out - before.out,
			  }
			: result.usage;
		this.plugin.recordUsage(delta);
		void savePending(this.app, this.plugin.manifest.id, this.pending);
		this.renderTurn(ask, result.reply, result.pending, result.stopped, delta, result.model);
		this.syncHead();
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
			this.plugin.agentSession = result.state;
			this.pending = result.pending;
			// 续跑返回的是累计用量，这里只记新增那几步，避免和上一轮重复计账
			const delta = {
				hit: result.usage.hit - before.hit,
				miss: result.usage.miss - before.miss,
				out: result.usage.out - before.out,
			};
			this.plugin.recordUsage(delta);
			void savePending(this.app, this.plugin.manifest.id, this.pending);
			// 续跑是同一条回答的延续，就地更新，不另起一轮
			this.updateLastTurn(result.reply, result.pending, result.stopped, delta, result.model);
		} catch (err) {
			this.showError(errorMessage(err));
		} finally {
			this.setBusy(false);
		}
		this.syncHead();
	}

	private ensureThread(): HTMLElement {
		if (!this.threadEl || !this.threadEl.isConnected) {
			this.resultEl.empty();
			this.threadEl = this.resultEl.createDiv({ cls: "dsv-thread" });
		}
		return this.threadEl;
	}

	/** 按钮和错误条每轮重画，对话记录不动 */
	private clearActions(): void {
		for (const el of Array.from(this.resultEl.querySelectorAll(".dsv-actions, .dsv-ops, .dsv-error"))) {
			el.remove();
		}
	}

	private lastTurn(): HTMLElement | null {
		return (this.threadEl?.lastElementChild as HTMLElement | undefined) ?? null;
	}

	/** 对话流追加一轮：你说的话 + 它答的话；早于 6 轮的收起，手机上不至于翻半天 */
	private renderTurn(
		ask: string | null,
		reply: string,
		pending: PendingOp[],
		stopped: StopReason,
		usage?: Usage,
		model?: string
	): void {
		const thread = this.ensureThread();
		this.clearActions();

		const turn = thread.createDiv({ cls: ask ? "dsv-turn" : "dsv-turn is-note" });
		if (ask) {
			const row = turn.createDiv({ cls: "dsv-ask" });
			row.createSpan({ cls: "dsv-ask-label", text: F.you() });
			row.createSpan({ cls: "dsv-ask-text", text: ask });
		}
		turn.createDiv({ cls: "dsv-reply", text: reply });
		if (usage && model && !isEmptyUsage(usage)) {
			turn.createDiv({ cls: "dsv-usage", text: this.usageText(usage, model) });
		}

		while (thread.children.length > MAX_THREAD_TURNS) {
			const oldest = thread.firstElementChild;
			if (!oldest) break;
			oldest.remove();
		}

		this.renderActions(reply, pending, stopped);
		turn.scrollIntoView({ block: "nearest" });
	}

	/** 续跑：同一轮回答换掉，不新起一轮 */
	private updateLastTurn(reply: string, pending: PendingOp[], stopped: StopReason, usage?: Usage, model?: string): void {
		const turn = this.lastTurn();
		this.clearActions();
		if (turn) {
			const body = turn.querySelector<HTMLElement>(".dsv-reply");
			if (body) body.setText(reply);
			turn.querySelector(".dsv-usage")?.remove();
			if (usage && model && !isEmptyUsage(usage)) {
				turn.createDiv({ cls: "dsv-usage", text: this.usageText(usage, model) });
			}
		}
		this.renderActions(reply, pending, stopped);
	}

	private renderActions(reply: string, pending: PendingOp[], stopped: StopReason): void {
		if (pending.length) {
			const box = this.resultEl.createDiv({ cls: "dsv-ops" });
			box.createDiv({ cls: "dsv-ops-title", text: F.pendingOps(pending.length) });
			for (const op of pending) {
				const row = box.createDiv({ cls: `dsv-op is-${op.kind}` });
				row.createSpan({ cls: "dsv-op-dot" });
				row.createSpan({ cls: "dsv-op-text", text: describeOp(op) });
			}
		}

		const bar = this.resultEl.createDiv({ cls: "dsv-actions" });
		if (pending.length) {
			const go = bar.createEl("button", { cls: "mod-cta dsv-btn-main", text: s("amCommit") });
			go.addEventListener("click", () => void this.commit(go));
		}

		// 不管答完没答完都留一个「接着问」：之前答完只剩复制，对话就断在这儿
		const ask = bar.createEl("button", { text: s("amAsk") });
		ask.addClass("dsv-btn-main");
		if (!pending.length) ask.addClass("mod-cta");
		ask.addEventListener("click", () => this.focusAsk());

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
		if (pending.length) {
			const drop = bar.createEl("button", { text: s("amDiscard") });
			drop.addEventListener("click", () => void this.discard());
		}
	}

	private focusAsk(): void {
		this.inputEl.focus();
		this.inputEl.scrollIntoView({ block: "center", behavior: "smooth" });
	}

	private async commit(btn: HTMLButtonElement): Promise<void> {
		if (!this.pending.length) return;
		btn.disabled = true;
		btn.setText(s("amCommitting"));
		try {
			const count = this.pending.length;
			const done = await commitAgent(this.app, this.pending);
			new Notice(done.length ? F.doneNotice(done[0]) : s("toastApplied"), 6000);
			this.pending = [];
			// 执行完不清空对话：上文还在，下一句可以直接说「再把标题改一下」
			if (this.state) this.state.pending = [];
			this.appliedNote = F.appliedForModel(count);
			await clearPending(this.app, this.plugin.manifest.id);
			this.addStep({
				tool: "commit",
				label: F.appliedOps(done.length),
				ok: true,
			});
			// 手机上连着做事：执行完不关窗，清空输入等着下一句
			this.renderTurn(null, F.appliedContinue(done.length), [], "done");
			this.inputEl.value = "";
			this.autoGrow();
			this.inputEl.focus();
			this.syncHead();
		} catch (err) {
			btn.disabled = false;
			btn.setText(s("amCommit"));
			this.showError(errorMessage(err));
		}
	}
}

