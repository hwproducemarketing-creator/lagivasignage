import './loadEnv.js';
import express from 'express';
import cors from 'cors';
import session from 'express-session';
import path from 'path';
import fs from 'fs';
import { createRequire } from 'module';
import {
  initDatabase,
  db,
  uploadsDir,
  rootDir,
  dbPath,
  dataDir,
  usingPersistentVolume,
} from './db.js';
import authRoutes from './routes/auth.js';
import mediaRoutes from './routes/media.js';
import screenRoutes from './routes/screen.js';
import adminRoutes from './routes/admin.js';
import devicesRoutes from './routes/devices.js';
import promotionsRoutes from './routes/promotions.js';
import schedulesRoutes from './routes/schedules.js';
import settingsRoutes from './routes/settings.js';
import activityRoutes from './routes/activity.js';
import playlistsRoutes from './routes/playlists.js';

const require = createRequire(import.meta.url);
const SqliteStoreFactory = require('better-sqlite3-session-store');
const SqliteStore = SqliteStoreFactory(session);

initDatabase();

const app = express();
const PORT = Number(process.env.PORT || 4000);
const isProd = process.env.NODE_ENV === 'production';
// Same-origin on Railway (admin served by Express). Override for local Vite if needed.
const corsOrigin = process.env.CORS_ORIGIN || (isProd ? true : 'http://localhost:5173');

app.set('trust proxy', 1);

app.use(
  cors({
    origin: corsOrigin === true ? true : String(corsOrigin).split(',').map((s) => s.trim()),
    credentials: true,
  })
);

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

app.use(
  session({
    store: new SqliteStore({
      client: db,
      expired: {
        clear: true,
        intervalMs: 15 * 60 * 1000,
      },
    }),
    secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      // Same site when admin + API share one Railway HTTPS URL
      sameSite: 'lax',
      secure: isProd,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  })
);

app.use('/uploads', express.static(uploadsDir));

app.get('/api/health', (_req, res) => {
  let devicesTotal = 0;
  let devicesRegistered = 0;
  try {
    devicesTotal = db.prepare('SELECT COUNT(*) AS c FROM devices').get().c;
    devicesRegistered = db
      .prepare(`SELECT COUNT(*) AS c FROM devices WHERE status = 'registered'`)
      .get().c;
  } catch (err) {
    console.warn('[hw-signage] health device count failed', err.message);
  }
  res.json({
    ok: true,
    service: 'hw-signage',
    dataDir,
    dbPath,
    dataDirEnv: process.env.DATA_DIR || null,
    usingPersistentVolume,
    devices: { total: devicesTotal, registered: devicesRegistered },
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/screen', screenRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/devices', devicesRoutes);
app.use('/api/promotions', promotionsRoutes);
app.use('/api/schedules', schedulesRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/activity', activityRoutes);
app.use('/api/playlists', playlistsRoutes);

// Web signage player (Vega OS / Fire TV browser / any TV browser)
const playerDir = path.join(rootDir, 'public', 'player');
app.use('/player', express.static(playerDir, { index: 'index.html' }));
app.get(['/player', '/player/'], (_req, res) => {
  res.sendFile(path.join(playerDir, 'index.html'));
});

const adminDist = path.join(rootDir, '..', 'admin', 'dist');
if (fs.existsSync(adminDist)) {
  app.use(express.static(adminDist));
  app.get('*', (req, res, next) => {
    if (
      req.path.startsWith('/api') ||
      req.path.startsWith('/uploads') ||
      req.path.startsWith('/player')
    ) {
      return next();
    }
    res.sendFile(path.join(adminDist, 'index.html'));
  });
}

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Server error' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`H&W Signage server listening on http://0.0.0.0:${PORT}`);
  console.log(`Database: ${dbPath}`);
  console.log(`Uploads: ${uploadsDir}`);
  console.log(`Admin dist: ${adminDist} (${fs.existsSync(adminDist) ? 'found' : 'missing'})`);
  if (isProd && !usingPersistentVolume) {
    console.warn(
      '[hw-signage] WARNING: DATA_DIR is not set. Screens, media, and settings will be wiped on every Railway restart/deploy. Mount a volume at /data and set DATA_DIR=/data.'
    );
  }
});
