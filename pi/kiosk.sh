#!/usr/bin/env bash
# Wait for local signage server, then open Chromium fullscreen on the player.
# Also disables X11 blanking for this session so the TV never goes black.

set -euo pipefail

PLAYER_URL="${HW_PLAYER_URL:-http://127.0.0.1:4000/player/?v=1.6.0}"
HEALTH_URL="${HW_HEALTH_URL:-http://127.0.0.1:4000/api/health}"
MAX_WAIT="${HW_KIOSK_WAIT:-120}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log() { echo "[hw-kiosk] $*"; }

export DISPLAY="${DISPLAY:-:0}"

# Never blank this session (X11). Harmless no-op on pure Wayland if xset missing.
if [[ -x "$SCRIPT_DIR/disable-sleep.sh" ]]; then
  bash "$SCRIPT_DIR/disable-sleep.sh" --session || true
elif command -v xset >/dev/null 2>&1; then
  xset s off 2>/dev/null || true
  xset -dpms 2>/dev/null || true
  xset s noblank 2>/dev/null || true
fi

# Find a Chromium binary (Bookworm names vary)
CHROME=""
for c in chromium-browser chromium google-chrome; do
  if command -v "$c" >/dev/null 2>&1; then
    CHROME="$c"
    break
  fi
done

if [[ -z "$CHROME" ]]; then
  log "ERROR: Chromium not installed. sudo apt install chromium"
  exit 1
fi

log "Waiting for server at $HEALTH_URL (up to ${MAX_WAIT}s)…"
for ((i=0; i<MAX_WAIT; i++)); do
  if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
    log "Server is up"
    break
  fi
  sleep 1
done

if ! curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
  log "WARN: health check still failing — launching kiosk anyway"
fi

# Hide mouse when idle (optional)
if command -v unclutter >/dev/null 2>&1; then
  unclutter -idle 0.5 -root &
fi

# Clean crash restore dialogs
PROFILE_DIR="${HOME}/.config/hw-signage-chromium"
mkdir -p "$PROFILE_DIR"
sed -i 's/"exited_cleanly":false/"exited_cleanly":true/' "$PROFILE_DIR/Default/Preferences" 2>/dev/null || true
sed -i 's/"exit_type":"Crashed"/"exit_type":"Normal"/' "$PROFILE_DIR/Default/Preferences" 2>/dev/null || true

log "Starting $CHROME → $PLAYER_URL"
exec "$CHROME" \
  --kiosk \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-restore-session-state \
  --check-for-update-interval=31536000 \
  --autoplay-policy=no-user-gesture-required \
  --disable-features=TranslateUI,IdleDetection \
  --disable-idle-detection \
  --no-first-run \
  --user-data-dir="$PROFILE_DIR" \
  "$PLAYER_URL"
