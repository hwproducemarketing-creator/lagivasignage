# H&W Produce — Raspberry Pi setup (local, no Railway)

Run the whole signage system **on a Raspberry Pi** at the store:

- Node server + SQLite + media files on the Pi’s SD card  
- Pi creates a Wi‑Fi **hotspot** so staff phones can manage content  
- On every boot: hotspot → signage server → Chromium fullscreen player  

**No cloud / Railway required** after setup. Railway deploy is separate and unchanged.

---

## What you need

### Hardware

| Item | Recommendation |
|------|----------------|
| Raspberry Pi | **Pi 4 or Pi 5**, 2 GB+ RAM |
| Power | Official Raspberry Pi power supply |
| Storage | MicroSD **32 GB+** (A2 recommended) |
| Display | HDMI TV / monitor (1080p is fine) |
| Wi‑Fi | Built-in Wi‑Fi (or USB adapter that supports **AP / hotspot** mode) |
| Phone | Any phone with Wi‑Fi (for admin) |

### Software

| Item | Detail |
|------|--------|
| OS | **Raspberry Pi OS (64-bit) with desktop**, Bookworm |
| Tools on your PC | [Raspberry Pi Imager](https://www.raspberrypi.com/software/) |
| During setup only | Temporary internet on the Pi (Wi‑Fi or Ethernet) for `apt` / `npm` |

---

## Defaults (change after install)

| Item | Default | Notes |
|------|---------|--------|
| Hotspot SSID | `HW-Signage` | Set via `HW_HOTSPOT_SSID` or edit `pi/start-hotspot.sh` |
| Hotspot password | `hwproduce` | **Change this** — nearby phones can join |
| Admin URL (phone) | `http://10.42.0.1:4000` | NetworkManager hotspot gateway |
| Alt admin URL | `http://192.168.4.1:4000` | hostapd-style fallback |
| Player (on Pi) | `http://127.0.0.1:4000/player/?v=1.6.1` | Fullscreen kiosk, no mouse |
| Admin login | `admin` / `changeme` | From `.env` (`ADMIN_USERNAME` / `ADMIN_PASSWORD`) |
| Data folder | `/home/<your-user>/hw-signage-data` | SQLite + uploads |

> Your Linux username may **not** be `pi` (Imager lets you choose it). Below, replace `pi` with the username you set.

---

## Step 1 — Flash Raspberry Pi OS

1. On a PC, open [Raspberry Pi Imager](https://www.raspberrypi.com/software/).  
2. **Choose device** → your Pi model.  
3. **Choose OS** → **Raspberry Pi OS (64-bit)** (Desktop / Bookworm).  
4. Click the gear / OS customisation:
   - Set **username** and **password** (remember these).  
   - Enable **SSH** (password auth is fine).  
   - Optional: enter home/store Wi‑Fi so the Pi gets internet on first boot.  
5. Flash the microSD, insert it in the Pi, connect HDMI + power, boot.  
6. Finish the first-run wizard.  
7. Prefer **boot to desktop** (Chromium kiosk needs a graphical session). Setup will also try to set this automatically.

While the Pi still has internet, update packages once:

```bash
sudo apt update && sudo apt full-upgrade -y
sudo reboot
```

### Optional — SSH from another computer

If you enabled SSH in Imager (same Wi‑Fi as the Pi):

```bash
ssh yourusername@raspberrypi.local
# or use the Pi’s IP address from your router
```

You can also plug a keyboard into the Pi and use the Terminal app on the desktop.

---

## Step 2 — Get the code onto the Pi

The Pi still needs **internet** for this step (clone + later `npm install`).

**Option A — git clone (recommended):**

```bash
cd ~
git clone https://github.com/hwproducemarketing-creator/lagivasignage.git
cd lagivasignage
```

**Option B — USB stick:** copy the `lagivasignage` folder onto a USB drive on your PC, plug into the Pi, then:

```bash
# after the USB mounts (name varies)
cp -a /media/$USER/USBNAME/lagivasignage ~/lagivasignage
cd ~/lagivasignage
```

---

## Step 3 — Run setup

From the repo folder:

```bash
cd ~/lagivasignage
sudo bash pi/setup.sh
```

This takes several minutes. It will:

1. Install Node 20, Chromium, NetworkManager, unclutter (+ unclutter-xfixes if available), curl, x11-xserver-utils  
2. `npm install` + `npm run build`  
3. Create `~/hw-signage-data` and a root `.env` (`DATA_DIR`, `COOKIE_SECURE=false`, CORS for hotspot IPs)  
4. Enable systemd units:  
   - `hw-signage` — Express server  
   - `hw-signage-hotspot` — Wi‑Fi AP  
   - `hw-signage-kiosk` — Chromium **fullscreen** player (no mouse)  
5. **Never-sleep** — disable screen blanking, DPMS, and system suspend  
6. Add desktop autostart for the kiosk + nosleep  


When it finishes, reboot:

```bash
sudo reboot
```

`setup.sh` is safe to run again later (idempotent).

---

## Step 4 — After reboot (what should happen automatically)

1. Desktop logs in.  
2. Wi‑Fi hotspot **`HW-Signage`** appears (password **`hwproduce`** until you change it).  
3. Signage server listens on port **4000**.  
4. Chromium opens **true fullscreen kiosk** to the local player:  
   `http://127.0.0.1:4000/player/?v=1.6.1`  
5. The **mouse cursor is hidden** (`unclutter` / `unclutter-xfixes`).  
6. The HDMI display **stays on** (no screensaver / sleep) until you power off the Pi.

Quick checks on the Pi (keyboard or SSH):

```bash
sudo systemctl status hw-signage hw-signage-hotspot hw-signage-kiosk
curl -s http://127.0.0.1:4000/api/health
```

You want the three services **active** and health returning JSON (not an error).

---

## Step 5 — Connect your phone and open admin

1. On your phone, open Wi‑Fi settings.  
2. Join **`HW-Signage`**.  
3. Password: **`hwproduce`** (or the new password if you already changed it).  
4. Open Chrome or Safari and go to:  
   **`http://10.42.0.1:4000`**  
5. Log in:  
   - Username: **`admin`**  
   - Password: **`changeme`** (until you change it)

If that URL fails, try: **`http://192.168.4.1:4000`**.

> The phone does **not** need internet. Admin talks only to the Pi over the hotspot.

---

## Step 6 — Pair the screen and publish first content

### A. Pair the TV (optional but recommended)

The kiosk player shows a **DEVICE CODE** strip (format like `XXXX-XXXX`) when it is waiting / unpaired.

1. On the phone admin, open **Screens**.  
2. Tap **Add Screen**.  
3. Enter the code from the TV strip (with or without the dash).  
4. Give it a name (e.g. `Front counter`) and save.

After pairing, the strip goes away when content is playing. You can still publish without pairing; pairing mainly helps you track the screen in **Screens**.

### B. Publish first content

1. Open **Content** (library).  
2. Upload an image or MP4 (keep files reasonable — default max upload is **100 MB**).  
3. Use **Publish** on that item (or build a **Playlist** / **Promotion** and publish from there).  
4. Wait a few seconds — the Pi player polls and should start showing the new content.

Tips:

- Prefer **Wi‑Fi already on the hotspot** while uploading so the big file lands on the Pi.  
- After content has played once, the player caches media for offline use if the phone disconnects later.

---

## Step 7 — Change hotspot password & admin password

### Hotspot password / SSID

One-shot (recommended):

```bash
sudo HW_HOTSPOT_SSID='HW-Signage' HW_HOTSPOT_PASSWORD='YourStrongPass' \
  bash ~/lagivasignage/pi/start-hotspot.sh
sudo systemctl restart hw-signage-hotspot
```

Or edit the defaults in `pi/start-hotspot.sh` (`HW-Signage` / `hwproduce`), then:

```bash
sudo systemctl restart hw-signage-hotspot
```

Rejoin the Wi‑Fi on your phone with the new password.

### Admin password

**After first boot**, the password in the database is already seeded. Prefer:

1. Phone → admin → **Settings** → change password there.

To set the **initial** seed password before first start (or if you recreate `.env` carefully):

```bash
nano ~/lagivasignage/.env
# set ADMIN_PASSWORD=...
```

`ADMIN_PASSWORD` in `.env` is only used when the admin user is **first created**. Changing `.env` later does **not** override an existing admin password — use Settings (or recreate the data dir, which wipes content).

Restart after `.env` edits if needed:

```bash
sudo systemctl restart hw-signage
```

---

## Fullscreen + no mouse cursor

The store TV should look like a dedicated sign, not a desktop:

| Piece | Behavior |
|-------|----------|
| **`pi/kiosk.sh`** | Chromium `--kiosk --start-fullscreen` (no window chrome) |
| **Profile** | Persistent `~/.config/hw-signage-chromium` so offline media cache survives reboots (**not** incognito) |
| **Cursor** | `unclutter -idle 0 -root` (or `unclutter-xfixes`) started before Chromium |
| **Health wait** | Waits for `http://127.0.0.1:4000/api/health` before launching |
| **Player CSS** | `cursor: none` on the page; JS also requests fullscreen on boot as a backup |
| **Autostart** | systemd `hw-signage-kiosk` + desktop `.desktop` autostart |

If you ever see a mouse pointer again:

```bash
sudo apt install -y unclutter
sudo systemctl restart hw-signage-kiosk
# or from the desktop:
bash ~/lagivasignage/pi/kiosk.sh
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

## Staff day-to-day

1. Join Wi‑Fi **`HW-Signage`** (your password).  
2. Open **`http://10.42.0.1:4000`**.  
3. Log in → upload / publish.  
4. The Pi TV already runs the local player — no Railway pairing.

---

## Offline / no internet

- After setup, the store can run with **no upstream internet**.  
- Hotspot is a local LAN between phone ↔ Pi.  
- Once media was published while the phone was connected, the player can keep showing cached files.

---

## Updating the app later

```bash
cd ~/lagivasignage
git pull
npm install
npm run build
sudo systemctl restart hw-signage
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

| Problem | What to try |
|---------|-------------|
| **No hotspot** | `sudo bash ~/lagivasignage/pi/start-hotspot.sh` · `rfkill unblock wifi` · `sudo systemctl status hw-signage-hotspot` · `sudo journalctl -u hw-signage-hotspot -e` |
| **Phone can’t open admin** | Confirm SSID `HW-Signage` · try `http://10.42.0.1:4000` and `http://192.168.4.1:4000` · stay on the hotspot (phone must not switch back to LTE-only for that page) |
| **Login cookie fails** | Ensure `.env` has `COOKIE_SECURE=false` · restart `sudo systemctl restart hw-signage` |
| **No kiosk / black screen** | Confirm desktop is logged in · `echo $DISPLAY` · run `bash ~/lagivasignage/pi/kiosk.sh` on the desktop · `sudo journalctl -u hw-signage-kiosk -e` · `sudo systemctl restart hw-signage-kiosk` |
| **Mouse cursor visible** | `sudo apt install -y unclutter` · `sudo systemctl restart hw-signage-kiosk` · confirm kiosk uses `--kiosk --start-fullscreen` |
| **Server not up** | `curl -s http://127.0.0.1:4000/api/health` · `sudo journalctl -u hw-signage -e` · confirm `npm run build` created `admin/dist` · `sudo systemctl restart hw-signage` |
| **`better-sqlite3` build errors** | `sudo apt install -y build-essential python3` then `cd ~/lagivasignage && npm rebuild` |
| **Screen goes black overnight** | `sudo bash ~/lagivasignage/pi/disable-sleep.sh` then `sudo reboot` |

### hostapd fallback (if nmcli hotspot fails)

Bookworm usually works with NetworkManager. If your dongle cannot AP via nmcli, install `hostapd` + `dnsmasq`, static IP `192.168.4.1` on `wlan0`, and point staff to `http://192.168.4.1:4000`. Keep `CORS_ORIGIN` including that URL (already in the generated `.env`).

---

## Packages (reference)

| Package | Why |
|---------|-----|
| `nodejs` 20+ | Signage server |
| `network-manager` + `nmcli` | Hotspot (`wifi hotspot`) |
| `chromium` / `chromium-browser` | Kiosk player |
| `unclutter` / `unclutter-xfixes` | Hide mouse cursor (always) |
| `x11-xserver-utils` | `xset` to disable DPMS / blanking |
| `curl` | Health wait in `kiosk.sh` |

---

## Security notes

- Default hotspot password **`hwproduce`** is for easy store setup only — **change it**.  
- Change the admin password in **Settings** (do not leave **`changeme`**).  
- Hotspot has no internet by default; treat it as a local store LAN.  
- Physical access to the Pi = access to the database under `DATA_DIR`.
