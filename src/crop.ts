/**
 * 框选：拍照之后先圈出要留的那一块（投影上的那页 PPT、书上的一段），
 * 只有圈里的内容会发给模型、也只有它会存进笔记。
 *
 * 交互上按手机优先设计：整层铺满，四个角可以拖，框里可以整体挪，
 * 另外给一个 16:9 —— 投影和 PPT 基本都是这个比例，点一下就对上了。
 */
import { s } from "./i18n";
import { FULL_RECT, clampRect, fitRatio, resizeRect } from "./crop-math";
import type { CropRect } from "./types";

type Corner = "tl" | "tr" | "bl" | "br";

export interface CropChoice {
	rect: CropRect;
	save: boolean;
}

interface Drag {
	mode: "move" | "resize";
	corner: Corner | null;
	startX: number;
	startY: number;
	from: CropRect;
	width: number;
	height: number;
}

/**
 * 打开框选层，确认后返回范围；取消返回 null。
 * initial 是上一次的框（重新框选时沿用），saveDefault 是「同时存进笔记」的初始勾选。
 */
export function openCropSheet(src: string, initial: CropRect, saveDefault: boolean): Promise<CropChoice | null> {
	const doc = activeDocument;

	return new Promise<CropChoice | null>((resolve) => {
		let rect: CropRect = clampRect(initial);
		let save = saveDefault;
		let drag: Drag | null = null;
		let closed = false;

		const layer = doc.body.createDiv({ cls: "dsv-crop" });
		layer.setAttribute("role", "dialog");
		layer.setAttribute("aria-label", s("cropTitle"));

		const head = layer.createDiv({ cls: "dsv-crop-head" });
		head.createDiv({ cls: "dsv-crop-title", text: s("cropTitle") });
		head.createDiv({ cls: "dsv-crop-hint", text: s("cropHint") });

		const stage = layer.createDiv({ cls: "dsv-crop-stage" });
		const frame = stage.createDiv({ cls: "dsv-crop-frame" });
		const img = frame.createEl("img", { cls: "dsv-crop-img", attr: { src } });
		img.draggable = false;

		// 框外用四块半透明遮住，比 box-shadow 便宜，手机上拖动不掉帧
		const shadeTop = frame.createDiv({ cls: "dsv-crop-shade is-top" });
		const shadeBottom = frame.createDiv({ cls: "dsv-crop-shade is-bottom" });
		const shadeLeft = frame.createDiv({ cls: "dsv-crop-shade is-left" });
		const shadeRight = frame.createDiv({ cls: "dsv-crop-shade is-right" });

		const box = frame.createDiv({ cls: "dsv-crop-box" });
		for (const corner of ["tl", "tr", "bl", "br"] as Corner[]) {
			const handle = box.createDiv({ cls: `dsv-crop-handle is-${corner}` });
			handle.dataset.corner = corner;
		}

		const foot = layer.createDiv({ cls: "dsv-crop-foot" });
		const row = foot.createDiv({ cls: "dsv-crop-row" });
		const wholeBtn = row.createEl("button", { cls: "dsv-crop-tool", text: s("cropWhole") });
		const ratioBtn = row.createEl("button", { cls: "dsv-crop-tool", text: s("cropRatio") });
		row.createDiv({ cls: "dsv-crop-gap" });
		const cancelBtn = row.createEl("button", { text: s("cropCancel") });
		const useBtn = row.createEl("button", { cls: "mod-cta dsv-btn-main", text: s("cropUse") });

		const checkLine = foot.createEl("label", { cls: "dsv-crop-check" });
		const check = checkLine.createEl("input", { type: "checkbox" });
		check.checked = saveDefault;
		checkLine.createSpan({ text: s("cropSaveNote") });

		const pct = (value: number): string => `${(value * 100).toFixed(3)}%`;

		const render = (): void => {
			box.setCssProps({
				left: pct(rect.x),
				top: pct(rect.y),
				width: pct(rect.w),
				height: pct(rect.h),
			});
			// 静态的那半边交给 CSS 类，这里只写会变的值
			shadeTop.setCssProps({ height: pct(rect.y) });
			shadeBottom.setCssProps({
				top: pct(rect.y + rect.h),
				height: pct(1 - rect.y - rect.h),
			});
			shadeLeft.setCssProps({ top: pct(rect.y), width: pct(rect.x), height: pct(rect.h) });
			shadeRight.setCssProps({
				left: pct(rect.x + rect.w),
				top: pct(rect.y),
				width: pct(1 - rect.x - rect.w),
				height: pct(rect.h),
			});
		};

		/** 按可用空间把图片摆进舞台，frame 的尺寸就是图片的真实显示尺寸 */
		const layout = (): void => {
			const naturalW = img.naturalWidth;
			const naturalH = img.naturalHeight;
			if (!naturalW || !naturalH) return;
			const availW = Math.max(80, stage.clientWidth - 24);
			const availH = Math.max(80, stage.clientHeight - 24);
			const scale = Math.min(availW / naturalW, availH / naturalH);
			frame.setCssProps({
				width: `${Math.round(naturalW * scale)}px`,
				height: `${Math.round(naturalH * scale)}px`,
			});
		};

		const onMove = (event: PointerEvent): void => {
			if (!drag) return;
			event.preventDefault();
			const dx = (event.clientX - drag.startX) / drag.width;
			const dy = (event.clientY - drag.startY) / drag.height;
			if (drag.mode === "move") {
				rect = clampRect({ x: drag.from.x + dx, y: drag.from.y + dy, w: drag.from.w, h: drag.from.h });
			} else if (drag.corner) {
				rect = resizeRect(drag.from, drag.corner, dx, dy);
			}
			render();
		};

		const onUp = (): void => {
			drag = null;
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
			window.removeEventListener("pointercancel", onUp);
		};

		const onDown = (event: PointerEvent): void => {
			if (event.button !== 0) return;
			const target = event.target as HTMLElement | null;
			const corner = (target?.dataset?.corner as Corner | undefined) ?? null;
			const bounds = frame.getBoundingClientRect();
			if (!bounds.width || !bounds.height) return;
			drag = {
				mode: corner ? "resize" : "move",
				corner,
				startX: event.clientX,
				startY: event.clientY,
				from: { ...rect },
				width: bounds.width,
				height: bounds.height,
			};
			event.preventDefault();
			event.stopPropagation();
			window.addEventListener("pointermove", onMove, { passive: false });
			window.addEventListener("pointerup", onUp);
			window.addEventListener("pointercancel", onUp);
		};

		const onResize = (): void => {
			layout();
			render();
		};

		const close = (value: CropChoice | null): void => {
			if (closed) return;
			closed = true;
			onUp();
			window.removeEventListener("keydown", onKey, true);
			window.removeEventListener("resize", onResize);
			layer.remove();
			resolve(value);
		};

		// 先吃掉 Esc，否则底下的 Obsidian 弹窗会跟着一起关
		function onKey(event: KeyboardEvent): void {
			if (event.key !== "Escape") return;
			event.preventDefault();
			event.stopPropagation();
			close(null);
		}

		box.addEventListener("pointerdown", onDown);
		wholeBtn.addEventListener("click", () => {
			rect = { ...FULL_RECT };
			render();
		});
		ratioBtn.addEventListener("click", () => {
			rect = fitRatio(rect, 16 / 9);
			render();
		});
		check.addEventListener("change", () => {
			save = check.checked;
		});
		cancelBtn.addEventListener("click", () => close(null));
		useBtn.addEventListener("click", () => close({ rect, save }));

		window.addEventListener("keydown", onKey, true);
		window.addEventListener("resize", onResize);

		const start = (): void => {
			layout();
			render();
		};
		if (img.complete && img.naturalWidth > 0) start();
		else img.addEventListener("load", start, { once: true });
	});
}
