import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import type DeepSeekVoicePlugin from "./main";
import { chatCompletion } from "./deepseek";
import type { VoiceMode } from "./types";

export interface DeepSeekVoiceSettings {
	apiKey: string;
	baseUrl: string;
	model: string;
	thinking: boolean;
	temperature: number;
	maxTokens: number;
	defaultMode: VoiceMode;
	requireConfirm: boolean;
	contextChars: number;
	newNoteFolder: string;
	extraSystemPrompt: string;
	asrEnabled: boolean;
}

export const DEFAULT_SETTINGS: DeepSeekVoiceSettings = {
	apiKey: "",
	baseUrl: "https://api.deepseek.com",
	model: "deepseek-flash",
	thinking: false,
	temperature: 0.3,
	maxTokens: 4000,
	defaultMode: "append",
	requireConfirm: true,
	contextChars: 6000,
	newNoteFolder: "",
	extraSystemPrompt: "",
	asrEnabled: true,
};

export const MODEL_OPTIONS: Record<string, string> = {
	"deepseek-flash": "deepseek-flash（V4.1-Flash，快且便宜，日常够用）",
	"deepseek-v4-pro": "deepseek-v4-pro（更强，慢一些、贵一些）",
};

export class VoiceNotesSettingTab extends PluginSettingTab {
	plugin: DeepSeekVoicePlugin;

	constructor(app: App, plugin: DeepSeekVoicePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl("h2", { text: "DeepSeek Voice Notes" });

		new Setting(containerEl)
			.setName("DeepSeek API Key")
			.setDesc(
				"只存在本库 .obsidian/plugins/deepseek-voice-notes/data.json 里。库若同步到 iCloud / Obsidian Sync，这个 key 也会跟着过去，别把它放进公开库或公开仓库。"
			)
			.addText((text) => {
				text.inputEl.type = "password";
				text.inputEl.autocapitalize = "off";
				text.inputEl.autocomplete = "off";
				text.setPlaceholder("sk-...")
					.setValue(this.plugin.settings.apiKey)
					.onChange(async (value) => {
						this.plugin.settings.apiKey = value.trim();
						await this.plugin.saveSettings();
					});
			})
			.addButton((btn) =>
				btn.setButtonText("测试连接").onClick(async () => {
					btn.setDisabled(true);
					btn.setButtonText("测试中…");
					try {
						const reply = await chatCompletion(this.plugin.settings, [
							{ role: "system", content: "只回复两个字：可用" },
							{ role: "user", content: "ping" },
						]);
						new Notice(`连接成功：${reply.slice(0, 40)}`);
					} catch (err) {
						new Notice(`连接失败：${errorText(err)}`, 10000);
					} finally {
						btn.setDisabled(false);
						btn.setButtonText("测试连接");
					}
				})
			);

		new Setting(containerEl)
			.setName("接口地址")
			.setDesc("默认 https://api.deepseek.com。用中转或代理时填到 /chat 之前的位置，带不带 /v1 都能识别。")
			.addText((text) =>
				text
					.setPlaceholder("https://api.deepseek.com")
					.setValue(this.plugin.settings.baseUrl)
					.onChange(async (value) => {
						this.plugin.settings.baseUrl = value.trim() || DEFAULT_SETTINGS.baseUrl;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("模型")
			.setDesc("两个模型都支持 JSON 输出和语音转写；模型名写错会直接报 400。")
			.addDropdown((dd) => {
				for (const [id, label] of Object.entries(MODEL_OPTIONS)) dd.addOption(id, label);
				dd.setValue(this.plugin.settings.model).onChange(async (value) => {
					this.plugin.settings.model = value;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("思考模式")
			.setDesc("默认关闭：笔记改写不需要长推理，关掉更快更省。开启后温度参数失效，输出前会先想一段。")
			.addToggle((tg) =>
				tg.setValue(this.plugin.settings.thinking).onChange(async (value) => {
					this.plugin.settings.thinking = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("用 DeepSeek 转写语音")
			.setDesc(
				"开启后弹窗里多一个录音按钮：录完上传到 /v1/tools/asr 转成文字。限制 120 秒 / 8 MiB。关掉就只用键盘自带的语音输入。"
			)
			.addToggle((tg) =>
				tg.setValue(this.plugin.settings.asrEnabled).onChange(async (value) => {
					this.plugin.settings.asrEnabled = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("默认动作")
			.setDesc("从命令或 URI 触发时用的默认落点。")
			.addDropdown((dd) => {
				dd.addOption("append", "追加到当前笔记末尾");
				dd.addOption("replace-note", "改写当前笔记全文");
				dd.addOption("replace-selection", "改写选中的段落");
				dd.addOption("create-note", "新建一篇笔记");
				dd.setValue(this.plugin.settings.defaultMode).onChange(async (value) => {
					this.plugin.settings.defaultMode = value as VoiceMode;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("写入前需要确认")
			.setDesc("开启后先看预览再点「写入笔记」。语音识别会有偏差，建议保持开启。")
			.addToggle((tg) =>
				tg.setValue(this.plugin.settings.requireConfirm).onChange(async (value) => {
					this.plugin.settings.requireConfirm = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("随指令发送的笔记字数上限")
			.setDesc("当前笔记超过这个字数时只发开头 60% 和结尾 40%。默认 6000 字，越大越慢越贵。")
			.addText((text) => {
				text.inputEl.type = "number";
				text.setValue(String(this.plugin.settings.contextChars)).onChange(async (value) => {
					const n = Number(value);
					if (Number.isFinite(n) && n >= 0) {
						this.plugin.settings.contextChars = Math.floor(n);
						await this.plugin.saveSettings();
					}
				});
			});

		new Setting(containerEl)
			.setName("新笔记存放文件夹")
			.setDesc("留空表示库根目录。不存在会自动创建，例如 00_Inbox。")
			.addText((text) =>
				text
					.setPlaceholder("00_Inbox")
					.setValue(this.plugin.settings.newNoteFolder)
					.onChange(async (value) => {
						this.plugin.settings.newNoteFolder = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("温度")
			.setDesc("0 更保守，1 更发散。改写建议 0.2–0.4；开了思考模式时这项无效。")
			.addSlider((slider) =>
				slider
					.setLimits(0, 1, 0.05)
					.setValue(this.plugin.settings.temperature)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.temperature = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("额外写作要求")
			.setDesc("追加到系统提示词，例如「标题不要加序号」「改写时保留双链」。")
			.addTextArea((ta) => {
				ta.setPlaceholder("可选")
					.setValue(this.plugin.settings.extraSystemPrompt)
					.onChange(async (value) => {
						this.plugin.settings.extraSystemPrompt = value;
						await this.plugin.saveSettings();
					});
				ta.inputEl.rows = 4;
			});

		const help = containerEl.createDiv({ cls: "dsv-settings-help" });
		help.createEl("h3", { text: "手机上怎么一键唤起" });
		help.createEl("p", {
			text: "iOS 不向第三方 App 开放音量键，「两个音量键同时按」在 Obsidian 里做不到。可用替代：① 设置 → 辅助功能 → 触控 → 轻点背面 → 轻点两下 → 选一个快捷指令；② iPhone 15 Pro 以上的操作按钮绑定快捷指令；③ 锁屏小组件。快捷指令动作只需「打开 URL」，填 obsidian://deepvoice?vault=你的库名&mode=append。",
		});
		help.createEl("p", {
			text: "想连语音识别一起省掉一步：快捷指令里用「听写文本」拿到文字，再拼成 obsidian://deepvoice?vault=库名&mode=append&text=文字&auto=1，插件会直接开始处理。",
		});
	}
}

export function errorText(err: unknown): string {
	if (err instanceof Error) return err.message;
	return String(err);
}
