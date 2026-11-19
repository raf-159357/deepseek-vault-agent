import { App, MarkdownView, Notice, TFile, TFolder, normalizePath } from "obsidian";
import type DeepSeekVoicePlugin from "./main";
import type { VoiceContext, VoiceMode, VoiceResult } from "./types";
import { asRecord } from "./json";
import { F, s } from "./i18n";

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
		const parsed: unknown = JSON.parse(slice);
		return asRecord(parsed) ?? null;
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
			summary: F.line(
				"模型没有按结构化格式返回，已按原文处理",
				"The model did not return structured output, so the raw text is used"
			),
			notes: F.line("建议重新生成一次，或把指令说得更具体。", "Try generating again, or make the instruction more specific."),
		};
	}

	const action = VALID_MODES.includes(obj.action as VoiceMode) ? (obj.action as VoiceMode) : fallbackMode;
	const content = typeof obj.content === "string" ? obj.content : "";
	const title = typeof obj.title === "string" ? obj.title : undefined;

	if (!content.trim()) {
		throw new Error(
			F.line(
				"模型返回的正文是空的，没有可写入的内容。换个说法再试一次。",
				"The model returned an empty body, so there is nothing to write. Try wording it differently."
			)
		);
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
			return F.appended(res.content.length, ctx.file?.basename ?? F.fallbackNote());
		case "replace-note":
			return F.rewritten(res.content.length, ctx.file?.basename ?? F.fallbackNote());
		case "replace-selection":
			return F.replacedSel(res.content.length, ctx.selection.length);
		case "create-note":
			return F.created(res.title ?? F.untitled(), res.content.length);
	}
}

function extractFrontmatter(data: string): string | null {
	const source: string = data;
	if (!source.startsWith("---")) return null;
	const end: number = source.indexOf("\n---", 3);
	if (end === -1) return null;
	const after: number = source.indexOf("\n", end + 4);
	const fm: string = after === -1 ? source : source.slice(0, after);
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
	throw new Error(F.tooManySame());
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
			throw new Error(F.noEditor());
		}
		const editor = view.editor;
		if (!ctx.from || !ctx.to) throw new Error(F.noSelectionRange());
		const current = editor.getRange(ctx.from, ctx.to);
		if (current !== ctx.selection) {
			throw new Error(F.selectionChanged());
		}
		editor.replaceRange(content, ctx.from, ctx.to);
		return F.selDone(content.length);
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
		return F.createdNote(file.basename);
	}

	const file = ctx.file;
	if (!file) throw new Error(s("errNoNote"));

	if (res.action === "append") {
		await app.vault.process(file, (data) => {
			const body = data.replace(/\s+$/, "");
			return `${body ? `${body}\n\n` : ""}${content}\n`;
		});
		return F.appendDone(file.basename);
	}

	// replace-note
	await app.vault.process(file, (data) => {
		const fm = extractFrontmatter(data);
		const keepsFrontmatter = fm && !content.startsWith("---");
		return `${keepsFrontmatter ? `${fm}\n\n` : ""}${content}\n`;
	});
	return F.rewriteDone(content.length, file.basename);
}

export function notify(message: string, timeout = 4000): void {
	new Notice(message, timeout);
}

export function guardFileSize(file: TFile | null): void {
	if (!file) return;
	if (file.stat.size > 800_000) {
		throw new Error(F.fileTooBig());
	}
}
