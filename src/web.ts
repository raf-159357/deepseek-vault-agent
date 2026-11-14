import { ApiError, postJson } from "./deepseek";
import type { DeepSeekVoiceSettings } from "./settings";

export interface SearchHit {
	title: string;
	url: string;
	/** 200 字左右的摘要，够模型判断要不要读全文 */
	summary: string;
	date?: string;
	site?: string;
}

const MAX_QUERY = 128;

/**
 * DeepSeek 联网搜索：POST /v1/tools/search
 * 结果里带 summary（给模型读）和 snippet（给人看），这里只用 summary。
 */
export async function webSearch(
	settings: DeepSeekVoiceSettings,
	query: string,
	count = 8
): Promise<SearchHit[]> {
	const q = (query || "").trim();
	if (!q) throw new ApiError("搜索词是空的。");
	if (q.length > MAX_QUERY) throw new ApiError(`搜索词最多 ${MAX_QUERY} 个字符，请缩短一点。`);

	const n = Math.min(50, Math.max(1, Math.floor(count) || 8));
	const data = await postJson(settings, "/v1/tools/search", {
		query: q,
		count: n,
		need_content: false,
	});

	const list: unknown[] = Array.isArray(data?.results) ? data.results : [];
	return list
		.map((r: any) => ({
			title: String(r?.title ?? "").trim(),
			url: String(r?.url ?? "").trim(),
			summary: String(r?.summary ?? r?.snippet ?? "").trim(),
			date: typeof r?.date === "string" ? r.date : undefined,
			site: typeof r?.site_name === "string" && r.site_name ? r.site_name : undefined,
		}))
		.filter((r) => r.url && r.title);
}

/** 把搜索结果压成模型好读的纯文本 */
export function formatHits(hits: SearchHit[]): string {
	if (!hits.length) return "（没有搜到结果，可以换个关键词再搜一次）";
	return hits
		.map((h, i) => {
			const meta = [h.site, h.date ? h.date.slice(0, 10) : ""].filter(Boolean).join(" · ");
			return `${i + 1}. ${h.title}${meta ? `（${meta}）` : ""}\n   ${h.url}\n   ${h.summary}`;
		})
		.join("\n");
}

export interface PageContent {
	title: string;
	content: string;
	url: string;
}

const MAX_PAGE_CHARS = 12000;

/**
 * DeepSeek 读网页：POST /v1/tools/fetch，返回 Markdown 正文。
 * 服务端已做正文抽取，不需要自己解析 HTML。
 */
export async function readUrl(settings: DeepSeekVoiceSettings, url: string): Promise<PageContent> {
	const u = (url || "").trim();
	if (!/^https?:\/\//i.test(u)) throw new ApiError(`不是有效的网页地址：${u}`);

	const data = await postJson(settings, "/v1/tools/fetch", { url: u });
	const content = String(data?.content ?? "");
	if (!content.trim()) {
		throw new ApiError("这个网页抓不到正文，可能是需要登录、纯图片，或者被站点拦了。");
	}
	return {
		title: String(data?.title ?? "").trim() || u,
		url: u,
		content: content.length > MAX_PAGE_CHARS ? `${content.slice(0, MAX_PAGE_CHARS)}\n\n（正文过长，已截断）` : content,
	};
}

/** 从一段文字里挑出 http(s) 链接，用于「用户直接甩了个链接」的场景 */
export function extractUrls(text: string): string[] {
	// 中文标点和汉字不能算进 URL：微信里复制出来的链接经常紧跟「。还有」
	const found = text.match(/https?:\/\/[^\s<>"'）)】\]，。；：、！？\u4e00-\u9fff]+/gi) ?? [];
	const cleaned = found.map((u) => u.replace(/[.,;:!?]+$/, ""));
	return Array.from(new Set(cleaned)).slice(0, 5);
}
