import { F, s } from "./i18n";
import { requestUrl } from "obsidian";
import type { AgentMessage, ChatMessage, ContentPart, ToolCall } from "./types";
import type { DeepSeekVoiceSettings } from "./settings";
import { asArray, asRecord, asString, get, text } from "./json";
import { parseUsage, type Usage } from "./usage";

/** 目前只有 deepseek-flash 收图；v4-pro 发图直接 400 */
export const VISION_MODEL = "deepseek-flash";

export function supportsVision(model: string): boolean {
	return /flash/i.test(model);
}

/** 带图时如果当前模型看不了图，临时换成 flash（不改用户设置） */
export function resolveModel(model: string, needsVision: boolean): string {
	if (!needsVision || supportsVision(model)) return model;
	return VISION_MODEL;
}

/** 把图片挂到最后一条 user 消息上，文字在前、图片在后 */
export function withImages(messages: ChatMessage[], images: string[]): ChatMessage[] {
	if (!images.length) return messages;
	const list = messages.slice();
	for (let i = list.length - 1; i >= 0; i--) {
		const msg = list[i];
		if (msg.role !== "user") continue;
		const parts: ContentPart[] =
			typeof msg.content === "string"
				? msg.content.trim()
					? [{ type: "text", text: msg.content }]
					: []
				: msg.content.slice();
		for (const url of images) parts.push({ type: "image_url", image_url: { url, detail: "high" } });
		list[i] = { role: "user", content: parts };
		break;
	}
	return list;
}

export class ApiError extends Error {
	status?: number;
	detail?: string;

	constructor(message: string, status?: number, detail?: string) {
		super(message);
		this.name = "ApiError";
		this.status = status;
		this.detail = detail;
	}
}

/** 用户可能填 https://api.deepseek.com 或 .../v1，两种都要能拼对 */
export function joinUrl(baseUrl: string, path: string): string {
	let base = (baseUrl || "https://api.deepseek.com").trim().replace(/\/+$/, "");
	if (path.startsWith("/v1/") && base.endsWith("/v1")) base = base.slice(0, -3);
	return `${base}${path}`;
}

export function mapHttpError(status: number, body: string): ApiError {
	let detail: string = body;
	try {
		const parsed: unknown = JSON.parse(body);
		detail = text(get(parsed, "error", "message")) || text(get(parsed, "message")) || body;
	} catch {
		/* 保持原文 */
	}
	const prefix =
		status === 400
			? F.line("请求被拒绝（400）", "Request rejected (400)")
			: status === 401
			? F.line("API Key 无效或没有权限（401）", "Invalid API key or no permission (401)")
			: status === 402
			? F.line("账户余额不足（402）", "Insufficient balance (402)")
			: status === 413
			? F.line("文件太大（413）：图片或音频超出上限", "File too large (413): image or audio over the limit")
			: status === 429
			? F.line("请求太频繁被限流（429）", "Rate limited (429)")
			: status >= 500
			? F.line(`DeepSeek 服务端错误（${status}）`, `DeepSeek server error (${status})`)
			: F.line(`请求失败（${status}）`, `Request failed (${status})`);
	return new ApiError(`${prefix}：${String(detail).slice(0, 300)}`, status, detail);
}

export interface ChatOptions {
	/** 是否要求模型输出 JSON（两代模型都支持 json_object） */
	json?: boolean;
	/** 附带的图片（data URL），带上就自动切到能看图的模型 */
	images?: string[];
}

/**
 * 用 Obsidian 的 requestUrl 直连 DeepSeek。
 * requestUrl 走原生 HTTP，绕开 WebView 的 CORS，桌面和 iOS/Android 都能用。
 */
export interface ChatResult {
	text: string;
	usage: Usage;
	/** 实际使用的模型（带图时可能临时是 flash） */
	model: string;
}

/** 和 chatCompletion 一样，只是把用量也带出来（界面要显示缓存命中） */
export async function chatCompletionDetailed(
	settings: DeepSeekVoiceSettings,
	messages: ChatMessage[],
	opts: ChatOptions = {}
): Promise<ChatResult> {
	if (!settings.apiKey || !settings.apiKey.trim()) {
		throw new ApiError(s("errNoKey"));
	}

	const images = (opts.images ?? []).filter((u) => !!u);
	const model = resolveModel(settings.model, images.length > 0);
	const body: Record<string, unknown> = {
		model,
		messages: withImages(messages, images),
		stream: false,
		max_tokens: settings.maxTokens,
		// 笔记改写不需要长推理，默认关掉思考模式：更快、更省
		thinking: { type: settings.thinking ? "enabled" : "disabled" },
	};

	// 思考模式下 temperature 不生效，避免误以为自己在调随机性
	if (!settings.thinking) body.temperature = settings.temperature;
	if (opts.json) body.response_format = { type: "json_object" };

	let res;
	try {
		res = await requestUrl({
			url: joinUrl(settings.baseUrl, "/chat/completions"),
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${settings.apiKey.trim()}`,
			},
			body: JSON.stringify(body),
			throw: false,
		});
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		throw new ApiError(F.netFail(msg));
	}

	if (res.status >= 400) throw mapHttpError(res.status, res.text ?? "");

	let data: unknown;
	try {
		data = res.json;
	} catch {
		throw new ApiError(F.notJson());
	}

	const content = asString(get(data, "choices", 0, "message", "content"));
	if (!content || !content.trim()) {
		throw new ApiError(F.emptyReply());
	}
	return { text: content, usage: parseUsage(get(data, "usage")), model };
}

export async function chatCompletion(
	settings: DeepSeekVoiceSettings,
	messages: ChatMessage[],
	opts: ChatOptions = {}
): Promise<string> {
	const res = await chatCompletionDetailed(settings, messages, opts);
	return res.text;
}

/** 手工拼 multipart/form-data，requestUrl 直接发 ArrayBuffer */
export function buildWavForm(wav: Uint8Array, filename = "speech.wav"): { body: ArrayBuffer; contentType: string } {
	const boundary = `----dsv${Math.random().toString(16).slice(2)}`;
	const head = new TextEncoder().encode(
		`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: audio/wav\r\n\r\n`
	);
	const tail = new TextEncoder().encode(`\r\n--${boundary}--\r\n`);
	const body = new Uint8Array(head.length + wav.length + tail.length);
	body.set(head, 0);
	body.set(wav, head.length);
	body.set(tail, head.length + wav.length);
	return { body: body.buffer, contentType: `multipart/form-data; boundary=${boundary}` };
}

/**
 * DeepSeek 语音转写：POST /v1/tools/asr
 * 限制：16-bit PCM WAV 或 Ogg Opus，≤8 MiB，≤120 秒。
 */
export async function transcribe(settings: DeepSeekVoiceSettings, wav: Uint8Array): Promise<string> {
	if (!settings.apiKey || !settings.apiKey.trim()) {
		throw new ApiError(s("errNoKeyAsr"));
	}
	const { body, contentType } = buildWavForm(wav);

	let res;
	try {
		res = await requestUrl({
			url: joinUrl(settings.baseUrl, "/v1/tools/asr"),
			method: "POST",
			headers: { Authorization: `Bearer ${settings.apiKey.trim()}` },
			contentType,
			body,
			throw: false,
		});
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		throw new ApiError(F.asrFail(msg));
	}

	if (res.status >= 400) throw mapHttpError(res.status, res.text ?? "");

	let payload: unknown = undefined;
	try {
		payload = res.json;
	} catch {
		throw new ApiError(F.notJson());
	}
	const transcript = text(get(payload, "text"));
	if (!transcript) throw new ApiError(F.asrEmpty());
	return transcript;
}

/** 通用 POST：语音之外的接口（工具调用、联网搜索、读网页）都走这里 */
export async function postJson(
	settings: DeepSeekVoiceSettings,
	path: string,
	body: Record<string, unknown>
): Promise<unknown> {
	if (!settings.apiKey || !settings.apiKey.trim()) {
		throw new ApiError(s("errNoKey"));
	}

	// 手机上切来切去，网络抖一下就整段白跑太亏。重试两次，退避 0.8s / 2s。
	const RETRY_DELAYS = [800, 2000];
	let res: Awaited<ReturnType<typeof requestUrl>> | null = null;
	let lastErr = "";
	for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
		try {
			res = await requestUrl({
				url: joinUrl(settings.baseUrl, path),
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${settings.apiKey.trim()}`,
				},
				body: JSON.stringify(body),
				throw: false,
			});
		} catch (err) {
			lastErr = err instanceof Error ? err.message : String(err);
			if (attempt < RETRY_DELAYS.length) {
				await new Promise((r) => window.setTimeout(r, RETRY_DELAYS[attempt]));
				continue;
			}
			throw new ApiError(F.netFail(lastErr));
		}
		// 5xx 和 429 值得重试；4xx 是请求本身的问题，重试也没用
		if ((res.status >= 500 || res.status === 429) && attempt < RETRY_DELAYS.length) {
			await new Promise((r) => window.setTimeout(r, RETRY_DELAYS[attempt]));
			continue;
		}
		break;
	}
	if (!res) throw new ApiError(F.netFail(lastErr || "no response"));

	if (res.status >= 400) throw mapHttpError(res.status, res.text ?? "");

	let payload: unknown;
	try {
		payload = res.json;
	} catch {
		throw new ApiError(F.notJson());
	}
	return payload;
}

export interface ToolsReply {
	/** 模型要说的话，可能为空（表示它只想调工具） */
	content: string;
	/** 模型请求调用的函数，可能为空（表示它已经给出最终回答） */
	toolCalls: ToolCall[];
	/** 这次请求的输入/输出 token 与缓存命中情况 */
	usage: Usage;
}

/**
 * 带函数调用的对话。工具由客户端执行，模型只负责决定调哪个。
 * 注意：Chat Completions 不支持在历史中间插入工具消息，所以只能按顺序追加。
 */
export async function chatWithTools(
	settings: DeepSeekVoiceSettings,
	messages: AgentMessage[],
	tools: unknown[],
	modelOverride?: string
): Promise<ToolsReply> {
	const body: Record<string, unknown> = {
		model: modelOverride || settings.model,
		messages,
		stream: false,
		max_tokens: settings.maxTokens,
		thinking: { type: settings.thinking ? "enabled" : "disabled" },
		tools,
		tool_choice: "auto",
	};
	if (!settings.thinking) body.temperature = settings.temperature;

	const data = await postJson(settings, "/chat/completions", body);
	const message = get(data, "choices", 0, "message");
	if (!asRecord(message)) {
		throw new ApiError(F.line("DeepSeek 没有返回 message，可能是接口地址不对。", "DeepSeek returned no message — the Base URL may be wrong."));
	}

	const rawCalls = asArray(get(message, "tool_calls"));
	const toolCalls: ToolCall[] = rawCalls
		.map((c, i) => ({
			id: text(get(c, "id")) || `call_${i}`,
			type: "function" as const,
			function: {
				name: text(get(c, "function", "name")),
				arguments: text(get(c, "function", "arguments")) || "{}",
			},
		}))
		.filter((c) => c.function.name);

	return { content: asString(get(message, "content")) ?? "", toolCalls, usage: parseUsage(get(data, "usage")) };
}
