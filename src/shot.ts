/**
 * 拍照之后的那一步：先框选，再（可选）存进笔记，最后才交给模型。
 * 两个弹窗（语音笔记 / AI 指令）共用这一份流程。
 */
import { App, Notice } from "obsidian";
import { openCropSheet } from "./crop";
import { FULL_RECT } from "./crop-math";
import { cropImage } from "./image";
import { saveShot } from "./shot-save";
import { F } from "./i18n";
import type { PickedImage } from "./types";

export interface ShotPrefs {
	/** 拍完是否先框选 */
	crop: boolean;
	/** 框完是否存进笔记 */
	save: boolean;
	/** 用户在框选层里改了勾选，持久化到设置 */
	onSavePref: (save: boolean) => Promise<void>;
}

/** 返回可直接使用的图；用户取消框选时返回 null */
export async function prepareShot(app: App, picked: PickedImage, prefs: ShotPrefs): Promise<PickedImage | null> {
	let image = picked;
	let save = prefs.save;

	if (prefs.crop) {
		const base = picked.original ?? picked.dataUrl;
		const choice = await openCropSheet(base, picked.crop ?? FULL_RECT, prefs.save);
		if (!choice) return null;
		if (choice.save !== prefs.save) {
			save = choice.save;
			await prefs.onSavePref(choice.save);
		}
		image = await cropImage(base, choice.rect, picked);
	}

	if (save) {
		const path = await saveShot(app, image);
		new Notice(path ? F.shotSaved(path) : F.shotNoNote(), 5000);
	}

	return image;
}
