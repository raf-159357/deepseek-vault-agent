import { MarkdownView, Notice, Plugin, TFile } from "obsidian";
import { DEFAULT_SETTINGS, DeepSeekVoiceSettings, VoiceNotesSettingTab } from "./settings";
import { buildContext, VoiceModal, VoiceModalOptions } from "./ui/voice-modal";
import { AgentModal, AgentModalOptions } from "./ui/agent-modal";
import type { VoiceContext, VoiceMode } from "./types";

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

	async onload(): Promise<void> {
		await this.loadSettings();

		this.addRibbonIcon("mic", "语音笔记（DeepSeek）", () => {
			void this.openVoice({});
		});

		this.addCommand({
			id: "open-voice-append",
			name: "语音输入：追加到当前笔记",
			callback: () => void this.openVoice({ mode: "append" }),
		});

		this.addCommand({
			id: "open-voice-rewrite",
			name: "语音输入：改写当前笔记",
			callback: () => void this.openVoice({ mode: "replace-note" }),
		});

		this.addCommand({
			id: "open-voice-create",
			name: "语音输入：新建笔记",
			callback: () => void this.openVoice({ mode: "create-note" }),
		});

		this.addCommand({
			id: "open-agent",
			name: "AI 指令：联网查资料 / 整理笔记",
			callback: () => void this.openAgent({}),
		});

		this.addCommand({
			id: "open-agent-links",
			name: "AI 指令：读当前笔记里的链接并整理",
			callback: () =>
				void this.openAgent({ presetText: "把当前笔记里出现的链接都读一遍，提炼要点，整理成一篇新的笔记" }),
		});

		this.addRibbonIcon("sparkles", "AI 指令（可联网）", () => {
			void this.openAgent({});
		});

		// obsidian://deepvoice?vault=库名&mode=append&text=...&auto=1
		// action=agent 时进入 AI 指令模式：obsidian://deepvoice?action=agent&text=...&auto=1
		// 供 iOS 快捷指令 / 轻点背面 / 操作按钮调用
		this.registerObsidianProtocolHandler("deepvoice", (params) => {
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
		});

		this.addSettingTab(new VoiceNotesSettingTab(this.app, this));

		if (!this.settings.apiKey) {
			// 首次安装给一次提示，等界面就绪再弹，避免用裸定时器
			this.app.workspace.onLayoutReady(() => {
				new Notice("DeepSeek Voice Notes：还没填 API Key，去「设置 → 第三方插件」里填。", 8000);
			});
		}
	}

	onunload(): void {
		/* 没有常驻资源需要释放 */
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
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data ?? {});
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
