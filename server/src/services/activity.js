import { db } from '../db.js';

export function logActivity(action, message, meta = null) {
  db.prepare(
    `INSERT INTO activity_logs (action, message, meta_json) VALUES (?, ?, ?)`
  ).run(action, message, meta ? JSON.stringify(meta) : null);
}

export function getRecentActivity(limit = 20) {
  return db
    .prepare(
      `SELECT id, action, message, meta_json, created_at
       FROM activity_logs
       ORDER BY id DESC
       LIMIT ?`
    )
    .all(limit)
    .map((row) => ({
      ...row,
      meta: row.meta_json ? JSON.parse(row.meta_json) : null,
      meta_json: undefined,
    }));
}
