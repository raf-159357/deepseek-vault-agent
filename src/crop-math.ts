/**
 * 框选的纯计算部分：不碰 DOM、不碰 Obsidian，方便单测。
 * 坐标一律归一化到 0–1，这样换屏幕、转屏、换缩放都不用换算像素。
 */
import type { CropRect } from "./types";

/** 整张图 */
export const FULL_RECT: CropRect = { x: 0, y: 0, w: 1, h: 1 };

/** 最小的框，避免拖成一条线之后点「用这块」 */
export const MIN_RECT = 0.06;

function clamp(value: number, lo: number, hi: number): number {
	return Math.min(hi, Math.max(lo, value));
}

export function isFull(rect: CropRect): boolean {
	return rect.x <= 0.0005 && rect.y <= 0.0005 && rect.w >= 0.999 && rect.h >= 0.999;
}

/** 收进画布内，并保证不小于 MIN_RECT；宽高为负时按 0 处理 */
export function clampRect(rect: CropRect, min = MIN_RECT): CropRect {
	const w = clamp(rect.w, min, 1);
	const h = clamp(rect.h, min, 1);
	const x = clamp(rect.x, 0, 1 - w);
	const y = clamp(rect.y, 0, 1 - h);
	return { x, y, w, h };
}

/** 拖四角：只动被拖的那两条边，另一边固定 */
export function resizeRect(
	start: CropRect,
	corner: "tl" | "tr" | "bl" | "br",
	dx: number,
	dy: number,
	min = MIN_RECT
): CropRect {
	const right = start.x + start.w;
	const bottom = start.y + start.h;
	let { x, y, w, h } = start;

	if (corner === "tl" || corner === "bl") {
		x = clamp(start.x + dx, 0, right - min);
		w = right - x;
	} else {
		w = clamp(start.w + dx, min, 1 - start.x);
	}

	if (corner === "tl" || corner === "tr") {
		y = clamp(start.y + dy, 0, bottom - min);
		h = bottom - y;
	} else {
		h = clamp(start.h + dy, min, 1 - start.y);
	}

	return { x, y, w, h };
}

/**
 * 套一个固定比例（16:9 给投影上的 PPT 用）。
 * 结果一定落在当前框里，不会突然变大把已经排掉的东西又框进来。
 */
export function fitRatio(rect: CropRect, ratio: number): CropRect {
	const w = Math.min(rect.w, rect.h * ratio);
	const h = w / ratio;
	return {
		x: rect.x + (rect.w - w) / 2,
		y: rect.y + (rect.h - h) / 2,
		w,
		h,
	};
}

/** 归一化范围 → 原图像素，至少 1 px */
export function toCropArea(
	rect: CropRect,
	width: number,
	height: number
): { sx: number; sy: number; sw: number; sh: number } {
	const safe = clampRect(rect);
	const sw = Math.max(1, Math.round(safe.w * width));
	const sh = Math.max(1, Math.round(safe.h * height));
	const sx = Math.min(width - sw, Math.max(0, Math.round(safe.x * width)));
	const sy = Math.min(height - sh, Math.max(0, Math.round(safe.y * height)));
	return { sx, sy, sw, sh };
}
