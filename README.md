# AgentScope

Real-time monitoring for every AI coding agent on your machine — Claude Code, Codex, Gemini CLI, Aider, Cursor, and more.

**Your data streams from your machine to your browser. Nothing goes through any server.**

---

## What it monitors

| Agent | Sessions | Permissions | Processes | Network |
|---|---|---|---|---|
| Claude Code | ✓ `~/.claude/projects/` | ✓ `settings.json` | ✓ | ✓ |
| Codex CLI | ✓ `~/.codex/` | ✓ `config.json` (fullAuto, approvalPolicy) | ✓ | ✓ |
| Gemini CLI | ✓ `~/.gemini/` | ✓ `settings.json` (sandbox, model) | ✓ | ✓ |
| Aider | — | — | ✓ | ✓ |
| Cursor | — | ✓ `.cursor/settings.json` | ✓ | ✓ |
| GitHub Copilot | — | — | ✓ | ✓ |

Network: Anthropic, OpenAI, Google, and GitHub API endpoints are whitelisted. Anything else is flagged.

---

## About the agent

The agent is a **single Node.js file (~15 KB)** with zero npm dependencies. Here's exactly what it costs:

| Resource | Idle (no browser) | Active (browser connected) |
|---|---|---|
| Disk | ~15 KB + log file | same |
| RAM | 35–50 MB (Node.js baseline) | same — no growth |
| CPU | ~0% | brief spike every 5 s (`ps` + `lsof`) |
| Port | 127.0.0.1:4242 | same |
| Outbound network | 1 req/hr to `/version.json` | same |

**The agent does NOT auto-start after a reboot.** The installer runs it once for the current session. To start it again after a reboot, re-run the installer or manually start it:

```bash
PORT=4242 AGENTSCOPE_HOST=https://your-site.netlify.app \
  nohup node ~/.agentscope/agent.js >> ~/.agentscope/agent.log 2>&1 &
```

### What it reads

| Source | What | Why |
|---|---|---|
| `~/.claude/projects/*/` | File size + mtime only | Session counting |
| `~/.gemini/`, `~/.codex/` | File size + mtime only | Session counting |
| `.claude/settings.json`, `.codex/config.json`, `.cursor/settings.json` | Full file | Permission audit |
| `~/.claude/history.jsonl` | Last 8 KB only | Recent activity feed |
| `ps aux` | Full process list | Detect AI agent processes |
| `lsof -i` (scoped to AI PIDs) | Open sockets | Network audit |

### What it never reads

- Session file **contents** — conversation text is never read, not even sampled
- API keys, tokens, `.env` files, or any credential material
- Keychain, browser storage, or anything outside AI agent data directories

### Control commands

```bash
# Check if running
cat ~/.agentscope/agent.pid | xargs ps -p

# Tail the log
tail -f ~/.agentscope/agent.log

# Stop
kill $(cat ~/.agentscope/agent.pid)

# Full uninstall
kill $(cat ~/.agentscope/agent.pid) 2>/dev/null
rm -rf ~/.agentscope
# macOS:
rm ~/Library/LaunchAgents/com.agentscope.agent.plist
# Linux:
systemctl --user disable agentscope
rm ~/.config/systemd/user/agentscope.service
```

---

## How it works

```
┌── your-site.netlify.app ───────────┐         ┌── Your machine ────────────────────────────┐
│                                    │         │                                            │
│  Static HTML / CSS / JS            │   SSE   │  ~/.agentscope/agent.js                   │
│                                    │◄────────┤  └─ listens on 127.0.0.1:4242            │
│  Browser renders the dashboard     │         │     reads: ~/.claude/, ~/.gemini/,         │
│                                    │         │            ~/.codex/, ps aux, lsof -i     │
└────────────────────────────────────┘         └────────────────────────────────────────────┘
                   Data never leaves your machine
```

---

## Quick start (from the hosted site)

Visit your deployed site and follow the on-screen instructions, or run the installer directly:

```bash
curl -fsSL https://your-site.netlify.app/install.sh | bash
```

Then open `/monitor` — it detects the agent automatically and connects.

---

## Development

### Run locally

No build step needed for local dev. Serve `public/` with any static server:

```bash
# Python (zero dependencies)
cd public && python3 -m http.server 8080

# Node.js
npx serve public -l 8080
```

Open **http://localhost:8080/monitor.html**. Start the agent pointing at your local server:

```bash
AGENTSCOPE_HOST=http://localhost:8080 node public/agent.js
```

The browser auto-connects once the agent is up. `index.html` and `monitor.html` take effect on refresh; `agent.js` changes require restarting the agent.

### Build for deployment

The build script copies `public/` → `dist/` and replaces `__HOSTED_URL__` with your actual URL:

```bash
# 1. Copy .env.example → .env and fill it in
cp .env.example .env
# edit .env: HOSTED_URL=https://your-site.netlify.app

# 2. Build
node build.js

# 3. Serve dist/ to verify
npx serve dist -l 8080
```

`dist/` is gitignored — never commit it.

---

## Deploy to Netlify

1. Fork this repo
2. Connect to Netlify → **New site → Import from Git**
3. Set **Site settings → Environment variables**: `HOSTED_URL` = your full site URL (e.g. `https://monitor.yourdomain.com`)
4. Deploy — Netlify runs `node build.js` automatically and publishes `dist/`

To use a custom domain, set it up in Netlify's domain settings, then update `HOSTED_URL` to match.

---

## Risk ratings

| Level | Meaning |
|---|---|
| **critical** | `Bash(node .claude/*)` or `fullAuto: true` — anything executes silently |
| **high** | Broad wildcard, Opus model override, daemon schedule, `approvalPolicy: never` |
| **medium** | Scoped wildcard (`npx @pkg*`), unknown HTTPS, sandbox disabled |
| **low** | Named-file permission, MCP server blanket, model config |
| **ok** | Specific rules, Anthropic/OpenAI/Google/GitHub endpoints, local connections |

---

## Privacy

- Agent binds to `127.0.0.1` — not reachable from the internet or local network
- The hosted site is pure static HTML/CSS/JS — no server, no database, no accounts
- Analytics slot included in HTML for self-hosters (empty by default — opt-in)
- One outbound call: `GET /version.json` to check for agent updates
- MIT licensed — [read every line](https://github.com/eternalsayed/ai-monitor)

---

## Why this exists

Third-party Claude Code plugins (like `claude-flow` / Ruflo) can:
- Spawn background daemons that run on a schedule, burning your quota without asking
- Grant themselves `Bash(node .claude/*)` — any script in that folder runs silently
- Override your model selection to Opus
- Open connections to endpoints unrelated to Anthropic

This tool makes all of that visible in real time, across every AI coding agent you use.

---

## License

MIT
