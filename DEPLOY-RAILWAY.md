# Deploy checklist for Railway + Fire TV (store)

Production URL:
https://heroic-acceptance-production-433e.up.railway.app

## A. Railway settings (REQUIRED for screens to survive)

**Root cause of “screens disappear after reload/restart”:** SQLite lives on the container disk unless you mount a volume. Redeploys and restarts wipe `/app` — including `server/database/signage.db` — so registered devices vanish and everyone must pair again.

### Fix: persistent volume + DATA_DIR

1. Railway project → your service → **Settings** → **Volumes** → **Add Volume**
2. **Mount path:** `/data` (exact)
3. **Variables** (Settings → Variables):

```text
NODE_ENV=production
DATA_DIR=/data
SESSION_SECRET=<long random string>
ADMIN_USERNAME=admin
ADMIN_PASSWORD=<strong password>
CORS_ORIGIN=https://heroic-acceptance-production-433e.up.railway.app
```

4. **Redeploy** after adding the volume / `DATA_DIR` (first time only — existing in-container DB will not migrate; re-pair once)
5. Verify persistence:

```text
https://heroic-acceptance-production-433e.up.railway.app/api/health
```

Expect JSON like:

```json
{
  "ok": true,
  "dataDir": "/data",
  "dbPath": "/data/database/signage.db",
  "dataDirEnv": "/data",
  "usingPersistentVolume": true,
  "devices": { "total": 1, "registered": 1 }
}
```

If `usingPersistentVolume` is `false` or `dbPath` is under `/app`, screens will keep vanishing.

6. Admin: https://heroic-acceptance-production-433e.up.railway.app
7. Health: https://heroic-acceptance-production-433e.up.railway.app/api/health

## B. TV display options

### Option 1 — Web player (recommended for Vega OS / browser TVs)

Open on the TV browser (or bookmark / home screen shortcut):

**https://heroic-acceptance-production-433e.up.railway.app/player**

1. Right-side strip always shows the device code (`XXXX-XXXX`) — no mouse needed
2. Phone admin → Screens → Add Screen → enter code
3. Publish content → TV updates automatically
4. Pairing is remembered across the 60s anti-sleep reload (localStorage + cookie)
5. Tap once for fullscreen; tap 3× for debug / Reset pairing

Works with store Wi‑Fi. No APK required.

### Option 2 — Android / Fire OS APK

`firetv/local.properties`:

```properties
SERVER_URL=https://heroic-acceptance-production-433e.up.railway.app
```

1. Open `firetv/` in Android Studio
2. Build → Build APK(s)
3. `adb install -r app-debug.apk`
4. Pair device code in admin → Screens → Add Screen

## C. Day-to-day

Phone → https://heroic-acceptance-production-433e.up.railway.app → upload/publish  
No laptop required.

After Railway volume is mounted, registered screens stay in **Screens** across admin reloads and deploys.
