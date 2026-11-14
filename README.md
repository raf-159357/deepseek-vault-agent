# DeepSeek Voice Notes

Speak one sentence. DeepSeek writes it into your Obsidian vault — append, rewrite, or create a note.

一个 Obsidian 插件：说一句话，交给 DeepSeek 追加、改写或新建笔记。支持 iPhone 轻点背面唤起。

---

## What it does

- **Four targets** — append to the current note, rewrite the whole note, rewrite a selection, or create a new note.
- **Speak inside the plugin** — records audio (16 kHz PCM16 WAV) on the device, sends it to DeepSeek's speech-to-text endpoint, then to the chat endpoint.
- **Preview before writing** — you always see a summary and the full result first; nothing touches your vault until you press **Write**.
- **Frontmatter-safe** — full-note rewrites preserve the YAML frontmatter block. Notes over 800 KB are refused rather than silently truncated.
- **URI entry point** — `obsidian://deepvoice?...` so iOS Shortcuts and Back Tap can trigger it without opening the command palette.

## Requirements

- Obsidian 1.5.0 or newer
- A DeepSeek API key (BYOK — this plugin ships without one)
- Internet access from the device running Obsidian

## Install

### Option A — BRAT (recommended, works on iPhone/iPad)

1. Install **BRAT** from Community plugins.
2. Open BRAT → **Add Beta plugin**.
3. Enter `raf-159357/obsidian-deepseek-voice`.
4. Enable **DeepSeek Voice Notes** in Community plugins.

### Option B — manual (desktop)

Copy `manifest.json`, `main.js`, and `styles.css` into:

```
<vault>/.obsidian/plugins/deepseek-voice-notes/
```

Then reload Obsidian and enable the plugin.

> On iOS the `.obsidian` folder is hidden by the Files app, so Option A is the practical route there.

## Setup

Settings → Community plugins → DeepSeek Voice Notes → gear icon:

| Setting | Default | Notes |
| --- | --- | --- |
| API Key | empty | Stored locally in `data.json`. Never sent anywhere except `api.deepseek.com`. |
| Model | `deepseek-flash` | `deepseek-v4-pro` is available too. |
| Thinking mode | off | When off, requests use `{"thinking":{"type":"disabled"}}` — faster and cheaper for editing tasks. |
| Speech-to-text | on | Turns recorded audio into text via `/v1/tools/asr`. |
| Max characters | 4000 | Caps generated output length. |
| Extra instructions | empty | Appended to every prompt. |
| Confirm before writing | on | Shows the preview modal. |

Press **Test connection** to verify the key before you start.

## Commands

| Command | What it does |
| --- | --- |
| Voice input: append to current note | Adds the result to the end of the note |
| Voice input: rewrite current note | Replaces the body, keeps frontmatter |
| Voice input: rewrite selection | Replaces only the selected text |
| Voice input: new note | Creates a note from the spoken title and content |

## iOS: trigger it with Back Tap

1. Settings → Accessibility → Touch → Back Tap → Double Tap
2. New Shortcut → action **Open URL**
3. URL:

```
obsidian://deepvoice?vault=YOUR_VAULT&mode=append
```

Optional parameters: `text=` (pre-filled text), `auto=1` (submit immediately), `mode=` one of `append|rewrite|selection|create-note`.

To capture speech in the shortcut itself, add **Dictate Text** → **URL Encode** → append as `&text=...&auto=1`.

## Privacy

- No telemetry, no analytics, no remote logging.
- The API key is stored in the vault's `.obsidian/plugins/deepseek-voice-notes/data.json`.
- Audio and text go only to `api.deepseek.com`. If speech-to-text is disabled, no audio leaves the device.

## Known limits

- Audio must be ≤ 120 seconds and ≤ 8 MiB per request (DeepSeek ASR limit).
- iOS does not expose hardware volume buttons to third-party apps, so "hold both volume keys" is not achievable; Back Tap or the Action Button is the supported trigger.
- Rewriting a note keeps frontmatter but replaces everything else — back up long notes first.

## Development

```bash
npm install
npm run dev      # watch build
npm run build    # typecheck + production bundle
npm test         # offline tests against the real bundle
npm run package  # produce dist/deepseek-voice-notes/
```

Source lives in `src/`. `main.js` is the only runtime artifact; there are no runtime dependencies.

## License

MIT — see [LICENSE](LICENSE).

## 中文说明

说一句话，插件把它写进你的 Obsidian 笔记。四种落点：追加到当前笔记、改写全文（保留 frontmatter）、改写选中段落、新建笔记。

安装：手机端推荐用 BRAT，添加本仓库地址即可；桌面端可把 `manifest.json` / `main.js` / `styles.css` 放进 `<库>/.obsidian/plugins/deepseek-voice-notes/`。

首次使用：设置里填自己的 DeepSeek API Key → 点「测试连接」→ 命令面板搜「语音输入」。

插件本身不含任何 API Key，所有调用都走你自己的账户。
