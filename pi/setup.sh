#!/usr/bin/env bash
# Idempotent H&W Signage setup for Raspberry Pi OS (Bookworm recommended).
# Run:  cd /home/pi/lagivasignage && sudo bash pi/setup.sh
#
# What it does:
#  - installs packages (node, chromium, network-manager, curl, …)
#  - npm install + admin build
#  - DATA_DIR + .env for local production
#  - systemd: hw-signage, hotspot, kiosk
#  - never-sleep: DPMS/screensaver/suspend off
#  - desktop autostart for kiosk (belt-and-suspenders)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo bash pi/setup.sh"
  exit 1
fi

# Prefer the user who invoked sudo
SIGNAGE_USER="${SUDO_USER:-}"
if [[ -z "$SIGNAGE_USER" || "$SIGNAGE_USER" == "root" ]]; then
  if id -u pi >/dev/null 2>&1; then
    SIGNAGE_USER=pi
  else
    SIGNAGE_USER="$(getent passwd | awk -F: '$3>=1000 && $1!="nobody"{print $1; exit}')"
  fi
fi

HOME_DIR="$(getent passwd "$SIGNAGE_USER" | cut -d: -f6)"
DATA_DIR="${HW_DATA_DIR:-$HOME_DIR/hw-signage-data}"
NODE_MAJOR=20

echo "=== H&W Signage Pi setup ==="
echo "Install dir : $INSTALL_DIR"
echo "Run as user : $SIGNAGE_USER ($HOME_DIR)"
echo "DATA_DIR    : $DATA_DIR"
echo

export DEBIAN_FRONTEND=noninteractive

echo "[1/9] Packages…"
apt-get update -y
apt-get install -y \
  curl ca-certificates gnupg \
  network-manager \
  chromium \
  unclutter \
  fonts-liberation \
  xdg-utils \
  x11-xserver-utils

# Chromium package name differs; try chromium-browser if needed
apt-get install -y chromium-browser 2>/dev/null || true
# Better cursor hider on some Bookworm images (optional)
apt-get install -y unclutter-xfixes 2>/dev/null || true

# Node.js 20 via NodeSource if missing / too old
need_node=0
if ! command -v node >/dev/null 2>&1; then
  need_node=1
else
  ver="$(node -v | sed 's/^v//' | cut -d. -f1)"
  if [[ "$ver" -lt "$NODE_MAJOR" ]]; then
    need_node=1
  fi
fi

if [[ "$need_node" -eq 1 ]]; then
  echo "[1b] Installing Node.js ${NODE_MAJOR}.x…"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
fi

echo "Node $(node -v) / npm $(npm -v)"

echo "[2/9] Data directory…"
mkdir -p "$DATA_DIR/database" "$DATA_DIR/uploads"
chown -R "$SIGNAGE_USER:$SIGNAGE_USER" "$DATA_DIR"

echo "[3/9] .env…"
ENV_FILE="$INSTALL_DIR/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  SECRET="$(openssl rand -hex 24 2>/dev/null || head -c 48 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 48)"
  cat > "$ENV_FILE" <<EOF
NODE_ENV=production
PORT=4000
DATA_DIR=$DATA_DIR
COOKIE_SECURE=false
SESSION_SECRET=$SECRET
ADMIN_USERNAME=admin
ADMIN_PASSWORD=changeme
CORS_ORIGIN=http://127.0.0.1:4000,http://localhost:4000,http://10.42.0.1:4000,http://192.168.4.1:4000
MAX_UPLOAD_MB=100
EOF
  chown "$SIGNAGE_USER:$SIGNAGE_USER" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo "Created $ENV_FILE — CHANGE ADMIN_PASSWORD and hotspot password after first login."
else
  echo "Keeping existing $ENV_FILE"
  # Ensure Pi-critical keys exist
  grep -q '^COOKIE_SECURE=' "$ENV_FILE" || echo 'COOKIE_SECURE=false' >> "$ENV_FILE"
  grep -q '^DATA_DIR=' "$ENV_FILE" || echo "DATA_DIR=$DATA_DIR" >> "$ENV_FILE"
fi

echo "[4/9] npm install + build (as $SIGNAGE_USER)…"
sudo -u "$SIGNAGE_USER" bash -lc "cd '$INSTALL_DIR' && npm install && npm run build"

echo "[5/9] Scripts executable…"
chmod +x "$INSTALL_DIR/pi/setup.sh" \
  "$INSTALL_DIR/pi/start-hotspot.sh" \
  "$INSTALL_DIR/pi/kiosk.sh" \
  "$INSTALL_DIR/pi/disable-sleep.sh"

render_unit() {
  local src="$1"
  local dest="$2"
  sed -e "s|__INSTALL_DIR__|$INSTALL_DIR|g" \
      -e "s|__SIGNAGE_USER__|$SIGNAGE_USER|g" \
      "$src" > "$dest"
}

echo "[6/9] systemd units…"
render_unit "$INSTALL_DIR/pi/hw-signage.service" /etc/systemd/system/hw-signage.service
render_unit "$INSTALL_DIR/pi/hw-signage-hotspot.service" /etc/systemd/system/hw-signage-hotspot.service
render_unit "$INSTALL_DIR/pi/hw-signage-kiosk.service" /etc/systemd/system/hw-signage-kiosk.service

systemctl daemon-reload
systemctl enable hw-signage.service hw-signage-hotspot.service hw-signage-kiosk.service
systemctl restart hw-signage-hotspot.service || true
systemctl restart hw-signage.service

echo "[7/9] Never-sleep (screen blank / DPMS / suspend)…"
bash "$INSTALL_DIR/pi/disable-sleep.sh"

echo "[8/9] Desktop autostart (kiosk + nosleep)…"
AUTOSTART_DIR="/etc/xdg/autostart"
mkdir -p "$AUTOSTART_DIR"
sed -e "s|__INSTALL_DIR__|$INSTALL_DIR|g" \
  "$INSTALL_DIR/pi/hw-signage-kiosk.desktop" > "$AUTOSTART_DIR/hw-signage-kiosk.desktop"
sed -e "s|__INSTALL_DIR__|$INSTALL_DIR|g" \
  "$INSTALL_DIR/pi/hw-signage-nosleep.desktop" > "$AUTOSTART_DIR/hw-signage-nosleep.desktop"

# Also user autostart
USER_AS="$HOME_DIR/.config/autostart"
mkdir -p "$USER_AS"
sed -e "s|__INSTALL_DIR__|$INSTALL_DIR|g" \
  "$INSTALL_DIR/pi/hw-signage-kiosk.desktop" > "$USER_AS/hw-signage-kiosk.desktop"
sed -e "s|__INSTALL_DIR__|$INSTALL_DIR|g" \
  "$INSTALL_DIR/pi/hw-signage-nosleep.desktop" > "$USER_AS/hw-signage-nosleep.desktop"
chown -R "$SIGNAGE_USER:$SIGNAGE_USER" "$HOME_DIR/.config"

echo "[9/9] Optional: boot to desktop (kiosk needs a graphical session)"
# Do not force raspi-config noninteractively if already graphical
if command -v raspi-config >/dev/null 2>&1; then
  raspi-config nonint do_boot_behaviour B4 2>/dev/null || true
fi

echo
echo "=== Setup complete ==="
echo "Hotspot SSID     : HW-Signage"
echo "Hotspot password : hwproduce   ← CHANGE THIS (HW_HOTSPOT_PASSWORD or edit pi/start-hotspot.sh)"
echo "Admin (phone)    : http://10.42.0.1:4000   (login admin / see .env ADMIN_PASSWORD)"
echo "                   http://192.168.4.1:4000  (if using hostapd fallback)"
echo "Player (kiosk)   : http://127.0.0.1:4000/player/?v=1.6.1"
echo "Kiosk            : fullscreen Chromium + mouse cursor hidden (unclutter)"
echo "Data             : $DATA_DIR"
echo "Display          : never-sleep enabled (blanking/DPMS/suspend off) — reboot to apply fully"
echo
echo "Useful commands:"
echo "  sudo systemctl status hw-signage"
echo "  sudo systemctl restart hw-signage"
echo "  sudo journalctl -u hw-signage -f"
echo "  sudo bash $INSTALL_DIR/pi/start-hotspot.sh"
echo "  sudo bash $INSTALL_DIR/pi/disable-sleep.sh"
echo
echo "Reboot recommended: sudo reboot"
