/**
 * 接口返回都是 unknown：先收窄再取值，避免 any 一路穿透到业务代码。
 * 这些函数不抛异常，取不到就返回 undefined，由调用方决定怎么兜底。
 */

export function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

export function asArray(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

export function asString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

export function asNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** get(obj, "choices", 0, "message", "content") —— 任意一层缺失都返回 undefined */
export function get(value: unknown, ...keys: (string | number)[]): unknown {
	let current: unknown = value;
	for (const key of keys) {
		if (typeof key === "number") {
			current = asArray(current)[key];
		} else {
			current = asRecord(current)?.[key];
		}
		if (current === undefined) return undefined;
	}
	return current;
}

/** 取字符串并去掉首尾空白，取不到时返回空串 */
export function text(value: unknown): string {
	return (asString(value) ?? "").trim();
}
