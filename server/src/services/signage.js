import { db } from '../db.js';
import { logActivity } from './activity.js';

function bumpVersion() {
  const current = db.prepare('SELECT version FROM signage_state WHERE id = 1').get();
  const nextVersion = (current?.version || 0) + 1;
  const updatedAt = new Date().toISOString();
  return { nextVersion, updatedAt };
}

function playlistItems(playlistId) {
  return db
    .prepare(
      `SELECT pi.id AS item_id, pi.order_index, pi.duration_sec,
              m.id AS media_id, m.filename, m.original_name, m.type, m.mime_type
       FROM playlist_items pi
       JOIN media m ON m.id = pi.media_id
       WHERE pi.playlist_id = ?
       ORDER BY pi.order_index ASC, pi.id ASC`
    )
    .all(playlistId)
    .map((row) => ({
      type: row.type,
      url: `/uploads/${row.filename}`,
      durationSec: Math.max(1, Number(row.duration_sec) || 10),
      filename: row.original_name,
      mediaId: row.media_id,
    }));
}

export function publishMedia(mediaId, actor = 'Admin') {
  const media = db.prepare('SELECT * FROM media WHERE id = ?').get(mediaId);
  if (!media) {
    return { ok: false, error: 'Media not found' };
  }

  const { nextVersion, updatedAt } = bumpVersion();

  db.prepare(
    `UPDATE signage_state
     SET version = ?, media_id = ?, playlist_id = NULL, published_type = 'single', updated_at = ?
     WHERE id = 1`
  ).run(nextVersion, mediaId, updatedAt);

  db.prepare(
    `INSERT INTO settings (key, value) VALUES ('last_resolved_media_id', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(`m:${mediaId}`);

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

export function publishPlaylist(playlistId, actor = 'Admin') {
  const playlist = db.prepare('SELECT * FROM playlists WHERE id = ?').get(playlistId);
  if (!playlist) {
    return { ok: false, error: 'Playlist not found' };
  }
  const items = playlistItems(playlistId);
  if (!items.length) {
    return { ok: false, error: 'Playlist has no items' };
  }

  const { nextVersion, updatedAt } = bumpVersion();

  db.prepare(
    `UPDATE signage_state
     SET version = ?, media_id = NULL, playlist_id = ?, published_type = 'playlist', updated_at = ?
     WHERE id = 1`
  ).run(nextVersion, playlistId, updatedAt);

  db.prepare(
    `INSERT INTO settings (key, value) VALUES ('last_resolved_media_id', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(`p:${playlistId}`);

  logActivity('publish', `${actor} published playlist: ${playlist.name}`, {
    playlistId,
    version: nextVersion,
    itemCount: items.length,
  });

  return {
    ok: true,
    version: nextVersion,
    updatedAt,
    playlist,
    items,
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

function asSingle(content) {
  return {
    mode: 'single',
    version: content.version,
    type: content.type,
    url: content.url,
    durationSec: null,
    updatedAt: content.updatedAt,
    filename: content.filename,
    mediaId: content.mediaId,
    playlistId: null,
    items: content.url
      ? [
          {
            type: content.type,
            url: content.url,
            durationSec: null,
            filename: content.filename,
          },
        ]
      : [],
    source: content.source,
    scheduleId: content.scheduleId,
  };
}

function asPlaylist(version, updatedAt, playlistId, items, source = 'published') {
  return {
    mode: 'playlist',
    version,
    type: items[0]?.type || null,
    url: items[0]?.url || null,
    durationSec: items[0]?.durationSec ?? null,
    updatedAt,
    filename: items[0]?.filename || null,
    mediaId: items[0]?.mediaId || null,
    playlistId,
    items,
    source,
  };
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
    return finalizeResolved(
      asSingle({
        version: state.version,
        type: scheduled.type,
        url: `/uploads/${scheduled.filename}`,
        updatedAt: state.updated_at,
        filename: scheduled.original_name,
        mediaId: scheduled.media_id,
        source: 'schedule',
        scheduleId: scheduled.id,
      })
    );
  }

  const state = db
    .prepare(
      `SELECT ss.version, ss.updated_at, ss.media_id, ss.playlist_id, ss.published_type,
              m.filename, m.original_name, m.mime_type, m.type
       FROM signage_state ss
       LEFT JOIN media m ON m.id = ss.media_id
       WHERE ss.id = 1`
    )
    .get();

  if (state?.published_type === 'playlist' && state.playlist_id) {
    const items = playlistItems(state.playlist_id);
    if (items.length) {
      return finalizeResolved(
        asPlaylist(state.version, state.updated_at, state.playlist_id, items, 'published')
      );
    }
  }

  if (state?.media_id && state.filename) {
    return finalizeResolved(
      asSingle({
        version: state.version,
        type: state.type,
        url: `/uploads/${state.filename}`,
        updatedAt: state.updated_at,
        filename: state.original_name,
        mediaId: state.media_id,
        source: 'published',
      })
    );
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
    return finalizeResolved(
      asSingle({
        version: state?.version || 0,
        type: defaultMedia.type,
        url: `/uploads/${defaultMedia.filename}`,
        updatedAt: state?.updated_at || null,
        filename: defaultMedia.original_name,
        mediaId: defaultMedia.id,
        source: 'default',
      })
    );
  }

  return finalizeResolved(
    asSingle({
      version: state?.version || 0,
      type: null,
      url: null,
      updatedAt: state?.updated_at || null,
      filename: null,
      mediaId: null,
      source: 'none',
    })
  );
}

function contentFingerprint(content) {
  if (content.mode === 'playlist' && content.playlistId) {
    return `p:${content.playlistId}`;
  }
  if (content.mediaId != null) {
    return `m:${content.mediaId}`;
  }
  return '';
}

function finalizeResolved(content) {
  const prev = db.prepare(`SELECT value FROM settings WHERE key = 'last_resolved_media_id'`).get();
  const prevId = prev?.value ?? '';
  const nextId = contentFingerprint(content);
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
  const { nextVersion, updatedAt } = bumpVersion();
  db.prepare(`UPDATE signage_state SET version = ?, updated_at = ? WHERE id = 1`).run(
    nextVersion,
    updatedAt
  );
  return { version: nextVersion, updatedAt };
}

export { playlistItems };
