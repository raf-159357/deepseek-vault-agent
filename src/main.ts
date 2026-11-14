import { MarkdownView, Notice, Platform, Plugin, TFile, setIcon } from "obsidian";
import { DEFAULT_SETTINGS, DeepSeekVoiceSettings, normalizeSettings, VoiceNotesSettingTab } from "./settings";
import { buildContext, VoiceModal, VoiceModalOptions } from "./ui/voice-modal";
import { AgentModal, AgentModalOptions } from "./ui/agent-modal";
import { resetLang, s, setLang } from "./i18n";
import type { VoiceContext, VoiceMode } from "./types";
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
	private fabEl: HTMLElement | null = null;
	private statsTimer: number | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.applyLanguage();

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

	onunload(): void {
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
		setIcon(el, "mic");
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

		el.addEventListener("pointerdown", (evt: PointerEvent) => {
			longFired = false;
			dragging = false;
			startX = evt.clientX;
			startY = evt.clientY;
			startRight = this.settings.fabRight;
			startBottom = this.settings.fabBottom;
			longPress = window.setTimeout(() => {
				longFired = true;
				longPress = null;
				void this.openVoice({ mode: "append" });
			}, 550);
		});

		el.addEventListener("pointermove", (evt: PointerEvent) => {
			if (longPress === null && !longFired) return;
			const dx = startX - evt.clientX;
			const dy = startY - evt.clientY;
			if (!dragging && Math.abs(dx) + Math.abs(dy) > 8) {
				dragging = true;
				clearLong();
			}
			if (!dragging) return;
			const right = Math.max(8, Math.min(startRight + dx, 400));
			const bottom = Math.max(8, Math.min(startBottom + dy, 800));
			this.settings.fabRight = Math.round(right);
			this.settings.fabBottom = Math.round(bottom);
			el.setCssProps({ right: `${this.settings.fabRight}px`, bottom: `${this.settings.fabBottom}px` });
		});

		const finish = () => {
			clearLong();
			if (dragging) {
				dragging = false;
				void this.saveSettings();
				return;
			}
			if (!longFired) void this.openAgent({});
			longFired = false;
		};

		el.addEventListener("pointerup", finish);
		el.addEventListener("pointercancel", () => {
			clearLong();
			longFired = false;
			dragging = false;
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
