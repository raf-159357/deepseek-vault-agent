import type { EditorPosition, TFile } from "obsidian";
import type { Usage } from "./usage";

/** 单次运行的步数硬上限（设置里的滑块也以此为最大值） */
export const AGENT_STEP_LIMIT = 24;

/** 一条消息最多带几张图 */
export const MAX_IMAGES = 4;

/** 语音指令的落点：追加 / 改写选中 / 改写全文 / 新建笔记 */
export type VoiceMode = "append" | "replace-selection" | "replace-note" | "create-note";

export interface VoiceContext {
	/** 触发时处于活动状态的笔记，可能为空（例如在空白页触发） */
	file: TFile | null;
	/** 触发时读到的笔记全文（已截断前的原文） */
	noteContent: string;
	/** 触发时编辑器里的选中文本，用于精确替换 */
	selection: string;
	from?: EditorPosition;
	to?: EditorPosition;
}

export interface VoiceResult {
	action: VoiceMode;
	/** 新建笔记时的标题（不含 .md） */
	title?: string;
	/** 要写入的 Markdown 正文 */
	content: string;
	/** 模型给用户的一句中文说明 */
	summary?: string;
	/** 模型的注意点 / 不确定之处 */
	notes?: string;
}

/** OpenAI 兼容的多段内容：文字或图片（图片走 data URL 或公网地址） */
export type ContentPart =
	| { type: "text"; text: string }
	| { type: "image_url"; image_url: { url: string; detail?: "low" | "high" | "auto" } };

export type MessageContent = string | ContentPart[];

export interface ChatMessage {
	role: "system" | "user" | "assistant";
	content: MessageContent;
}

/** 模型请求调用的函数（OpenAI 兼容格式） */
export interface ToolCall {
	id: string;
	type: "function";
	function: { name: string; arguments: string };
}

/** Agent 对话里的一条消息，比 ChatMessage 多出 tool 角色 */
export type AgentMessage =
	| { role: "system" | "user"; content: MessageContent }
	| { role: "assistant"; content: string; tool_calls?: ToolCall[] }
	| { role: "tool"; content: string; tool_call_id: string };

/** 需要在用户确认后才真正落盘的写操作 */
export type PendingOp =
	| { kind: "write"; path: string; mode: "create" | "append" | "overwrite"; content: string }
	| { kind: "folder"; path: string }
	| { kind: "move"; from: string; to: string }
	| { kind: "delete"; path: string };

export interface AgentStep {
	tool: string;
	/** 给界面显示的一句话，例如「搜索：obsidian 插件」 */
	label: string;
	ok: boolean;
}

/** 停下来时的原因：正常答完 / 步数用完 / 到时间上限（都可以「继续跑」） */
export type StopReason = "done" | "steps" | "time";

/** 一次任务的完整状态，留着它就能接着往下跑（手机上 App 被杀也不至于全丢） */
export interface AgentState {
	messages: AgentMessage[];
	pending: PendingOp[];
	steps: AgentStep[];
	/** 原任务带了图片时，续跑仍按多模态发（图片已在 messages 里，这里只记标志） */
	hasImages: boolean;
	/** 累计用量，续跑时继续累加 */
	usage: Usage;
	/** 本次运行里已经调用过的只读工具指纹，重复调用直接复用，不再花一次 token */
	seen?: Set<string>;
	/** 这段对话进行到第几轮（用户说了几句话）；续跑不增加，接着说才增加 */
	turns?: number;
}

/** 从相机或相册拿到、已经压好尺寸的图片 */
export interface PickedImage {
	dataUrl: string;
	name: string;
	bytes: number;
	width: number;
	height: number;
	/** 未裁的原图（长边已压到 1400）；再框选一次时以它为底，不叠加损失 */
	original?: string;
	/** 当前这张图用的框选范围；没有就是整张 */
	crop?: CropRect;
	/** 存进库之后的路径；有它模型才能在写笔记时用 ![[…]] 引用这张图 */
	savedPath?: string;
}

/** 框选范围，按图片宽高归一化到 0–1，换设备、换缩放都不受影响 */
export interface CropRect {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface AgentRunResult {
	reply: string;
	steps: AgentStep[];
	pending: PendingOp[];
	stopped: StopReason;
	state: AgentState;
	/** 本次累计用量（含缓存命中） */
	usage: Usage;
	/** 实际使用的模型（带图时可能临时换成 flash） */
	model: string;
}
