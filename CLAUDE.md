# AISentry — Project Context

Real-time browser dashboard that monitors every AI coding agent on the user's machine (Claude Code, Codex CLI, Gemini CLI, Aider, Cursor, GitHub Copilot). Data flows only from the local machine to the local browser — nothing through any external server.

**Deployed site:** https://aisentry.netlify.app  
**GitHub repo:** https://github.com/eternalsayed/ai-sentry  
**Local dev dir:** `/Users/sayed/Code/claude-monitor`

---

## Architecture

```
aisentry.netlify.app (static HTML/CSS/JS)
        ▲
        │  SSE  (EventSource → localhost:4242/events)
        │
~/.aisentry/agent.js   ← single Node.js file, zero npm deps
  port 127.0.0.1:4242
  reads every 5 s (only when browser tab is open):
    - ~/.claude/projects/*/   (file size + mtime — session counting)
    - ~/.gemini/              (file size + mtime — session counting)
    - ~/.codex/               (file size + mtime — session counting)
    - ~/.claude/settings.json, .codex/config.json, .cursor/settings.json  (full — permission audit)
    - ~/.claude/history.jsonl (last 8 KB — recent activity)
    - ps aux                  (process detection)
    - lsof -i (scoped to AI PIDs) (network audit)
  never reads: conversation content, API keys, .env files, keychain
```

## File map

| File | Purpose |
|---|---|
| `public/agent.js` | Local SSE daemon (426 lines, zero deps). Serves `/ping` and `/events` on `127.0.0.1:4242`. |
| `public/monitor.html` | Monitor SPA. 3 states: install → restart → live dashboard. Uses Chart.js for timeline/bar/doughnut. |
| `public/index.html` | Marketing landing page. Static, no framework. |
| `public/install.sh` | Bash installer. Downloads agent, starts it, registers launchd/systemd, injects shell aliases. |
| `public/version.json` | `{"version":"1.0.0"}` — polled once/hour by agent for update checks. |
| `build.js` | Zero-dep build script. Copies `public/` → `dist/`, replaces `__HOSTED_URL__` with `HOSTED_URL` env var. |
| `netlify.toml` | Build: `node build.js`, publish: `dist/`. Requires `HOSTED_URL` env var in Netlify settings. |

## Key constants in agent.js

```js
PORT       = process.env.PORT || 4242
HOSTED_URL = process.env.AISENTRY_HOST || '__HOSTED_URL__'
HOME       = os.homedir()

AGENT_SESSION_DIRS = [
  { dir: ~/.claude/projects, prefix: '' },
  { dir: ~/.gemini,          prefix: 'gemini:' },
  { dir: ~/.codex,           prefix: 'codex:' },
]

AGENT_SIGNATURES = [
  'claude', '.claude/', 'claude-flow', '@claude-flow', 'ruflo',
  'codex', '@openai/codex', 'openai-codex',
  'gemini', '@google/gemini-cli', 'gemini-cli',
  ' aider ', '/aider',
  'copilot-language-server', 'copilot-cli',
]

SKIP_IF_CONTAINS = ['grep', 'agent.js', 'aisentry']
```

Network whitelist (classifyEndpoint): anthropic.com, openai.com, googleapis.com, github.com/githubusercontent.com → ok. Everything else → medium or high.

## Risk rating system

| Level | Trigger |
|---|---|
| critical | `Bash(node .claude/*)` or `fullAuto: true` |
| high | Broad wildcard, Opus model override, daemon schedule, `approvalPolicy: never`, unknown endpoint |
| medium | Scoped wildcard (`npx @pkg*`), sandbox disabled, unknown HTTPS |
| low | Named-file permission, MCP server blanket, model config |
| ok | Specific allow rule, whitelisted endpoint |

## Build & deploy

```bash
# Local dev (no build needed)
npm run dev          # serve public/ on :8080
npm run dev:agent    # AISENTRY_HOST=http://localhost:8080 node public/agent.js

# Build (requires .env with HOSTED_URL=https://aisentry.netlify.app)
npm run build        # public/ → dist/ with __HOSTED_URL__ replaced
npm run preview      # build + serve dist/ on :8080

# Deploy
npm run deploy          # build + netlify deploy --prod
npm run deploy:preview  # build + netlify deploy (draft URL)
```

Netlify auto-deploys from `main`. Requires `HOSTED_URL=https://aisentry.netlify.app` in Netlify → Site settings → Environment variables.

## monitor.html state machine

```
initialCheck()
  └─ ping localhost:4242/ping
       ├─ success  → onAgentFound() → show dashboard, set localStorage as_agent_seen=1
       ├─ fail + localStorage as_agent_seen=1  → show restart screen
       └─ fail + no localStorage               → show install screen
```

Restart screen shows: `as-start` / `as-restart` aliases first, then manual nohup command, then full reinstall link.

## Shell aliases (injected by install.sh into ~/.zshrc or ~/.bashrc)

```
as-start    launch agent in background
as-stop     kill agent
as-restart  stop + start
as-log      tail -f ~/.aisentry/agent.log
as-status   check if running
as-update   re-run installer from site
as-open     open https://aisentry.netlify.app/monitor
```

## install.sh behavior

1. Checks Node.js ≥ 18
2. Kills any running instance (reads PID from `~/.aisentry/agent.pid`)
3. Downloads `agent.js` to `~/.aisentry/`
4. Starts agent with `nohup`; writes PID to `~/.aisentry/agent.pid`
5. macOS: writes `~/Library/LaunchAgents/com.aisentry.agent.plist` (RunAtLoad: false)
6. Linux: writes `~/.config/systemd/user/aisentry.service` + enables it
7. Prompts `[Y/n]` to append `as-*` aliases to shell rc; removes old block first (idempotent)

## `__HOSTED_URL__` pattern

All `public/` source files use `__HOSTED_URL__` as a placeholder. `build.js` replaces it globally at build time. HTML/JS files have a JS fallback so they work in local dev without building:

```js
const _raw = '__HOSTED_URL__';
const HOSTED_URL = _raw.startsWith('__') ? window.location.origin : _raw;
```

`install.sh` has no JS fallback — it needs the build step to get the correct URL.

## Private Network Access

Agent sets `Access-Control-Allow-Private-Network: true` on all responses so Chrome allows HTTPS pages to connect to `localhost`.

## What's NOT in the codebase

- No npm dependencies (not even devDependencies) — `build.js` and `agent.js` use only Node.js built-ins
- No framework (React, Vue, etc.) — plain HTML/CSS/JS
- No backend — Netlify serves only static files
- `dist/` is gitignored — never commit it
- No `.env` file committed — only `.env.example`
