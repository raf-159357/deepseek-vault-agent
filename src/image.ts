/**
 * 拍照 / 选图：走 WebView 原生的 file input，iOS 和 Android 都能直接调起相机。
 * 上传前先压到 1400 px、JPEG 0.82 —— 模型那边反正会把图缩到约 1300×1300，
 * 传原图只会白花流量和上传时间。
 */
import type { PickedImage } from "./types";
import { F } from "./i18n";

/** 长边上限，超过就等比缩小 */
const MAX_SIDE = 1400;
const QUALITY = 0.82;
/** data URL 字符数上限（约 3 MB 原图），超过再压一档 */
const HARD_BYTES = 4 * 1024 * 1024;
const ACCEPT = "image/jpeg,image/png,image/webp,image/gif";

/** base64 解码后的字节数，用来估算上传体积 */
export function bytesOfDataUrl(dataUrl: string): number {
	const comma = dataUrl.indexOf(",");
	if (comma === -1) return 0;
	const b64 = dataUrl.slice(comma + 1);
	const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
	return Math.max(0, Math.floor((b64.length * 3) / 4) - pad);
}

interface Decoded {
	source: CanvasImageSource;
	width: number;
	height: number;
	release: () => void;
}

async function decode(file: File): Promise<Decoded> {
	const factory = (window as unknown as { createImageBitmap?: (blob: Blob) => Promise<ImageBitmap> })
		.createImageBitmap;
	if (typeof factory === "function") {
		const bitmap = await factory(file);
		return {
			source: bitmap,
			width: bitmap.width,
			height: bitmap.height,
			release: () => bitmap.close(),
		};
	}
	// 老版本 iOS 没有 createImageBitmap，退回 <img>
	const url = URL.createObjectURL(file);
	const img = activeDocument.createElement("img");
	await new Promise<void>((resolve, reject) => {
		img.onload = () => resolve();
		img.onerror = () => reject(new Error(F.imageFail("decode")));
		img.src = url;
	});
	return {
		source: img,
		width: img.naturalWidth || img.width,
		height: img.naturalHeight || img.height,
		release: () => URL.revokeObjectURL(url),
	};
}

function draw(decoded: Decoded, maxSide: number, quality: number): string {
	const scale = Math.min(1, maxSide / Math.max(decoded.width, decoded.height));
	const width = Math.max(1, Math.round(decoded.width * scale));
	const height = Math.max(1, Math.round(decoded.height * scale));
	const canvas = activeDocument.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error(F.imageFail("no canvas"));
	ctx.drawImage(decoded.source, 0, 0, width, height);
	return canvas.toDataURL("image/jpeg", quality);
}

export async function shrinkImage(file: File, maxSide = MAX_SIDE, quality = QUALITY): Promise<PickedImage> {
	const decoded = await decode(file);
	try {
		let dataUrl = draw(decoded, maxSide, quality);
		// 极端情况（长截图之类）再压一档，宁可糊一点也别让请求被拒
		if (bytesOfDataUrl(dataUrl) > HARD_BYTES) dataUrl = draw(decoded, Math.round(maxSide * 0.7), 0.7);
		return {
			dataUrl,
			name: file.name || "photo.jpg",
			bytes: bytesOfDataUrl(dataUrl),
			width: decoded.width,
			height: decoded.height,
		};
	} finally {
		decoded.release();
	}
}

/**
 * 打开系统相机（useCamera）或相册，返回压缩后的图片；用户取消时返回 null。
 * 必须在点击事件里同步调用，iOS 才认这个用户手势。
 */
export function pickImage(useCamera: boolean): Promise<PickedImage | null> {
	const input = activeDocument.createElement("input");
	input.type = "file";
	input.accept = ACCEPT;
	input.multiple = false;
	if (useCamera) input.setAttribute("capture", "environment");
	input.addClass("dsv-file-input");
	activeDocument.body.appendChild(input);

	return new Promise<PickedImage | null>((resolve, reject) => {
		let settled = false;
		let focusTimer: number | null = null;

		const cleanup = () => {
			if (focusTimer !== null) {
				window.clearTimeout(focusTimer);
				focusTimer = null;
			}
			window.removeEventListener("focus", onFocus);
			input.remove();
		};
		const finish = (value: PickedImage | null) => {
			if (settled) return;
			settled = true;
			cleanup();
			resolve(value);
		};
		const fail = (err: unknown) => {
			if (settled) return;
			settled = true;
			cleanup();
			reject(err instanceof Error ? err : new Error(String(err)));
		};

		// iOS 上点「取消」不一定触发 change，回到前台后再确认一次
		const onFocus = () => {
			if (focusTimer !== null) window.clearTimeout(focusTimer);
			focusTimer = window.setTimeout(() => {
				if (!settled && (!input.files || input.files.length === 0)) finish(null);
			}, 700);
		};

		input.addEventListener("change", () => {
			const file = input.files && input.files[0] ? input.files[0] : null;
			if (!file) {
				finish(null);
				return;
			}
			void shrinkImage(file).then(finish, fail);
		});

		window.addEventListener("focus", onFocus);
		input.click();
	});
}
