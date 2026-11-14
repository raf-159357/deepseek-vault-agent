import { App, TFile, TFolder, normalizePath } from "obsidian";
import type { PendingOp } from "./types";

// 配置目录不一定是 .obsidian（用户可改），统一交给下面的「隐藏目录」规则拦，避免写死路径
const FORBIDDEN_SEGMENTS = [".git", ".trash", "node_modules"];
const MAX_WRITE_CHARS = 200_000;

/**
 * 把模型给的路径变成安全路径。
 * 模型会瞎编 `../`、绝对路径、`.obsidian/` 这类东西，必须在这里挡住。
 */
export function safePath(raw: string): string {
	let p = String(raw ?? "").trim();
	if (!p) throw new Error("路径是空的。");
	p = p.replace(/\\/g, "/").replace(/^\.\//, "");
	if (p.startsWith("/") || /^[a-zA-Z]:/.test(p)) throw new Error(`只能用库内相对路径，不能是「${raw}」。`);
	if (p.split("/").some((seg) => seg === "..")) throw new Error(`路径里不能有「..」，拒绝越出库目录：${raw}`);

	p = normalizePath(p);
	const lower = p.toLowerCase();
	for (const bad of FORBIDDEN_SEGMENTS) {
		if (lower === bad || lower.startsWith(`${bad}/`) || lower.includes(`/${bad}/`) || lower.endsWith(`/${bad}`)) {
			throw new Error(`不允许操作配置目录「${bad}」：${raw}`);
		}
	}
	if (p.split("/").some((seg) => seg.startsWith("."))) throw new Error(`不允许操作隐藏文件或目录：${raw}`);
	return p;
}

function asMarkdownPath(path: string): string {
	return /\.md$/i.test(path) ? path : `${path}.md`;
}

function parentOf(path: string): string {
	const i = path.lastIndexOf("/");
	return i === -1 ? "" : path.slice(0, i);
}

async function ensureFolder(app: App, folder: string): Promise<void> {
	if (!folder) return;
	const path = normalizePath(folder);
	const existing = app.vault.getAbstractFileByPath(path);
	if (existing instanceof TFolder) return;
	if (existing) throw new Error(`「${path}」是一个文件，不能当文件夹用。`);
	await app.vault.createFolder(path);
}

export interface NoteInfo {
	path: string;
	size: number;
	mtime: number;
}

/** 列出某个文件夹下的内容，根目录传空字符串 */
export function listFolder(app: App, folder: string, limit = 80): { folders: string[]; notes: NoteInfo[] } {
	const raw = String(folder ?? "").trim();
	const path = raw ? safePath(raw) : "";
	const target = path ? app.vault.getAbstractFileByPath(path) : app.vault.getRoot();
	if (!target) throw new Error(`找不到文件夹：${raw}`);
	if (!(target instanceof TFolder)) throw new Error(`「${raw}」是一个文件，不是文件夹。`);

	const folders: string[] = [];
	const notes: NoteInfo[] = [];
	for (const child of target.children) {
		if (child instanceof TFolder) folders.push(`📁 ${child.path}`);
		else if (child instanceof TFile && child.extension === "md") {
			notes.push({ path: child.path, size: child.stat.size, mtime: child.stat.mtime });
		}
	}
	notes.sort((a, b) => b.mtime - a.mtime);
	return { folders: folders.slice(0, limit), notes: notes.slice(0, limit) };
}

export async function readNote(app: App, rawPath: string, maxChars = 20_000): Promise<{ path: string; content: string }> {
	const path = safePath(asMarkdownPath(rawPath));
	const file = app.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile)) throw new Error(`没有这篇笔记：${path}`);
	const content = await app.vault.cachedRead(file);
	return {
		path,
		content: content.length > maxChars ? `${content.slice(0, maxChars)}\n\n（内容过长，已截断）` : content,
	};
}

export interface SearchMatch {
	path: string;
	/** 命中的上下文，正文搜索时给出前后各 60 字 */
	snippet: string;
	where: "title" | "content";
}

/** 先按文件名匹配，再按正文匹配；只在 .md 里找，跳过配置目录 */
export async function searchNotes(app: App, query: string, limit = 20): Promise<SearchMatch[]> {
	const q = String(query ?? "").trim();
	if (!q) throw new Error("搜索词是空的。");
	const needle = q.toLowerCase();
	const out: SearchMatch[] = [];

	const files = app.vault.getMarkdownFiles();
	for (const f of files) {
		if (out.length >= limit) break;
		if (f.path.toLowerCase().includes(needle)) {
			out.push({ path: f.path, snippet: f.basename, where: "title" });
		}
	}

	if (out.length < limit) {
		for (const f of files) {
			if (out.length >= limit) break;
			if (out.some((m) => m.path === f.path)) continue;
			let text = "";
			try {
				text = await app.vault.cachedRead(f);
			} catch {
				continue;
			}
			const at = text.toLowerCase().indexOf(needle);
			if (at === -1) continue;
			const start = Math.max(0, at - 60);
			const snippet = text.slice(start, Math.min(text.length, at + needle.length + 60)).replace(/\s+/g, " ");
			out.push({ path: f.path, snippet, where: "content" });
		}
	}
	return out;
}

export function formatList(res: { folders: string[]; notes: NoteInfo[] }): string {
	const parts: string[] = [];
	if (res.folders.length) parts.push(`文件夹：\n${res.folders.join("\n")}`);
	if (res.notes.length) parts.push(`笔记（最近修改在前）：\n${res.notes.map((n) => `${n.path}（${n.size} B）`).join("\n")}`);
	return parts.join("\n\n") || "（这个文件夹是空的）";
}

export function formatMatches(list: SearchMatch[]): string {
	if (!list.length) return "（没有匹配的笔记）";
	return list.map((m) => `- ${m.path}｜${m.where === "title" ? "标题命中" : "正文命中"}：${m.snippet}`).join("\n");
}

/** 一行话描述一个待执行操作，给用户确认时看 */
export function describeOp(op: PendingOp): string {
	switch (op.kind) {
		case "write": {
			const label = op.mode === "create" ? "新建" : op.mode === "append" ? "追加" : "覆盖";
			return `${label}「${op.path}」（${op.content.length} 字）`;
		}
		case "folder":
			return `新建文件夹「${op.path}」`;
		case "move":
			return `移动「${op.from}」→「${op.to}」`;
		case "delete":
			return `移入回收站「${op.path}」`;
	}
}

async function trash(app: App, path: string): Promise<void> {
	const file = app.vault.getAbstractFileByPath(path);
	if (!file) throw new Error(`找不到「${path}」，可能已经被删了。`);
	if (!(file instanceof TFile) && !(file instanceof TFolder)) {
		throw new Error(`「${path}」不是笔记或文件夹。`);
	}
	const fm = app.fileManager as unknown as { trashFile?: (f: TFile | TFolder) => Promise<void> };
	if (typeof fm.trashFile === "function") {
		await fm.trashFile(file);
		return;
	}
	await app.vault.trash(file, true);
}

/**
 * 真正执行排队的写操作。任何一步失败都会中断并抛出，已完成的步骤不会回滚
 * （Obsidian 没有事务，与其假装能回滚，不如把进度如实告诉用户）。
 */
export async function applyOps(app: App, ops: PendingOp[]): Promise<string[]> {
	const done: string[] = [];
	for (const op of ops) {
		if (op.kind === "folder") {
			await ensureFolder(app, op.path);
			done.push(`已新建文件夹「${op.path}」`);
			continue;
		}

		if (op.kind === "delete") {
			await trash(app, safePath(op.path));
			done.push(`已移入回收站「${op.path}」`);
			continue;
		}

		if (op.kind === "move") {
			const from = safePath(op.from);
			const to = safePath(op.to);
			const file = app.vault.getAbstractFileByPath(from);
			if (!file) throw new Error(`找不到「${from}」。`);
			await ensureFolder(app, parentOf(to));
			if (app.vault.getAbstractFileByPath(to)) throw new Error(`「${to}」已经存在，换个名字。`);
			await app.fileManager.renameFile(file, to);
			done.push(`已移动「${from}」→「${to}」`);
			continue;
		}

		// write
		const path = safePath(asMarkdownPath(op.path));
		if (op.content.length > MAX_WRITE_CHARS) throw new Error(`「${path}」内容超过 20 万字，拒绝写入。`);
		const body = op.content.replace(/\r\n/g, "\n");
		const existing = app.vault.getAbstractFileByPath(path);

		if (op.mode === "create" && existing) throw new Error(`「${path}」已经存在，改用追加或覆盖。`);

		if (!existing) {
			await ensureFolder(app, parentOf(path));
			await app.vault.create(path, body.endsWith("\n") ? body : `${body}\n`);
			done.push(`已新建「${path}」`);
			continue;
		}

		if (!(existing instanceof TFile)) throw new Error(`「${path}」是文件夹，不能当笔记写。`);
		const file = existing;
		if (op.mode === "append") {
			await app.vault.process(file, (data) => {
				const head = data.replace(/\s+$/, "");
				return `${head ? `${head}\n\n` : ""}${body.replace(/\s+$/, "")}\n`;
			});
			done.push(`已追加到「${path}」`);
		} else {
			await app.vault.process(file, () => (body.endsWith("\n") ? body : `${body}\n`));
			done.push(`已覆盖「${path}」`);
		}
	}
	return done;
}
