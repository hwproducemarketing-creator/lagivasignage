# Deploy checklist for Railway + Fire TV (store)

Production URL:
https://heroic-acceptance-production-433e.up.railway.app

## A. Railway settings

1. Volume mount: `/data`
2. Variables:
   - NODE_ENV=production
   - DATA_DIR=/data
   - SESSION_SECRET=...
   - ADMIN_USERNAME=admin
   - ADMIN_PASSWORD=...
   - CORS_ORIGIN=https://heroic-acceptance-production-433e.up.railway.app
3. Admin: https://heroic-acceptance-production-433e.up.railway.app
4. Health: https://heroic-acceptance-production-433e.up.railway.app/api/health

## B. TV display options

### Option 1 — Web player (recommended for Vega OS / browser TVs)

Open on the TV browser (or bookmark / home screen shortcut):

**https://heroic-acceptance-production-433e.up.railway.app/player**

1. TV shows a device code (`XXXX-XXXX`)
2. Phone admin → Screens → Add Screen → enter code
3. Publish content → TV updates automatically
4. Tap once for fullscreen; tap 3× for debug

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
