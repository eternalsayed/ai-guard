# AISentry

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
PORT=4242 AISENTRY_HOST=https://aisentry.netlify.app \
  nohup node ~/.aisentry/agent.js >> ~/.aisentry/agent.log 2>&1 &
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
cat ~/.aisentry/agent.pid | xargs ps -p

# Tail the log
tail -f ~/.aisentry/agent.log

# Stop
kill $(cat ~/.aisentry/agent.pid)

# Full uninstall
kill $(cat ~/.aisentry/agent.pid) 2>/dev/null
rm -rf ~/.aisentry
# macOS:
rm ~/Library/LaunchAgents/com.aisentry.agent.plist
# Linux:
systemctl --user disable aisentry
rm ~/.config/systemd/user/aisentry.service
```

---

## How it works

```
┌── aisentry.netlify.app ───────────┐         ┌── Your machine ────────────────────────────┐
│                                    │         │                                            │
│  Static HTML / CSS / JS            │   SSE   │  ~/.aisentry/agent.js                   │
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
curl -fsSL https://aisentry.netlify.app/install.sh | bash
```

Then open `/monitor` — it detects the agent automatically and connects.

---

## Development

```bash
npm run dev          # serve public/ on :8080 — no build step needed
npm run dev:agent    # start agent pointing at localhost:8080 (separate terminal)
```

Open **http://localhost:8080/monitor.html**. The browser auto-connects once the agent is up. HTML changes take effect on refresh; `agent.js` changes require restarting the agent (`Ctrl-C`, then `npm run dev:agent` again).

### Build & preview

```bash
cp .env.example .env  # set HOSTED_URL=https://aisentry.netlify.app
npm run build         # copies public/ → dist/, injects HOSTED_URL
npm run preview       # builds + serves dist/ on :8080
```

`dist/` is gitignored — never commit it.

---

## Deploy to Netlify

**Auto-deploy (recommended):** connect the repo to Netlify, set `HOSTED_URL` in **Site settings → Environment variables**, and every push to `main` deploys automatically.

**Manual deploy:**

```bash
npm run deploy          # build + deploy to production
npm run deploy:preview  # build + deploy as a draft URL (no production traffic)
```

Both scripts use `npx netlify` — you'll be prompted to log in if you haven't already (`npx netlify login`).

To use a custom domain, configure it in Netlify's domain settings, then update `HOSTED_URL` to match and redeploy.

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
