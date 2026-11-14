/**
 * 用量统计：把 DeepSeek 返回的缓存命中情况记下来，算个大概花费。
 *
 * 官方规则（api-docs.deepseek.com/guides/kv_cache）：
 * - 只有「完整命中某个 cache prefix unit」才算命中，命中部分的输入价是未命中的 1/50；
 * - 所以把系统提示词、工具定义这些永远不变的部分放最前面，命中率才高；
 * - 返回的 usage 里给 prompt_cache_hit_tokens / prompt_cache_miss_tokens。
 */
import { asRecord } from "./json";

export interface Usage {
	/** 命中缓存的输入 token */
	hit: number;
	/** 未命中的输入 token */
	miss: number;
	/** 输出 token */
	out: number;
}

export const EMPTY_USAGE: Usage = { hit: 0, miss: 0, out: 0 };

/** 每百万 token 的美元价（错峰价；错峰时段是官方标价的五折） */
interface Price {
	hit: number;
	miss: number;
	out: number;
}

const PRICES: Record<string, Price> = {
	// deepseek-flash / DeepSeek-V4.1-Flash
	flash: { hit: 0.003, miss: 0.15, out: 0.6 },
	// deepseek-v4-pro
	pro: { hit: 0.022, miss: 0.66, out: 1.98 },
};

export function priceOf(model: string): Price {
	return /pro/i.test(model) ? PRICES.pro : PRICES.flash;
}

function num(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function parseUsage(raw: unknown): Usage {
	const usage = asRecord(raw);
	if (!usage) return { ...EMPTY_USAGE };
	const hit = num(usage.prompt_cache_hit_tokens);
	const miss = num(usage.prompt_cache_miss_tokens);
	const out = num(usage.completion_tokens);
	// 有些中转只回 OpenAI 字段：cached_tokens 在 details 里
	const cached = num(asRecord(usage.prompt_tokens_details)?.cached_tokens);
	return {
		hit: hit || cached,
		miss: miss || Math.max(0, num(usage.prompt_tokens) - (hit || cached)),
		out,
	};
}

export function addUsage(a: Usage, b: Usage): Usage {
	return { hit: a.hit + b.hit, miss: a.miss + b.miss, out: a.out + b.out };
}

export function isEmptyUsage(u: Usage): boolean {
	return u.hit + u.miss + u.out === 0;
}

/** 按错峰价估算美元花费 */
export function estimateCost(u: Usage, model: string): number {
	const p = priceOf(model);
	return (u.hit * p.hit + u.miss * p.miss + u.out * p.out) / 1_000_000;
}

/** 缓存帮你省下的钱（同样的 token 如果全部未命中要多付多少） */
export function savedByCache(u: Usage, model: string): number {
	const p = priceOf(model);
	return (u.hit * (p.miss - p.hit)) / 1_000_000;
}
