#!/usr/bin/env bash
# Disable screen blanking / DPMS / system sleep for H&W kiosk.
# Safe to run repeatedly (idempotent). Prefer: sudo bash pi/disable-sleep.sh
# Also invoked from kiosk.sh (X11 bits) and setup.sh (system-wide).

set -euo pipefail

log() { echo "[hw-nosleep] $*"; }

IS_ROOT=0
if [[ "$(id -u)" -eq 0 ]]; then
  IS_ROOT=1
fi

# --- X11 session (run as desktop user; no-op if no DISPLAY / no xset) ---
disable_x11_blanking() {
  export DISPLAY="${DISPLAY:-:0}"
  if ! command -v xset >/dev/null 2>&1; then
    return 0
  fi
  # May fail on Wayland-only sessions — ignore
  xset s off 2>/dev/null || true
  xset -dpms 2>/dev/null || true
  xset s noblank 2>/dev/null || true
  log "X11: screensaver/DPMS off (DISPLAY=$DISPLAY)"
}

# --- System-wide (root) ---
if [[ "$IS_ROOT" -eq 1 ]]; then
  log "Applying system-wide never-sleep settings…"

  # Packages for xset
  if command -v apt-get >/dev/null 2>&1; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get install -y x11-xserver-utils 2>/dev/null || true
  fi

  # Raspberry Pi OS: Screen Blanking → No
  if command -v raspi-config >/dev/null 2>&1; then
    # 0 = disable blanking (menu "No") on current Bookworm raspi-config
    raspi-config nonint do_blanking 0 2>/dev/null || true
    log "raspi-config: screen blanking disabled"
  fi

  # Prevent systemd sleep / hibernate (kiosk Pi should stay awake until power off)
  # Undo later with: systemctl unmask sleep.target suspend.target hibernate.target hybrid-sleep.target
  systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target 2>/dev/null || true
  log "systemd: masked sleep/suspend/hibernate targets"

  # logind: ignore idle
  mkdir -p /etc/systemd/logind.conf.d
  cat > /etc/systemd/logind.conf.d/hw-signage-nosleep.conf <<'EOF'
[Login]
IdleAction=ignore
IdleActionSec=0
HandleLidSwitch=ignore
HandleLidSwitchExternalPower=ignore
HandleLidSwitchDocked=ignore
HandleSuspendKey=ignore
HandleHibernateKey=ignore
EOF
  systemctl reload-or-restart systemd-logind 2>/dev/null || true
  log "logind: IdleAction=ignore"

  # Xorg server flags (used when session is X11)
  mkdir -p /etc/X11/xorg.conf.d
  cat > /etc/X11/xorg.conf.d/10-hw-signage-noblank.conf <<'EOF'
Section "ServerFlags"
    Option "BlankTime"    "0"
    Option "StandbyTime"  "0"
    Option "SuspendTime"  "0"
    Option "OffTime"      "0"
EndSection

Section "ServerLayout"
    Identifier "HWSignageLayout"
    Option "BlankTime"    "0"
    Option "StandbyTime"  "0"
    Option "SuspendTime"  "0"
    Option "OffTime"      "0"
EndSection
EOF
  log "Xorg: noblank config written"

  # lightdm (if present): don't blank greeter
  if [[ -d /etc/lightdm ]]; then
    mkdir -p /etc/lightdm/lightdm.conf.d
    cat > /etc/lightdm/lightdm.conf.d/90-hw-signage-nosleep.conf <<'EOF'
[Seat:*]
xserver-command=X -s 0 -dpms
EOF
    log "lightdm: X -s 0 -dpms"
  fi

  # Wayfire (older Bookworm default): disable idle DPMS
  for WF in /etc/wayfire/defaults.ini /home/*/.config/wayfire.ini; do
    [[ -e "$WF" || "$WF" == /home/*/.config/wayfire.ini ]] || continue
  done
  # Write / update each existing user wayfire.ini + a system snippet
  if [[ -d /etc/wayfire ]]; then
    mkdir -p /etc/wayfire
    cat > /etc/wayfire/hw-signage-nosleep.ini <<'EOF'
[idle]
dpms_timeout = -1
EOF
    log "wayfire: /etc/wayfire/hw-signage-nosleep.ini (include from wayfire.ini if needed)"
  fi

  # Per-user Wayfire / labwc tweaks for the signage account
  for home in /home/*; do
    [[ -d "$home" ]] || continue
    user="$(basename "$home")"
    id -u "$user" >/dev/null 2>&1 || continue

    mkdir -p "$home/.config"
    # wayfire.ini
    WF="$home/.config/wayfire.ini"
    if [[ -f "$WF" ]]; then
      if grep -q '^\[idle\]' "$WF" 2>/dev/null; then
        sed -i '/^\[idle\]/,/^\[/{s/^dpms_timeout.*/dpms_timeout = -1/}' "$WF" || true
        grep -q '^dpms_timeout' "$WF" || sed -i '/^\[idle\]/a dpms_timeout = -1' "$WF" || true
      else
        printf '\n[idle]\ndpms_timeout = -1\n' >> "$WF"
      fi
    else
      mkdir -p "$home/.config"
      printf '[idle]\ndpms_timeout = -1\n' > "$WF"
    fi

    # labwc: ensure no swayidle blanking; drop a marker autostart
    mkdir -p "$home/.config/labwc"
    AUTOSTART="$home/.config/labwc/autostart"
    if [[ ! -f "$AUTOSTART" ]] || ! grep -q 'hw-signage-nosleep' "$AUTOSTART" 2>/dev/null; then
      {
        echo "# hw-signage-nosleep"
        echo "killall swayidle 2>/dev/null || true"
      } >> "$AUTOSTART"
    fi

    chown -R "$user:$user" "$home/.config" 2>/dev/null || true
  done
  log "wayfire/labwc: per-user idle/DPMS disabled"

  # Desktop autostart: re-apply xset on every graphical login
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  cat > /etc/xdg/autostart/hw-signage-nosleep.desktop <<EOF
[Desktop Entry]
Type=Application
Name=H&W Signage Never Sleep
Comment=Disable DPMS / screensaver for kiosk
Exec=/bin/bash ${SCRIPT_DIR}/disable-sleep.sh --session
X-GNOME-Autostart-enabled=true
NoDisplay=true
Terminal=false
EOF
  log "autostart: hw-signage-nosleep.desktop"

  log "System never-sleep settings applied (reboot recommended)."
fi

# Session mode or always try X11 when DISPLAY is set
if [[ "${1:-}" == "--session" ]] || [[ -n "${DISPLAY:-}" ]]; then
  disable_x11_blanking
fi

exit 0
