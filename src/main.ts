import { MarkdownView, Notice, Platform, Plugin, TFile, setIcon } from "obsidian";
import { DEFAULT_SETTINGS, DeepSeekVoiceSettings, normalizeSettings, VoiceNotesSettingTab } from "./settings";
import { buildContext, VoiceModal, VoiceModalOptions } from "./ui/voice-modal";
import { AgentModal, AgentModalOptions } from "./ui/agent-modal";
import { resetLang, s, setLang } from "./i18n";
import type { AgentState, VoiceContext, VoiceMode } from "./types";
import { clearSession, loadSession, saveSession } from "./session-store";
import { continueAgent } from "./agent";
import { isEmptyUsage, type Usage } from "./usage";

const VALID_MODES: VoiceMode[] = ["append", "replace-selection", "replace-note", "create-note"];

function pick(params: Record<string, string>, ...keys: string[]): string | undefined {
	for (const key of keys) {
		const found = params[key] ?? params[key.toLowerCase()] ?? params[key.toUpperCase()];
		if (found) return found;
	}
	return undefined;
}

export default class DeepSeekVoicePlugin extends Plugin {
	settings: DeepSeekVoiceSettings = { ...DEFAULT_SETTINGS };
	/**
	 * 当前这段 AI 对话。存在插件实例上（不是弹窗里），
	 * 所以关掉弹窗再打开能接着聊；Obsidian 重启就重来。
	 */
	agentSession: AgentState | null = null;
	/** 正在自动续跑，避免前后台切换时重复开跑 */
	private resuming = false;
	private fabEl: HTMLElement | null = null;
	private statsTimer: number | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.applyLanguage();
		// 上次没跑完的会话：读回来，回到前台就能接着跑
		this.agentSession = await loadSession(this.app, this.manifest.id);
		this.registerDomEvent(document, "visibilitychange", () => {
			if (document.visibilityState === "hidden") {
				void this.persistSession();
			} else {
				void this.maybeResume();
			}
		});

		this.addRibbonIcon("mic", s("ribbonVoice"), () => {
			void this.openVoice({});
		});

		this.addCommand({
			id: "open-voice-append",
			name: s("cmdAppend"),
			callback: () => void this.openVoice({ mode: "append" }),
		});

		this.addCommand({
			id: "open-voice-rewrite",
			name: s("cmdRewrite"),
			callback: () => void this.openVoice({ mode: "replace-note" }),
		});

		this.addCommand({
			id: "open-voice-create",
			name: s("cmdCreate"),
			callback: () => void this.openVoice({ mode: "create-note" }),
		});

		this.addCommand({
			id: "open-agent",
			name: s("cmdAgent"),
			callback: () => void this.openAgent({}),
		});

		this.addCommand({
			id: "open-agent-links",
			name: s("cmdAgentLinks"),
			callback: () =>
				void this.openAgent({
					presetText:
						this.settings.uiLang === "en"
							? "Read every link in the current note, extract the key points, and write them up as a new note"
							: "把当前笔记里出现的链接都读一遍，提炼要点，整理成一篇新的笔记",
				}),
		});

		this.addRibbonIcon("sparkles", s("ribbonAgent"), () => {
			void this.openAgent({});
		});

		// obsidian://vaultagent?vault=库名&mode=append&text=...&auto=1
		// action=agent 时进入 AI 指令模式：obsidian://vaultagent?action=agent&text=...&auto=1
		// 供 iOS 快捷指令 / 轻点背面 / 操作按钮调用。
		// 兼容：旧链接 deepvoice 永久保留，新名字 vaultagent 等价，两者都能用。
		const protocolHandler = (params: Record<string, string>) => {
			const rawMode = pick(params, "mode");
			const mode = VALID_MODES.includes(rawMode as VoiceMode) ? (rawMode as VoiceMode) : undefined;
			const text = pick(params, "text", "q");
			const auto = pick(params, "auto");
			const action = pick(params, "action");
			const autoFlag = auto === "1" || auto === "true";
			const preset = text ? decodeURIComponent(text) : undefined;

			if (action === "agent") {
				void this.openAgent({ presetText: preset, autoRun: autoFlag });
				return;
			}

			void this.openVoice({
				mode,
				presetText: preset,
				autoSubmit: autoFlag,
			});
		};

		this.registerObsidianProtocolHandler("deepvoice", protocolHandler);
		this.registerObsidianProtocolHandler("vaultagent", protocolHandler);

		this.addSettingTab(new VoiceNotesSettingTab(this.app, this));

		this.app.workspace.onLayoutReady(() => {
			this.syncFab();
			if (!this.settings.apiKey) {
				// 首次安装给一次提示，等界面就绪再弹，避免用裸定时器
				new Notice(s("noKey"), 8000);
			}
		});
	}

	/** 把当前会话写盘（每一轮都会调一次，App 被杀也能接上） */
	async persistSession(state?: AgentState): Promise<void> {
		const target = state ?? this.agentSession;
		if (!target) return;
		await saveSession(this.app, this.manifest.id, target);
	}

	/** 忘掉当前会话（用户点「新对话」时调） */
	async resetSession(): Promise<void> {
		this.agentSession = null;
		await clearSession(this.app, this.manifest.id);
	}

	/**
	 * 回到前台时自动接上：
	 * 只有因为「步数/时间到上限」而停下来的才自动跑；用户自己点暂停的不动。
	 */
	async maybeResume(): Promise<void> {
		const st = this.agentSession;
		if (!st || this.resuming || !this.settings.autoResume) return;
		const why = st.stopReason;
		if (why !== "time" && why !== "steps") return;
		this.resuming = true;
		try {
			new Notice("继续跑上次没做完的任务… / Resuming the unfinished task…");
			const res = await continueAgent(this.app, this.settings, st, {
				onCheckpoint: (next) => {
					this.agentSession = next;
					void this.persistSession(next);
				},
			});
			this.agentSession = res.state ?? st;
			await this.persistSession();
		} catch {
			/* 续跑失败就等下一条用户消息，不弹错误打断 */
		} finally {
			this.resuming = false;
		}
	}

	onunload(): void {
		void this.persistSession();
		this.fabEl?.remove();
		this.fabEl = null;
	}

	/** 按设置切换界面语言；改完文案的入口需要重开弹窗才生效 */
	applyLanguage(): void {
		const pref = this.settings.uiLang;
		if (pref === "zh" || pref === "en") setLang(pref);
		else resetLang();
	}

	/**
	 * 手机上的悬浮按钮：点一下进 AI 指令，长按进语音笔记，可以拖着走。
	 * 只在移动端且设置开启时出现。
	 */
	syncFab(): void {
		const shouldShow = Platform.isMobile && this.settings.floatingButton;
		if (!shouldShow) {
			this.fabEl?.remove();
			this.fabEl = null;
			return;
		}
		if (this.fabEl) return;

		const el = activeDocument.createElement("div");
		el.addClass("dsv-fab");
		el.setAttribute("aria-label", s("amTitle"));
		// 图标：大肥鱼鲸鱼娘（原项目 1190fasheqi/dafeiyu-pet，MIT License，见 THIRD-PARTY-NOTICES.md）
		// 已按 52px 圆钮裁成头肩构图并量化压缩，约 3.7 KB
		const art = el.createSpan({ cls: "dsv-fab-art" });
		art.innerHTML = `<img alt="" width="48" height="48" style="display:block;border-radius:50%;object-fit:contain" src="data:image/png;base64,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">`;
		el.setCssProps({
			right: `${this.settings.fabRight}px`,
			bottom: `${this.settings.fabBottom}px`,
		});

		let longPress: number | null = null;
		let longFired = false;
		let dragging = false;
		let startX = 0;
		let startY = 0;
		let startRight = 0;
		let startBottom = 0;

		const clearLong = () => {
			if (longPress !== null) {
				window.clearTimeout(longPress);
				longPress = null;
			}
		};

		/** 走两步：挑一个附近的新位置，慢慢滑过去，走的时候身体会上下晃 */
		const wanderTimer = window.setInterval(() => {
			if (dragging || !this.settings.floatingButton || document.visibilityState === "hidden") return;
			if (!this.settings.fabWander) return;
			if (this.fabEl !== el) return;
			const maxR = Math.max(8, window.innerWidth - el.offsetWidth - 10);
			const maxB = Math.max(8, window.innerHeight - el.offsetHeight - 10);
			const nextR = Math.min(maxR, Math.max(8, this.settings.fabRight + (Math.random() * 160 - 80)));
			const nextB = Math.min(maxB, Math.max(8, this.settings.fabBottom + (Math.random() * 120 - 60)));
			const goingLeft = nextR > this.settings.fabRight;
			el.toggleClass("is-left", goingLeft);
			el.addClass("is-walking");
			el.setCssProps({ right: `${Math.round(nextR)}px`, bottom: `${Math.round(nextB)}px` });
			window.setTimeout(() => el.removeClass("is-walking"), 900);
		}, 9000);
		this.registerInterval(wanderTimer);

		el.addEventListener("pointerdown", (evt: PointerEvent) => {
			longFired = false;
			dragging = false;
			startX = evt.clientX;
			startY = evt.clientY;
			startRight = this.settings.fabRight;
			startBottom = this.settings.fabBottom;
			el.addClass("is-pressed");
			el.removeClass("is-walking");
			longPress = window.setTimeout(() => {
				longFired = true;
				longPress = null;
				void this.openVoice({ mode: "append" });
			}, 550);
		});

		el.addEventListener("pointermove", (evt: PointerEvent) => {
			if (longPress === null && !longFired && !dragging) return;
			el.setAttribute("dir", "x");
			const dx = startX - evt.clientX;
			const dy = startY - evt.clientY;
			if (!dragging && Math.abs(dx) + Math.abs(dy) > 8) {
				dragging = true;
				clearLong();
				el.addClass("is-dragging");
			}
			if (!dragging) return;
			// 按屏幕实际尺寸夹住，别让它跑到屏幕外（原来写死 400/800，平板上拖不过去）
			const maxRight = Math.max(8, window.innerWidth - el.offsetWidth - 8);
			const maxBottom = Math.max(8, window.innerHeight - el.offsetHeight - 8);
			const right = Math.max(8, Math.min(startRight + dx, maxRight));
			const bottom = Math.max(8, Math.min(startBottom + dy, maxBottom));
			this.settings.fabRight = Math.round(right);
			this.settings.fabBottom = Math.round(bottom);
			el.setCssProps({ right: `${this.settings.fabRight}px`, bottom: `${this.settings.fabBottom}px` });
		});

		const finish = () => {
			clearLong();
			el.removeClass("is-pressed");
			if (dragging) {
				dragging = false;
				el.removeClass("is-dragging");
				el.addClass("is-landing");
				window.setTimeout(() => el.removeClass("is-landing"), 360);
				void this.saveSettings();
				return;
			}
			if (!longFired) {
				// 点一下：蹦一下再进指令，像被戳了一下
				el.addClass("is-tap");
				window.setTimeout(() => el.removeClass("is-tap"), 320);
				void this.openAgent({});
			}
			longFired = false;
		};

		el.addEventListener("pointerup", finish);
		el.addEventListener("pointercancel", () => {
			clearLong();
			longFired = false;
			dragging = false;
			el.removeClass("is-pressed");
			el.removeClass("is-dragging");
		});

		activeDocument.body.appendChild(el);
		this.fabEl = el;
	}

	async openVoice(options: VoiceModalOptions): Promise<void> {
		const ctx = await this.buildCtx();
		const modal = new VoiceModal(this.app, this, ctx, {
			mode: options.mode ?? this.settings.defaultMode,
			presetText: options.presetText,
			autoSubmit: options.autoSubmit,
		});
		modal.open();
	}

	async openAgent(options: AgentModalOptions): Promise<void> {
		const ctx = await this.buildCtx();
		const modal = new AgentModal(this.app, this, ctx, {
			presetText: options.presetText,
			autoRun: options.autoRun,
		});
		modal.open();
	}

	private async buildCtx(): Promise<VoiceContext> {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const active = view?.file ?? this.app.workspace.getActiveFile();
		const file: TFile | null = active && active.extension === "md" ? active : null;

		let noteContent = "";
		if (file) {
			try {
				noteContent = await this.app.vault.cachedRead(file);
			} catch {
				noteContent = "";
			}
		}
		return buildContext(this.app, file, noteContent);
	}

	openSettings(): void {
		const setting = (this.app as unknown as { setting?: { open(): void; openTabById(id: string): void } }).setting;
		if (!setting) return;
		setting.open();
		setting.openTabById(this.manifest.id);
	}

	async loadSettings(): Promise<void> {
		const data = (await this.loadData()) as Partial<DeepSeekVoiceSettings> | null;
		this.settings = normalizeSettings(data ?? {});
	}

	/**
	 * 记一次请求的用量。只为了让设置页能显示「缓存命中率大概多少」，
	 * 写盘做了合并，不会每步都写一次 disk。
	 */
	recordUsage(usage: Usage): void {
		const s = this.settings.cacheStats;
		if (isEmptyUsage(usage)) return;
		s.req += 1;
		s.hit += usage.hit;
		s.miss += usage.miss;
		s.out += usage.out;
		if (this.statsTimer !== null) window.clearTimeout(this.statsTimer);
		this.statsTimer = window.setTimeout(() => {
			this.statsTimer = null;
			void this.saveSettings();
		}, 4000);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
