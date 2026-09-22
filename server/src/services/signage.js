import { db } from '../db.js';
import { logActivity } from './activity.js';

export function publishMedia(mediaId, actor = 'Admin') {
  const media = db.prepare('SELECT * FROM media WHERE id = ?').get(mediaId);
  if (!media) {
    return { ok: false, error: 'Media not found' };
  }

  const current = db.prepare('SELECT version FROM signage_state WHERE id = 1').get();
  const nextVersion = (current?.version || 0) + 1;
  const updatedAt = new Date().toISOString();

  db.prepare(
    `UPDATE signage_state SET version = ?, media_id = ?, updated_at = ? WHERE id = 1`
  ).run(nextVersion, mediaId, updatedAt);

  db.prepare(
    `INSERT INTO settings (key, value) VALUES ('last_resolved_media_id', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(String(mediaId));

  logActivity('publish', `${actor} published: ${media.original_name}`, {
    mediaId,
    version: nextVersion,
  });

  return {
    ok: true,
    version: nextVersion,
    updatedAt,
    media,
  };
}

export function setDefaultMedia(mediaId) {
  const media = db.prepare('SELECT * FROM media WHERE id = ?').get(mediaId);
  if (!media) {
    return { ok: false, error: 'Media not found' };
  }
  db.prepare('UPDATE media SET is_default = 0').run();
  db.prepare('UPDATE media SET is_default = 1 WHERE id = ?').run(mediaId);
  db.prepare(
    `INSERT INTO settings (key, value) VALUES ('default_media_id', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(String(mediaId));
  return { ok: true, media };
}

export function resolveCurrentContent() {
  const now = new Date().toISOString();

  const scheduled = db
    .prepare(
      `SELECT s.*, m.filename, m.original_name, m.mime_type, m.type, m.path
       FROM schedules s
       JOIN media m ON m.id = s.media_id
       WHERE s.active = 1
         AND s.start_at <= ?
         AND s.end_at >= ?
       ORDER BY s.id DESC
       LIMIT 1`
    )
    .get(now, now);

  if (scheduled) {
    const state = db.prepare('SELECT version, updated_at FROM signage_state WHERE id = 1').get();
    return finalizeResolved({
      version: state.version,
      type: scheduled.type,
      url: `/uploads/${scheduled.filename}`,
      updatedAt: state.updated_at,
      filename: scheduled.original_name,
      mediaId: scheduled.media_id,
      source: 'schedule',
      scheduleId: scheduled.id,
    });
  }

  const state = db
    .prepare(
      `SELECT ss.version, ss.updated_at, ss.media_id,
              m.filename, m.original_name, m.mime_type, m.type
       FROM signage_state ss
       LEFT JOIN media m ON m.id = ss.media_id
       WHERE ss.id = 1`
    )
    .get();

  if (state?.media_id && state.filename) {
    return finalizeResolved({
      version: state.version,
      type: state.type,
      url: `/uploads/${state.filename}`,
      updatedAt: state.updated_at,
      filename: state.original_name,
      mediaId: state.media_id,
      source: 'published',
    });
  }

  const defaultSetting = db
    .prepare(`SELECT value FROM settings WHERE key = 'default_media_id'`)
    .get();
  let defaultMedia = null;
  if (defaultSetting?.value) {
    defaultMedia = db.prepare('SELECT * FROM media WHERE id = ?').get(Number(defaultSetting.value));
  }
  if (!defaultMedia) {
    defaultMedia = db.prepare('SELECT * FROM media WHERE is_default = 1 LIMIT 1').get();
  }

  if (defaultMedia) {
    return finalizeResolved({
      version: state?.version || 0,
      type: defaultMedia.type,
      url: `/uploads/${defaultMedia.filename}`,
      updatedAt: state?.updated_at || null,
      filename: defaultMedia.original_name,
      mediaId: defaultMedia.id,
      source: 'default',
    });
  }

  return finalizeResolved({
    version: state?.version || 0,
    type: null,
    url: null,
    updatedAt: state?.updated_at || null,
    filename: null,
    mediaId: null,
    source: 'none',
  });
}

function finalizeResolved(content) {
  const prev = db.prepare(`SELECT value FROM settings WHERE key = 'last_resolved_media_id'`).get();
  const prevId = prev?.value ?? '';
  const nextId = content.mediaId != null ? String(content.mediaId) : '';
  if (prevId !== nextId) {
    const current = db.prepare('SELECT version FROM signage_state WHERE id = 1').get();
    const nextVersion = (current?.version || 0) + 1;
    const updatedAt = new Date().toISOString();
    db.prepare(`UPDATE signage_state SET version = ?, updated_at = ? WHERE id = 1`).run(
      nextVersion,
      updatedAt
    );
    db.prepare(
      `INSERT INTO settings (key, value) VALUES ('last_resolved_media_id', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).run(nextId);
    content.version = nextVersion;
    content.updatedAt = updatedAt;
  } else {
    const state = db.prepare('SELECT version, updated_at FROM signage_state WHERE id = 1').get();
    content.version = state?.version || content.version;
    content.updatedAt = state?.updated_at || content.updatedAt;
  }
  return content;
}

export function bumpVersionForScheduleChange() {
  const current = db.prepare('SELECT version FROM signage_state WHERE id = 1').get();
  const nextVersion = (current?.version || 0) + 1;
  const updatedAt = new Date().toISOString();
  db.prepare(`UPDATE signage_state SET version = ?, updated_at = ? WHERE id = 1`).run(
    nextVersion,
    updatedAt
  );
  return { version: nextVersion, updatedAt };
}
