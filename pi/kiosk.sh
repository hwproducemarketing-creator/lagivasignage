#!/usr/bin/env bash
# Wait for local signage server + graphical display, then open Chromium true-kiosk.
# Hides the mouse cursor; keeps a persistent Chromium profile for offline Cache API.

set -uo pipefail

PLAYER_URL="${HW_PLAYER_URL:-http://127.0.0.1:4000/player/?v=1.6.3}"
HEALTH_URL="${HW_HEALTH_URL:-http://127.0.0.1:4000/api/health}"
MAX_WAIT="${HW_KIOSK_WAIT:-180}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROFILE_DIR="${HW_CHROMIUM_PROFILE:-${HOME}/.config/hw-signage-chromium}"

log() { echo "[hw-kiosk] $*"; }

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-${HOME}/.Xauthority}"
# Bookworm Wayland/labwc sometimes needs this
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"

# Never blank this session (X11). Harmless no-op on pure Wayland if xset missing.
if [[ -x "$SCRIPT_DIR/disable-sleep.sh" ]]; then
  bash "$SCRIPT_DIR/disable-sleep.sh" --session || true
elif command -v xset >/dev/null 2>&1; then
  xset s off 2>/dev/null || true
  xset -dpms 2>/dev/null || true
  xset s noblank 2>/dev/null || true
fi

# Wait until a display server is actually up (fixes kiosk not opening after boot / git pull)
log "Waiting for graphical display (DISPLAY=$DISPLAY)…"
for ((i=0; i<MAX_WAIT; i++)); do
  if [[ -S /tmp/.X11-unix/X0 ]] || [[ -S /tmp/.X11-unix/X1 ]]; then
    log "X11 socket present"
    break
  fi
  if [[ -n "${WAYLAND_DISPLAY:-}" ]] || [[ -S "${XDG_RUNTIME_DIR}/wayland-0" ]]; then
    log "Wayland present"
    break
  fi
  if command -v xset >/dev/null 2>&1 && xset q >/dev/null 2>&1; then
    log "xset responds"
    break
  fi
  sleep 1
done

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
  log "WARN: health still failing — waiting 60s more"
  for ((i=0; i<60; i++)); do
    if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
      log "Server is up (late)"
      break
    fi
    sleep 1
  done
fi

if ! curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
  log "ERROR: server never became healthy — launching kiosk anyway"
fi

# Stop previous kiosk Chromium / cursor hiders for this profile (never fail the script)
pkill -f "user-data-dir=${PROFILE_DIR}" 2>/dev/null || true
pkill -f 'unclutter-xfixes' 2>/dev/null || true
pkill -x unclutter 2>/dev/null || true
sleep 1

# Hide mouse cursor immediately (idle 0 = always)
if command -v unclutter-xfixes >/dev/null 2>&1; then
  unclutter-xfixes --timeout 0 --jitter 0 --hide-on-touch --start-hidden &
  log "Cursor hidden (unclutter-xfixes)"
elif command -v unclutter >/dev/null 2>&1; then
  unclutter -idle 0 -root &
  log "Cursor hidden (unclutter -idle 0 -root)"
else
  log "WARN: unclutter not installed — mouse may be visible"
fi

# Persistent profile so Cache API / offline media survive reboots (do NOT use --incognito)
mkdir -p "$PROFILE_DIR"
sed -i 's/"exited_cleanly":false/"exited_cleanly":true/' "$PROFILE_DIR/Default/Preferences" 2>/dev/null || true
sed -i 's/"exit_type":"Crashed"/"exit_type":"Normal"/' "$PROFILE_DIR/Default/Preferences" 2>/dev/null || true

log "Starting $CHROME kiosk → $PLAYER_URL (profile=$PROFILE_DIR)"
exec "$CHROME" \
  --kiosk \
  --start-fullscreen \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-restore-session-state \
  --disable-translate \
  --disable-features=TranslateUI,IdleDetection \
  --disable-idle-detection \
  --check-for-update-interval=31536000 \
  --autoplay-policy=no-user-gesture-required \
  --overscroll-history-navigation=0 \
  --no-first-run \
  --no-default-browser-check \
  --disable-gpu-sandbox \
  --user-data-dir="$PROFILE_DIR" \
  "$PLAYER_URL"
