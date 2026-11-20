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
		art.innerHTML = `<img alt="" width="44" height="44" style="display:block;border-radius:50%;object-fit:contain" src="data:image/png;base64,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">`;
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
