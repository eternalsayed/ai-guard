#!/usr/bin/env bash
# AISentry — local monitoring agent installer
# Monitors Claude Code, Codex, Gemini CLI, Aider, and other AI coding agents.
# Source: https://aisentry.netlify.app
#
# What this script does:
#   1. Downloads a single Node.js file (~15 KB) to ~/.aisentry/agent.js
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
#   kill $(cat ~/.aisentry/agent.pid) 2>/dev/null
#   rm -rf ~/.aisentry
#   # macOS: launchctl unload ~/Library/LaunchAgents/com.aisentry.agent.plist && rm ~/Library/LaunchAgents/com.aisentry.agent.plist
#   # Linux: systemctl --user disable aisentry && rm ~/.config/systemd/user/aisentry.service
set -euo pipefail

HOSTED_URL="__HOSTED_URL__"
AGENT_DIR="$HOME/.aisentry"
AGENT_PATH="$AGENT_DIR/agent.js"
LOG_FILE="$AGENT_DIR/agent.log"
PID_FILE="$AGENT_DIR/agent.pid"
PORT="${PORT:-4242}"

bold=$'\e[1m'; green=$'\e[32m'; yellow=$'\e[33m'; cyan=$'\e[36m'; dim=$'\e[2m'; reset=$'\e[0m'

header() { echo; echo "${bold}${cyan}AISentry — Installer${reset}"; echo "${dim}${HOSTED_URL}${reset}"; echo; }
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
PORT="$PORT" AISENTRY_HOST="$HOSTED_URL" nohup node "$AGENT_PATH" >> "$LOG_FILE" 2>&1 &
AGENT_PID=$!
echo "$AGENT_PID" > "$PID_FILE"

sleep 1
if ! kill -0 "$AGENT_PID" 2>/dev/null; then
  die "Agent failed to start. Check logs: tail -f $LOG_FILE"
fi
ok "Agent started (PID $AGENT_PID) on port $PORT"

# ── macOS: register with launchd ──────────────────────────────────────────────
if [ "$(uname)" = "Darwin" ]; then
  PLIST="$HOME/Library/LaunchAgents/com.aisentry.agent.plist"
  NODE_BIN=$(command -v node)
  cat > "$PLIST" << PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>              <string>com.aisentry.agent</string>
  <key>ProgramArguments</key>  <array><string>$NODE_BIN</string><string>$AGENT_PATH</string></array>
  <key>EnvironmentVariables</key>
    <dict>
      <key>PORT</key>              <string>$PORT</string>
      <key>AISENTRY_HOST</key>   <string>$HOSTED_URL</string>
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
  cat > "$UNIT_DIR/aisentry.service" << UNIT_EOF
[Unit]
Description=AISentry local monitoring agent
After=network.target

[Service]
Type=simple
ExecStart=$NODE_BIN $AGENT_PATH
Environment=PORT=$PORT
Environment=AISENTRY_HOST=$HOSTED_URL
Restart=on-failure
StandardOutput=append:$LOG_FILE
StandardError=append:$LOG_FILE

[Install]
WantedBy=default.target
UNIT_EOF
  systemctl --user daemon-reload 2>/dev/null || true
  systemctl --user enable aisentry 2>/dev/null && ok "Registered with systemd (auto-start on login)" || warn "Could not enable systemd unit (non-critical)"
fi

# ── Shell aliases ─────────────────────────────────────────────────────────────
ALIAS_BLOCK="
# AISentry aliases (added by installer)
alias as-start='PORT=$PORT AISENTRY_HOST=$HOSTED_URL nohup node $AGENT_PATH >> $LOG_FILE 2>&1 & echo \$! > $PID_FILE && echo \"AISentry started (PID \$(cat $PID_FILE))\"'
alias as-stop='kill \$(cat $PID_FILE 2>/dev/null) 2>/dev/null && rm -f $PID_FILE && echo \"AISentry stopped\" || echo \"AISentry not running\"'
alias as-restart='as-stop; sleep 1; as-start'
alias as-log='tail -f $LOG_FILE'
alias as-status='kill -0 \$(cat $PID_FILE 2>/dev/null) 2>/dev/null && echo \"AISentry running (PID \$(cat $PID_FILE))\" || echo \"AISentry not running\"'
alias as-update='curl -fsSL $HOSTED_URL/install.sh | bash'
alias as-open='open $HOSTED_URL/monitor 2>/dev/null || xdg-open $HOSTED_URL/monitor 2>/dev/null || echo \"Open: $HOSTED_URL/monitor\"'
"

# Detect shell rc file
SHELL_RC=""
if [ -f "$HOME/.zshrc" ]; then
  SHELL_RC="$HOME/.zshrc"
elif [ -f "$HOME/.bashrc" ]; then
  SHELL_RC="$HOME/.bashrc"
elif [ -f "$HOME/.bash_profile" ]; then
  SHELL_RC="$HOME/.bash_profile"
fi

echo
echo "  ${bold}Shell aliases${reset}  (as-start, as-stop, as-restart, as-log, as-status, as-update, as-open)"
if [ -n "$SHELL_RC" ]; then
  printf "  Add to %s? [Y/n] " "$SHELL_RC"
  read -r REPLY </dev/tty
  REPLY="${REPLY:-Y}"
  if [ "$REPLY" = "Y" ] || [ "$REPLY" = "y" ]; then
    # Remove any previous AISentry alias block before appending
    if grep -q "AISentry aliases" "$SHELL_RC" 2>/dev/null; then
      # Portable removal of old block (sed on macOS requires -i '' )
      SED_I=(-i)
      [ "$(uname)" = "Darwin" ] && SED_I=(-i '')
      sed "${SED_I[@]}" '/# AISentry aliases/,/^alias as-open/d' "$SHELL_RC"
    fi
    printf '%s\n' "$ALIAS_BLOCK" >> "$SHELL_RC"
    ok "Aliases added to $SHELL_RC — run: source $SHELL_RC"
  else
    warn "Skipped. To add them manually, paste this into $SHELL_RC:"
    echo "$ALIAS_BLOCK"
  fi
else
  warn "Could not detect shell rc file. Paste these aliases manually:"
  echo "$ALIAS_BLOCK"
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo
echo "  ${bold}All done.${reset}"
echo
echo "  ${dim}Dashboard  →${reset} ${cyan}${HOSTED_URL}/monitor${reset}"
echo "  ${dim}Port       →${reset} $PORT"
echo "  ${dim}Logs       →${reset} ${dim}as-log${reset}  (or: tail -f $LOG_FILE)"
echo "  ${dim}Stop       →${reset} ${dim}as-stop${reset}"
echo "  ${dim}Restart    →${reset} ${dim}as-restart${reset}"
echo "  ${dim}Status     →${reset} ${dim}as-status${reset}"
echo "  ${dim}Update     →${reset} ${dim}as-update${reset}"
echo
