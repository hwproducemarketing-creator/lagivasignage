# Deploy checklist for Railway + Fire TV (store)

## A. Deploy server (once)

1. Push code to GitHub
2. Railway → New Project → Deploy from GitHub
3. Add Volume mount `/data`
4. Variables:
   - NODE_ENV=production
   - DATA_DIR=/data
   - SESSION_SECRET=...
   - ADMIN_USERNAME=admin
   - ADMIN_PASSWORD=...
   - CORS_ORIGIN=https://YOUR-APP.up.railway.app
5. Generate public domain
6. Open URL → login → upload → publish

## B. Build Fire TV APK (once per SERVER_URL change)

1. firetv/local.properties:
   SERVER_URL=https://YOUR-APP.up.railway.app
2. Android Studio → Build APK
3. adb install on Fire Stick (any Wi‑Fi with internet)
4. Pair device code in admin Screens page

## C. Day-to-day at the store

- Phone browser → Railway admin URL → upload/publish
- No laptop required
- Fire Stick only needs internet to the Railway URL
