/**
 * 界面语言：跟随 Obsidian 的语言设置，也可以在插件设置里强制指定。
 * 文案全部集中在这里，避免散落在各个组件里。
 */

export type Lang = "zh" | "en";

function detect(): Lang {
	try {
		const raw = (window.localStorage.getItem("language") ?? "").toLowerCase();
		if (raw.startsWith("zh")) return "zh";
		if (raw) return "en";
		const nav = (window.navigator?.language ?? "").toLowerCase();
		return nav.startsWith("zh") ? "zh" : "en";
	} catch {
		return "zh";
	}
}

let lang: Lang = detect();

export function setLang(next: Lang): void {
	lang = next;
}

export function resetLang(): void {
	lang = detect();
}

export function getLang(): Lang {
	return lang;
}

export function isEn(): boolean {
	return lang === "en";
}

/** 静态文案 */
const S = {
	// —— 命令与入口 ——
	ribbonVoice: { zh: "语音笔记（DeepSeek）", en: "Voice note (DeepSeek)" },
	ribbonAgent: { zh: "AI 指令（可联网）", en: "AI instruction (web access)" },
	cmdAppend: { zh: "语音输入：追加到当前笔记", en: "Voice input: append to current note" },
	cmdRewrite: { zh: "语音输入：改写当前笔记", en: "Voice input: rewrite current note" },
	cmdCreate: { zh: "语音输入：新建笔记", en: "Voice input: create a new note" },
	cmdAgent: { zh: "AI 指令：联网查资料 / 整理笔记", en: "AI instruction: research or organise" },
	cmdAgentLinks: { zh: "AI 指令：读当前笔记里的链接并整理", en: "AI instruction: read the links in this note" },
	noKey: {
		zh: "DeepSeek Vault Agent：还没填 API Key，去「设置 → 第三方插件」里填。",
		en: "DeepSeek Vault Agent: no API key yet. Add one in Settings → Community plugins.",
	},

	// —— 语音弹窗 ——
	vmTitle: { zh: "语音笔记", en: "Voice note" },
	vmNoNote: { zh: "当前没有打开的笔记，将新建一篇", en: "No note is open — a new one will be created" },
	vmModeAppend: { zh: "追加", en: "Append" },
	vmModeRewrite: { zh: "改写全文", en: "Rewrite note" },
	vmModeSelection: { zh: "改写选中", en: "Rewrite selection" },
	vmModeCreate: { zh: "新建笔记", en: "New note" },
	vmStart: { zh: "● 开始说话", en: "● Start speaking" },
	vmStop: { zh: "■ 结束并转写", en: "■ Stop and transcribe" },
	vmPlaceholder: { zh: "说话或直接输入…", en: "Speak, or type here…" },
	vmClose: { zh: "关闭", en: "Close" },
	vmGenerate: { zh: "生成", en: "Generate" },
	vmGenerating: { zh: "生成中…", en: "Generating…" },
	vmRecording: { zh: "正在录音…说完点一下结束", en: "Recording… tap again when you are done" },
	vmTranscribing: { zh: "转写中…", en: "Transcribing…" },
	vmTranscribed: {
		zh: "已转成文字，检查一下有没有同音错字，再点「生成」。",
		en: "Transcribed. Check for stray words, then press Generate.",
	},
	vmNeedSelection: {
		zh: "先在这篇笔记里选中一段文字，才能改写选中部分。",
		en: "Select some text in this note first, then rewrite the selection.",
	},
	vmNeedNote: {
		zh: "当前没有打开的笔记，请在 Obsidian 里打开一篇笔记再触发。",
		en: "No note is open. Open one first, then trigger again.",
	},
	vmEmpty: { zh: "先说点什么，或者直接打字。", en: "Say something first, or type it." },
	vmWrite: { zh: "写入笔记", en: "Write to note" },
	vmCopy: { zh: "复制", en: "Copy" },
	vmCopied: { zh: "已复制到剪贴板", en: "Copied" },
	vmCopyFail: { zh: "复制失败，请手动选中复制", en: "Copy failed — select the text and copy manually" },
	vmRetry: { zh: "重新生成", en: "Generate again" },
	vmOldSelection: { zh: "原来的选中内容", en: "Previous selection" },
	vmOldBody: { zh: "改写前的正文（前 400 字）", en: "Previous body (first 400 characters)" },
	vmKey: { zh: "去填 API Key", en: "Enter API key" },
	vmNote: { zh: "注意：", en: "Note: " },

	// —— AI 指令弹窗 ——
	amTitle: { zh: "AI 指令", en: "AI instruction" },
	amSamples: {
		zh: "搜一下最近关于这个主题的新进展，整理成笔记\n把这篇文章的链接读一下，提炼要点存成新笔记\n看看我库里有哪些相关笔记，列出来",
		en: "Search the latest on this topic and write it up as a note\nRead the link in this article and save the key points as a note\nList the related notes already in my vault",
	},
	amPlaceholder: {
		zh: "让它查资料、读链接、整理或新建笔记…",
		en: "Ask it to research, read a link, tidy up, or create a note…",
	},
	amRun: { zh: "执行", en: "Run" },
	amRunning: { zh: "处理中…", en: "Working…" },
	amClose: { zh: "关闭", en: "Close" },
	amEmpty: { zh: "先说清楚要它做什么。", en: "Say what it should do first." },
	amCommit: { zh: "执行这些操作", en: "Run these actions" },
	amCommitting: { zh: "执行中…", en: "Applying…" },
	amDone: {
		zh: "已写入。接着说要做什么就行，不用重新打开窗口。",
		en: "Written. Just say what is next — no need to reopen this dialog.",
	},
	amCopyReply: { zh: "复制回答", en: "Copy answer" },
	amKey: { zh: "去填 API Key", en: "Enter API key" },
	amCamera: { zh: "拍照", en: "Camera" },
	amGallery: { zh: "相册", en: "Photos" },
	amAddImage: { zh: "加图片", en: "Add image" },
	amContinue: { zh: "继续跑", en: "Keep going" },
	amDiscard: { zh: "丢弃这批", en: "Discard" },
	amPhotoOnly: {
		zh: "把图片里的内容读出来，整理成一篇结构清晰的笔记",
		en: "Read what is in the image and write it up as a well-structured note",
	},

	// —— 框选 ——
	cropTitle: { zh: "框住要留下的部分", en: "Frame what to keep" },
	cropHint: {
		zh: "拖四角调范围，框里可以整体挪动。框外的内容不会发给 AI，也不会进笔记。",
		en: "Drag the corners, or move the whole frame. Anything outside it is not sent to the model and not saved.",
	},
	cropWhole: { zh: "全图", en: "Whole photo" },
	cropRatio: { zh: "16:9", en: "16:9" },
	cropCancel: { zh: "取消", en: "Cancel" },
	cropUse: { zh: "用这块", en: "Use this" },
	cropSaveNote: { zh: "同时存进笔记", en: "Also save into the note" },
	cropRedo: { zh: "点一下重新框选", en: "Tap to frame again" },

	// —— 设置页 ——
	setApiKeyName: { zh: "DeepSeek API Key", en: "DeepSeek API key" },
	setApiKeyDesc: {
		zh: "只存在本库的插件目录里。库若同步到 iCloud / Obsidian Sync，这个 key 也会跟着过去，别把它放进公开库或公开仓库。",
		en: "Stored only inside this vault's plugin folder. If the vault syncs (iCloud, Obsidian Sync), the key syncs too — never put it in a public vault or repo.",
	},
	setTest: { zh: "测试连接", en: "Test connection" },
	setTesting: { zh: "测试中…", en: "Testing…" },
	setBaseName: { zh: "接口地址", en: "Base URL" },
	setBaseDesc: {
		zh: "默认 https://api.deepseek.com。用中转或代理时填到 /chat 之前的位置，带不带 /v1 都能识别。",
		en: "Default https://api.deepseek.com. With a proxy or reseller, enter everything before /chat — with or without /v1.",
	},
	setModelName: { zh: "模型", en: "Model" },
	setModelDesc: {
		zh: "两个模型都支持 JSON 输出和语音转写；模型名写错会直接报 400。",
		en: "Both models support JSON output and speech-to-text. A wrong model name returns 400.",
	},
	setThinkingName: { zh: "思考模式", en: "Thinking mode" },
	setThinkingDesc: {
		zh: "默认关闭：笔记改写不需要长推理，关掉更快更省。开启后温度参数失效，输出前会先想一段。",
		en: "Off by default — note work does not need long reasoning. Turning it on disables temperature and adds a pause before the answer.",
	},
	setAsrName: { zh: "用 DeepSeek 转写语音", en: "Transcribe with DeepSeek" },
	setAsrDesc: {
		zh: "开启后弹窗里多一个录音按钮：录完上传转成文字。限制 120 秒 / 8 MiB。关掉就只用键盘自带的语音输入。",
		en: "Adds a record button to the dialog; the clip is uploaded and transcribed. Limit 120 s / 8 MiB. Turn it off to use only the keyboard's dictation.",
	},
	setAgentHead: { zh: "AI 指令（联网与知识库操作）", en: "AI instructions (web and vault actions)" },
	setWebName: { zh: "允许联网搜索", en: "Allow web search" },
	setWebDesc: {
		zh: "开启后 AI 能联网搜索和读网页：给个链接它能打开看，问到最新进展它会自己查。关掉就只能用模型已有知识。",
		en: "Lets the agent search the web and open links. Off means it answers only from what the model already knows.",
	},
	setSearchName: { zh: "每次搜索返回条数", en: "Results per search" },
	setSearchDesc: {
		zh: "默认 8 条。条数越多信息越全，但塞进上下文的字也越多，更慢更贵。",
		en: "Default 8. More results means more context, a slower run, and a bigger bill.",
	},
	setStepsName: { zh: "最多执行步数", en: "Maximum steps" },
	setStepsDesc: {
		zh: "一步 = 一次「想一下 → 调一个工具」。查资料再写笔记通常要 3–5 步；要批量整理就拉到 12 以上。上限 24，用完了可以点「继续跑」。",
		en: "One step = think, then call one tool. Research plus writing usually takes 3–5 steps; batch work needs 12+. Cap 24 — when it runs out you can press Keep going.",
	},
	setCtxName: { zh: "单次读取笔记的字数上限", en: "Characters read per note" },
	setCtxDesc: {
		zh: "AI 读一篇笔记时最多拿这么多字，超出会截断。默认 20000。",
		en: "How much of a single note the agent may read. Longer notes are truncated. Default 20000.",
	},
	setDeleteName: { zh: "允许 AI 把笔记移入回收站", en: "Allow the agent to trash notes" },
	setDeleteDesc: {
		zh: "默认关闭。开启后 AI 也只是把删除放进确认队列，你点了才会执行，而且只进回收站。",
		en: "Off by default. Even when on, deletions queue for confirmation and only ever go to the trash.",
	},
	setModeHead: { zh: "默认动作", en: "Default action" },
	setShotsHead: { zh: "拍照与截图", en: "Photos" },
	setCropName: { zh: "拍完先框选", en: "Crop after capture" },
	setCropDesc: {
		zh: "拍完先在图上拖出要保留的部分 —— 比如只留投影上那页 PPT，把周围的教室裁掉。框外的内容不会发给模型。",
		en: "After a photo is taken, drag a frame around what you want — the slide on the projector, not the classroom around it. Nothing outside the frame is sent to the model.",
	},
	setShotSaveName: { zh: "框完存进笔记", en: "Save the framed photo into the note" },
	setShotSaveDesc: {
		zh: "把裁好的图存成附件，并在光标处插入 ![[…]]。用的是 Obsidian 自己的附件目录设置。",
		en: "Stores the cropped image as an attachment and inserts ![[…]] at the cursor, using your Obsidian attachment folder setting.",
	},
	setModeDesc: { zh: "从命令或 URI 触发时用的默认落点。", en: "Where a command or URI puts the text by default." },
	setModeAppend: { zh: "追加到当前笔记末尾", en: "Append to the current note" },
	setModeRewrite: { zh: "改写当前笔记全文", en: "Rewrite the whole note" },
	setModeSelection: { zh: "改写选中的段落", en: "Rewrite the selection" },
	setModeCreate: { zh: "新建一篇笔记", en: "Create a new note" },
	setConfirmName: { zh: "写入前需要确认", en: "Confirm before writing" },
	setConfirmDesc: {
		zh: "开启后先看预览再点「写入笔记」。语音识别会有偏差，建议保持开启。",
		en: "Shows a preview before writing. Speech recognition makes mistakes — keep it on.",
	},
	setNoteCtxName: { zh: "随指令发送的笔记字数上限", en: "Note context sent with each instruction" },
	setNoteCtxDesc: {
		zh: "当前笔记超过这个字数时只发开头 60% 和结尾 40%。默认 6000 字。",
		en: "Above this size only the first 60% and last 40% are sent. Default 6000 characters.",
	},
	setFolderName: { zh: "新笔记存放文件夹", en: "Folder for new notes" },
	setFolderDesc: { zh: "留空表示库根目录。不存在会自动创建，例如 00_Inbox。", en: "Empty means the vault root. Missing folders are created, e.g. 00_Inbox." },
	setTempName: { zh: "温度", en: "Temperature" },
	setTempDesc: {
		zh: "0 更保守，1 更发散。改写建议 0.2–0.4；开了思考模式时这项无效。",
		en: "0 is conservative, 1 is loose. 0.2–0.4 suits rewriting. Ignored while thinking mode is on.",
	},
	setExtraName: { zh: "额外写作要求", en: "Extra writing rules" },
	setExtraDesc: {
		zh: "追加到系统提示词，例如「标题不要加序号」「改写时保留双链」。",
		en: "Appended to the system prompt, e.g. “no numbering in titles” or “keep wiki-links”.",
	},
	setExtraPlaceholder: { zh: "可选", en: "Optional" },
	setUiName: { zh: "界面语言", en: "Interface language" },
	setUiDesc: { zh: "默认跟随 Obsidian 的语言设置。", en: "Follows the language set in Obsidian by default." },
	uiAuto: { zh: "跟随 Obsidian", en: "Follow Obsidian" },
	uiZh: { zh: "中文", en: "中文 (Chinese)" },
	uiEn: { zh: "English", en: "English" },
	setFabName: { zh: "手机上的悬浮按钮", en: "Floating button on mobile" },
	setFabDesc: {
		zh: "在手机界面上浮一个圆钮，点一下直接进 AI 指令，长按进语音笔记。可以拖到不挡手的位置。",
		en: "Shows a round button on the phone screen: tap for an AI instruction, long-press for a voice note. Drag it anywhere.",
	},
	setStatsName: { zh: "用量与缓存", en: "Usage and cache" },
	setStatsDesc: {
		zh: "插件自己记的账：发了多少次请求、输入里有多少命中了缓存、大约花了多少。只存在本地，不上传。",
		en: "A local tally: how many requests went out, how much input hit the cache, what it roughly cost. Stored on this device only.",
	},
	statsReset: { zh: "清零", en: "Reset" },
	statsCleared: { zh: "已清零", en: "Cleared" },
	setHelpHead: { zh: "手机上怎么一键唤起", en: "One-tap entry on the phone" },
	setHelp1: {
		zh: "iOS 不向第三方 App 开放音量键，「两个音量键同时按」在 Obsidian 里做不到。可用替代：① 设置 → 辅助功能 → 触控 → 轻点背面 → 轻点两下 → 选一个快捷指令；② iPhone 15 Pro 以上的操作按钮绑定快捷指令；③ 锁屏小组件。快捷指令动作只需「打开 URL」。",
		en: "iOS does not give third-party apps the volume buttons, so “press both” is impossible inside Obsidian. Use Back Tap (Settings → Accessibility → Touch → Back Tap), the Action button on iPhone 15 Pro and later, or a lock-screen widget. The shortcut only needs one action: Open URL.",
	},
	setHelp2: {
		zh: "想连语音识别一起省掉一步：快捷指令里用「听写文本」拿到文字，再拼成 obsidian://vaultagent?vault=库名&mode=append&text=文字&auto=1，插件会直接开始处理。",
		en: "To skip the dialog, take the text from Dictate Text and build obsidian://vaultagent?vault=<vault>&mode=append&text=<text>&auto=1 — the plugin starts working immediately.",
	},

	// —— 错误与提示 ——
	errNoKey: {
		zh: "还没有填写 DeepSeek API Key：设置 → 第三方插件 → DeepSeek Vault Agent。",
		en: "No DeepSeek API key yet: Settings → Community plugins → DeepSeek Vault Agent.",
	},
	errNoKeyAsr: { zh: "还没有填写 DeepSeek API Key，无法转写语音。", en: "No DeepSeek API key, so speech cannot be transcribed." },
	errNoNote: {
		zh: "当前没有打开的笔记，请选择「新建笔记」或先打开一篇笔记。",
		en: "No note is open. Choose “New note”, or open one first.",
	},
	toastApplied: { zh: "已执行", en: "Applied" },
} as const;

export type StringKey = keyof typeof S;

export function s(key: StringKey): string {
	return S[key][lang];
}

/** 需要插值的文案 */
export const F = {
	line: (zh: string, en: string): string => (lang === "en" ? en : zh),
	recHint: (max: number): string =>
		lang === "en"
			? `Tap to start, tap again when done (max ${max}s). The text lands below — check it, then Generate.`
			: `点一下开始，说完再点一下（最长 ${max} 秒），文字会先填进下面，确认后再生成。`,
	recElapsed: (sec: number): string => (lang === "en" ? `Stop and transcribe · ${sec}s` : `结束并转写 · ${sec}s`),
	micFail: (msg: string): string => (lang === "en" ? `Cannot open the microphone: ${msg}` : `打不开麦克风：${msg}`),
	micFailHint: (): string =>
		lang === "en"
			? "Microphone blocked. On iPhone check Settings → Obsidian → Microphone; otherwise use the keyboard's dictation."
			: "打不开麦克风。到 iPhone「设置 → Obsidian → 麦克风」确认已允许；不行就点键盘上的麦克风用系统听写。",
	kbHint: (): string =>
		lang === "en" ? "You can also use the keyboard's own dictation key. Ctrl/Cmd + Enter to generate." : "也可以点键盘上的麦克风用系统听写。快捷键 Ctrl / Cmd + Enter",
	contentLen: (n: number): string => (lang === "en" ? `Content to write (${n} chars)` : `要写入的内容（${n} 字）`),
	pendingOps: (n: number): string => (lang === "en" ? `Pending actions (${n})` : `待确认的操作（${n}）`),
	// —— 网络与接口 ——
	netFail: (msg: string): string =>
		lang === "en" ? `Network request failed: ${msg}. Check the connection or the Base URL.` : `网络请求失败：${msg}。检查网络，或确认「接口地址」是否正确。`,
	notJson: (): string =>
		lang === "en" ? "DeepSeek did not return JSON — the Base URL may point at another service." : "DeepSeek 返回的不是 JSON，可能接口地址指到了别的服务。",
	emptyReply: (): string => (lang === "en" ? "DeepSeek returned an empty answer. Try wording it differently." : "DeepSeek 返回内容为空。换个说法再试一次。"),
	asrFail: (msg: string): string => (lang === "en" ? `Audio upload failed: ${msg}` : `语音上传失败：${msg}`),
	asrEmpty: (): string =>
		lang === "en" ? "Nothing was recognised — too short, or too noisy. Try again." : "没有识别出内容，可能太短或环境太吵。再说一次试试。",

	// —— 路径与工具 ——
	emptyPath: (): string => (lang === "en" ? "The path is empty." : "路径是空的。"),
	notRelative: (raw: string): string =>
		lang === "en" ? `Only paths relative to the vault are allowed, not “${raw}”.` : `只能用库内相对路径，不能是「${raw}」。`,
	dotdot: (raw: string): string =>
		lang === "en" ? `“..” is not allowed — it would leave the vault: ${raw}` : `路径里不能有「..」，拒绝越出库目录：${raw}`,
	configDir: (bad: string, raw: string): string =>
		lang === "en" ? `The config folder “${bad}” is off limits: ${raw}` : `不允许操作配置目录「${bad}」：${raw}`,
	hidden: (raw: string): string =>
		lang === "en" ? `Hidden files and folders are off limits: ${raw}` : `不允许操作隐藏文件或目录：${raw}`,
	noFolder: (raw: string): string => (lang === "en" ? `Folder not found: ${raw}` : `找不到文件夹：${raw}`),
	notFolder: (raw: string): string => (lang === "en" ? `“${raw}” is a file, not a folder.` : `「${raw}」是一个文件，不是文件夹。`),
	noNote: (path: string): string => (lang === "en" ? `No such note: ${path}` : `没有这篇笔记：${path}`),
	emptyQuery: (): string => (lang === "en" ? "The search query is empty." : "搜索词是空的。"),
	gone: (path: string): string => (lang === "en" ? `“${path}” is not there any more.` : `找不到「${path}」，可能已经被删了。`),
	notNoteOrFolder: (path: string): string =>
		lang === "en" ? `“${path}” is neither a note nor a folder.` : `「${path}」不是笔记或文件夹。`,
	opCreate: (): string => (lang === "en" ? "Create" : "新建"),
	opAppend: (): string => (lang === "en" ? "Append to" : "追加"),
	opOverwrite: (): string => (lang === "en" ? "Overwrite" : "覆盖"),
	opWrite: (label: string, path: string, n: number): string =>
		lang === "en" ? `${label} “${path}” (${n} characters)` : `${label}「${path}」（${n} 字）`,
	opFolder: (path: string): string => (lang === "en" ? `Create folder “${path}”` : `新建文件夹「${path}」`),
	opMove: (from: string, to: string): string => (lang === "en" ? `Move “${from}” → “${to}”` : `移动「${from}」→「${to}」`),
	opTrash: (path: string): string => (lang === "en" ? `Move “${path}” to the trash` : `移入回收站「${path}」`),

	// —— 录音 ——
	noMic: (): string => (lang === "en" ? "No microphone API here — use the keyboard's dictation instead." : "当前环境没有麦克风接口，请改用键盘上的语音输入。"),
	noWebAudio: (): string => (lang === "en" ? "Web Audio is unavailable, so recording cannot start. Use the keyboard's dictation." : "这个环境不支持 Web Audio，无法录音。请改用键盘上的语音输入。"),
	silent: (): string => (lang === "en" ? "Nothing was recorded — check the microphone permission." : "没有录到声音，检查一下麦克风权限。"),
	tooShort: (): string => (lang === "en" ? "That was too short — finish the sentence before stopping." : "录音太短了，说完整一句话再停。"),

	// —— 联网 ——
	queryTooLong: (n: number): string => (lang === "en" ? `Keep the query under ${n} characters.` : `搜索词最多 ${n} 个字符，请缩短一点。`),
	badUrl: (u: string): string => (lang === "en" ? `Not a valid web address: ${u}` : `不是有效的网页地址：${u}`),
	noPageBody: (): string =>
		lang === "en"
			? "No readable text on that page — it may need a login, be image-only, or block scrapers."
			: "这个网页抓不到正文，可能是需要登录、纯图片，或者被站点拦了。",

	// —— 图片 ——
	imageFail: (msg: string): string =>
		lang === "en" ? `Could not read that image: ${msg}` : `这张图读不出来：${msg}`,
	imageTooBig: (): string =>
		lang === "en" ? "That image is too large even after shrinking — try a smaller one." : "这张图压过之后还是太大，换一张小一点的。",
	imageLimit: (n: number): string =>
		lang === "en" ? `Up to ${n} images per message.` : `一条消息最多带 ${n} 张图。`,
	visionSwap: (): string =>
		lang === "en"
			? "Images need deepseek-flash, so this request uses it instead of your selected model."
			: "识图要用 deepseek-flash，这次请求临时改用它的（你选的模型不支持看图）。",
	photos: (n: number): string => (lang === "en" ? `${n} image${n === 1 ? "" : "s"}` : `${n} 张图`),
	shotSaved: (path: string): string => (lang === "en" ? `Saved to “${path}”` : `已存进笔记：${path}`),
	shotNoNote: (): string =>
		lang === "en"
			? "No note is open, so the photo was only sent to the model — nothing was saved."
			: "当前没有打开的笔记，这张图只发给了模型，没有存进库里。",
	cropSaved: (path: string): string => (lang === "en" ? `Saved: ${path}` : `已存：${path}`),

	// —— 长任务 ——
	stepsUsed: (n: number, max: number): string => (lang === "en" ? `Steps · ${n} / ${max}` : `执行过程 · ${n} / ${max}`),
	budgetUsed: (n: number): string =>
		lang === "en"
			? `${n} steps used — the step budget is spent. Press Keep going to carry on.`
			: `已用 ${n} 步，步数用完了。想接着做就点「继续跑」。`,
	timeUsed: (): string =>
		lang === "en"
			? "Hit the 8-minute limit for one run. Press Keep going to carry on."
			: "单次跑到 8 分钟上限了，点「继续跑」接着做。",

	// —— 用量与缓存 ——
	statsSummary: (req: number, rate: number, cost: string, saved: string): string => {
		if (lang === "en") {
			return `${req} request${req === 1 ? "" : "s"} · cache hit ${rate}% of input · ≈$${cost} spent · $${saved} saved`;
		}
		return `共 ${req} 次请求 · 输入命中缓存 ${rate}% · 花费约 $${cost} · 省下 $${saved}`;
	},
	usageLine: (hit: number, miss: number, out: number, cost: string, saved: string): string => {
		const total = hit + miss;
		const rate = total > 0 ? Math.round((hit / total) * 100) : 0;
		const k = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);
		return lang === "en"
			? `Cache ${rate}% · ${k(hit)} reused + ${k(miss)} new · ${k(out)} out · ≈$${cost} · saved $${saved}`
			: `缓存 ${rate}% · 复用 ${k(hit)} + 新增 ${k(miss)} tok · 输出 ${k(out)} · 约 $${cost} · 省 $${saved}`;
	},
	restored: (n: number): string =>
		lang === "en"
			? `${n} action${n === 1 ? "" : "s"} from last time never got applied. Apply them, or discard.`
			: `上次还有 ${n} 个写操作没执行。可以现在执行，或者丢弃。`,

	// —— 落盘结果 ——
	writeDone: (n: number): string => (lang === "en" ? `Wrote ${n} characters` : `已写入 ${n} 字`),
	rewriteDone: (n: number, name: string): string =>
		lang === "en" ? `Rewrote the body of “${name}” (${n} characters)` : `已改写「${name}」正文（${n} 字）`,
	appendDone: (name: string): string => (lang === "en" ? `Appended to “${name}”` : `已追加到「${name}」`),
	createdNote: (name: string): string => (lang === "en" ? `Created “${name}”` : `已新建「${name}」`),
	selDone: (n: number): string => (lang === "en" ? `Replaced the selection (${n} characters)` : `已替换选中段落（${n} 字）`),
	fallbackNote: (): string => (lang === "en" ? "the current note" : "当前笔记"),
	untitled: (): string => (lang === "en" ? "Untitled" : "未命名"),

	// —— 文件与路径错误 ——
	isFile: (path: string): string =>
		lang === "en" ? `“${path}” is a file, so it cannot be used as a folder.` : `「${path}」是一个文件，不能当作文件夹使用。`,
	tooManySame: (): string =>
		lang === "en" ? "Too many notes share that name — pick a different title." : "同名的笔记太多了，换一个标题再试。",
	noEditor: (): string =>
		lang === "en"
			? "That note is no longer open for editing, so the selection cannot be replaced precisely. Reopen it, select again, retry."
			: "原笔记已经不在编辑状态，无法精确替换选中段落。请重新打开笔记、重新选中后再试。",
	noSelectionRange: (): string =>
		lang === "en" ? "The selection range was lost — select the text again and retry." : "没有拿到选中范围，请重新选中文字再试。",
	selectionChanged: (): string =>
		lang === "en"
			? "The selected text changed while waiting; select it again so nothing wrong gets overwritten."
			: "选中的文字在等待期间被改动了，为避免覆盖错误内容，请重新选中再试。",
	fileTooBig: (): string =>
		lang === "en"
			? "This note is larger than 800 KB. The plugin refuses to rewrite it wholesale — append instead, or split the note first."
			: "这篇笔记太大（超过 800 KB），为避免误覆盖，插件拒绝整篇改写。请用「追加」或先拆分笔记。",
	appliedOps: (n: number): string => (lang === "en" ? `${n} action${n === 1 ? "" : "s"} applied` : `已执行 ${n} 个操作`),
	doneNotice: (first: string): string => (lang === "en" ? `Done: ${first}` : `完成：${first}`),
	appended: (n: number, name: string): string =>
		lang === "en" ? `Appended ${n} characters to “${name}”` : `追加 ${n} 字到「${name}」末尾`,
	rewritten: (n: number, name: string): string =>
		lang === "en" ? `Replaced “${name}” with ${n} characters` : `用 ${n} 字替换「${name}」整篇正文`,
	replacedSel: (n: number, m: number): string =>
		lang === "en" ? `Replaced the selection (${m} → ${n} characters)` : `用 ${n} 字替换选中的 ${m} 字`,
	created: (title: string, n: number): string =>
		lang === "en" ? `Created “${title}” (${n} characters)` : `新建笔记「${title}」（${n} 字）`,
};

