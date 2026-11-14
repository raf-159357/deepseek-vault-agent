# DeepSeek Voice Notes

**Speak one sentence. It lands in your vault as a proper note.**

An Obsidian plugin that turns spoken words into written notes through your own DeepSeek API key — appending, rewriting, or creating notes without leaving the keyboard.

[中文说明](README.zh-CN.md) · [Report an issue](https://github.com/raf-159357/obsidian-deepseek-voice/issues)

---

## Why this exists

Obsidian is excellent at storing thoughts and terrible at capturing them in a hurry. When you are walking, cooking, or lying in bed, you are not going to open a note, find the right place, and type.

This plugin closes that gap with one loop:

> speak → DeepSeek transcribes and rewrites → you approve → the note is updated

Nothing is written until you press **Write**. Every step is visible.

## What it actually does

You say something like:

> “Note down today's group meeting. Professor Wang wants three more experiments, draft due next Wednesday, and I should check the 2023 cohort data first.”

Pick a target, press generate, and you get a structured block — not a raw transcript:

```markdown
### 2026-11-14 组会

- 王老师要求补充三组实验
- 下周三之前交初稿
- 优先核对 2023 级队列数据
```

Four targets, each useful in a different situation:

| Mode | What happens | When to use it |
| --- | --- | --- |
| **Append** | Adds the result to the end of the current note | Daily log, meeting notes, running list |
| **Rewrite note** | Replaces the body, keeps frontmatter | Cleaning up a messy draft |
| **Rewrite selection** | Replaces only the selected text | Fixing one paragraph |
| **New note** | Creates a file with a generated title | Idea capture, quick memos |

## Install

### BRAT (recommended — the only practical route on iPhone/iPad)

1. Install **BRAT** from Community plugins
2. Open BRAT → **Add Beta plugin**
3. Enter `raf-159357/obsidian-deepseek-voice`
4. Enable **DeepSeek Voice Notes** in Community plugins

### Manual (desktop)

Download `manifest.json`, `main.js`, and `styles.css` from the [latest release](https://github.com/raf-159357/obsidian-deepseek-voice/releases/latest) and place them in:

```
<vault>/.obsidian/plugins/deepseek-voice-notes/
```

Reload Obsidian, then enable the plugin.

> On iOS the `.obsidian` folder is hidden by the Files app, so manual installation is not possible there. Use BRAT.

## Setup

You need a DeepSeek API key — **the plugin ships with none, and never will**.

1. Sign up at [platform.deepseek.com](https://platform.deepseek.com)
2. Create an API key under **API keys**
3. Top up a small balance (voice notes cost very little at the `deepseek-flash` tier)
4. In Obsidian: Settings → Community plugins → DeepSeek Voice Notes → gear icon → paste the key → **Test connection**

## Using it

### Desktop

`Ctrl/Cmd + P` → type **voice** → pick one of the four commands.

### iPhone / iPad

iOS does not expose hardware volume buttons to third-party apps, so “hold both volume keys” is not possible. Use one of these instead:

**Back Tap** — Settings → Accessibility → Touch → Back Tap → Double Tap → pick a shortcut containing a single **Open URL** action:

```
obsidian://deepvoice?mode=append
```

**Home / Lock Screen widget** — add a Shortcuts widget pointing at the same shortcut. One tap opens the voice panel.

**Obsidian mobile toolbar** — Settings → Mobile → toolbar options → add the command **Voice input: append to current note**.

### Inside the panel

1. Choose the target mode at the top
2. Press **● Start speaking** — the button turns into **■ Stop and transcribe (12s)**
3. Speak, then tap it again
4. Text appears in the box after a moment — **read it, fix homophone errors**
5. Press **Generate**
6. Review the preview, press **Write to note**

Speech recognition will happily turn “笔记” into “比记”. Step 4 is the one that matters.

## URI parameters

Useful for Shortcuts, Alfred, or scripting:

```
obsidian://deepvoice?vault=VAULT&mode=MODE&text=TEXT&auto=1
```

| Parameter | Values | Meaning |
| --- | --- | --- |
| `vault` | vault name | Which vault to open (optional if already inside one) |
| `mode` | `append` \| `rewrite` \| `selection` \| `create-note` | Target |
| `text` | URL-encoded string | Pre-fills the input box |
| `auto` | `1` | Submit immediately instead of waiting for a click |

Note: `text` requires URL encoding. With `auto=1` and text present, the plugin starts generating on open — so a Shortcut can do *dictate → encode → open URL* and skip the panel entirely.

## Settings

| Setting | Default | Notes |
| --- | --- | --- |
| API key | empty | Stored in the vault's `data.json`, sent only to your configured endpoint |
| Base URL | `https://api.deepseek.com` | Change for a proxy or compatible gateway; `/v1` optional |
| Model | `deepseek-flash` | Or `deepseek-v4-pro` for harder rewriting |
| Thinking mode | off | Off is faster and cheaper for editing; on helps long-form restructuring |
| Speech to text | on | Uses `/v1/tools/asr`; turn off to dictate with the system keyboard instead |
| Max characters | 4000 | Caps generated output |
| Context limit | 6000 | Long notes are sent as head 60% + tail 40% |
| Extra instructions | empty | Appended to every prompt — e.g. “write in Chinese, use bullet points only” |
| Confirm before writing | on | Shows the preview. Turn off for fully hands-free writing |

## Privacy

- No telemetry, no analytics, no crash reporting, no remote logging.
- The key lives in `.obsidian/plugins/deepseek-voice-notes/data.json` inside your vault.
- Audio goes to the speech endpoint only when you record inside the plugin and speech-to-text is enabled.
- Text goes to the chat endpoint only when you press **Generate**.
- Nothing is written to your vault until you press **Write to note**.
- The only network destination is the base URL you configure.

## Limits

- Audio per request: ≤ 120 seconds, ≤ 8 MiB (DeepSeek ASR limit)
- Notes larger than 800 KB are refused for full rewrites rather than truncated silently
- Rewriting a note keeps frontmatter but replaces everything else — version control or file recovery is your friend
- iOS cannot be triggered by hardware volume keys; Back Tap / widget / toolbar are the supported entries

## Development

```bash
npm install
npm run dev       # watch build
npm run build     # typecheck + production bundle
npm test          # offline tests against the real bundle
npm run package   # produce dist/deepseek-voice-notes/
```

Source is in `src/`. `main.js` is the only runtime artifact and has no runtime dependencies. Tests load the real built bundle against a stubbed Obsidian module, so they exercise the shipped code rather than a copy of it.

## License

MIT — see [LICENSE](LICENSE).
