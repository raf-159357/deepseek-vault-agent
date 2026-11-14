# DeepSeek Vault Agent

**Say one sentence — it searches the web, reads the links, and writes the note.** A voice-first AI agent for Obsidian that runs on your own DeepSeek API key, on desktop **and on iPhone**.

[中文说明](README.zh-CN.md) · [Report an issue](https://github.com/raf-159357/deepseek-vault-agent/issues) · MIT

---

## Why this exists

Every AI note tool asks you to move your notes somewhere: into Notion's cloud, into a chat window where you paste text back and forth, or onto a desktop-only setup that needs a local CLI, a Node process, or an MCP bridge running in the background.

This plugin takes the opposite route. Your vault stays a folder of Markdown files. The plugin talks straight to DeepSeek from inside Obsidian, which means it works in the iOS app with no server, no bridge and no companion app. You hold the volume of work down to one gesture: **two taps on the back of the phone, speak, done.**

It is also honest about the model it uses: DeepSeek Flash is not GPT-5 or Claude Opus. It is fast, it follows instructions well enough for note work, and it costs roughly **one tenth** of a $20/month subscription for a heavy personal workload. That trade is the whole point.

## What it does

**Voice → note, four ways**

| Mode | What happens |
| --- | --- |
| Append | Your speech is cleaned up and appended to the current note |
| Rewrite note | The note is reorganised; frontmatter is preserved, body replaced |
| Rewrite selection | Only the highlighted paragraph is touched |
| New note | A title, a folder (if needed) and a file are created for you |

**Instructions → actions, with web access**

Type or dictate an instruction in plain language:

- *"Search the latest on GLP-1 and atrial fibrillation, then write a 5-point summary into 文献/综述.md"*
- *"Read the three links in this note and turn them into a comparison table"*
- *"Create a folder 课题/开题 and draft an outline there"*

The agent has nine tools: search notes, list folders, read a note, web search, read a URL, write a note, create a folder, move/rename, and (off by default) move to trash.

## How it compares

Prices as listed by each vendor in November 2026, for one person. This table is about *fit*, not about which model is smartest.

| | Where your notes live | Can it change your vault? | Works on iPhone? | What you pay |
| --- | --- | --- | --- | --- |
| **Obsidian alone** | Your disk / your sync | — | Yes | $0 |
| **ChatGPT / Gemini / Claude in a browser** | Their cloud, your clipboard | No — you copy and paste | Yes, as a browser tab | $20, $19.99, $20 / month |
| **Notion AI** | Notion's cloud | Yes, inside Notion only | Yes | $20 / member / month (Business; AI included) |
| **Copilot for Obsidian** | Your vault | Yes, with BYO key on the free tier | Manifest allows it; the agent features lean on local CLIs | Free BYOK, Plus $14.99/mo |
| **Vault Operator / DSH-type agent plugins** | Your vault | Yes | Desktop only (`isDesktopOnly: true`) | Free, plus your own model key |
| **DeepSeek Vault Agent** | Your vault, plain Markdown | Yes, with a confirmation queue | Yes, voice-first | **DeepSeek usage only, ≈ $2/month heavy use** |

### What is genuinely different

Let's not pretend this is the first agent plugin. The community list already has 260+ plugins mentioning agents, and several of them write to your vault properly. Three things are still rare in combination:

1. **iPhone is a first-class target.** Most vault-agent plugins are desktop-only because they wrap Claude Code, Codex or a local DSH process. This one is pure HTTP from inside Obsidian, so the phone is not an afterthought.
2. **One API key, both jobs.** The same DeepSeek key does speech-to-text, reasoning, web search and page fetching. No second provider, no search subscription.
3. **Nothing is written until you say so.** Read tools run immediately; every write goes into a queue you approve. That is deliberately more conservative than "let the agent edit freely".

### Where it is weaker

- The model is cheaper, and it shows on long, subtle rewrites. Switch to `deepseek-v4-pro` in settings for those.
- The interface is Chinese-first today. English UI strings are on the roadmap.
- No embeddings, no semantic search, no chat sidebar with memory. It is an action tool, not a second brain.

## What it actually costs

Real DeepSeek list prices (November 2026, **off-peak**; peak hours are 2×):

| Item | Price |
| --- | --- |
| Input, cache miss | $0.15 / 1M tokens |
| Output | $0.60 / 1M tokens |
| Web search | $0.75 / 1,000 searches |
| Web fetch | $0.75 / 1,000 fetches |
| Speech to text | $0.116 / hour of audio |

Worked examples, assuming a ~3,000-token note context and a ~700-token answer:

| Task | Cost |
| --- | --- |
| One 20-second voice note (transcribe + rewrite) | ≈ $0.0015 (¥0.01) |
| 1,000 voice notes | ≈ $1.50 (¥11) |
| One research run (1 search + 2 page reads + 3 model turns) | ≈ $0.007 (¥0.05) |
| Heavy month: 20 notes/day + 5 research runs/day | ≈ $2 (¥15) |
| A year of that | ≈ $24 (¥170) |

For comparison, that year is about **one month** of ChatGPT Plus, Google AI Pro, or Notion Business, and about **one sixth** of Copilot Plus annual.

Caveats, because they matter: those numbers assume Flash and off-peak. Long documents, `deepseek-v4-pro`, or letting the agent read ten pages per request will multiply them. There is no free tier — you top up DeepSeek and pay per use, which is exactly why there is no subscription here.

## Install

### BRAT (recommended, and the only practical route on iPhone)

1. Install **BRAT** from Community plugins.
2. BRAT → **Add Beta plugin** → `raf-159357/deepseek-vault-agent`.
3. Enable **DeepSeek Vault Agent** in Community plugins.

### Manual

Download `manifest.json`, `main.js`, `styles.css` from the [latest release](https://github.com/raf-159357/deepseek-vault-agent/releases/latest) and place them in:

```
<vault>/.obsidian/plugins/deepseek-vault-agent/
```

Then reload Obsidian and enable the plugin. On iOS the `.obsidian` folder is hidden from the Files app, so use BRAT there.

## Setup

1. Get a key at [platform.deepseek.com](https://platform.deepseek.com) → API keys, and add a small balance.
2. Obsidian → Settings → Community plugins → **DeepSeek Vault Agent** → gear icon → paste the key → **Test connection**.

Defaults are already correct: `https://api.deepseek.com`, model `deepseek-flash`, thinking off (faster and cheaper). If you use a proxy or a reseller, change the base URL — a trailing `/v1` is handled either way.

## Using it on the phone

The iOS volume buttons are not available to third-party apps, so pick one of these:

**Back Tap** — Settings → Accessibility → Touch → Back Tap → Double Tap → your shortcut. The shortcut needs exactly one action, **Open URL**:

```
obsidian://vaultagent?mode=append
```

(The old `obsidian://deepvoice?...` link still works and will keep working — shortcuts you already built are safe.)

**Home screen or lock screen widget** — add a Shortcuts widget that runs the same shortcut.

**Mobile toolbar** — Settings → Mobile → manage toolbar options → add **Voice input: append to current note**.

Inside the dialog: **Start speaking** → speak → tap again to stop → check the transcript (fix homophones) → **Generate** → **Write to note**.

To skip the dialog entirely, add `&text=...&auto=1`, or turn off *Confirm before writing*.

## Commands and URI

| Command | Purpose |
| --- | --- |
| Voice input: append to current note | Safest way to start |
| Voice input: rewrite current note | Reorganise the whole note, keep frontmatter |
| Voice input: create note | New file from speech |
| AI instruction: research / organise | Agent mode with web access |
| AI instruction: read links in this note | Batch-read every URL in the current note |

```
obsidian://vaultagent?vault=<name>&mode=append|rewrite|create-note&text=<urlencoded>&auto=1
obsidian://vaultagent?vault=<name>&action=agent&text=<urlencoded>&auto=1
```

## Settings

| Setting | Default | Notes |
| --- | --- | --- |
| API key | empty | Stored in `data.json` in your vault |
| Base URL / model | api.deepseek.com / deepseek-flash | `deepseek-v4-pro` for hard rewrites |
| Thinking mode | off | On = better reasoning, slower, pricier |
| Transcribe with DeepSeek | on | Off = type instead of record |
| Allow web search | on | Off = agent refuses to search |
| Results per search | 8 | 1–20 |
| Max agent steps | 6 | Hard cap 12, protects your balance |
| Note context limit | 6,000 chars | Sent with each instruction |
| Confirm before writing | on | Off = fully hands-free |
| Agent may trash notes | off | Trash only, never a hard delete |

## Safety model

- **Read tools run; write tools queue.** The agent proposes, you press *Run these actions*.
- Paths are validated: no `..`, no absolute paths, no `.obsidian`, no dotfolders.
- Limits: 12 queued writes, 200k characters per write, 6 steps per run (max 12).
- Deleting is disabled by default, goes to the trash, and asks twice.
- Rewriting a note keeps YAML frontmatter; notes over 800 KB are refused rather than truncated.

## Privacy and network

The plugin talks to exactly one host: whatever you put in **Base URL** (default `https://api.deepseek.com`).

- Audio leaves your device only when you record inside the plugin, and only to the speech endpoint.
- Note text leaves your device only when you press **Generate** or **Send**.
- Nothing is written to your vault until you approve.
- No telemetry, no analytics, no account, no licence check.
- Your key sits in `.obsidian/plugins/deepseek-vault-agent/data.json`. If that vault syncs, the key syncs too — don't put it in a public vault.

## Limits worth knowing

- **No background jobs.** Plugins only run while Obsidian is open; iOS will not wake it on a schedule. For "every morning at 8", use an iOS Shortcuts automation to open the URI.
- **No email access.** Gmail needs OAuth and raw sockets, neither of which the Obsidian WebView offers. Workaround: forward mail into a note (or an email→RSS service), then run *AI instruction: read links in this note*.
- **No streaming.** Responses arrive in one piece; long runs feel like a pause followed by a result.
- **Web tools need to be enabled on your DeepSeek account.** If they are not, the agent reports the error instead of silently guessing.

## Development

```bash
npm install
npm run dev      # watch
npm run build    # typecheck + bundle
npm test         # 3 offline suites: voice flow, API layer, agent tools/paths
npm run package  # dist/deepseek-vault-agent/
```

Tests load the real bundle against stubbed Obsidian modules, so they run with no network and no vault.

## License

MIT.
