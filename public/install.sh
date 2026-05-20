#!/usr/bin/env bash
# AgentScope — local monitoring agent installer
# Monitors Claude Code, Codex, Gemini CLI, Aider, and other AI coding agents.
# Source: https://YOUR_SITE.netlify.app
#
# What this script does:
#   1. Downloads a single Node.js file (~15 KB) to ~/.agentscope/agent.js
#   2. Kills any previously running instance of the agent
#   3. Starts the agent as a background process on port 4242 (127.0.0.1 only)
#   4. On macOS: registers a launchd agent so it starts automatically on login
#   5. On Linux:  registers a systemd user unit for the same purpose
#
# What it does NOT do:
#   - It does not read conversation content (only file sizes and timestamps)
#   - It does not send any data to external servers
#   - It does not modify your Claude/Codex/Gemini configuration files
#
# Uninstall:
#   kill $(cat ~/.agentscope/agent.pid) 2>/dev/null
#   rm -rf ~/.agentscope
#   # macOS: launchctl unload ~/Library/LaunchAgents/com.agentscope.agent.plist && rm ~/Library/LaunchAgents/com.agentscope.agent.plist
#   # Linux: systemctl --user disable agentscope && rm ~/.config/systemd/user/agentscope.service
set -euo pipefail

HOSTED_URL="https://YOUR_SITE.netlify.app"
AGENT_DIR="$HOME/.agentscope"
AGENT_PATH="$AGENT_DIR/agent.js"
LOG_FILE="$AGENT_DIR/agent.log"
PID_FILE="$AGENT_DIR/agent.pid"
PORT="${PORT:-4242}"

bold=$'\e[1m'; green=$'\e[32m'; yellow=$'\e[33m'; cyan=$'\e[36m'; dim=$'\e[2m'; reset=$'\e[0m'

header() { echo; echo "${bold}${cyan}AgentScope — Installer${reset}"; echo "${dim}${HOSTED_URL}${reset}"; echo; }
ok()     { echo "  ${green}✓${reset}  $1"; }
warn()   { echo "  ${yellow}!${reset}  $1"; }
die()    { echo "  ✗  $1" >&2; exit 1; }

header

# ── Prerequisites ─────────────────────────────────────────────────────────────
command -v node >/dev/null 2>&1 || die "Node.js is required. Install from https://nodejs.org"
NODE_VER=$(node -e "process.exit(parseInt(process.versions.node)<18?1:0)" 2>/dev/null && echo "ok" || echo "old")
[ "$NODE_VER" = "old" ] && warn "Node.js 18+ recommended (you have $(node --version))"
ok "Node.js $(node --version)"

# ── Stop existing instance ────────────────────────────────────────────────────
if [ -f "$PID_FILE" ]; then
  OLD_PID=$(cat "$PID_FILE" 2>/dev/null || echo "")
  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
    kill "$OLD_PID" 2>/dev/null && ok "Stopped previous agent (PID $OLD_PID)"
  fi
  rm -f "$PID_FILE"
fi

# ── Download agent ────────────────────────────────────────────────────────────
mkdir -p "$AGENT_DIR"
echo "  Downloading agent..."
if command -v curl >/dev/null 2>&1; then
  curl -fsSL "${HOSTED_URL}/agent.js" -o "$AGENT_PATH"
elif command -v wget >/dev/null 2>&1; then
  wget -qO "$AGENT_PATH" "${HOSTED_URL}/agent.js"
else
  die "curl or wget is required"
fi
chmod +x "$AGENT_PATH"
ok "Agent downloaded to $AGENT_PATH"

# ── Launch ────────────────────────────────────────────────────────────────────
PORT="$PORT" AGENTSCOPE_HOST="$HOSTED_URL" nohup node "$AGENT_PATH" >> "$LOG_FILE" 2>&1 &
AGENT_PID=$!
echo "$AGENT_PID" > "$PID_FILE"

sleep 1
if ! kill -0 "$AGENT_PID" 2>/dev/null; then
  die "Agent failed to start. Check logs: tail -f $LOG_FILE"
fi
ok "Agent started (PID $AGENT_PID) on port $PORT"

# ── macOS: register with launchd ──────────────────────────────────────────────
if [ "$(uname)" = "Darwin" ]; then
  PLIST="$HOME/Library/LaunchAgents/com.agentscope.agent.plist"
  NODE_BIN=$(command -v node)
  cat > "$PLIST" << PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>              <string>com.agentscope.agent</string>
  <key>ProgramArguments</key>  <array><string>$NODE_BIN</string><string>$AGENT_PATH</string></array>
  <key>EnvironmentVariables</key>
    <dict>
      <key>PORT</key>              <string>$PORT</string>
      <key>AGENTSCOPE_HOST</key>   <string>$HOSTED_URL</string>
    </dict>
  <key>RunAtLoad</key>         <false/>
  <key>KeepAlive</key>         <false/>
  <key>StandardOutPath</key>   <string>$LOG_FILE</string>
  <key>StandardErrorPath</key> <string>$LOG_FILE</string>
  <key>WorkingDirectory</key>  <string>$AGENT_DIR</string>
</dict>
</plist>
PLIST_EOF
  ok "Registered with launchd (starts on next login)"
fi

# ── Linux: systemd user unit ──────────────────────────────────────────────────
if [ "$(uname)" = "Linux" ] && command -v systemctl >/dev/null 2>&1; then
  NODE_BIN=$(command -v node)
  UNIT_DIR="$HOME/.config/systemd/user"
  mkdir -p "$UNIT_DIR"
  cat > "$UNIT_DIR/agentscope.service" << UNIT_EOF
[Unit]
Description=AgentScope local monitoring agent
After=network.target

[Service]
Type=simple
ExecStart=$NODE_BIN $AGENT_PATH
Environment=PORT=$PORT
Environment=AGENTSCOPE_HOST=$HOSTED_URL
Restart=on-failure
StandardOutput=append:$LOG_FILE
StandardError=append:$LOG_FILE

[Install]
WantedBy=default.target
UNIT_EOF
  systemctl --user daemon-reload 2>/dev/null || true
  systemctl --user enable agentscope 2>/dev/null && ok "Registered with systemd (auto-start on login)" || warn "Could not enable systemd unit (non-critical)"
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo
echo "  ${bold}All done.${reset}"
echo
echo "  ${dim}Dashboard  →${reset} ${cyan}${HOSTED_URL}/monitor${reset}"
echo "  ${dim}Port       →${reset} $PORT"
echo "  ${dim}Logs       →${reset} tail -f $LOG_FILE"
echo "  ${dim}Stop       →${reset} kill \$(cat $PID_FILE)"
echo "  ${dim}Update     →${reset} curl -fsSL ${HOSTED_URL}/install.sh | bash"
echo
