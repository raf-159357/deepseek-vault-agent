import { requestUrl } from "obsidian";
import type { ChatMessage } from "./types";
import type { DeepSeekVoiceSettings } from "./settings";

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

function mapHttpError(status: number, body: string): ApiError {
	let detail = body;
	try {
		const parsed = JSON.parse(body);
		detail = parsed?.error?.message ?? parsed?.message ?? body;
	} catch {
		/* 保持原文 */
	}
	const prefix =
		status === 400
			? "请求被拒绝（400）"
			: status === 401
			? "API Key 无效或没有权限（401）"
			: status === 402
			? "账户余额不足（402）"
			: status === 413
			? "音频文件太大（413）"
			: status === 429
			? "请求太频繁被限流（429）"
			: status >= 500
			? `DeepSeek 服务端错误（${status}）`
			: `请求失败（${status}）`;
	return new ApiError(`${prefix}：${String(detail).slice(0, 300)}`, status, detail);
}

export interface ChatOptions {
	/** 是否要求模型输出 JSON（两代模型都支持 json_object） */
	json?: boolean;
}

/**
 * 用 Obsidian 的 requestUrl 直连 DeepSeek。
 * requestUrl 走原生 HTTP，绕开 WebView 的 CORS，桌面和 iOS/Android 都能用。
 */
export async function chatCompletion(
	settings: DeepSeekVoiceSettings,
	messages: ChatMessage[],
	opts: ChatOptions = {}
): Promise<string> {
	if (!settings.apiKey || !settings.apiKey.trim()) {
		throw new ApiError("还没有填写 DeepSeek API Key：设置 → 第三方插件 → DeepSeek Voice Notes。");
	}

	const body: Record<string, unknown> = {
		model: settings.model,
		messages,
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
		throw new ApiError(`网络请求失败：${msg}。检查网络，或确认「接口地址」是否正确。`);
	}

	if (res.status >= 400) throw mapHttpError(res.status, res.text ?? "");

	let data: any;
	try {
		data = res.json;
	} catch {
		throw new ApiError("DeepSeek 返回的不是 JSON，可能接口地址指到了别的服务。");
	}

	const content: string | undefined = data?.choices?.[0]?.message?.content;
	if (!content || !content.trim()) {
		throw new ApiError("DeepSeek 返回内容为空。换个说法再试一次。");
	}
	return content;
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
		throw new ApiError("还没有填写 DeepSeek API Key，无法转写语音。");
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
		throw new ApiError(`语音上传失败：${msg}`);
	}

	if (res.status >= 400) throw mapHttpError(res.status, res.text ?? "");

	const data = res.json as { text?: string };
	const text = (data?.text ?? "").trim();
	if (!text) throw new ApiError("没有识别出内容，可能太短或环境太吵。再说一次试试。");
	return text;
}
