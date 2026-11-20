import type { VoiceMode } from "./types";

/**
 * 技能卡 = 基座（只读，随插件升级）+ 我的补充（用户可改，升级不动）。
 * 这里只放基座与默认值，用户的补充存在 settings.skillMine 里，按 skill.id 取。
 */

export type SkillId = "study" | "paper" | "journal" | "free";

/** 用户能喂给技能的东西：不一定是照片 */
export type SkillInput = "photo" | "file" | "link" | "doi" | "text";

export interface SkillToggles {
	/** 要不要关系图谱 */
	graph?: boolean;
	/** 概念要不要建双链 */
	links?: boolean;
	/** 手帐：要不要热量估算 */
	calories?: boolean;
	/** 一律新建，不允许追加 */
	newFile?: boolean;
	/** 要不要自测题 */
	questions?: boolean;
}

export interface SkillMine {
	extraPrompt: string;
	toggles: SkillToggles;
	outline?: string[];
	folder?: string;
	/** 绑定的项目笔记（MOC）。写了就先读它，再决定追加到哪一节 */
	moc?: string;
}

export interface Skill {
	id: SkillId;
	name: string;
	icon: string;
	/** 功能选项的标记色，界面上每个选项一个色 */
	color: string;
	desc: string;
	inputs: SkillInput[];
	builtin: {
		/** 写作规范，追加进 system */
		fragment: string;
		/** 章节骨架，写进任务消息，提醒模型别漏节 */
		outline: string[];
		graph: boolean;
		questions: boolean;
		tools: string[];
		defaultMode: VoiceMode;
		folder: string;
		/** 建议的 MOC 路径（用户没改就用它） */
		moc?: string;
	};
	defaults: SkillMine;
}

export const EMPTY_MINE: SkillMine = { extraPrompt: "", toggles: {} };

/* ——————————————————————————— 学习拆解 ——————————————————————————— */

const STUDY: Skill = {
	id: "study",
	name: "学习拆解",
	icon: "学",
	color: "#955905",
	desc: "一个知识点，讲透、出题、画图",
	inputs: ["photo", "file", "link", "text"],
	builtin: {
		fragment: [
			"你在帮用户把一页讲义、一张截图、一个链接或一段资料，整理成能真正学会的笔记。不要复述原文，要拆开讲。",
			"按下面九节写，一节都不许省：",
			"1. 知识点：一句不超过 40 字的话说清它是什么。",
			"2. 为什么重要：它在整门课里解决什么问题，两句以内。",
			"3. 打个比方：用日常场景类比，必须具体到能想象出画面；不要写「就像一座桥梁」这种没有信息量的空话。",
			"4. 拆开看：把机制拆成 3–5 步，每步一行并标序号，讲清每步的输入和输出。",
			"5. 过程演示：用 mermaid 的 graph TD 画一张 6–10 节点的图，画它「怎么运转」，不是画概念关系。",
			"6. 关系图谱：跨笔记画。先用 search_notes 找 3–5 篇相关的旧笔记，再把本篇概念和这些旧笔记一起画进 mermaid；连到旧笔记的边上写 [[笔记名]]，让用户在 Obsidian 图谱里能跳过去。",
			"7. 自测：出 3–5 道题（1 道概念辨析、1 道应用、1 道易错），每题的答案单独放在折叠块里，格式严格写成：> [!success]- 答案 换行 > 内容",
			"8. 拓展：3 条可以继续深挖的方向，每条一句话，指明往哪查。",
			"9. 待确认：资料里看不清、没写到的，列在这里，绝对不许编。",
			"概念第一次出现时用 [[双链]] 包起来。",
		].join("\n"),
		outline: ["知识点", "为什么重要", "打个比方", "拆开看", "过程演示", "关系图谱", "自测", "拓展", "待确认"],
		graph: true,
		questions: true,
		tools: ["search_notes", "read_note", "read_url", "web_search", "list_folder", "write_note"],
		defaultMode: "create-note",
		folder: "学习",
		moc: "学习/学习 MOC.md",
	},
	defaults: { extraPrompt: "", toggles: { graph: true, links: true, questions: true } },
};

/* ——————————————————————————— 文献拆解 ——————————————————————————— */

const PAPER: Skill = {
	id: "paper",
	name: "文献拆解",
	icon: "文",
	color: "#3f5b8a",
	desc: "一个 DOI，拆成能用的研究笔记",
	inputs: ["doi", "link", "file", "photo", "text"],
	builtin: {
		fragment: [
			"你在帮用户把一篇文献拆成能用的研究笔记，目标是让用户读完就能讲清这篇文章在做什么。输入可能是 DOI、链接、PDF 或截图。",
			"第一步先确定文献：给的是 DOI 就先读 https://doi.org/{DOI}；拿不到全文时用 web_search 找 PMC / arXiv / 作者主页的开放版本，并在笔记开头注明你用的是哪个来源。找不到全文就明说，只能基于摘要写。",
			"按下面九节写：",
			"1. 一句话结论：≤40 字，说清这篇文章到底发现了什么。",
			"2. 研究问题与假设：作者想回答什么，假设是什么。",
			"3. 方法与流程图：用 mermaid 的 graph TD 自己画一张流程图（研究对象 → 分组/纳入排除 → 干预或暴露 → 观察指标 → 终点），再用文字讲清每一步为什么这么做。画之前先 search_notes 找库里已读过的同主题文献，把它们作为节点连进来。",
			"4. 关键数据：一张表格，列为 指标 | 数值 | 出处（页码或图表号）。每个数字必须能在原文找到，找不到就不写。",
			"5. 结果：主要发现 3 条，每条一句，带关键数字。",
			"6. 讨论：完整保留作者的核心论点、推理链和承认的局限。不许压缩成一句话，不许只留结论丢掉推理过程。",
			"7. 我的评读：这篇文章能怎么用到用户自己的场景，3 条，要具体。",
			"8. 自测：3 道题（1 道方法、1 道结果、1 道局限），答案放折叠块：> [!success]- 答案",
			"9. 原文图表：文中若有流程图或关键结果图，写出图注并尝试把图保存到附件后嵌入 ![[文件名]]；存不下来就只写图注加页码。",
			"不确定的一律写进笔记末尾的「待核实」，不许编造作者、样本量、P 值或引用。",
		].join("\n"),
		outline: ["一句话结论", "研究问题与假设", "方法与流程图", "关键数据", "结果", "讨论", "我的评读", "自测", "原文图表"],
		graph: true,
		questions: true,
		tools: ["search_notes", "read_note", "read_url", "web_search", "write_note"],
		defaultMode: "create-note",
		folder: "文献",
		moc: "文献/文献 MOC.md",
	},
	defaults: { extraPrompt: "", toggles: { graph: true, questions: true } },
};

/* ——————————————————————————— 手帐打卡 ——————————————————————————— */

const JOURNAL: Skill = {
	id: "journal",
	name: "手帐打卡",
	icon: "帐",
	color: "#4a6b4f",
	desc: "一张图，记成好看的一段日子",
	inputs: ["photo", "text", "file"],
	builtin: {
		fragment: [
			"你在帮用户记今天。手帐的写法是短、具体、有画面感，不要总结腔。",
			"结构：",
			"1. 标题写成 # 11月19日 · 一句话，日期取今天，不要用照片的拍摄时间。",
			"2. 把用户给的图放在标题下面，正文只留一行图注。",
			"3. 三行短句：今天发生了什么 / 一个值得记的细节 / 一句心情。每行不超过 40 字。",
			"4. 如果是风景或食物照片：先写画面里有什么（颜色、光线、天气、温度），再写当时的感觉；不要堆形容词，用具体名词。",
			"5. 结尾放 3–5 个 #标签。",
			"6. 如果是吃的，补一行热量估算，标「估算」；如果是训练，补一行「练了什么 · 组数 · 感受」。",
			"语气像一个写字很好看的人在记日记，允许口语。禁止出现「今天真是充实的一天」这类空话。",
		].join("\n"),
		outline: ["今天发生了什么", "一个细节", "心情", "标签"],
		graph: false,
		questions: false,
		tools: ["search_notes", "read_note", "write_note"],
		defaultMode: "append",
		folder: "手帐",
		moc: "手帐/手帐 MOC.md",
	},
	defaults: { extraPrompt: "", toggles: { calories: false } },
};


/* ——————————————————————————— 自由（其他） ——————————————————————————— */

const FREE: Skill = {
	id: "free",
	name: "其他",
	icon: "随",
	color: "#6f6a62",
	desc: "你说了算，它自己定结构",
	inputs: ["photo", "file", "link", "text"],
	builtin: {
		fragment: [
			"用户没有指定产出形态。先判断他到底要什么：一份笔记、一次整理、一张清单，还是只要一个答案。",
			"按最合适的结构写，但必须做到三点：",
			"1. 先给结论，再给依据；结论不超过三行。",
			"2. 结构跟着内容走，不要硬套学习笔记或文献综述的模板。",
			"3. 不确定的地方单独标出来，不要编。",
			"如果用户的意图本身不清楚，先按最可能的一种做出来，并在开头用一句话说明你按什么理解做的。",
		].join("\n"),
		outline: [],
		graph: false,
		questions: false,
		tools: ["search_notes", "read_note", "read_url", "web_search", "list_folder", "write_note"],
		defaultMode: "create-note",
		folder: "",
	},
	defaults: { extraPrompt: "", toggles: {} },
};

export const SKILLS: Skill[] = [STUDY, PAPER, JOURNAL, FREE];

export function getSkill(id: string | undefined): Skill {
	return SKILLS.find((s) => s.id === id) ?? JOURNAL;
}

/** 把开关翻译成短句，模型比布尔值更认这种说法 */
function toggleLines(t: SkillToggles): string[] {
	const out: string[] = [];
	if (t.graph === true) out.push("必须输出关系图谱（mermaid graph TD）。");
	if (t.graph === false) out.push("不要输出 mermaid 图，用文字列表代替。");
	if (t.links === true) out.push("核心概念一律用 [[双链]] 包起来。");
	if (t.questions === true) out.push("自测题至少 3 道，答案放折叠块。");
	if (t.questions === false) out.push("不要出题。");
	if (t.calories === true) out.push("如果是食物，补一行热量估算并标「估算」。");
	if (t.newFile === true) out.push("一律新建笔记，不要追加到已有笔记。");
	return out;
}

/**
 * 合成一个技能的提示词块：基座 + 我的补充 + 开关短句。
 * 用户的补充放在基座后面，语气上属于「追加要求」，不会覆盖硬规则。
 */
export function buildSkillPrompt(skill: Skill, mine?: SkillMine): string {
	const m = mine ?? skill.defaults;
	const lines: string[] = ["", `【本次技能：${skill.name}】`, skill.builtin.fragment];
	if (skill.builtin.outline.length) {
		lines.push(`章节顺序：${skill.builtin.outline.join(" / ")}`);
	}
	const toggles = toggleLines({ ...skill.defaults.toggles, ...m.toggles });
	if (toggles.length) lines.push(...toggles);
	const moc = (m.moc || skill.builtin.moc || "").trim();
	if (moc) {
		lines.push("");
		lines.push(`【项目笔记 MOC】${moc}`);
		lines.push("执行顺序：先 read_note 读这篇 MOC。读到了就按它的章节结构，把本次内容 append 到最匹配的那一节，并在 MOC 末尾补一条 [[本次笔记]]；没有匹配的章节就先加一个章节再写。读不到（文件不存在）就新建这篇 MOC，写一个最小骨架（按上面章节顺序），再按同样方式追加。");
	}

	const extra = (m.extraPrompt || "").trim();
	if (extra) {
		lines.push("");
		lines.push("【用户对这个技能的补充要求（优先遵守，但不得违反上面的硬规则）】");
		lines.push(extra.slice(0, 800));
	}
	return lines.join("\n");
}

/** 新建笔记时的默认目录，用户的设置优先 */
export function skillFolder(skill: Skill, mine?: SkillMine): string {
	return (mine?.folder || skill.builtin.folder || "").trim();
}
