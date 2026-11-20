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
		art.innerHTML = `<img alt="" width="48" height="48" style="display:block;border-radius:50%;object-fit:contain" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAJAAAACQCAMAAADQmBKKAAABgFBMVEWdoZwVESDj5eKgrNHg1NaQnnRqpeDs7uxgWVz09fTZ1bRuhLNolFq2uLY6XKQZKGSRbGKox5qCe4VjpFtcecOvyOl3enblnljNYVXxw1ZGPE1eikw2Yi0qO4LYrpeq5alOMzVFZzlmllSnq2L1c3A3SWo7a8d/dz9WZouwxqbFY1NVfkXPZFh//38ffx+8PTMA/wD//wCVtIjG2r3/AACoxp6//3+WvoTE1b+2SEiabD1RgD/z8/AAAADu7exTZKYvN25YhEhKWJZlk1N2pGL+/v729vZpdrM3R4n7+/vPyM0lKVNMXaLV189sZ3A3RHWKho1tiMgxNVRVVW1TfER2mGlJSmtxltOsp6scI1Hs2NJXdLVyol1ijFLt5Nrm2ue2trNJRlUVFzWzx6sVG0tSY5SEqHaXlZd1dodMeTx3dHglLGNXh8yXtors7Ow5VZJVeMVmW2vFvMjW1ujJu7YoJjbs7exibaqKd3ZnaYro6ujr7euEk8/HxLtBTYrY4tQgVkZoAAAAgHRSTlP9/xf/9/7/m/5f/P/xBf///vn/Ef//A//3//9q////CP//qAYJ//8F/1tgdJoCAxsBAay0AasEU1wH///+AP7///7//v4Dzf//sf////7////////+/v////////7+/v/////+///9///+/////HP/////////0f///yxT/////vBJH+YAAB2nSURBVHjatZyJY9pIsvDFZeP7yDGzmSST2dnz7b77ve9sJCGMJSR0IBlZAoO5wfi+7Uls/+uvqiWwwAg7s5lO4sgc0k9V1VXV1d1iUr+mvc2+ejs8/uFvP3jtbz/MzQ1effXq56VfdWrmq7+RzWaj9GBubi4XX0ymA+2Q3by62jz6PBf1P5n97YHoJbLR/7PGEGgdn2Rrb28L/tsrsoQ2Nv4fSz7UbwqEp3+bjebizUwmk840D/cQZgtA7u6Ke2k46BCWJaya2NhIJGZnowj14z//VkCvACf7OUcempl0ulLJIAyVzx6VFoN0aThU1zYyO9DWHgg7G4UvPRrcNwT6r1fw4/MsXjiTrmRoQ+FsgbYqLJXL1vuffqosqs2NnQ3adjbWQIObcz+mUn9++62B/gDC+d9XKIjDAQ7yQPuppgIMmA1oqgmW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">`;
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
