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

**Photos**

Tap *Camera* (or *Photos*) in either dialog and the system picker opens — on iOS and Android that is the real camera. The shot is resized to 1400 px and sent to the model, so "photograph this page / this prescription / this whiteboard and turn it into a note" works in one step. Vision is only available on `deepseek-flash`; if you picked `deepseek-v4-pro`, that single request switches to Flash automatically and tells you so.

## Status: what works, what doesn't (0.6.0)

Written down honestly, because a marketplace listing that over-promises is worse than a short one.

**Works today, on iPhone and Android as well as desktop**

- Voice → note, all four modes, with a preview before anything is written.
- DeepSeek speech-to-text inside the dialog (120 s per clip), or the system keyboard's dictation.
- One-tap entry from the phone: a floating button that follows you across the app, Back Tap, lock-screen widget, action button, or a Shortcuts automation.
- English and Chinese interface, following the app language (and overridable per plugin).
- Agent mode: search the vault, read notes, list folders, web search, read a link, then create / append / overwrite notes, create folders, move and rename — with a confirmation queue in front of every write.
- Photos: camera or photo library, up to 4 per message, downscaled before upload.
- Nine tools, 8 steps by default (cap 24), 24 queued writes per run, 200k characters per write.
- When the step budget or the 8-minute wall clock runs out, **Keep going** resumes the same conversation instead of starting over.
- The confirmation queue is written to disk, so a phone that kills the app does not throw away ten prepared edits.
- Cache-aware prompts: the system prompt and tool schema stay byte-identical between runs, the document you are editing sits in its own stable message, and repeated reads in one run are answered from what the model already has. Each answer reports the hit rate and what it cost.
- Settings show a running tally: requests, cache hit rate of all input, money spent, money saved.
- Frontmatter preserved on rewrite; notes over 800 KB refused instead of truncated.
- Rebuilt against the official `eslint-plugin-obsidianmd` ruleset: 0 errors.

**Not built yet**

- **No background work.** Nothing runs while Obsidian is closed. iOS will not wake the app on a schedule, so "every morning at 8" has to be an iOS Shortcuts automation that opens the URI.
- **No email inbox.** Gmail needs OAuth and raw sockets; the Obsidian WebView gives neither. The workaround is forwarding mail into a note or an RSS-to-note service, then running *read links in this note*.
- **No streaming.** The answer arrives in one piece.
- **No chat history / memory.** Each instruction starts clean; the dialog stays open so you can issue the next one, but nothing is remembered between runs.
- **No semantic search.** Keyword search over filenames and body text — no embeddings.
- **No custom prompt per tool.** One system prompt, one extra-requirements box.

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
- Both interfaces exist (English and Chinese), but the English wording is a translation of Chinese-first copy — some sentences still read that way.
- No embeddings, no semantic search, no chat sidebar with memory. It is an action tool, not a second brain.

## What it actually costs

Real DeepSeek list prices (November 2026, **off-peak**; peak hours are 2×):

| Item | Price |
| --- | --- |
| Input, cache **hit** | $0.003 / 1M tokens |
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

### Cache hits are where the cheap comes from

DeepSeek bills a cached input token at **$0.003 / 1M** instead of $0.15 — fifty times cheaper — but only when a request *fully* matches a cached prefix unit. That has a direct consequence for how a client should be built, and this plugin follows it:

- The system prompt and the tool schema never contain the current note name, the time, or a random id. Variable context (which note is open, how many actions are queued) rides in the user message instead, so everything before it stays byte-identical and can be reused across notes and across days.
- Agent history is append-only, and *Keep going* reuses the exact same message list, so a 20-step task pays full price for its first turn and cache price for the other nineteen.
- Tool schemas are emitted in a fixed order, because they sit in the prefix too.
- The document you are editing gets its own user message, with your instruction in the one after it. Rewriting the same note three times (append, then tighten, then add a line) hits cache on the document from the second time on, because only the trailing instruction block changed.
- In agent mode, reading the same note twice in one run returns a pointer to the earlier result instead of the text again, and tool output is capped at 9k characters with the tail kept — a tool result is re-sent on every later step, so its length multiplies by the step count.
- Every answer shows `Cache 91% · 8.2k reused + 780 new · ≈$0.0011 · saved $0.0011`, so you can see the effect rather than trust it. Settings keeps a running total, including a reset button.

What to expect, measured rather than promised:

| Situation | Input on cache |
| --- | --- |
| First call after the cache expired (hours of idle, or right after changing the model / the web-search toggle — both alter the prefix) | 0% |
| Single short question, prefix still warm | 90–96% |
| Agent task of 4–6 steps | 85–93% of all input tokens |
| Rewriting a note for the first time (the document is new text no cache can contain) | 10–25%, i.e. just the system prompt |
| Rewriting the same note a second time | 85–95% |

The ceiling is structural: the prefix is the system prompt plus the tool schema (~2.4k tokens); everything after it is content the model has not seen. So a hit rate near 100% is not a thing, and any plugin claiming it is measuring something else. The dialog shows the real number per call and settings keeps the running total.

The first request after a cache eviction is always a miss; DeepSeek keeps caches for hours to days, best-effort.

Caveats, because they matter: those numbers assume Flash and off-peak. Long documents, `deepseek-v4-pro`, or letting the agent read ten pages per request will multiply them. There is no free tier — you top up DeepSeek and pay per use, which is exactly why there is no subscription here.

## Interface

The dialogs are built from your theme's own variables — no gradients, no glow, no floating cards with hand-picked purple accents, so it looks like Obsidian rather than a chat app bolted on. One accent colour, one hairline, one grey surface; hierarchy comes from spacing and type size. Dark and light both follow whatever theme you run, including community themes.

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

**Floating button** — a round button floats over the app on phones and tablets. Tap it for an AI instruction, long-press for a voice note, drag it out of the way. Toggle it under *Floating button on mobile* in settings.

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
npm run lint     # official eslint-plugin-obsidianmd ruleset
npm test         # 3 offline suites: voice flow, API layer, agent tools/paths
npm run package  # dist/deepseek-vault-agent/
```

Tests load the real bundle against stubbed Obsidian modules, so they run with no network and no vault.

## License

MIT.
