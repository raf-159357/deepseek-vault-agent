import type { SkillMine } from "./skills";
import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import type DeepSeekVoicePlugin from "./main";
import { chatCompletion } from "./deepseek";
import { SKILLS } from "./skills";
import { F, s, setLang, isEn } from "./i18n";
import type { VoiceMode } from "./types";
import { AGENT_STEP_LIMIT } from "./types";
import { estimateCost, savedByCache } from "./usage";

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
	/** —— 以下是 0.2 的 AI 指令（联网 + 读库 + 写库） —— */
	webSearchEnabled: boolean;
	searchCount: number;
	agentMaxSteps: number;
	/** 单次运行的时间上限（分钟）。0 = 不限，靠用户随时暂停 */
	agentTimeLimitMin: number;
	/** 回到前台时，如果上次任务还没跑完，自动接着跑 */
	autoResume: boolean;
	agentContextChars: number;
	/** 默认关：允许 AI 把笔记移入回收站 */
	allowDelete: boolean;
	/** —— 0.4：界面语言与手机悬浮按钮 —— */
	uiLang: "auto" | "zh" | "en";
	floatingButton: boolean;
	/** 让图标自己走动：每隔几秒挪一小段，像个小宠物 */
	fabWander: boolean;
	fabRight: number;
	fabBottom: number;
	/** —— 0.6：累计用量，用来观察缓存命中率 —— */
	cacheStats: CacheStats;
	/** —— 0.7：拍照后框选，以及裁好的图是否落进笔记 —— */
	cropShot: boolean;
	shotToNote: boolean;
	/** —— 0.8：技能包。currentSkillId 记住上次选的，skillMine 只存用户自己写的那部分 —— */
	currentSkillId: string;
	skillMine: Record<string, SkillMine>;
}

export interface CacheStats {
	/** 请求次数 */
	req: number;
	/** 命中缓存的输入 token */
	hit: number;
	/** 未命中的输入 token */
	miss: number;
	/** 输出 token */
	out: number;
}

export const EMPTY_STATS: CacheStats = { req: 0, hit: 0, miss: 0, out: 0 };

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
	webSearchEnabled: true,
	searchCount: 8,
	agentMaxSteps: 0,
	agentTimeLimitMin: 0,
	autoResume: true,
	agentContextChars: 20000,
	allowDelete: false,
	uiLang: "auto",
	floatingButton: true,
	fabWander: true,
	fabRight: 16,
	fabBottom: 96,
	cacheStats: { ...EMPTY_STATS },
	cropShot: true,
	shotToNote: true,
	currentSkillId: "journal",
	skillMine: {},
};

/** 老版本的数据里没有 cacheStats，补一个默认值，避免读 undefined */
export function normalizeSettings(data: Partial<DeepSeekVoiceSettings>): DeepSeekVoiceSettings {
	const merged: DeepSeekVoiceSettings = Object.assign({}, DEFAULT_SETTINGS, data);
	merged.cacheStats = Object.assign({}, EMPTY_STATS, data.cacheStats ?? {});
	// 0.7 新增：老数据里没有这两项，默认都算开启
	merged.cropShot = data.cropShot !== false;
	merged.shotToNote = data.shotToNote !== false;
	// 0.8 新增：老数据没有技能字段，给一个默认技能
	merged.agentTimeLimitMin = typeof data.agentTimeLimitMin === "number" ? data.agentTimeLimitMin : 0;
	merged.autoResume = data.autoResume !== false;
	merged.fabWander = data.fabWander !== false;
	merged.currentSkillId = typeof data.currentSkillId === "string" ? data.currentSkillId : "journal";
	merged.skillMine = data.skillMine && typeof data.skillMine === "object" ? data.skillMine : {};
	return merged;
}

export function modelOptions(): Record<string, string> {
	if (isEn()) {
		return {
			"deepseek-flash": "deepseek-flash (V4.1-Flash — fast and cheap, fine for daily use)",
			"deepseek-v4-pro": "deepseek-v4-pro (stronger, slower, pricier)",
		};
	}
	return {
		"deepseek-flash": "deepseek-flash（V4.1-Flash，快且便宜，日常够用）",
		"deepseek-v4-pro": "deepseek-v4-pro（更强，慢一些、贵一些）",
	};
}

export class VoiceNotesSettingTab extends PluginSettingTab {
	plugin: DeepSeekVoicePlugin;

	constructor(app: App, plugin: DeepSeekVoicePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		const t = s;

		new Setting(containerEl)
			.setName(t("setApiKeyName"))
			.setDesc(t("setApiKeyDesc"))
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
				btn.setButtonText(t("setTest")).onClick(async () => {
					btn.setDisabled(true);
					btn.setButtonText(t("setTesting"));
					try {
						const reply = await chatCompletion(this.plugin.settings, [
							{ role: "system", content: isEn() ? "Reply with one word: ok" : "只回复两个字：可用" },
							{ role: "user", content: "ping" },
						]);
						new Notice(`${isEn() ? "Connected: " : "连接成功："}${reply.slice(0, 40)}`);
					} catch (err) {
						new Notice(`${isEn() ? "Failed: " : "连接失败："}${errorText(err)}`, 10000);
					} finally {
						btn.setDisabled(false);
						btn.setButtonText(t("setTest"));
					}
				})
			);

		new Setting(containerEl).setName(t("setBaseName")).setDesc(t("setBaseDesc")).addText((text) =>
			text
				.setPlaceholder("https://api.deepseek.com")
				.setValue(this.plugin.settings.baseUrl)
				.onChange(async (value) => {
					this.plugin.settings.baseUrl = value.trim() || DEFAULT_SETTINGS.baseUrl;
					await this.plugin.saveSettings();
				})
		);

		new Setting(containerEl)
			.setName(t("setModelName"))
			.setDesc(t("setModelDesc"))
			.addDropdown((dd) => {
				for (const [id, label] of Object.entries(modelOptions())) dd.addOption(id, label);
				dd.setValue(this.plugin.settings.model).onChange(async (value) => {
					this.plugin.settings.model = value;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName(t("setThinkingName"))
			.setDesc(t("setThinkingDesc"))
			.addToggle((tg) =>
				tg.setValue(this.plugin.settings.thinking).onChange(async (value) => {
					this.plugin.settings.thinking = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName(t("setAsrName"))
			.setDesc(t("setAsrDesc"))
			.addToggle((tg) =>
				tg.setValue(this.plugin.settings.asrEnabled).onChange(async (value) => {
					this.plugin.settings.asrEnabled = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl).setName(t("setAgentHead")).setHeading();

		new Setting(containerEl)
			.setName(t("setWebName"))
			.setDesc(t("setWebDesc"))
			.addToggle((tg) =>
				tg.setValue(this.plugin.settings.webSearchEnabled).onChange(async (value) => {
					this.plugin.settings.webSearchEnabled = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName(t("setSearchName"))
			.setDesc(t("setSearchDesc"))
			.addSlider((slider) =>
				slider
					.setLimits(3, 20, 1)
					.setValue(this.plugin.settings.searchCount)
					.onChange(async (value) => {
						this.plugin.settings.searchCount = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName(t("setStepsName"))
			.setDesc(t("setStepsDesc"))
			.addSlider((slider) =>
				slider
					.setLimits(2, AGENT_STEP_LIMIT, 1)
					.setValue(this.plugin.settings.agentMaxSteps)
					.onChange(async (value) => {
						this.plugin.settings.agentMaxSteps = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName(t("setCtxName"))
			.setDesc(t("setCtxDesc"))
			.addText((text) => {
				text.inputEl.type = "number";
				text.setValue(String(this.plugin.settings.agentContextChars)).onChange(async (value) => {
					const n = Number(value);
					if (Number.isFinite(n) && n >= 1000) {
						this.plugin.settings.agentContextChars = Math.floor(n);
						await this.plugin.saveSettings();
					}
				});
			});

		new Setting(containerEl)
			.setName(t("setDeleteName"))
			.setDesc(t("setDeleteDesc"))
			.addToggle((tg) =>
				tg.setValue(this.plugin.settings.allowDelete).onChange(async (value) => {
					this.plugin.settings.allowDelete = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl).setName(t("setShotsHead")).setHeading();

		new Setting(containerEl)
			.setName(t("setCropName"))
			.setDesc(t("setCropDesc"))
			.addToggle((tg) =>
				tg.setValue(this.plugin.settings.cropShot).onChange(async (value) => {
					this.plugin.settings.cropShot = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName(t("setShotSaveName"))
			.setDesc(t("setShotSaveDesc"))
			.addToggle((tg) =>
				tg.setValue(this.plugin.settings.shotToNote).onChange(async (value) => {
					this.plugin.settings.shotToNote = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl).setName(t("setModeHead")).setDesc(t("setModeDesc")).addDropdown((dd) => {
			dd.addOption("append", t("setModeAppend"));
			dd.addOption("replace-note", t("setModeRewrite"));
			dd.addOption("replace-selection", t("setModeSelection"));
			dd.addOption("create-note", t("setModeCreate"));
			dd.setValue(this.plugin.settings.defaultMode).onChange(async (value) => {
				this.plugin.settings.defaultMode = value as VoiceMode;
				await this.plugin.saveSettings();
			});
		});

		new Setting(containerEl)
			.setName(isEn() ? "Function" : "功能")
			.setDesc(
				isEn()
					? "Which function runs by default: study breakdown, paper breakdown, or journal."
					: "默认用哪个功能跑：学习拆解 / 文献拆解 / 手帐打卡。切换后立刻生效，下次打开还是它。"
			)
			.addDropdown((dd) => {
				for (const sk of SKILLS) {
					dd.addOption(sk.id, isEn() ? sk.id : `${sk.icon} · ${sk.name}`);
				}
				dd.setValue(this.plugin.settings.currentSkillId).onChange(async (value) => {
					this.plugin.settings.currentSkillId = value;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName(t("setConfirmName"))
			.setDesc(t("setConfirmDesc"))
			.addToggle((tg) =>
				tg.setValue(this.plugin.settings.requireConfirm).onChange(async (value) => {
					this.plugin.settings.requireConfirm = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName(t("setNoteCtxName"))
			.setDesc(t("setNoteCtxDesc"))
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
			.setName(t("setFolderName"))
			.setDesc(t("setFolderDesc"))
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
			.setName(t("setTempName"))
			.setDesc(t("setTempDesc"))
			.addSlider((slider) =>
				slider
					.setLimits(0, 1, 0.05)
					.setValue(this.plugin.settings.temperature)
					.onChange(async (value) => {
						this.plugin.settings.temperature = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName(t("setExtraName"))
			.setDesc(t("setExtraDesc"))
			.addTextArea((ta) => {
				ta.setPlaceholder(t("setExtraPlaceholder"))
					.setValue(this.plugin.settings.extraSystemPrompt)
					.onChange(async (value) => {
						this.plugin.settings.extraSystemPrompt = value;
						await this.plugin.saveSettings();
					});
				ta.inputEl.rows = 4;
			});

		new Setting(containerEl)
			.setName(t("setUiName"))
			.setDesc(t("setUiDesc"))
			.addDropdown((dd) => {
				dd.addOption("auto", t("uiAuto"));
				dd.addOption("zh", t("uiZh"));
				dd.addOption("en", t("uiEn"));
				dd.setValue(this.plugin.settings.uiLang).onChange(async (value) => {
					const next = value === "zh" || value === "en" ? value : "auto";
					this.plugin.settings.uiLang = next;
					await this.plugin.saveSettings();
					this.plugin.applyLanguage();
					this.display();
				});
			});

		new Setting(containerEl)
			.setName(t("setFabName"))
			.setDesc(t("setFabDesc"))
			.addToggle((tg) =>
				tg.setValue(this.plugin.settings.floatingButton).onChange(async (value) => {
					this.plugin.settings.floatingButton = value;
					await this.plugin.saveSettings();
					this.plugin.syncFab();
				})
			);

		this.renderStats(containerEl);

		const help = containerEl.createDiv({ cls: "dsv-settings-help" });
		new Setting(help).setName(t("setHelpHead")).setHeading();
		help.createEl("p", { text: t("setHelp1") });
		help.createEl("p", { text: t("setHelp2") });
	}

	/** 用量与缓存：能看到命中率到底是多少，而不是只听插件说「做了缓存优化」 */
	private renderStats(containerEl: HTMLElement): void {
		const stats = this.plugin.settings.cacheStats;
		const total = stats.hit + stats.miss;
		const rate = total > 0 ? Math.round((stats.hit / total) * 100) : 0;
		const usage = { hit: stats.hit, miss: stats.miss, out: stats.out };
		const model = this.plugin.settings.model;
		const summary =
			stats.req > 0
				? `${s("setStatsDesc")}\n${F.statsSummary(
						stats.req,
						rate,
						estimateCost(usage, model).toFixed(4),
						savedByCache(usage, model).toFixed(4)
				  )}`
				: s("setStatsDesc");

		const setting = new Setting(containerEl)
			.setName(s("setStatsName"))
			.setDesc(summary)
			.addButton((btn) =>
				btn.setButtonText(s("statsReset")).onClick(async () => {
					this.plugin.settings.cacheStats = { ...EMPTY_STATS };
					await this.plugin.saveSettings();
					new Notice(s("statsCleared"));
					this.display();
				})
			);
		if (stats.req === 0) setting.settingEl.addClass("dsv-stats-empty");
	}

}

export function errorText(err: unknown): string {
	if (err instanceof Error) return err.message;
	return String(err);
}

export { setLang };
