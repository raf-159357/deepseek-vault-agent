import type { EditorPosition, TFile } from "obsidian";

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

export interface ChatMessage {
	role: "system" | "user" | "assistant";
	content: string;
}

/** 模型请求调用的函数（OpenAI 兼容格式） */
export interface ToolCall {
	id: string;
	type: "function";
	function: { name: string; arguments: string };
}

/** Agent 对话里的一条消息，比 ChatMessage 多出 tool 角色 */
export type AgentMessage =
	| { role: "system" | "user"; content: string }
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

export interface AgentRunResult {
	reply: string;
	steps: AgentStep[];
	pending: PendingOp[];
}
