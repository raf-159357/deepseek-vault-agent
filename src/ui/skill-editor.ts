import { Modal, Notice } from "obsidian";
import type DeepSeekVoicePlugin from "../main";
import { getSkill, type SkillMine, type SkillToggles } from "../skills";

/**
 * 单个功能的「我的补充」。
 * 基座（随插件升级）不在这里改，这里只存用户自己加的那部分，
 * 升级后自动叠到新基座上，不会被覆盖。
 */
export class SkillMineModal extends Modal {
	constructor(
		private plugin: DeepSeekVoicePlugin,
		private skillId: string,
		private onDone?: () => void
	) {
		super(plugin.app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("dsv-skilledit");
		const skill = getSkill(this.skillId);
		const stored = this.plugin.settings.skillMine[this.skillId];
		const mine: SkillMine = {
			extraPrompt: stored?.extraPrompt ?? "",
			toggles: { ...(stored?.toggles ?? {}) },
			outline: stored?.outline,
			folder: stored?.folder,
			moc: stored?.moc,
		};

		contentEl.createEl("h3", { text: `${skill.icon} ${skill.name} · 我的补充` });
		contentEl.createEl("p", {
			cls: "dsv-skilledit-tip",
			text: "基座模板会随插件升级，这里写的只属于你自己，升级不会丢。安全与事实类规则（不编造、写操作要确认）不在这里改。",
		});

		const toggles: Array<[keyof SkillToggles, string, string]> = [
			["graph", "生成关系图谱", "用 mermaid 画概念之间的关系"],
			["links", "概念自动建双链", "核心概念用 [[双链]] 包起来"],
			["questions", "出自我检测题", "末尾放几道题，答案折叠"],
			["calories", "估算热量", "手帐里给吃的补一行热量"],
			["newFile", "一律新建文件", "不追加到已有笔记"],
		];

		for (const [key, label, desc] of toggles) {
			const row = contentEl.createDiv({ cls: "dsv-skilledit-row" });
			const left = row.createDiv({ cls: "dsv-skilledit-text" });
			left.createDiv({ cls: "dsv-skilledit-label", text: label });
			left.createDiv({ cls: "dsv-skilledit-desc", text: desc });
			const box = row.createEl("input", { type: "checkbox" });
			box.checked = mine.toggles[key] === true;
			box.addEventListener("change", () => {
				mine.toggles[key] = box.checked;
			});
		}

		contentEl.createDiv({ cls: "dsv-skilledit-label", text: "再补充几句（可选）" });
		const area = contentEl.createEl("textarea", { cls: "dsv-skilledit-area" });
		area.placeholder = "例如：我是临床医学大二，解剖名词一律标英文缩写；笔记不要超过 400 字。";
		area.value = mine.extraPrompt;
		const counter = contentEl.createDiv({ cls: "dsv-skilledit-count" });
		const paint = (): void => {
			counter.setText(`${area.value.length} / 800`);
		};
		area.addEventListener("input", paint);
		paint();

		const bar = contentEl.createDiv({ cls: "dsv-skilledit-bar" });
		const cancel = bar.createEl("button", { text: "取消" });
		cancel.addEventListener("click", () => this.close());
		const reset = bar.createEl("button", { text: "清空" });
		reset.addEventListener("click", () => {
			area.value = "";
			mine.extraPrompt = "";
			for (const [key] of toggles) mine.toggles[key] = undefined;
			contentEl.querySelectorAll("input[type=checkbox]").forEach((el) => {
				(el as HTMLInputElement).checked = false;
			});
			paint();
		});
		const save = bar.createEl("button", { cls: "mod-cta", text: "保存" });
		save.addEventListener("click", () => {
			mine.extraPrompt = area.value.slice(0, 800);
			if (mine.extraPrompt.length >= 800) new Notice("补充超过 800 字，已截断。");
			this.plugin.settings.skillMine[this.skillId] = mine;
			void this.plugin.saveSettings();
			this.onDone?.();
			this.close();
			new Notice(`${skill.name} 的补充已保存`);
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
