# AgentScope

Real-time monitoring for every AI coding agent on your machine — Claude Code, Codex, Gemini CLI, Aider, and more.

**Your data streams from your machine to your browser. Nothing goes through any server.**

## What it monitors

| Agent | Sessions | Permissions | Processes | Network |
|---|---|---|---|---|
| Claude Code | ✓ `~/.claude/projects/` | ✓ `settings.json` | ✓ | ✓ |
| Codex CLI | ✓ `~/.codex/` | ✓ `config.json` | ✓ | ✓ |
| Gemini CLI | ✓ `~/.gemini/` | ✓ `settings.json` | ✓ | ✓ |
| Aider | — | — | ✓ | ✓ |
| Cursor | — | ✓ `.cursor/settings.json` | ✓ | ✓ |
| GitHub Copilot | — | — | ✓ | ✓ |

**Network**: Anthropic, OpenAI, Google, and GitHub API endpoints are whitelisted. Anything else is flagged.

## How it works

```
┌── agentscope.netlify.app ──────────┐         ┌── Your machine ────────────────────────────┐
│                                    │         │                                            │
│  Static HTML / CSS / JS            │   SSE   │  ~/.agentscope/agent.js                   │
│                                    │◄────────┤  └─ listens on 127.0.0.1:4242            │
│  Browser renders the dashboard     │         │     reads: ~/.claude/, ~/.gemini/,         │
│                                    │         │            ~/.codex/, ps aux, lsof -i     │
└────────────────────────────────────┘         └────────────────────────────────────────────┘
                   Data never leaves your machine
```

## Quick start (from the hosted site)

Visit **[agentscope.netlify.app](https://agentscope.netlify.app)** and follow the on-screen instructions, or run the installer directly:

```bash
curl -fsSL https://agentscope.netlify.app/install.sh | bash
```

Then open the Monitor page. It detects the agent automatically and connects.

**Tail the logs:**
```bash
tail -f ~/.agentscope/agent.log
```

**Stop the agent:**
```bash
kill $(cat ~/.agentscope/agent.pid)
```

**Update:**
```bash
curl -fsSL https://agentscope.netlify.app/install.sh | bash
```

## Run locally (for development)

Clone the repo and serve the `public/` directory with any static file server:

```bash
git clone https://github.com/eternalsayed/ai-monitor
cd ai-monitor

# Option A: Python (zero dependencies)
cd public && python3 -m http.server 8080

# Option B: Node.js
npx serve public -l 8080

# Option C: PHP
cd public && php -S localhost:8080
```

Open **http://localhost:8080** — you'll see the install screen.

Start the agent pointing at your local dev server:

```bash
AGENTSCOPE_HOST=http://localhost:8080 node public/agent.js
```

The browser will auto-connect as soon as the agent is up. Changes to `index.html` or `monitor.html` take effect on refresh; changes to `agent.js` require restarting the agent process.

## Self-hosting on Netlify

1. Fork this repo
2. Connect to Netlify → **New site → Import from Git**
3. Set publish directory: `public`, build command: *(leave blank)*
4. Deploy — Netlify reads `netlify.toml` automatically

After deploy, update the `HOSTED_URL` constant in `public/agent.js` and `public/install.sh` from `YOUR_NETLIFY_SITE.netlify.app` to your actual domain, then commit and push.

## Risk ratings

| Level | Meaning |
|---|---|
| **critical** | Blanket `Bash(node .claude/*)` or `fullAuto: true` — anything executes silently |
| **high** | Broad wildcard, model override (Opus), active daemon schedule, `approvalPolicy: never` |
| **medium** | Scoped wildcard (e.g. `npx @pkg*`), unknown HTTPS connection, sandbox disabled |
| **low** | Named-file permission, MCP server blanket, model config |
| **ok** | Expected: specific rules, Anthropic/OpenAI/Google/GitHub endpoints, local connections |

## Privacy

- Agent binds to `127.0.0.1` only — not reachable from the internet or your local network
- Session content is never read — only file size and timestamp
- No analytics, no tracking, no accounts (analytics slot in HTML for self-hosters to fill)
- One outbound call: `GET /version.json` to check for agent updates
- MIT licensed — [read every line](https://github.com/eternalsayed/ai-monitor)

## Why this exists

Third-party Claude Code plugins (like `claude-flow` / Ruflo) can:
- Spawn background daemons that run on a schedule, burning your quota
- Grant themselves `Bash(node .claude/*)` — any script in that directory executes silently
- Override your model selection to Opus without asking
- Open connections to endpoints that have nothing to do with Anthropic

This tool makes all of that visible in one place, in real time, for every AI coding agent you use.

## License

MIT
