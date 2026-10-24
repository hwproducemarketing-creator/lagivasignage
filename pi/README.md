# Raspberry Pi local mode (no Railway / no cloud)

Run the entire H&W Produce signage stack **on a Raspberry Pi** at the store:

- Node + SQLite + uploads on Pi disk  
- Pi creates a Wi‑Fi **hotspot** for staff phones  
- On boot: hotspot → signage server → Chromium kiosk on the local player  

Railway deploy is unchanged. Use this guide only for standalone Pi installs.

---

## Defaults (change after install)

| Item | Default | Notes |
|------|---------|--------|
| Hotspot SSID | `HW-Signage` | Edit `HW_HOTSPOT_SSID` or `pi/start-hotspot.sh` |
| Hotspot password | `hwproduce` | **Change this** — store Wi‑Fi is open to anyone nearby |
| Admin URL (phone) | `http://10.42.0.1:4000` | NetworkManager hotspot gateway |
| Alt admin URL | `http://192.168.4.1:4000` | hostapd-style fallback |
| Player (on Pi) | `http://127.0.0.1:4000/player/?v=1.6.0` | Kiosk uses localhost |
| Admin login | `admin` / `changeme` | Set in `.env` (`ADMIN_PASSWORD`) |
| Data folder | `/home/<user>/hw-signage-data` | SQLite + uploads |

---

## Staff day-to-day

1. On your phone, join Wi‑Fi **`HW-Signage`** / password **`hwproduce`** (or your changed password).  
2. Open Chrome/Safari → **`http://10.42.0.1:4000`**  
3. Log in → upload / publish (same admin as always).  
4. The Pi screen already shows the player on localhost — no pairing to Railway needed for local mode.  
   (Optional: register a local “screen” via pairing if you use the Screens page; the kiosk player still works with publish-to-all content.)

---

## Hardware

- Raspberry Pi 4 or 5 recommended (2 GB+ RAM)  
- Official power supply  
- MicroSD 32 GB+ (A2 recommended)  
- HDMI display / TV  
- Built-in Wi‑Fi (or USB Wi‑Fi that supports AP mode)

---

## 1. Flash Raspberry Pi OS

1. Use [Raspberry Pi Imager](https://www.raspberrypi.com/software/).  
2. Choose **Raspberry Pi OS (64-bit)** with desktop — **Bookworm**.  
3. In Imager settings: enable SSH, set username/password, optional Wi‑Fi for first-time setup.  
4. Flash, insert SD, boot, finish first-run wizard.  
5. Prefer **boot to desktop** (needed for Chromium kiosk).

Update once while the Pi can reach the internet:

```bash
sudo apt update && sudo apt full-upgrade -y
sudo reboot
```

---

## 2. Get this repo onto the Pi

**Option A — git clone (needs temporary internet):**

```bash
cd ~
git clone https://github.com/hwproducemarketing-creator/lagivasignage.git
cd lagivasignage
```

**Option B — copy from a USB stick:**

```bash
# on the Pi, after mounting the USB
cp -a /media/$USER/USBNAME/lagivasignage ~/lagivasignage
cd ~/lagivasignage
```

---

## 3. Run setup

```bash
cd ~/lagivasignage
sudo bash pi/setup.sh
sudo reboot
```

`setup.sh` is idempotent. It will:

1. Install Node 20, Chromium, NetworkManager, unclutter, curl, x11-xserver-utils  
2. `npm install` + `npm run build`  
3. Create `~/hw-signage-data` and root `.env` (`DATA_DIR`, `COOKIE_SECURE=false`, CORS for hotspot IPs)  
4. Enable systemd units:  
   - `hw-signage` — Express server  
   - `hw-signage-hotspot` — Wi‑Fi AP  
   - `hw-signage-kiosk` — Chromium fullscreen player  
5. **Never-sleep** — disable screen blanking, DPMS, and system suspend  
6. Add desktop autostart for the kiosk + nosleep  

---

## 4. After reboot — what should happen

1. **Hotspot** `HW-Signage` appears.  
2. **Server** listens on `0.0.0.0:4000` (health: `http://127.0.0.1:4000/api/health`).  
3. **Chromium** opens kiosk to `http://127.0.0.1:4000/player/?v=1.6.0`.  
4. Phone on hotspot can open admin at `http://10.42.0.1:4000`.  
5. **Display stays on** — no screensaver / sleep until you power off the Pi.

Check status:

```bash
sudo systemctl status hw-signage hw-signage-hotspot hw-signage-kiosk
curl -s http://127.0.0.1:4000/api/health
```

---

## Never sleep (display always on)

The TV/HDMI output must not blank overnight. `setup.sh` runs `pi/disable-sleep.sh`, which:

| Layer | What is disabled |
|-------|------------------|
| **raspi-config** | Screen blanking → No |
| **systemd** | `sleep` / `suspend` / `hibernate` / `hybrid-sleep` targets **masked** |
| **logind** | `IdleAction=ignore` (no idle suspend) |
| **X11** | `xset s off`, `xset -dpms`, `xset s noblank` + Xorg BlankTime=0 |
| **Wayfire / labwc** | `dpms_timeout = -1`; kill `swayidle` on labwc autostart |
| **Chromium** | `--disable-features=IdleDetection` |
| **Autostart** | Re-applies X11 nosleep on every desktop login |

Re-apply anytime:

```bash
sudo bash ~/lagivasignage/pi/disable-sleep.sh
sudo reboot
```

**Undo suspend masking later** (if you reuse the Pi as a normal desktop):

```bash
sudo systemctl unmask sleep.target suspend.target hibernate.target hybrid-sleep.target
```

---

## Change hotspot password / SSID

```bash
sudo nano /home/pi/lagivasignage/pi/start-hotspot.sh
# or one-shot:
sudo HW_HOTSPOT_SSID='HW-Signage' HW_HOTSPOT_PASSWORD='YourStrongPass' \
  bash /home/pi/lagivasignage/pi/start-hotspot.sh
```

Then:

```bash
sudo systemctl restart hw-signage-hotspot
```

---

## Change admin password

```bash
sudo nano ~/lagivasignage/.env   # ADMIN_PASSWORD=...
# Password is only seeded on first boot — after that use Settings → change password in the admin UI
sudo systemctl restart hw-signage
```

---

## Offline / no internet

- Server and player run **locally** — no Railway required after setup.  
- Once media has been published while the phone was connected, the player caches files on the Pi (see player offline mode).  
- Hotspot does **not** need upstream internet for admin ↔ Pi.

---

## Packages (reference)

| Package | Why |
|---------|-----|
| `nodejs` 20+ | Signage server |
| `network-manager` + `nmcli` | Hotspot (`wifi hotspot`) |
| `chromium` / `chromium-browser` | Kiosk player |
| `unclutter` | Hide mouse cursor |
| `x11-xserver-utils` | `xset` to disable DPMS / blanking |
| `curl` | Health wait in `kiosk.sh` |

### hostapd fallback (if nmcli hotspot fails)

Bookworm usually works with NetworkManager. If your dongle cannot AP via nmcli, install `hostapd` + `dnsmasq`, static IP `192.168.4.1` on `wlan0`, and point staff to `http://192.168.4.1:4000`. Keep `CORS_ORIGIN` including that URL (already in the generated `.env`).

---

## Updating the app later

```bash
cd ~/lagivasignage
git pull   # or copy new files
npm install
npm run build
sudo systemctl restart hw-signage
# Hard-refresh kiosk if needed:
sudo systemctl restart hw-signage-kiosk
```

---

## Uninstall / disable

```bash
sudo systemctl disable --now hw-signage hw-signage-hotspot hw-signage-kiosk
sudo rm -f /etc/systemd/system/hw-signage*.service
sudo systemctl daemon-reload
```

Data remains in `~/hw-signage-data` until you delete it.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Phone can’t open admin | Confirm hotspot SSID; try `http://10.42.0.1:4000` and `http://192.168.4.1:4000` |
| Login cookie fails | Ensure `.env` has `COOKIE_SECURE=false` |
| Black kiosk / no browser | `echo $DISPLAY`; run `pi/kiosk.sh` manually on the desktop; check `journalctl -u hw-signage-kiosk` |
| Server won’t start | `journalctl -u hw-signage -e`; confirm `npm run build` produced `admin/dist` |
| Hotspot won’t start | `sudo bash pi/start-hotspot.sh`; check Wi‑Fi not blocked: `rfkill unblock wifi` |
| `better-sqlite3` build errors | `sudo apt install -y build-essential python3` then `npm rebuild` |

---

## Security notes

- Default hotspot password **`hwproduce`** is for easy store setup only — **change it**.  
- Change **`ADMIN_PASSWORD`** / use Settings to set a strong password.  
- Hotspot has no internet by default; treat it as a local store LAN.  
- Physical access to the Pi = access to the database under `DATA_DIR`.
