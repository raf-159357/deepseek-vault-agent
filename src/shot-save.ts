/**
 * 把框好的图存进库：走 Obsidian 自己的附件目录设置。
 * 有打开着的笔记就顺手在光标处插入 ![[...]]（跟手动拖一张图进来一样）；
 * 没有打开的笔记也照样存进库 —— 存下来模型才有路径可引用，
 * 否则它写笔记时只能干巴巴地描述「这里有一张图」。
 */
import { App, MarkdownView, TFile } from "obsidian";
import type { PickedImage } from "./types";

function toBuffer(dataUrl: string): ArrayBuffer {
	const comma = dataUrl.indexOf(",");
	const base64 = comma === -1 ? "" : dataUrl.slice(comma + 1);
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
	return bytes.buffer;
}

function stamp(): string {
	const now = new Date();
	const pad = (n: number): string => String(n).padStart(2, "0");
	return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(
		now.getMinutes()
	)}${pad(now.getSeconds())}`;
}

export interface SavedShot {
	path: string;
	/** 有没有顺手插进当前笔记的光标处 */
	inserted: boolean;
}

/** 存图；当前笔记存在时顺带插入双链。存不下（权限/磁盘）时返回 null */
export async function saveShot(app: App, image: PickedImage): Promise<SavedShot | null> {
	const view = app.workspace.getActiveViewOfType(MarkdownView);
	const note = view?.file ?? null;
	const editor = view?.editor ?? null;
	try {
		const path = await app.fileManager.getAvailablePathForAttachment(`shot-${stamp()}.jpg`, note?.path ?? "");
		await app.vault.createBinary(path, toBuffer(image.dataUrl));
		if (editor) editor.replaceSelection(`![[${path}]]\n`);
		return { path, inserted: !!editor };
	} catch {
		return null;
	}
}

/**
 * 重新框选之后，把同一路径上的图换掉。
 * 不换的话正文里的引用还是旧那一刀，而模型看到的是新的，对不上。
 */
export async function replaceShot(app: App, image: PickedImage): Promise<PickedImage> {
	if (!image.savedPath) return image;
	try {
		const file = app.vault.getAbstractFileByPath(image.savedPath);
		if (file instanceof TFile) await app.vault.modifyBinary(file, toBuffer(image.dataUrl));
	} catch {
		/* 换不掉也不影响这次请求，下次存图会是新的 */
	}
	return image;
}
