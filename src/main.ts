import { MarkdownView, Notice, Platform, Plugin, TFile } from "obsidian";
import { DEFAULT_SETTINGS, DeepSeekVoiceSettings, normalizeSettings, VoiceNotesSettingTab } from "./settings";
import { buildContext, VoiceModal, VoiceModalOptions } from "./ui/voice-modal";
import { AgentModal, AgentModalOptions } from "./ui/agent-modal";
import { resetLang, s, setLang } from "./i18n";
import type { AgentState, VoiceContext, VoiceMode } from "./types";
import { clearSession, loadSession, saveSession } from "./session-store";
import { continueAgent } from "./agent";
import { isEmptyUsage, type Usage } from "./usage";

/** 悬浮按钮图标（大肥鱼立绘裁剪，MIT，见 THIRD-PARTY-NOTICES.md），内嵌避免额外请求 */
const FAB_ICON = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAKAAAACgCAMAAAC8EZcfAAAB4FBMVEXb3OFopN2bpZvnpluPoNMmHyvo1q+TaVzi4dzZrZm2trbt7Odla4uhiHatyuqtxqJsn1rs7OdchrNpYl1FO00uPYIxXSoaKmM2aKhIMzQqbyfSbGPvx2w8S19EbT1teB5NbUju7rSitJygqXnQtMuq3ajtrKpKdULFYlg2YMdIbcPgaGiUwnlJdEL//39WnlFPaj3mmT26zLe/Pz9EazuhXV2Jf6H//wDYnJXcg3jShHrGZVwA////AADBzbm9WFCDXjwtgkFYiE5qkV4A/wD29PEAAADt6uZTZKZQd0cvN21KWJbp5NxDaztnllb+/v7T1s1MXaIkKVOSqIx6qGRahU1qdrM3R4ltZnD6+vg7ZjTPyM2yuKx3lm9rimU3Q3RtiMgyNlNxldPt2dFiiFcbI1GKh4pVVm2tp6v5+Pa4xbJISWrl2uZWdLZyol2VlpIVGkmHtG4VFzJGcT3GyLxKRlSEqnElLGR2dHiitZtQY5hHbUGas4/08/DV1uiCm3pYh8xUecc4VJJBTYpibaooJjT29fKFlM/08/BkWmvb4dV4eIYGBAnKubVXVFjHWlH19PFwgrmXmKrEu8inm5aMeXY6WKQICi5sV1ft6+ejmqq4tcdkfcJ/f3/qysaEe4jjlquUAAAAoHRSTlPm/+n////+/hD/A2H////u+57//v///v///wv3//6qDhoFqxH/CxKsX///EP9kAg3a/6UEdwT/AaupYqgBAYBW+1qlVAH+AP7//v///v7+BP7///3+/v///87+/v79/P///////v////+1/v////7+//7//v7//v///v/9/Gf//v///////y//Uv/+//////2M//////////8t////Av//IVNMKQAAKVNJREFUeNq9fQdD29jWrUMgJDNpk565U27v9Suv9/cOsiQXWW7CkiwLV9wxtjElECCQAAMTSG+Tv/rWPnLHpEy5ZyYGjC0tr933PhKuqR+0Pv+8++2ndz69c+e//P73v79z586nn/6q87Tf7/9BZ3B973e+8b/hEP/2859/9buvfjnLsM6dO/ezb/cZC4bEr/7+1e/+7evPCah/6hP/Pxug/1ecos+/+re/e73eeVEUFwVP8Mv/9bOfffvtpGnGYvNhkVas+fDh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";

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
		this.registerDomEvent(activeDocument, "visibilitychange", () => {
			if (activeDocument.visibilityState === "hidden") {
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
		// 图标：大肥鱼鲸鱼娘（1190fasheqi/dafeiyu-pet，MIT），用 DOM 构建，避免 innerHTML
		const icon = art.createEl("img");
		icon.width = 48;
		icon.height = 48;
		icon.alt = "";
		icon.src = FAB_ICON;
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
			if (dragging || !this.settings.floatingButton || activeDocument.visibilityState === "hidden") return;
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
