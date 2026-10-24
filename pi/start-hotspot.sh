#!/usr/bin/env bash
# Create / bring up the H&W Signage WiFi access point.
# Defaults (CHANGE PASSWORD after install — see pi/README.md):
#   SSID:     HW-Signage
#   Password: hwproduce
# NetworkManager hotspot gateway is usually http://10.42.0.1:4000

set -euo pipefail

SSID="${HW_HOTSPOT_SSID:-HW-Signage}"
PASSWORD="${HW_HOTSPOT_PASSWORD:-hwproduce}"
CONN_NAME="${HW_HOTSPOT_CONN:-HW-Signage-Hotspot}"
IFACE="${HW_HOTSPOT_IFACE:-}"

log() { echo "[hw-hotspot] $*"; }

if ! command -v nmcli >/dev/null 2>&1; then
  log "ERROR: nmcli not found. Install NetworkManager (Raspberry Pi OS Bookworm default)."
  log "Fallback: configure hostapd/dnsmasq manually — see pi/README.md"
  exit 1
fi

# Prefer wlan0; allow override
if [[ -z "$IFACE" ]]; then
  if nmcli -t -f DEVICE,TYPE device status | grep -q '^wlan0:wifi'; then
    IFACE=wlan0
  else
    IFACE="$(nmcli -t -f DEVICE,TYPE device status | awk -F: '$2=="wifi"{print $1; exit}')"
  fi
fi

if [[ -z "$IFACE" ]]; then
  log "ERROR: no WiFi interface found"
  exit 1
fi

log "Interface=$IFACE SSID=$SSID"

# Unblock rfkill if needed
rfkill unblock wifi 2>/dev/null || true

# Re-create connection so SSID/password changes apply
if nmcli -t -f NAME connection show | grep -qx "$CONN_NAME"; then
  log "Removing old connection $CONN_NAME"
  nmcli connection delete "$CONN_NAME" >/dev/null 2>&1 || true
fi

log "Starting hotspot…"
nmcli device wifi hotspot ifname "$IFACE" con-name "$CONN_NAME" ssid "$SSID" password "$PASSWORD"

# Prefer autoconnect on boot
nmcli connection modify "$CONN_NAME" connection.autoconnect yes 2>/dev/null || true

IP="$(nmcli -g IP4.ADDRESS connection show "$CONN_NAME" 2>/dev/null | head -1 | cut -d/ -f1 || true)"
if [[ -z "$IP" ]]; then
  IP="10.42.0.1"
fi

log "Hotspot up. Staff admin URL: http://${IP}:4000"
log "SSID=$SSID  (change password with HW_HOTSPOT_PASSWORD or edit this script)"
exit 0
