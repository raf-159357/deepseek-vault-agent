# Marketplace submission sheet / 上架提交材料

Everything needed to submit version **0.6.0**

- Cache work that goes beyond "we put the static part first": the note being edited now lives in its own message so repeated edits of the same note hit cache from the second pass; duplicate reads inside one run are answered with a pointer instead of the text; tool output is capped at 9k characters keeping the tail, because it is re-sent on every later step.
- Settings show a running tally (requests, cache hit rate of all input, spent, saved) with a reset.
- Interface rework: the dialogs now use one accent colour, one hairline and one grey surface, all driven by the active theme's variables. No gradients, no glow, no coloured pills — it should read as part of Obsidian, not as a chat overlay.

**0.5.0**

- Photos: camera / photo library in both dialogs, up to 4 images, downscaled to 1400 px before upload. Vision runs on `deepseek-flash`; requests with an image switch to it automatically when another model is selected.
- Long tasks: 8 steps by default (cap 24, was 12), 24 queued writes, 8-minute wall clock, and a **Keep going** button that resumes the same conversation instead of restarting.
- The confirmation queue is persisted under the plugin folder, so an app kill on the phone no longer loses prepared edits.
- Cache-friendly prompt layout: the system prompt and tool schemas are byte-identical between runs (variable context moved into the user message), history is append-only, and each answer reports cache hit rate plus estimated cost.

**0.4.0**

- Bilingual interface (English / Chinese), following the app language, overridable in settings.
- Floating button on mobile: tap for an AI instruction, long-press for a voice note, draggable.
- Model replies follow the language of the instruction.

**0.3.2** at <https://community.obsidian.md>.
提交 0.3.2 时，门户上要填的内容都在这份文件里，中英对照。

---

## 1. Store description / 商店简介

This is the `description` field in `manifest.json` — it is what users see in the plugin browser.
门户里显示的简介就是 `manifest.json` 的 `description`，别在门户里另写一份。

**EN (143 chars, ends with a period, does not contain "obsidian")**

> Speak or type — DeepSeek plans, searches the web, reads links, and writes notes or folders in your vault. Bring your own key; runs on iPhone.

**中文对照（仅供人读，门户只收英文）**

> 说一句或打一句 —— DeepSeek 自己规划、联网查、读链接，然后在你的库里写笔记、建文件夹。自带 API Key，iPhone 上也能用。

Rules this satisfies: ≤ 250 characters, sentence case, ends with a period, the word "obsidian" is not used (required by the portal).

---

## 2. Portal fields / 门户要填的字段

| Field | Value |
| --- | --- |
| Repository | `raf-159357/deepseek-vault-agent` |
| Release / tag | `0.3.2` (no `v` prefix) |
| Release assets | `main.js`, `manifest.json`, `styles.css` only |
| Plugin ID | `deepseek-vault-agent` |
| Min app version | `1.7.2` |
| Desktop only | No — `isDesktopOnly: false` |
| Categories | 按门户给出的分类勾选（建议 AI、搜索、笔记；以门户实际列表为准） |
| License | MIT |
| Payment | **Optional payment** (the plugin is free; the user pays DeepSeek for their own API usage) |

---

## 3. Notes for the reviewer / 给审核员的话

**EN**

> **What it does.** A voice-first AI agent for a vault. The user records or types an instruction; the plugin calls DeepSeek's chat completions API with function-calling tools that read and write vault files, search the web, and fetch a URL. Read tools execute immediately; every write is queued and executed only after the user presses "Run these actions".
>
> **No bundled credentials.** The plugin ships with an empty API key. Until the user pastes their own key in settings, every action stops with a readable message and a button that opens the settings tab. To evaluate the code without a key, open Settings → DeepSeek Vault Agent: the tab renders fully, and "Test connection" reports `还没有填写 DeepSeek API Key` (no key yet) rather than failing silently.
>
> **Network.** One host only: the user's configured base URL, default `https://api.deepseek.com`. Endpoints used: `/chat/completions` (OpenAI-compatible, with tools), `/tools/search`, `/tools/fetch`, `/tools/asr` (audio transcription). No other requests, no telemetry, no analytics, no remote config.
>
> **File access.** Uses the public `Vault` / `FileManager` / `MetadataCache` APIs only. Paths are validated: no `..`, no absolute paths, no dot-folders (`.obsidian`, `.git`, `.trash`), no `node_modules`. Deleting is off by default; when on, it calls `FileManager.trashFile()` (the user's own trash preference), never a hard delete.
>
> **Language.** UI strings are English or Chinese depending on Obsidian's language setting (overridable per plugin). The model is instructed to answer in the language of the instruction.
>
> **Mobile.** `isDesktopOnly: false` and no Node/Electron APIs are used. Audio is captured with `getUserMedia` + `AudioContext` + `ScriptProcessorNode` and encoded to 16-bit PCM WAV in JS (MediaRecorder is not used, because iOS gives it mp4/aac, which the ASR endpoint rejects). Settings and dialogs are laid out for narrow screens.
>
> **Clipboard.** Write-only, and only after the user presses "Copy reply": `navigator.clipboard.writeText(reply)`. The plugin never reads the clipboard and never watches for clipboard changes.
>
> **Vault enumeration.** `getFiles()` / `getMarkdownFiles()` are used to list candidate notes for the model's `search` and `list` tools — the agent has to know what exists before it can work on it. No path is read until one of those tools asks for a specific file, and every read goes through the path validation above.
>
> **Review status.** `eslint` with `eslint-plugin-obsidianmd` reports 0 errors. Five warnings remain and are expected: four are `no-deprecated` on `ScriptProcessorNode` (the recording path, no AudioWorklet equivalent available across the Obsidian WebViews), one is `prefer-setting-definitions` (the declarative settings API from 1.13 is additive; the plugin supports 1.7.2 and keeps the classic tab for compatibility).

**中文**

> **它做什么。** 库里的语音优先 AI 助手。用户录音或打字给一句指令，插件带着函数调用工具去请求 DeepSeek 的 chat completions：工具能读笔记、写笔记、搜库、联网搜索、读网页。读类工具直接执行；所有写操作进队列，用户点「执行这些操作」才真正落盘。
>
> **不内置任何密钥。** 插件出厂 API Key 为空。用户没填之前，所有操作都会停下来给一句可读提示，并给一个直接跳到设置页的按钮。没有 key 也能审代码：打开 设置 → DeepSeek Vault Agent，整个设置页能正常渲染，「测试连接」会明确报 `还没有填写 DeepSeek API Key`，不会静默失败。
>
> **联网。** 只连一个主机：用户配置的 Base URL，默认 `https://api.deepseek.com`。用到的接口：`/chat/completions`（OpenAI 兼容，带 tools）、`/tools/search`、`/tools/fetch`、`/tools/asr`（语音转写）。没有其他请求，没有遥测、统计或远程配置。
>
> **文件访问。** 只用 `Vault` / `FileManager` / `MetadataCache` 公开 API。路径做校验：拒绝 `..`、绝对路径、点目录（`.obsidian`、`.git`、`.trash`）、`node_modules`。删除默认关闭；开启后走 `FileManager.trashFile()`（尊重用户自己的删除偏好），绝不硬删除。
>
> **语言。** 界面文案按 Obsidian 的语言设置走中英两套（插件里可单独指定）；模型被要求用用户指令的语言回答。
>
> **手机。** `isDesktopOnly: false`，不使用 Node/Electron 专有 API；录音是 `getUserMedia` + `AudioContext` + `ScriptProcessorNode`，在 JS 里自己编 16-bit PCM WAV（不用 MediaRecorder，因为 iOS 上它只给 mp4/aac，转写接口不收）；弹窗和设置页按窄屏排版。
>
> **剪贴板。** 只写不读，且只在用户点「复制回答」时写一次：`navigator.clipboard.writeText(reply)`。插件不读剪贴板，也不监听剪贴板变化。
>
> **枚举库文件。** `getFiles()` / `getMarkdownFiles()` 用来给模型的 `search`、`list` 工具列出候选笔记 —— 助手得先知道库里有什么才能干活。具体文件内容要等某个工具点名读取，每次读取都过上面那套路径校验。
>
> **审核状态。** 用 `eslint-plugin-obsidianmd` 跑 `eslint`：0 errors。剩余 5 条 warning 是预期内的：4 条是 `ScriptProcessorNode` 的 `no-deprecated`（录音链路，Obsidian 各平台 WebView 上还没有等价的 AudioWorklet 方案），1 条是 `prefer-setting-definitions`（1.13 才有的声明式设置 API，本插件要兼容 1.7.2，所以保留经典设置页）。

---

## 4. Changelog for this submission / 本次提交的变更

**0.6.0**

- Cache work that goes beyond "we put the static part first": the note being edited now lives in its own message so repeated edits of the same note hit cache from the second pass; duplicate reads inside one run are answered with a pointer instead of the text; tool output is capped at 9k characters keeping the tail, because it is re-sent on every later step.
- Settings show a running tally (requests, cache hit rate of all input, spent, saved) with a reset.
- Interface rework: the dialogs now use one accent colour, one hairline and one grey surface, all driven by the active theme's variables. No gradients, no glow, no coloured pills — it should read as part of Obsidian, not as a chat overlay.

**0.5.0**

- Photos: camera / photo library in both dialogs, up to 4 images, downscaled to 1400 px before upload. Vision runs on `deepseek-flash`; requests with an image switch to it automatically when another model is selected.
- Long tasks: 8 steps by default (cap 24, was 12), 24 queued writes, 8-minute wall clock, and a **Keep going** button that resumes the same conversation instead of restarting.
- The confirmation queue is persisted under the plugin folder, so an app kill on the phone no longer loses prepared edits.
- Cache-friendly prompt layout: the system prompt and tool schemas are byte-identical between runs (variable context moved into the user message), history is append-only, and each answer reports cache hit rate plus estimated cost.

**0.4.0**

- Bilingual interface (English / Chinese), following the app language, overridable in settings.
- Floating button on mobile: tap for an AI instruction, long-press for a voice note, draggable.
- Model replies follow the language of the instruction.

**0.3.2**

- Deletion now goes through `app.fileManager.trashFile()`, so it follows the user's own trash preference.
- `extractFrontmatter` annotated explicitly; no `any` left on that path.
- Agent dialog stays open after a write, so the next instruction can be issued without reopening.
- Model replies follow the language of the instruction instead of always answering in Chinese.

**0.3.1**

- Settings headings via `new Setting(el).setName(...).setHeading()`.
- `element.style.*` → `setCssProps`; timers via `window.*`.
- `src/json.ts`: every API response narrowed from `unknown`.
- `minAppVersion` raised to 1.7.2.

---

## 5. Not built yet — do not claim these / 还没做，别在说明里承诺

No background jobs, no email inbox, no streaming, no chat memory, no semantic search, per-tool prompts. The English UI exists but is a translation of Chinese-first copy. Vision requires `deepseek-flash`; a photo request silently switches to it. Details and workarounds are in the "Status" section of both READMEs.

---

## 6. Shipping 0.6.0 / 怎么把 0.6.0 发上去

The portal has no "cancel review" button, and you do not need one. A version is published by making a GitHub **Release**; the portal scans the newest release and the old result is replaced.

门户没有「取消审核」，也不需要取消。版本是靠 GitHub 的 **Release** 发布的：发了新 Release，门户会去扫最新的那个，旧结果自动被替换。

### 6.1 Release on GitHub / 在 GitHub 发版

Either run the script (needs a fine-grained token with Contents: read and write on this repo only):

```bash
node scripts/release.mjs <token>
```

Or do it by hand at <https://github.com/raf-159357/deepseek-vault-agent/releases/new>:

| Field | Value |
| --- | --- |
| Tag | `0.6.0` — no `v`, must equal `manifest.json` `version` |
| Target | `main` |
| Title | `0.6.0` |
| Assets | exactly these three, names unchanged: `main.js`, `manifest.json`, `styles.css` |

Anything else attached to the release (source zips are added automatically) is ignored, but do not attach a second `main.js`.

### 6.2 Then on the portal / 然后回门户

1. Open the plugin page → **Check for updates** (top right of Reviews). This re-runs the scan against the newest release; the header should switch from `0.3.1` to `0.6.0`.
2. Nothing else to submit. The listing text comes from `manifest.json`; the categories and payment choice were already set on the first submission.
3. Only **Error** blocks a release. **Recommendation** and **Warning** do not — the three entries currently shown (release attestation, vault enumeration, clipboard) are all Recommendations, and two of them are answered in section 3 above.
4. Do not press **Archive** in the `…` menu: that takes the plugin off the list and the whole submission has to start over.
