import type { App } from "obsidian";
import { chatWithTools, resolveModel } from "./deepseek";
import { errorText, type DeepSeekVoiceSettings } from "./settings";
import { formatHits, readUrl, webSearch, extractUrls } from "./web";
import { applyOps, formatList, formatMatches, listFolder, readNote, safePath, searchNotes } from "./vault-tools";
import type {
	AgentRunResult,
	AgentState,
	AgentStep,
	MessageContent,
	PendingOp,
	StopReason,
	ToolCall,
	VoiceContext,
} from "./types";
import { AGENT_STEP_LIMIT } from "./types";
import { asRecord, asString, text } from "./json";
import { F } from "./i18n";
import { addUsage, EMPTY_USAGE } from "./usage";

/** 一次准备太多写操作，用户在手机上翻都翻不过来 */
const MAX_PENDING = 24;
/** 步数硬上限，设置里最多也只能拉到这个数 */
const MAX_STEPS = AGENT_STEP_LIMIT;
/** 不设步数上限时的兜底，防止模型自己绕圈把额度烧光 */
const SOFT_MAX_STEPS = 200;
/** 单次运行的墙钟上限：手机息屏/切后台容易被打断，超时就停下来等用户点继续 */
const TIME_LIMIT_MS = 8 * 60 * 1000;
/** 这几个只读、彼此不影响，可以并发跑 */
const READ_TOOLS = new Set(["search_notes", "list_folder", "read_note", "read_url", "web_search"]);
/**
 * 单次工具结果最多回灌多少字。
 * 工具结果会留在对话里被后面每一步重复发送，长度直接乘上步数，
 * 所以宁可在源头截断，也不要让一大篇网页在 20 步里反复计费。
 */
const TOOL_RESULT_CHARS = 9000;
/**
 * 一段对话最多留多少条消息。
 * 用户接着说是常态，历史只增不减的话每一轮都在为前面所有工具结果付钱，
 * 所以到顶就从最早的一整轮开始丢。
 */
const MAX_HISTORY_MESSAGES = 48;

/** 保留头尾的截断：结尾常有结论，砍掉可惜 */
function clip(text: string, max: number = TOOL_RESULT_CHARS): string {
	if (text.length <= max) return text;
	const head = Math.floor(max * 0.72);
	const tail = max - head;
	const cut = text.length - max;
	return `${text.slice(0, head)}\n\n…（已截断 ${cut} 字，中间部分没发给你）…\n\n${text.slice(-tail)}`;
}

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
			"写笔记。mode=create 新建（已存在会报错）、append 追加到末尾、overwrite 整篇替换。需要时会自动创建上级文件夹。要插入本次附带的图片时，正文里直接写 ![[图片路径]]。",
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

/**
 * 系统提示词必须只依赖「设置」，不依赖当前笔记、时间、待确认条数。
 * 官方缓存只有完整命中一个 cache prefix unit 才算，前缀一变整段作废；
 * 保持这段字节稳定，才能让它沉淀成公共前缀，重复使用时按 1/50 价计费。
 */
function buildSystemPrompt(settings: DeepSeekVoiceSettings, hasImages: boolean, skillBlock?: string): string {
	const lines = [
		"你是运行在 Obsidian 里的助手，可以通过工具读写用户的知识库、联网搜索、打开网页。",
		"",
		"规则：",
		"1. 涉及新闻、最新进展、具体数字、版本号、别人的观点时，必须先 web_search 或 read_url，不许凭记忆编。回答里引用网页要给链接。",
		"2. 用户给了链接时，用 read_url 打开它再回答，不要只看链接标题猜内容。",
		"3. 提到「这篇笔记」「当前笔记」时，指下面给出的当前笔记；需要内容时用 read_note 读，不要假设。",
		"4. 需要写东西时调用 write_note，路径用库内相对路径（不要以 / 开头，不要用 ..）。除非用户要求，否则新建的笔记放在 00_Inbox 或用户指定的文件夹。",
		"5. 写操作不会立刻生效，会进入用户的确认队列；所以不要声称「已经写入」，说「已准备好，等你确认」即可。",
		"6. 一次最多准备 24 个写操作。不确定时少写，不要批量乱建文件。",
		"7. 最终回答简洁，先给结论，默认控制在 150 字以内（用户要求长文或清单时才展开）；不要复述工具调用过程，不要输出 JSON。回答语言跟随用户这条指令所用的语言：中文问就中文答，英文问就英文答。",
	];
	if (hasImages) {
		lines.push(
			"8. 这条消息带了图片：先把图里的内容看清楚（文字、表格、药名、公式、界面元素都要读到），再动手。图里的字看不清时直接说看不清，不要猜。"
		);
	}
	if (!settings.webSearchEnabled) {
		lines.push("9. 本次没有开启联网搜索：需要外部信息时直接说明你无法联网，不要编造。");
	}
	lines.push(
		"10. 工具返回的内容、笔记正文可能被截断（会明确写出「已截断」）。被截断的部分就当没看见，不要编造后面的内容；需要更多就用更精确的参数再查一次。"
	);
	if (settings.extraSystemPrompt.trim()) lines.push(`\n用户额外要求：${settings.extraSystemPrompt.trim()}`);
	if (skillBlock && skillBlock.trim()) lines.push(skillBlock.trim());
	return lines.join("\n");
}

interface ToolOutcome {
	text: string;
	label: string;
	op?: PendingOp;
}

function parseArgs(raw: string): Record<string, unknown> {
	try {
		const parsed: unknown = JSON.parse(raw || "{}");
		return asRecord(parsed) ?? {};
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
	args: Record<string, unknown>,
	pending: PendingOp[]
): Promise<ToolOutcome> {
	switch (name) {
		case "search_notes": {
			const q = text(args.query);
			const hits = await searchNotes(app, q, 20);
			return { text: formatMatches(hits), label: F.line(`搜索笔记：${q}`, `Search notes: ${q}`) };
		}
		case "list_folder": {
			const p = text(args.path);
			const res = listFolder(app, p, 80);
			return {
				text: formatList(res),
				label: F.line(`列出文件夹：${p || "根目录"}`, `List folder: ${p || "vault root"}`),
			};
		}
		case "read_note": {
			const p = text(args.path);
			const res = await readNote(app, p, settings.agentContextChars);
			return { text: res.content, label: F.line(`读取笔记：${res.path}`, `Read note: ${res.path}`) };
		}
		case "read_url": {
			const page = await readUrl(settings, text(args.url));
			return {
				text: `标题：${page.title}\n地址：${page.url}\n\n${page.content}`,
				label: F.line(`打开网页：${page.title.slice(0, 40)}`, `Open page: ${page.title.slice(0, 40)}`),
			};
		}
		case "web_search": {
			if (!settings.webSearchEnabled) throw new Error("联网搜索当前是关闭的。");
			const q = text(args.query);
			const hits = await webSearch(settings, q, Number(args.count) || settings.searchCount);
			return { text: formatHits(hits), label: F.line(`联网搜索：${q}`, `Web search: ${q}`) };
		}
		case "write_note": {
			const safe = safePath(text(args.path));
			const path = /\.md$/i.test(safe) ? safe : `${safe}.md`;
			const rawMode = text(args.mode) || "create";
			const mode: WriteMode = rawMode === "append" || rawMode === "overwrite" || rawMode === "create" ? rawMode : "create";
			const content = asString(args.content) ?? "";
			if (!content.trim()) throw new Error("content 是空的，没有可写的内容。");
			const op: PendingOp = { kind: "write", path, mode, content };
			pending.push(op);
			return {
				text: `已加入待确认队列（队列共 ${pending.length} 条，尚未写入磁盘）。`,
				label: F.line(`准备写笔记：${path}`, `Prepare write: ${path}`),
				op,
			};
		}
		case "create_folder": {
			const path = safePath(text(args.path));
			const op: PendingOp = { kind: "folder", path };
			pending.push(op);
			return {
				text: `已加入待确认队列（队列共 ${pending.length} 条）。`,
				label: F.line(`准备新建文件夹：${path}`, `Prepare folder: ${path}`),
				op,
			};
		}
		case "move_note": {
			const from = safePath(text(args.from));
			const to = safePath(text(args.to));
			const op: PendingOp = { kind: "move", from, to };
			pending.push(op);
			return {
				text: `已加入待确认队列（队列共 ${pending.length} 条）。`,
				label: F.line(`准备移动：${from} → ${to}`, `Prepare move: ${from} → ${to}`),
				op,
			};
		}
		case "delete_note": {
			if (!settings.allowDelete) throw new Error("删除权限没有开启，请让用户到设置里打开。");
			const path = safePath(text(args.path));
			const op: PendingOp = { kind: "delete", path };
			pending.push(op);
			return {
				text: `已加入待确认队列（队列共 ${pending.length} 条）。`,
				label: F.line(`准备删除：${path}`, `Prepare trash: ${path}`),
				op,
			};
		}
		default:
			throw new Error(`没有这个工具：${name}`);
	}
}

export interface AgentOptions {
	/** 每完成一步（工具执行完）回调一次，界面用来实时显示进度 */
	onStep?: (step: AgentStep) => void;
	/** 每一轮结束后问一次「要不要停」：用户点了暂停就返回 true */
	shouldStop?: () => boolean;
	/** 每一轮结束后把状态存一次盘，App 被杀也能接着跑 */
	onCheckpoint?: (state: AgentState) => void;
}

export interface AgentStartOptions extends AgentOptions {
	/** 随这条指令一起发出去的图片（data URL） */
	images?: string[];
	/** 这些图片存进库之后的路径，模型要靠它写 ![[…]] */
	shots?: string[];
	/** 上一次没执行完的写操作，接着排进同一个队列 */
	pending?: PendingOp[];
	/** 技能包合成的提示词块（基座 + 我的补充），由 skills.ts 生成 */
	skillBlock?: string;
}

interface CallOutcome {
	text: string;
	label: string;
	ok: boolean;
}

/** 参数顺序不同的同一次调用要认成同一次，所以按键名排序后做指纹 */
function callKey(name: string, args: Record<string, unknown>): string {
	const sorted = Object.keys(args)
		.sort()
		.map((k) => `${k}=${JSON.stringify(args[k])}`)
		.join("|");
	return `${name}(${sorted})`;
}

async function execCall(
	app: App,
	settings: DeepSeekVoiceSettings,
	state: AgentState,
	call: ToolCall
): Promise<CallOutcome> {
	const args = parseArgs(call.function.arguments);
	const name = call.function.name;
	if (state.pending.length >= MAX_PENDING) {
		return {
			text: `错误：写操作已达上限 ${MAX_PENDING} 条，先让用户确认这批再继续。`,
			label: name,
			ok: false,
		};
	}

	// 同一次运行里重复读同一篇 / 搜同一个词：结果已经在上面了，别再花一次钱
	if (READ_TOOLS.has(name)) {
		const key = callKey(name, args);
		if (!state.seen) state.seen = new Set<string>();
		if (state.seen.has(key)) {
			return {
				text: "（这一步和前面某次调用参数完全相同，结果见上文，这里不重复返回。需要别的信息请换参数。）",
				label: F.line(`复用上一次结果：${name}`, `Reused earlier result: ${name}`),
				ok: true,
			};
		}
		state.seen.add(key);
	}

	try {
		const outcome = await runTool(app, settings, name, args, state.pending);
		return { text: outcome.text, label: outcome.label, ok: true };
	} catch (err) {
		return {
			text: `错误：${errorText(err)}`,
			label: F.line(`${name} 失败`, `${name} failed`),
			ok: false,
		};
	}
}

/**
 * 一批工具调用：只读的并发跑（长任务能省掉一半等待），
 * 只要含写操作就按顺序来，保证建文件夹在写笔记之前。
 * 结果按原顺序回灌，避免 tool_call_id 对不上。
 */
async function runBatch(
	app: App,
	settings: DeepSeekVoiceSettings,
	state: AgentState,
	calls: ToolCall[],
	onStep?: (step: AgentStep) => void
): Promise<void> {
	const record = (call: ToolCall, out: CallOutcome): void => {
		state.messages.push({ role: "tool", tool_call_id: call.id, content: clip(out.text) });
		const step: AgentStep = { tool: call.function.name, label: out.label, ok: out.ok };
		state.steps.push(step);
		onStep?.(step);
	};

	if (calls.every((call) => READ_TOOLS.has(call.function.name))) {
		const outs = await Promise.all(calls.map((call) => execCall(app, settings, state, call)));
		calls.forEach((call, i) => record(call, outs[i]));
		return;
	}
	for (const call of calls) record(call, await execCall(app, settings, state, call));
}

async function runLoop(
	app: App,
	settings: DeepSeekVoiceSettings,
	state: AgentState,
	options: AgentOptions = {}
): Promise<AgentRunResult> {
	const onStep = options.onStep;
	const tools = buildTools(settings);
	// 步数不再是「跑几轮就断」的硬闸：0 表示不设限，只在 SOFT_MAX 处兜底防跑飞
	const configured = Number(settings.agentMaxSteps);
	const maxSteps = !configured || configured <= 0 ? SOFT_MAX_STEPS : Math.min(SOFT_MAX_STEPS, configured);
	const model = resolveModel(settings.model, state.hasImages);
	// 单次时长同样可关：0 = 不限，靠用户随时暂停
	const limitMin = Number(settings.agentTimeLimitMin) || 0;
	const deadline = limitMin > 0 ? Date.now() + limitMin * 60_000 : Number.POSITIVE_INFINITY;

	let reply = "";
	let stopped: StopReason = "steps";
	let used = 0;

	for (let round = 0; round < maxSteps; round++) {
		// 用户点了暂停：把手头这一轮跑完就停，状态留着，随时能接着来
		if (options.shouldStop?.()) {
			stopped = "paused";
			break;
		}
		// 每轮开始前存一次：即使这一轮跑到一半 App 被系统杀掉，也只需重跑当前这轮
		options.onCheckpoint?.(state);
		if (Date.now() > deadline) {
			stopped = "time";
			break;
		}
		const res = await chatWithTools(settings, state.messages, tools, model);
		state.usage = addUsage(state.usage, res.usage);
		used = round + 1;

		if (!res.toolCalls.length) {
			reply = res.content.trim();
			stopped = "done";
			break;
		}

		state.messages.push({ role: "assistant", content: res.content ?? "", tool_calls: res.toolCalls });
		await runBatch(app, settings, state, res.toolCalls, onStep);
		reply = res.content.trim();
		if (round === maxSteps - 1) stopped = "steps";
	}

	if (!reply && stopped === "done") {
		reply = state.pending.length
			? F.line(
					`已经准备好 ${state.pending.length} 个操作，等你确认。`,
					`Prepared ${state.pending.length} action${state.pending.length === 1 ? "" : "s"}, waiting for your confirmation.`
			  )
			: F.line(
					"这次没有得出结论，可以再具体说一点，比如让它搜什么、写到哪里。",
					"No conclusion this time — be more specific about what to search for or where to write."
			  );
	}
	// 这一问一答要留在上下文里：用户下一句「接着」时，模型才知道自己刚才说了什么。
	// 只有正常答完才补 assistant；步数/时间用尽时最后一条是 tool 回灌，补了反而多余。
	if (stopped === "done" && reply) {
		state.messages.push({ role: "assistant", content: reply });
	}
	if (reply && state.pending.length) {
		reply += `\n\n${F.line(
			`（还有 ${state.pending.length} 个写操作待确认）`,
			`(${state.pending.length} write action${state.pending.length === 1 ? "" : "s"} pending)`
		)}`;
	}
	if (stopped !== "done") {
		reply += (reply ? "\n\n" : "") + (stopped === "time" ? F.timeUsed() : F.budgetUsed(used));
	}

	state.stopReason = stopped;
	return { reply, steps: state.steps, pending: state.pending, stopped, state, usage: state.usage, model };
}

/**
 * 一轮用户消息的内容：当前笔记、确认队列、补充说明这类会变的东西都塞在这里，
 * 系统提示词才能保持字节稳定、命中缓存。
 */
function turnContent(
	ctx: VoiceContext,
	instruction: string,
	images: string[],
	pending: PendingOp[],
	note?: string,
	shots: string[] = []
): MessageContent {
	const noteLine = ctx.file
		? F.line(`【当前笔记：${ctx.file.path}】`, `[current note: ${ctx.file.path}]`)
		: F.line("【当前笔记：没有打开任何笔记】", "[current note: none open]");
	// 图片是存进库的文件，模型必须知道路径才能用 ![[…]] 引用；否则它只会写「这里有一张图」
	const shotLine = shots.length
		? F.line(
				`【这次带的 ${shots.length} 张图已经存进库里：${shots.join("、")}。写笔记时要按需用 ![[${shots[0]}]] 这样的完整路径把图嵌进正文，不要只写「这里有一张图」】`,
				`[The ${shots.length} attached image(s) are already saved in the vault: ${shots.join(", ")}. Embed them in the note with ![[<path>]] exactly as given — never just say an image exists.]`
		  )
		: "";
	const queueLine = pending.length
		? F.line(
				`【确认队列里已有 ${pending.length} 条待执行，不要重复准备】`,
				`[${pending.length} action(s) already queued — do not prepare them again]`
		  )
		: "";
	const head = [noteLine, shotLine, queueLine, note ?? "", instruction.trim()].filter((line) => !!line).join("\n");

	return images.length
		? [
				{ type: "text", text: head },
				...images.map((url) => ({ type: "image_url" as const, image_url: { url, detail: "high" as const } })),
		  ]
		: head;
}

/**
 * 历史裁剪：从整轮的开头切，绝不把 tool 回灌单独留在最前面
 * （tool 消息必须紧跟带 tool_calls 的 assistant，否则接口直接报错）。
 */
function trimHistory(state: AgentState): void {
	const msgs = state.messages;
	if (msgs.length <= MAX_HISTORY_MESSAGES) return;
	// 系统提示词永远留着，所以按「总数减一」算要丢多少
	let cut = msgs.length - (MAX_HISTORY_MESSAGES - 1);
	while (cut < msgs.length && msgs[cut].role === "tool") cut++;
	const system = msgs[0];
	state.messages = [system, ...msgs.slice(cut)];
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
	options: AgentStartOptions = {}
): Promise<AgentRunResult> {
	if (!instruction.trim()) throw new Error(F.line("指令是空的。", "The instruction is empty."));

	const images = (options.images ?? []).filter((url) => !!url);
	const pending = (options.pending ?? []).slice(0, MAX_PENDING);

	const state: AgentState = {
		messages: [
			{ role: "system", content: buildSystemPrompt(settings, images.length > 0, options.skillBlock) },
			{ role: "user", content: turnContent(ctx, instruction, images, pending, undefined, options.shots ?? []) },
		],
		pending,
		steps: [],
		hasImages: images.length > 0,
		usage: { ...EMPTY_USAGE },
		seen: new Set<string>(),
		turns: 1,
	};
	return runLoop(app, settings, state, options);
}

export interface AgentFollowUpOptions extends AgentOptions {
	/** 技能块（续跑时一般不用重发，留作新开段落用） */
	skillBlock?: string;
	/** 这一句带的图片（data URL） */
	images?: string[];
	/** 这一句带的图片在库里的路径 */
	shots?: string[];
	/** 需要补充告诉模型的背景，例如上一批写操作已经执行或已被丢弃 */
	note?: string;
}

/**
 * 接着说一句：沿用同一段对话，把用户的新消息追加在后面继续跑。
 * 这是「持续对话」的关键 —— 上面的回答、读过的笔记、查过的网页都还在上下文里，
 * 用户不用把背景再讲一遍，也不会像重新执行那样从零开始。
 */
export async function followUpAgent(
	app: App,
	settings: DeepSeekVoiceSettings,
	state: AgentState,
	ctx: VoiceContext,
	instruction: string,
	options: AgentFollowUpOptions = {}
): Promise<AgentRunResult> {
	const images = (options.images ?? []).filter((url) => !!url);
	if (!instruction.trim() && !images.length) {
		throw new Error(F.line("指令是空的。", "The instruction is empty."));
	}

	state.messages.push({
		role: "user",
		content: turnContent(ctx, instruction, images, state.pending, options.note, options.shots ?? []),
	});
	// 新一轮重新允许读同样的笔记 / 搜同样的词：上一轮的结果可能已经过时
	state.seen = new Set<string>();
	state.turns = (state.turns ?? 1) + 1;
	if (images.length) state.hasImages = true;
	trimHistory(state);

	return runLoop(app, settings, state, options);
}

/** 步数或时间到上限后接着跑：沿用原来的对话记录和待确认队列，不重新开始 */
export async function continueAgent(
	app: App,
	settings: DeepSeekVoiceSettings,
	state: AgentState,
	options: AgentOptions = {}
): Promise<AgentRunResult> {
	return runLoop(app, settings, state, options);
}


/** 用户点了「执行」之后，真正落盘 */
export async function commitAgent(app: App, pending: PendingOp[]): Promise<string[]> {
	if (!pending.length) return [];
	return applyOps(app, pending);
}

export { extractUrls };
