import type { App } from "obsidian";
import { chatWithTools } from "./deepseek";
import { errorText, type DeepSeekVoiceSettings } from "./settings";
import { formatHits, readUrl, webSearch, extractUrls } from "./web";
import { applyOps, formatList, formatMatches, listFolder, readNote, safePath, searchNotes } from "./vault-tools";
import type { AgentMessage, AgentRunResult, AgentStep, PendingOp, VoiceContext } from "./types";

const MAX_PENDING = 12;
type WriteMode = "create" | "append" | "overwrite";

function tool(name: string, description: string, properties: Record<string, unknown>, required: string[]) {
	return {
		type: "function",
		function: {
			name,
			description,
			parameters: { type: "object", properties, required, additionalProperties: false },
		},
	};
}

function buildTools(settings: DeepSeekVoiceSettings): unknown[] {
	const tools: unknown[] = [
		tool(
			"search_notes",
			"在用户的知识库里按关键词找笔记，先匹配文件名再匹配正文。想引用用户以前写过的东西时用这个。",
			{ query: { type: "string", description: "关键词，中文或英文都可以" } },
			["query"]
		),
		tool(
			"list_folder",
			"列出一个文件夹里的笔记和子文件夹。path 留空表示库根目录。",
			{ path: { type: "string", description: "库内相对路径，例如 00_Inbox，留空表示根目录" } },
			[]
		),
		tool(
			"read_note",
			"读一篇笔记的完整内容。只知道路径、不知道内容时先调用它。",
			{ path: { type: "string", description: "库内相对路径，例如 文献/某篇.md" } },
			["path"]
		),
		tool(
			"read_url",
			"打开一个网页并读取它的正文（Markdown）。用户给了链接、或你需要看某个页面细节时用。",
			{ url: { type: "string", description: "完整的 http/https 链接" } },
			["url"]
		),
	];

	if (settings.webSearchEnabled) {
		tools.push(
			tool(
				"web_search",
				"联网搜索。任何涉及新闻、最新进展、具体数据、你不确定的事实时都必须先搜，不要凭记忆回答。",
				{
					query: { type: "string", description: "搜索词，像人一样自然描述，最多 128 字" },
					count: { type: "integer", description: "结果条数，1-20，默认 8" },
				},
				["query"]
			)
		);
	}

	tools.push(
		tool(
			"write_note",
			"写笔记。mode=create 新建（已存在会报错）、append 追加到末尾、overwrite 整篇替换。需要时会自动创建上级文件夹。",
			{
				path: { type: "string", description: "库内相对路径，带不带 .md 都行，例如 00_Inbox/读书笔记" },
				mode: { type: "string", enum: ["create", "append", "overwrite"], description: "写入方式" },
				content: { type: "string", description: "完整的 Markdown 正文" },
			},
			["path", "mode", "content"]
		),
		tool(
			"create_folder",
			"新建一个文件夹，用来给笔记分类。已存在不会报错。",
			{ path: { type: "string", description: "库内相对路径，例如 课题/综述" } },
			["path"]
		),
		tool(
			"move_note",
			"移动或重命名一篇笔记。",
			{
				from: { type: "string", description: "原路径" },
				to: { type: "string", description: "新路径" },
			},
			["from", "to"]
		)
	);

	if (settings.allowDelete) {
		tools.push(
			tool(
				"delete_note",
				"把一篇笔记移入回收站。用户明确说要删除时才用。",
				{ path: { type: "string", description: "要删除的笔记路径" } },
				["path"]
			)
		);
	}
	return tools;
}

function buildSystemPrompt(ctx: VoiceContext, settings: DeepSeekVoiceSettings, noteHint: string): string {
	const lines = [
		"你是运行在 Obsidian 里的中文助手，可以通过工具读写用户的知识库、联网搜索、打开网页。",
		"",
		"规则：",
		"1. 涉及新闻、最新进展、具体数字、版本号、别人的观点时，必须先 web_search 或 read_url，不许凭记忆编。回答里引用网页要给链接。",
		"2. 用户给了链接时，用 read_url 打开它再回答，不要只看链接标题猜内容。",
		"3. 提到「这篇笔记」「当前笔记」时，指下面给出的当前笔记；需要内容时用 read_note 读，不要假设。",
		"4. 需要写东西时调用 write_note，路径用库内相对路径（不要以 / 开头，不要用 ..）。除非用户要求，否则新建的笔记放在 00_Inbox 或用户指定的文件夹。",
		"5. 写操作不会立刻生效，会进入用户的确认队列；所以不要声称「已经写入」，说「已准备好，等你确认」即可。",
		"6. 一次最多准备 12 个写操作。不确定时少写，不要批量乱建文件。",
		"7. 最终回答用中文，简洁，先给结论；不要复述工具调用过程，不要输出 JSON。",
	];
	if (!settings.webSearchEnabled) {
		lines.push("8. 本次没有开启联网搜索：需要外部信息时直接说明你无法联网，不要编造。");
	}
	if (settings.extraSystemPrompt.trim()) lines.push(`\n用户额外要求：${settings.extraSystemPrompt.trim()}`);
	lines.push("", `当前笔记：${noteHint}`);
	return lines.join("\n");
}

interface ToolOutcome {
	text: string;
	label: string;
	op?: PendingOp;
}

function parseArgs(raw: string): Record<string, any> {
	try {
		const parsed = JSON.parse(raw || "{}");
		return parsed && typeof parsed === "object" ? parsed : {};
	} catch {
		return {};
	}
}

/**
 * 执行一个工具。读操作直接做，写操作只排队。
 * 出错不抛异常，把错误原文交给模型，让它自己改。
 */
async function runTool(
	app: App,
	settings: DeepSeekVoiceSettings,
	name: string,
	args: Record<string, any>,
	pending: PendingOp[]
): Promise<ToolOutcome> {
	switch (name) {
		case "search_notes": {
			const q = String(args.query ?? "");
			const hits = await searchNotes(app, q, 20);
			return { text: formatMatches(hits), label: `搜索笔记：${q}` };
		}
		case "list_folder": {
			const p = String(args.path ?? "");
			const res = listFolder(app, p, 80);
			return { text: formatList(res), label: `列出文件夹：${p || "根目录"}` };
		}
		case "read_note": {
			const p = String(args.path ?? "");
			const res = await readNote(app, p, settings.agentContextChars);
			return { text: res.content, label: `读取笔记：${res.path}` };
		}
		case "read_url": {
			const page = await readUrl(settings, String(args.url ?? ""));
			return {
				text: `标题：${page.title}\n地址：${page.url}\n\n${page.content}`,
				label: `打开网页：${page.title.slice(0, 40)}`,
			};
		}
		case "web_search": {
			if (!settings.webSearchEnabled) throw new Error("联网搜索当前是关闭的。");
			const q = String(args.query ?? "");
			const hits = await webSearch(settings, q, Number(args.count) || settings.searchCount);
			return { text: formatHits(hits), label: `联网搜索：${q}` };
		}
		case "write_note": {
			const safe = safePath(String(args.path ?? ""));
			const path = /\.md$/i.test(safe) ? safe : `${safe}.md`;
			const rawMode = String(args.mode ?? "create");
			const mode: WriteMode = rawMode === "append" || rawMode === "overwrite" || rawMode === "create" ? rawMode : "create";
			const content = String(args.content ?? "");
			if (!content.trim()) throw new Error("content 是空的，没有可写的内容。");
			const op: PendingOp = { kind: "write", path, mode, content };
			pending.push(op);
			return { text: `已加入待确认队列（队列共 ${pending.length} 条，尚未写入磁盘）。`, label: `准备写笔记：${path}`, op };
		}
		case "create_folder": {
			const path = safePath(String(args.path ?? ""));
			const op: PendingOp = { kind: "folder", path };
			pending.push(op);
			return { text: `已加入待确认队列（队列共 ${pending.length} 条）。`, label: `准备新建文件夹：${path}`, op };
		}
		case "move_note": {
			const from = safePath(String(args.from ?? ""));
			const to = safePath(String(args.to ?? ""));
			const op: PendingOp = { kind: "move", from, to };
			pending.push(op);
			return { text: `已加入待确认队列（队列共 ${pending.length} 条）。`, label: `准备移动：${from} → ${to}`, op };
		}
		case "delete_note": {
			if (!settings.allowDelete) throw new Error("删除权限没有开启，请让用户到设置里打开。");
			const path = safePath(String(args.path ?? ""));
			const op: PendingOp = { kind: "delete", path };
			pending.push(op);
			return { text: `已加入待确认队列（队列共 ${pending.length} 条）。`, label: `准备删除：${path}`, op };
		}
		default:
			throw new Error(`没有这个工具：${name}`);
	}
}

export interface AgentOptions {
	/** 每完成一步（工具执行完）回调一次，界面用来实时显示进度 */
	onStep?: (step: AgentStep) => void;
}

/**
 * Agent 主循环：模型决定调什么，客户端执行，结果回灌，直到它给出最终回答或用完步数。
 * 写操作只排队不落盘，由调用方在用户确认后统一 applyOps。
 */
export async function runAgent(
	app: App,
	settings: DeepSeekVoiceSettings,
	ctx: VoiceContext,
	instruction: string,
	options: AgentOptions = {}
): Promise<AgentRunResult> {
	if (!instruction.trim()) throw new Error("指令是空的。");

	const noteHint = ctx.file ? ctx.file.path : "（当前没有打开笔记）";
	const messages: AgentMessage[] = [
		{ role: "system", content: buildSystemPrompt(ctx, settings, noteHint) },
		{ role: "user", content: instruction.trim() },
	];

	const tools = buildTools(settings);
	const pending: PendingOp[] = [];
	const steps: AgentStep[] = [];
	const maxSteps = Math.max(1, Math.min(12, settings.agentMaxSteps));
	let reply = "";

	for (let i = 0; i < maxSteps; i++) {
		const res = await chatWithTools(settings, messages, tools);

		if (!res.toolCalls.length) {
			reply = res.content.trim();
			break;
		}

		messages.push({ role: "assistant", content: res.content ?? "", tool_calls: res.toolCalls });

		for (const call of res.toolCalls) {
			const args = parseArgs(call.function.arguments);
			let text = "";
			let label = call.function.name;
			let ok = true;

			if (pending.length >= MAX_PENDING) {
				text = `错误：写操作已达上限 ${MAX_PENDING} 条，先让用户确认这批再继续。`;
				ok = false;
			} else {
				try {
					const outcome = await runTool(app, settings, call.function.name, args, pending);
					text = outcome.text;
					label = outcome.label;
				} catch (err) {
					text = `错误：${errorText(err)}`;
					label = `${call.function.name} 失败`;
					ok = false;
				}
			}

			messages.push({ role: "tool", tool_call_id: call.id, content: text.slice(0, 16_000) });
			const step: AgentStep = { tool: call.function.name, label, ok };
			steps.push(step);
			options.onStep?.(step);
		}

		if (i === maxSteps - 1) reply = res.content.trim();
	}

	if (!reply) {
		reply = pending.length
			? `已经准备好 ${pending.length} 个操作，等你确认。`
			: "这次没有得出结论，可以再具体说一点，比如让它搜什么、写到哪里。";
	}
	if (pending.length) {
		reply += `\n\n（还有 ${pending.length} 个写操作待确认）`;
	}
	return { reply, steps, pending };
}

/** 用户点了「执行」之后，真正落盘 */
export async function commitAgent(app: App, pending: PendingOp[]): Promise<string[]> {
	if (!pending.length) return [];
	return applyOps(app, pending);
}

export { extractUrls };
