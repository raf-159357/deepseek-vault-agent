import type { ChatMessage, VoiceContext, VoiceMode } from "./types";
import type { DeepSeekVoiceSettings } from "./settings";

const MODE_LABEL: Record<VoiceMode, string> = {
	append: "追加到当前笔记末尾（保留原有内容）",
	"replace-selection": "只改写编辑器中选中的那段文字",
	"replace-note": "改写整篇笔记正文",
	"create-note": "新建一篇新笔记",
};

function truncateMiddle(text: string, max: number): string {
	if (max <= 0 || text.length <= max) return text;
	const head = Math.floor(max * 0.6);
	const tail = max - head;
	return `${text.slice(0, head)}\n\n…（中间省略 ${text.length - max} 字）…\n\n${text.slice(-tail)}`;
}

export function buildSystemPrompt(settings: DeepSeekVoiceSettings, skillBlock?: string): string {
	const extra = settings.extraSystemPrompt.trim();
	return [
		"你是一个 Obsidian 笔记助手，由手机语音指令调用。用户的话来自语音识别，可能有同音错字、断句混乱、口语赘词，先按上下文合理纠正，但不要凭猜测补充事实。",
		"",
		"只输出一个 JSON 对象，不要 Markdown 代码块，不要任何解释文字。字段如下：",
		"{",
		'  "action": "append" | "replace-selection" | "replace-note" | "create-note",',
		'  "title": "新建笔记时的标题，不含 .md、不含斜杠；其他动作可留空",',
		'  "content": "要写入的 Markdown 正文",',
		'  "summary": "一句话说明你做了什么，供用户确认（语言跟随用户）",',
		'  "notes": "你不确定的地方或需要用户注意的点，没有就留空字符串"',
		"}",
		"",
		"硬性规则：",
		"1. content 里只放真正要写进笔记的内容，不要写「以下是」「已为你整理」这类话，不要用代码块包裹整段。",
		"2. action 必须与用户本次的落点一致：要求追加就不要输出全文改写，只改写选中就不要重写整篇。",
		"3. 保留用户原有的 Markdown 结构、标题层级、列表、标签、双链和 YAML frontmatter，除非用户明确要求改动。frontmatter 不要放进 content。",
		"4. 不做未被要求的删改。用户要求补充时按原笔记的语气和粒度续写，不要拔高成论文腔。",
		"5. 不确定的信息写进 notes，绝不编造人名、数字、日期、文献或引用。",
		"6. 中文输入输出中文；用户用其他语言时跟随用户。",
		extra ? `7. 额外要求：${extra}` : "",
		skillBlock ? `\n${skillBlock}` : "",
	]
		.filter((line) => line !== "")
		.join("\n");
}

/**
 * 会变的部分（指令、落点）单独放最后一条消息，笔记正文放在前面那条。
 *
 * 这么拆是为了缓存：前缀只要有一个字节不同就整段作废，按全价计费。
 * 同一篇笔记反复改（先追加、再润色、再补一句）时，正文那一大块逐字节一致，
 * 第二次起就按命中价（1/50）算；不同笔记之间至少系统提示词和工具壳还能命中。
 */
export function buildDocMessage(ctx: VoiceContext, settings: DeepSeekVoiceSettings): string | null {
	const where = ctx.file ? ctx.file.path : "";
	const body =
		ctx.selection && ctx.selection.trim()
			? ctx.selection
			: truncateMiddle(ctx.noteContent, settings.contextChars);
	if (!body.trim()) return where ? `【当前笔记：${where}】\n\n（这篇笔记还是空的）` : null;
	const head = where ? `【当前笔记：${where}】` : "【当前文档】";
	return `${head}\n\n${body}`;
}

export function buildTaskMessage(ctx: VoiceContext, instruction: string, mode: VoiceMode): string {
	const parts: string[] = [];
	parts.push(`【本次落点】${mode} —— ${MODE_LABEL[mode]}`);
	if (!ctx.file) parts.push("【当前笔记】（没有打开任何笔记，只能新建）");
	if (mode === "replace-selection") parts.push("【改写范围】上面那段就是我选中的文字，content 只返回改写后的这一段，不要重写整篇。");
	if (mode === "create-note") parts.push("【上面的正文】只作风格与上下文参考，不要整篇搬进新笔记。");
	parts.push("");
	parts.push("【用户语音指令】");
	parts.push(instruction.trim());
	parts.push("");
	parts.push(`请输出符合落点 ${mode} 的单个 JSON 对象。`);
	return parts.join("\n");
}

export function buildMessages(
	ctx: VoiceContext,
	instruction: string,
	mode: VoiceMode,
	settings: DeepSeekVoiceSettings
): ChatMessage[] {
	const messages: ChatMessage[] = [{ role: "system", content: buildSystemPrompt(settings) }];
	const doc = buildDocMessage(ctx, settings);
	if (doc) messages.push({ role: "user", content: doc });
	messages.push({ role: "user", content: buildTaskMessage(ctx, instruction, mode) });
	return messages;
}
