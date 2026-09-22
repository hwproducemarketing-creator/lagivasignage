# H&W Produce Digital Signage

Simple digital signage for **H&W Produce Calgary**: upload or create content in a web admin dashboard, publish it, and an Amazon Fire TV Stick automatically displays the newest content fullscreen.

## Architecture

| App | Role |
|-----|------|
| `server/` | Express API + SQLite + file uploads |
| `admin/` | React admin dashboard (Vite + Tailwind) |
| `firetv/` | Kotlin Fire TV / Android TV player |

```text
Admin computer/phone
  → Login → Upload / Create promotion → Publish
  → Server (version++)
  → Fire TV polls every 10s → downloads → displays
```

Fire TV keeps a local cache. If the internet drops, the last content stays on screen (no error UI).

## Requirements

- Node.js 20+
- npm 9+
- Android Studio (for Fire TV APK)
- Fire TV Stick with **Apps from Unknown Sources** / ADB enabled for sideload

## Quick start (local)

### 1. Install

```bash
cd lagivasignage
cp .env.example .env
# optional: edit server/.env (already seeded for local use)
npm install
```

Default admin credentials (change in production):

- Username: `admin`
- Password: `changeme`

### 2. Start server + admin

```bash
npm run dev
```

- API / uploads: http://localhost:4000  
- Admin UI: http://localhost:5173  

Or separately:

```bash
npm run dev:server
npm run dev:admin
```

### 3. Production-style start

```bash
npm run build
npm start
```

Serves the built admin from the Express server (when `admin/dist` exists).

## Deploy on Railway (recommended — no laptop at the store)

Railway runs the API + admin dashboard 24/7 with HTTPS. Fire TVs and phones talk to your Railway URL.

### 1. Push this repo to GitHub

Create a GitHub repo and push `F:\lagivasignage` (or connect Railway to the local folder via Railway CLI).

### 2. Create the Railway project

1. Go to [https://railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo**
2. Select this repository
3. Railway will build using the included `Dockerfile`

### 3. Add a persistent volume (required)

Without a volume, uploads and the database reset on every deploy.

1. Open your Railway service → **Settings** → **Volumes** (or click **+ Volume**)
2. Mount path: `/data`
3. In **Variables**, set:

```text
DATA_DIR=/data
```

### 4. Set environment variables

In Railway → **Variables**:

| Variable | Example |
|----------|---------|
| `NODE_ENV` | `production` |
| `DATA_DIR` | `/data` |
| `SESSION_SECRET` | long random string |
| `ADMIN_USERNAME` | `admin` |
| `ADMIN_PASSWORD` | strong password (used only on **first** boot) |
| `CORS_ORIGIN` | `https://YOUR-APP.up.railway.app` |
| `MAX_UPLOAD_MB` | `100` |

`PORT` is set by Railway automatically — do not hardcode it.

### 5. Generate a public HTTPS URL

1. Railway service → **Settings** → **Networking** → **Generate Domain**
2. Copy the URL, e.g. `https://hw-signage-production-xxxx.up.railway.app`
3. Set `CORS_ORIGIN` to that exact URL (no trailing slash)
4. Redeploy if you changed variables after the first deploy

### 6. Open the admin dashboard

Visit your Railway URL in a browser (phone or computer):

- Login with `ADMIN_USERNAME` / `ADMIN_PASSWORD`
- Upload → Publish

Health check: `https://YOUR-APP.up.railway.app/api/health`

### 7. Point the Fire TV app at Railway

In `firetv/local.properties`:

```properties
sdk.dir=C:\\Users\\YOU\\AppData\\Local\\Android\\Sdk
SERVER_URL=https://YOUR-APP.up.railway.app
```

Rebuild the APK in Android Studio, then install on the Stick (store Wi‑Fi is fine — no PC server needed).

Pair: Fire TV shows device code → open admin on your phone → **Screens → Add Screen**.

### Railway notes

- Admin UI is served by the same Express app (`admin/dist` built in Docker).
- SQLite lives at `/data/database/signage.db`, uploads at `/data/uploads/`.
- Changing `ADMIN_PASSWORD` later does **not** update an existing user — change password in **Settings** in the dashboard.
- Free/trial plans may sleep; for a store TV use a paid hobby plan so the service stays awake.

## Environment variables

See [`.env.example`](.env.example):

| Variable | Purpose |
|----------|---------|
| `PORT` | Server port (default `4000`; Railway sets this) |
| `DATA_DIR` | Persistent data root (Railway: `/data`) |
| `SESSION_SECRET` | Session signing secret |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Seeded on first boot |
| `CORS_ORIGIN` | Admin origin(s), comma-separated |
| `MAX_UPLOAD_MB` | Upload limit (default `100`) |
| `NODE_ENV` | `development` or `production` |

**Local production notes**

- Prefer Railway (or similar) for the store; avoid leaving a laptop on.
- Data lives under `DATA_DIR` when set, otherwise `server/database/` and `server/uploads/`.
- Do not expose the SQLite file or `.env` publicly.

## Admin features

- **Login / Logout** — bcrypt passwords, session cookies
- **Dashboard** — screen counts, current preview, device online/offline, activity
- **Content** — drag-drop upload (JPG/PNG/WEBP/MP4), preview, publish confirm, delete, set default, schedule
- **Screens** — register Fire TV via device code, rename, status
- **Promotions** — 1920×1080 branded graphic generator → save / publish
- **Settings** — business name, default media, password change, schedule list

Online rule: last heartbeat younger than **90 seconds**.

## API (summary)

Public (Fire TV):

- `GET /api/screen/current`
- `POST /api/screen/heartbeat`
- `POST /api/devices/pairing-code`
- `GET /api/devices/pairing-status/:code`

Auth:

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`

Admin (session required):

- `GET/POST /api/media`, `POST /api/media/upload`, `DELETE /api/media/:id`
- `POST /api/admin/publish`, `GET /api/admin/status`
- `GET/POST /api/devices`, `POST /api/devices/register`, `PATCH /api/devices/:id`
- `GET/POST/DELETE /api/promotions`
- `GET/POST/DELETE /api/schedules`
- `GET/PUT /api/settings`
- `GET /api/activity`

## Web player (Vega OS / browser — no APK)

Fullscreen signage in any TV browser:

**https://lagivasignage-production.up.railway.app/player**

- Shows pairing code → register under Admin → Screens
- Polls every 10s, heartbeat every 30s
- Caches media offline in the browser
- Images + looping muted video
- Tap once for fullscreen; tap 3× for debug

Local: `http://localhost:4000/player` (with server running)

## Fire TV / Android APK

### Configure server URL

1. Copy `firetv/local.properties.example` → `firetv/local.properties`
2. Set your Android SDK path and server URL:

**Railway (store — recommended):**
```properties
SERVER_URL=https://lagivasignage-production.up.railway.app
```

**Local Wi‑Fi test only:**
```properties
SERVER_URL=http://192.168.1.50:4000
```

Use your PC’s LAN IP (not `localhost`) for local tests. Emulator can use `http://10.0.2.2:4000`.

### Build APK (Android Studio)

1. Open the `firetv/` folder in Android Studio.
2. Let Gradle sync.
3. **Build → Build Bundle(s) / APK(s) → Build APK(s)**.
4. APK path is typically:

`firetv/app/build/outputs/apk/debug/app-debug.apk`

### Install on Fire TV Stick

1. On Fire TV: **Settings → My Fire TV → Developer Options**  
   - Enable **ADB debugging**  
   - Enable **Apps from Unknown Sources** (as needed)
2. From your PC (same network):

```bash
adb connect FIRE_TV_IP:5555
adb install -r app-debug.apk
```

3. Launch **H&W Signage** from the Fire TV apps row.

### First-run pairing

1. Fire TV shows a **DEVICE CODE** (`XXXX-XXXX`).
2. In admin: **Screens → Add Screen** → enter code → name (e.g. `Main Store TV`) → Register.
3. App starts polling and heartbeating automatically.

### Player behavior

- Fullscreen, keep screen on, immersive UI
- Poll `/api/screen/current` every **10s**
- Heartbeat every **30s**
- Downloads new version safely (temp → verify → swap)
- Images: `fitCenter` (contain, no stretch)
- Videos: Media3 ExoPlayer, loop, muted, no controls
- Offline: keep last cache; if none → “Waiting for signage…”
- Auto-start on boot via `BOOT_COMPLETED` (as allowed by Fire OS)
- Debug overlay: press **Menu/Info** three times quickly

## End-to-end test checklist

1. Admin login works  
2. Upload JPG/PNG  
3. Publish → version increments  
4. `GET /api/screen/current` returns new URL  
5. Fire TV detects version and downloads  
6. TV shows new image  
7. Disconnect network → cached content remains  
8. Reconnect → auto resumes  
9. Publish again → TV updates  
10. Heartbeat shows Online on dashboard  
11. Stop app → Offline after ~90s  
12. Invalid file rejected  
13. Create promotion → preview → publish → TV shows it  

Automated API smoke (server must be running):

```bash
node scripts/smoke.mjs
```

## Project layout

```text
lagivasignage/
├── server/          # Express + SQLite
├── admin/           # React dashboard
├── firetv/          # Android / Fire TV app
├── scripts/smoke.mjs
├── .env.example
└── README.md
```

## License

Private — H&W Produce Calgary.
