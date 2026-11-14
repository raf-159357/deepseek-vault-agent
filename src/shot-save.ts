/**
 * 把框好的图存进库：走 Obsidian 自己的附件目录设置，
 * 在光标处插入 ![[...]]，跟手动拖一张图进来效果一样。
 */
import { App, MarkdownView } from "obsidian";
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

/** 存图并插入双链；当前没有打开的笔记时返回 null（图仍然会发给模型） */
export async function saveShot(app: App, image: PickedImage): Promise<string | null> {
	const view = app.workspace.getActiveViewOfType(MarkdownView);
	const note = view?.file ?? null;
	const editor = view?.editor ?? null;
	if (!note || !editor) return null;

	const path = await app.fileManager.getAvailablePathForAttachment(`shot-${stamp()}.jpg`, note.path);
	await app.vault.createBinary(path, toBuffer(image.dataUrl));
	editor.replaceSelection(`![[${path}]]\n`);
	return path;
}
