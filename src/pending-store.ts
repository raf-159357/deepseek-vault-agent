/**
 * 待确认的写操作存盘。
 * 手机上 Obsidian 很容易被系统回收，辛苦准备了十条改写，一切后台就没了。
 * 这里把队列写在插件目录里，下次打开弹窗时接着用。
 */
import type { App } from "obsidian";
import type { PendingOp } from "./types";
import { asRecord, asString } from "./json";

const FILE = "pending-queue.json";
/** 超过这个时间的队列不再恢复，避免拿起一份上个月的旧草稿 */
const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
const MAX_OPS = 40;

function queuePath(app: App, pluginId: string): string {
	return `${app.vault.configDir}/plugins/${pluginId}/${FILE}`;
}

export async function savePending(app: App, pluginId: string, ops: PendingOp[]): Promise<void> {
	const path = queuePath(app, pluginId);
	try {
		if (!ops.length) {
			await clearPending(app, pluginId);
			return;
		}
		await app.vault.adapter.write(path, JSON.stringify({ at: Date.now(), ops: ops.slice(0, MAX_OPS) }));
	} catch {
		/* 存不下就算了，不能因为存档失败挡住主流程 */
	}
}

export async function clearPending(app: App, pluginId: string): Promise<void> {
	const path = queuePath(app, pluginId);
	try {
		if (await app.vault.adapter.exists(path)) await app.vault.adapter.remove(path);
	} catch {
		/* 同上 */
	}
}

function parseOp(raw: unknown): PendingOp | null {
	const rec = asRecord(raw);
	if (!rec) return null;
	const kind = asString(rec.kind);
	const path = asString(rec.path);

	if (kind === "write") {
		const mode = asString(rec.mode);
		const content = asString(rec.content);
		if (!path || !content) return null;
		if (mode !== "create" && mode !== "append" && mode !== "overwrite") return null;
		return { kind: "write", path, mode, content };
	}
	if (kind === "folder") {
		return path ? { kind: "folder", path } : null;
	}
	if (kind === "move") {
		const from = asString(rec.from);
		const to = asString(rec.to);
		return from && to ? { kind: "move", from, to } : null;
	}
	if (kind === "delete") {
		return path ? { kind: "delete", path } : null;
	}
	return null;
}

export async function loadPending(app: App, pluginId: string): Promise<PendingOp[]> {
	const path = queuePath(app, pluginId);
	try {
		if (!(await app.vault.adapter.exists(path))) return [];
		const raw = await app.vault.adapter.read(path);
		const parsed: unknown = JSON.parse(raw);
		const rec = asRecord(parsed);
		if (!rec) return [];
		const at = typeof rec.at === "number" ? rec.at : 0;
		if (!at || Date.now() - at > MAX_AGE_MS) {
			await clearPending(app, pluginId);
			return [];
		}
		const list = Array.isArray(rec.ops) ? rec.ops : [];
		return list.map(parseOp).filter((op): op is PendingOp => op !== null);
	} catch {
		return [];
	}
}
