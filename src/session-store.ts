/**
 * 把整段 Agent 会话写盘。
 *
 * 手机上 Obsidian 一切后台就可能被系统回收，之前只存了待确认队列，
 * 对话本身一丢，回来只能从头再问一遍。这里把 messages / steps / turns 一起存下来，
 * 下次打开弹窗能直接「继续跑」。
 *
 * 图片不落盘：data URL 动辄几百 KB，塞进 JSON 会把插件目录撑爆。
 * 图早就存成附件了（路径在 messages 里的 tool 结果和 shots 里），这里用占位符替代。
 */
import type { App } from "obsidian";
import type { AgentState, AgentMessage } from "./types";
import { asArray, asRecord, asString } from "./json";

const FILE = "session.json";
/** 超过这个时间的会话不再恢复，避免打开一个上周的半截任务 */
const MAX_AGE_MS = 12 * 60 * 60 * 1000;
/** 单条消息最长保留多少字符（工具结果本来就已经截断过，这里再兜一层） */
const MAX_MSG_CHARS = 12000;

function sessionPath(app: App, pluginId: string): string {
	return `${app.vault.configDir}/plugins/${pluginId}/${FILE}`;
}

function stripMessage(msg: AgentMessage): AgentMessage {
	const content = msg.content;
	if (typeof content === "string") {
		return { ...msg, content: content.slice(0, MAX_MSG_CHARS) };
	}
	if (!Array.isArray(content)) return msg;
	const parts = content.map((part) => {
		if (part.type === "image_url") {
			return { type: "text" as const, text: "〔图片已存为附件，未写进会话存档〕" };
		}
		return part.type === "text" ? { ...part, text: part.text.slice(0, MAX_MSG_CHARS) } : part;
	});
	return { ...msg, content: parts } as AgentMessage;
}

export async function saveSession(app: App, pluginId: string, state: AgentState): Promise<void> {
	try {
		const payload = {
			at: Date.now(),
			messages: state.messages.map(stripMessage),
			pending: state.pending,
			steps: state.steps.slice(-60),
			hasImages: state.hasImages,
			usage: state.usage,
			turns: state.turns ?? 1,
			skillBlock: state.skillBlock ?? "",
			stopReason: state.stopReason ?? "",
		};
		await app.vault.adapter.write(sessionPath(app, pluginId), JSON.stringify(payload));
	} catch {
		/* 存不下不能挡住主流程 */
	}
}

export async function loadSession(app: App, pluginId: string): Promise<AgentState | null> {
	const path = sessionPath(app, pluginId);
	try {
		if (!(await app.vault.adapter.exists(path))) return null;
		const raw = JSON.parse(await app.vault.adapter.read(path)) as unknown;
		const rec = asRecord(raw);
		if (!rec) return null;
		const at = typeof rec.at === "number" ? rec.at : 0;
		if (Date.now() - at > MAX_AGE_MS) {
			await clearSession(app, pluginId);
			return null;
		}
		const messages = asArray(rec.messages);
		if (!messages.length) return null;
		return {
			messages,
			pending: asArray(rec.pending) as AgentState["pending"],
			steps: asArray(rec.steps) as AgentState["steps"],
			hasImages: rec.hasImages === true,
			usage: (rec.usage as AgentState["usage"]) ?? { prompt: 0, completion: 0, cached: 0, total: 0 },
			turns: typeof rec.turns === "number" ? rec.turns : 1,
			skillBlock: asString(rec.skillBlock),
			stopReason: asString(rec.stopReason) as AgentState["stopReason"],
		} as AgentState;
	} catch {
		return null;
	}
}

export async function clearSession(app: App, pluginId: string): Promise<void> {
	const path = sessionPath(app, pluginId);
	try {
		if (await app.vault.adapter.exists(path)) await app.vault.adapter.remove(path);
	} catch {
		/* 同上 */
	}
}
