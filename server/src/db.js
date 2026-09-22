import Database from 'better-sqlite3';
import bcrypt from 'bcrypt';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

// Railway: mount a volume at /data and set DATA_DIR=/data so DB + uploads persist.
const dataRoot = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : rootDir;
const dbDir = path.join(dataRoot, 'database');
const uploadsDir = path.join(dataRoot, 'uploads');

fs.mkdirSync(dbDir, { recursive: true });
fs.mkdirSync(uploadsDir, { recursive: true });

const dbPath = path.join(dbDir, 'signage.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT UNIQUE,
      name TEXT,
      pairing_code TEXT UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending',
      current_version INTEGER DEFAULT 0,
      last_seen TEXT,
      app_version TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS media (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      type TEXT NOT NULL,
      size INTEGER NOT NULL,
      width INTEGER,
      height INTEGER,
      path TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS signage_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      version INTEGER NOT NULL DEFAULT 0,
      media_id INTEGER,
      updated_at TEXT,
      FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS playlists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS playlist_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      playlist_id INTEGER NOT NULL,
      media_id INTEGER NOT NULL,
      order_index INTEGER NOT NULL DEFAULT 0,
      duration_sec INTEGER NOT NULL DEFAULT 10,
      FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
      FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS promotions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_name TEXT NOT NULL,
      price TEXT NOT NULL,
      unit TEXT,
      description TEXT,
      image_media_id INTEGER,
      generated_media_id INTEGER,
      start_at TEXT,
      end_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (image_media_id) REFERENCES media(id) ON DELETE SET NULL,
      FOREIGN KEY (generated_media_id) REFERENCES media(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      media_id INTEGER NOT NULL,
      start_at TEXT NOT NULL,
      end_at TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      message TEXT NOT NULL,
      meta_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      sid TEXT PRIMARY KEY,
      sess TEXT NOT NULL,
      expire INTEGER NOT NULL
    );
  `);

  // Migrate older session schema if needed
  const sessionInfo = db.prepare(`PRAGMA table_info(sessions)`).all();
  const hasExpire = sessionInfo.some((c) => c.name === 'expire');
  const hasExpired = sessionInfo.some((c) => c.name === 'expired');
  if (hasExpired && !hasExpire) {
    db.exec(`DROP TABLE sessions;
      CREATE TABLE sessions (
        sid TEXT PRIMARY KEY,
        sess TEXT NOT NULL,
        expire INTEGER NOT NULL
      );`);
  }

  // Add playlist columns to signage_state if missing
  const stateCols = db.prepare(`PRAGMA table_info(signage_state)`).all();
  if (!stateCols.some((c) => c.name === 'published_type')) {
    db.exec(`ALTER TABLE signage_state ADD COLUMN published_type TEXT NOT NULL DEFAULT 'single'`);
  }
  if (!stateCols.some((c) => c.name === 'playlist_id')) {
    db.exec(`ALTER TABLE signage_state ADD COLUMN playlist_id INTEGER`);
  }

  const state = db.prepare('SELECT id FROM signage_state WHERE id = 1').get();
  if (!state) {
    db.prepare(
      `INSERT INTO signage_state (id, version, media_id, playlist_id, published_type, updated_at)
       VALUES (1, 0, NULL, NULL, 'single', NULL)`
    ).run();
  }

  const business = db.prepare(`SELECT value FROM settings WHERE key = 'business_name'`).get();
  if (!business) {
    db.prepare(`INSERT INTO settings (key, value) VALUES ('business_name', ?)`).run('H&W Produce');
  }

  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'changeme';
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (!existing) {
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, hash);
    console.log(`Seeded admin user: ${username}`);
  }

  return db;
}

export { db, uploadsDir, rootDir, dbPath };
