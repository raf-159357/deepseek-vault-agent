import { App, MarkdownView, Notice, TFile, TFolder, normalizePath } from "obsidian";
import type DeepSeekVoicePlugin from "./main";
import type { VoiceContext, VoiceMode, VoiceResult } from "./types";

const VALID_MODES: VoiceMode[] = ["append", "replace-selection", "replace-note", "create-note"];

function stripFences(raw: string): string {
	let text = raw.trim();
	const fence = text.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/);
	if (fence) text = fence[1].trim();
	return text;
}

function extractJsonObject(text: string): Record<string, unknown> | null {
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	if (start === -1 || end === -1 || end <= start) return null;
	const slice = text.slice(start, end + 1);
	try {
		const parsed = JSON.parse(slice);
		return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}

/** 模型偶尔不按 JSON 返回，此时按用户选择的落点原样写入，并在预览里提示。 */
export function parseResult(raw: string, fallbackMode: VoiceMode): VoiceResult {
	const cleaned = stripFences(raw);
	const obj = extractJsonObject(cleaned);
	if (!obj) {
		return {
			action: fallbackMode,
			content: cleaned,
			summary: "模型没有按结构化格式返回，已按原文处理",
			notes: "建议重新生成一次，或把指令说得更具体。",
		};
	}

	const action = VALID_MODES.includes(obj.action as VoiceMode) ? (obj.action as VoiceMode) : fallbackMode;
	const content = typeof obj.content === "string" ? obj.content : "";
	const title = typeof obj.title === "string" ? obj.title : undefined;

	if (!content.trim()) {
		throw new Error("模型返回的正文是空的，没有可写入的内容。换个说法再试一次。");
	}

	return {
		action,
		title: title?.trim() || undefined,
		content: content.replace(/\r\n/g, "\n"),
		summary: typeof obj.summary === "string" ? obj.summary.trim() : undefined,
		notes: typeof obj.notes === "string" ? obj.notes.trim() : undefined,
	};
}

export function describeResult(res: VoiceResult, ctx: VoiceContext): string {
	switch (res.action) {
		case "append":
			return `追加 ${res.content.length} 字到「${ctx.file?.basename ?? "当前笔记"}」末尾`;
		case "replace-note":
			return `用 ${res.content.length} 字替换「${ctx.file?.basename ?? "当前笔记"}」整篇正文`;
		case "replace-selection":
			return `用 ${res.content.length} 字替换选中的 ${
				ctx.selection.length
			} 字`;
		case "create-note":
			return `新建笔记「${res.title ?? "未命名"}」（${res.content.length} 字）`;
	}
}

function extractFrontmatter(data: string): string | null {
	if (!data.startsWith("---")) return null;
	const end = data.indexOf("\n---", 3);
	if (end === -1) return null;
	const after = data.indexOf("\n", end + 4);
	const fm = after === -1 ? data : data.slice(0, after);
	return fm.trimEnd();
}

function sanitizeTitle(title: string): string {
	const cleaned = title
		.replace(/[\\/:*?"<>|#^[\]]/g, "-")
		.replace(/\s+/g, " ")
		.trim()
		.replace(/\.md$/i, "");
	return cleaned.slice(0, 60) || "语音笔记";
}

function timestamp(): string {
	const d = new Date();
	const p = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function isoTimestamp(): string {
	const d = new Date();
	const p = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

async function ensureFolder(app: App, folder: string): Promise<void> {
	const path = normalizePath(folder);
	if (!path) return;
	const existing = app.vault.getAbstractFileByPath(path);
	if (existing instanceof TFolder) return;
	if (existing) throw new Error(`「${path}」是一个文件，不能当作文件夹使用。`);
	await app.vault.createFolder(path);
}

async function uniquePath(app: App, basePath: string): Promise<string> {
	if (!app.vault.getAbstractFileByPath(basePath)) return basePath;
	const stem = basePath.replace(/\.md$/i, "");
	for (let i = 2; i < 1000; i++) {
		const candidate = `${stem} ${i}.md`;
		if (!app.vault.getAbstractFileByPath(candidate)) return candidate;
	}
	throw new Error("同名的笔记太多了，换一个标题再试。");
}

/**
 * 把模型结果写进库里。返回一句给用户看的结果说明。
 * 写入用 vault.process，尽量降低与其他插件/同步冲突的概率。
 */
export async function writeResult(plugin: DeepSeekVoicePlugin, ctx: VoiceContext, res: VoiceResult): Promise<string> {
	const app = plugin.app;
	const content = res.content.replace(/\s+$/, "");

	if (res.action === "replace-selection") {
		const view = app.workspace.getActiveViewOfType(MarkdownView);
		if (!view || !ctx.file || view.file?.path !== ctx.file.path) {
			throw new Error("原笔记已经不在编辑状态，无法精确替换选中段落。请重新打开笔记、重新选中后再试。");
		}
		const editor = view.editor;
		if (!ctx.from || !ctx.to) throw new Error("没有拿到选中范围，请重新选中文字再试。");
		const current = editor.getRange(ctx.from, ctx.to);
		if (current !== ctx.selection) {
			throw new Error("选中的文字在等待期间被改动了，为避免覆盖错误内容，请重新选中再试。");
		}
		editor.replaceRange(content, ctx.from, ctx.to);
		return `已替换选中段落（${content.length} 字）`;
	}

	if (res.action === "create-note") {
		const folder = plugin.settings.newNoteFolder.trim();
		if (folder) await ensureFolder(app, folder);
		const name = sanitizeTitle(res.title || content.split("\n")[0] || `语音笔记 ${timestamp()}`);
		const basePath = normalizePath(folder ? `${folder}/${name}.md` : `${name}.md`);
		const path = await uniquePath(app, basePath);
		const frontmatter = [
			"---",
			`created: ${isoTimestamp()}`,
			"source: deepseek-vault-agent",
			res.title ? `title: "${name.replace(/"/g, "'")}"` : null,
			"---",
			"",
		]
			.filter((line) => line !== null)
			.join("\n");
		const file = await app.vault.create(path, `${frontmatter}${content}\n`);
		await app.workspace.getLeaf(false).openFile(file);
		return `已新建「${file.basename}」`;
	}

	const file = ctx.file;
	if (!file) throw new Error("当前没有打开的笔记，请选择「新建笔记」或先打开一篇笔记。");

	if (res.action === "append") {
		await app.vault.process(file, (data) => {
			const body = data.replace(/\s+$/, "");
			return `${body ? `${body}\n\n` : ""}${content}\n`;
		});
		return `已追加到「${file.basename}」`;
	}

	// replace-note
	await app.vault.process(file, (data) => {
		const fm = extractFrontmatter(data);
		const keepsFrontmatter = fm && !content.startsWith("---");
		return `${keepsFrontmatter ? `${fm}\n\n` : ""}${content}\n`;
	});
	return `已改写「${file.basename}」正文`;
}

export function notify(message: string, timeout = 4000): void {
	new Notice(message, timeout);
}

export function guardFileSize(file: TFile | null): void {
	if (!file) return;
	if (file.stat.size > 800_000) {
		throw new Error("这篇笔记太大（超过 800 KB），为避免误覆盖，插件拒绝整篇改写。请用「追加」或先拆分笔记。");
	}
}
