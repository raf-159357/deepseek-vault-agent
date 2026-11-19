/**
 * 浏览器内录音 → 16kHz 单声道 16-bit PCM WAV。
 * DeepSeek ASR 只认 16-bit PCM WAV / Ogg Opus，MediaRecorder 在 iOS 上产出的是 mp4/aac，
 * 所以这里直接用 Web Audio 采原始采样，自己写 WAV 头，避免格式转换依赖。
 */

import { F } from "./i18n";

const TARGET_RATE = 16000;

export interface RecorderOptions {
	/** 自动停止的秒数上限，DeepSeek ASR 上限 120 秒 */
	maxSeconds?: number;
}

export class WavRecorder {
	recording = false;
	private stream: MediaStream | null = null;
	private ctx: AudioContext | null = null;
	private source: MediaStreamAudioSourceNode | null = null;
	private processor: ScriptProcessorNode | null = null;
	private mute: GainNode | null = null;
	private chunks: Float32Array[] = [];
	private sampleRate = 48000;
	private startedAt = 0;

	get elapsedSeconds(): number {
		return this.recording ? (Date.now() - this.startedAt) / 1000 : 0;
	}

	async start(options: RecorderOptions = {}): Promise<void> {
		if (this.recording) return;
		const media = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
		if (!media?.getUserMedia) {
			throw new Error(F.noMic());
		}

		this.stream = await media.getUserMedia({
			audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
		});

		type AudioCtor = new () => AudioContext;
		const holder = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
		const Ctor = holder.AudioContext ?? holder.webkitAudioContext;
		if (!Ctor) {
			throw new Error(F.noWebAudio());
		}
		this.ctx = new Ctor();
		if (this.ctx.state === "suspended") await this.ctx.resume();
		this.sampleRate = this.ctx.sampleRate;

		this.source = this.ctx.createMediaStreamSource(this.stream);
		this.processor = this.ctx.createScriptProcessor(4096, 1, 1);
		this.mute = this.ctx.createGain();
		this.mute.gain.value = 0; // 不把麦克风声音放出来，否则会有回声

		this.chunks = [];
		this.processor.onaudioprocess = (evt) => {
			if (!this.recording) return;
			const input = evt.inputBuffer.getChannelData(0);
			this.chunks.push(new Float32Array(input));
		};

		this.source.connect(this.processor);
		this.processor.connect(this.mute);
		this.mute.connect(this.ctx.destination);

		this.recording = true;
		this.startedAt = Date.now();
	}

	/** 停止并返回 WAV 字节 */
	async stop(): Promise<Uint8Array> {
		const seconds = this.elapsedSeconds;
		this.recording = false;
		this.disconnect();

		const merged = merge(this.chunks);
		this.chunks = [];
		if (merged.length === 0) throw new Error(F.silent());
		if (seconds < 0.3) throw new Error(F.tooShort());

		const pcm = resample(merged, this.sampleRate, TARGET_RATE);
		return encodeWav(pcm, TARGET_RATE);
	}

	async cancel(): Promise<void> {
		this.recording = false;
		this.chunks = [];
		this.disconnect();
	}

	private disconnect(): void {
		try {
			this.processor?.disconnect();
			this.source?.disconnect();
			this.mute?.disconnect();
		} catch {
			/* 已断开 */
		}
		this.processor = null;
		this.source = null;
		this.mute = null;
		this.stream?.getTracks().forEach((track) => track.stop());
		this.stream = null;
		const ctx = this.ctx;
		this.ctx = null;
		if (ctx && ctx.state !== "closed") void ctx.close().catch(() => undefined);
	}
}

function merge(chunks: Float32Array[]): Float32Array {
	const total = chunks.reduce((sum, c) => sum + c.length, 0);
	const out = new Float32Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.length;
	}
	return out;
}

/** 线性插值降采样，够用且没有依赖 */
function resample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
	if (fromRate === toRate) return input;
	const ratio = fromRate / toRate;
	const length = Math.floor(input.length / ratio);
	const out = new Float32Array(length);
	for (let i = 0; i < length; i++) {
		const pos = i * ratio;
		const idx = Math.floor(pos);
		const frac = pos - idx;
		const a = input[idx] ?? 0;
		const b = input[idx + 1] ?? a;
		out[i] = a + (b - a) * frac;
	}
	return out;
}

function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
	const buffer = new ArrayBuffer(44 + samples.length * 2);
	const view = new DataView(buffer);

	const writeString = (offset: number, text: string) => {
		for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
	};

	writeString(0, "RIFF");
	view.setUint32(4, 36 + samples.length * 2, true);
	writeString(8, "WAVE");
	writeString(12, "fmt ");
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true); // PCM
	view.setUint16(22, 1, true); // 单声道
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * 2, true);
	view.setUint16(32, 2, true);
	view.setUint16(34, 16, true);
	writeString(36, "data");
	view.setUint32(40, samples.length * 2, true);

	let offset = 44;
	for (let i = 0; i < samples.length; i++) {
		const s = Math.max(-1, Math.min(1, samples[i]));
		view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
		offset += 2;
	}

	return new Uint8Array(buffer);
}
