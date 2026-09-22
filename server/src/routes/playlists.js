import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { logActivity } from '../services/activity.js';
import { publishPlaylist } from '../services/signage.js';

const router = Router();

function getPlaylistDto(playlist) {
  const items = db
    .prepare(
      `SELECT pi.id, pi.media_id, pi.order_index, pi.duration_sec,
              m.original_name, m.filename, m.type, m.mime_type
       FROM playlist_items pi
       JOIN media m ON m.id = pi.media_id
       WHERE pi.playlist_id = ?
       ORDER BY pi.order_index ASC, pi.id ASC`
    )
    .all(playlist.id);

  const state = db.prepare('SELECT playlist_id, published_type FROM signage_state WHERE id = 1').get();
  const isPublished =
    state?.published_type === 'playlist' && Number(state.playlist_id) === Number(playlist.id);

  return {
    id: playlist.id,
    name: playlist.name,
    createdAt: playlist.created_at,
    updatedAt: playlist.updated_at,
    isPublished,
    items: items.map((it) => ({
      id: it.id,
      mediaId: it.media_id,
      orderIndex: it.order_index,
      durationSec: it.duration_sec,
      originalName: it.original_name,
      type: it.type,
      url: `/uploads/${it.filename}`,
    })),
  };
}

router.get('/', requireAuth, (_req, res) => {
  const rows = db.prepare('SELECT * FROM playlists ORDER BY id DESC').all();
  res.json({ playlists: rows.map(getPlaylistDto) });
});

router.get('/:id', requireAuth, (req, res) => {
  const playlist = db.prepare('SELECT * FROM playlists WHERE id = ?').get(Number(req.params.id));
  if (!playlist) return res.status(404).json({ error: 'Playlist not found' });
  res.json({ playlist: getPlaylistDto(playlist) });
});

router.post('/', requireAuth, (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Name is required' });

  const now = new Date().toISOString();
  const result = db
    .prepare(`INSERT INTO playlists (name, created_at, updated_at) VALUES (?, ?, ?)`)
    .run(name, now, now);

  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  items.forEach((item, index) => {
    const mediaId = Number(item.mediaId);
    if (!mediaId) return;
    const media = db.prepare('SELECT id, type FROM media WHERE id = ?').get(mediaId);
    if (!media) return;
    const duration =
      item.durationSec != null
        ? Math.max(1, Number(item.durationSec))
        : media.type === 'video'
          ? 30
          : 10;
    db.prepare(
      `INSERT INTO playlist_items (playlist_id, media_id, order_index, duration_sec)
       VALUES (?, ?, ?, ?)`
    ).run(result.lastInsertRowid, mediaId, index, duration);
  });

  const playlist = db.prepare('SELECT * FROM playlists WHERE id = ?').get(result.lastInsertRowid);
  logActivity('playlist_created', `Playlist created: ${name}`, { playlistId: playlist.id });
  res.status(201).json({ ok: true, playlist: getPlaylistDto(playlist) });
});

router.put('/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const playlist = db.prepare('SELECT * FROM playlists WHERE id = ?').get(id);
  if (!playlist) return res.status(404).json({ error: 'Playlist not found' });

  const name = String(req.body?.name || playlist.name).trim();
  if (!name) return res.status(400).json({ error: 'Name is required' });

  const now = new Date().toISOString();
  db.prepare(`UPDATE playlists SET name = ?, updated_at = ? WHERE id = ?`).run(name, now, id);

  if (Array.isArray(req.body?.items)) {
    db.prepare('DELETE FROM playlist_items WHERE playlist_id = ?').run(id);
    req.body.items.forEach((item, index) => {
      const mediaId = Number(item.mediaId);
      if (!mediaId) return;
      const media = db.prepare('SELECT id, type FROM media WHERE id = ?').get(mediaId);
      if (!media) return;
      const duration =
        item.durationSec != null
          ? Math.max(1, Number(item.durationSec))
          : media.type === 'video'
            ? 30
            : 10;
      db.prepare(
        `INSERT INTO playlist_items (playlist_id, media_id, order_index, duration_sec)
         VALUES (?, ?, ?, ?)`
      ).run(id, mediaId, index, duration);
    });
  }

  const updated = db.prepare('SELECT * FROM playlists WHERE id = ?').get(id);
  logActivity('playlist_updated', `Playlist updated: ${name}`, { playlistId: id });
  res.json({ ok: true, playlist: getPlaylistDto(updated) });
});

router.delete('/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const playlist = db.prepare('SELECT * FROM playlists WHERE id = ?').get(id);
  if (!playlist) return res.status(404).json({ error: 'Playlist not found' });

  const state = db.prepare('SELECT playlist_id, published_type FROM signage_state WHERE id = 1').get();
  if (state?.published_type === 'playlist' && Number(state.playlist_id) === id) {
    return res.status(400).json({
      error: 'Cannot delete the currently published playlist. Publish something else first.',
    });
  }

  db.prepare('DELETE FROM playlists WHERE id = ?').run(id);
  logActivity('playlist_deleted', `Playlist deleted: ${playlist.name}`, { playlistId: id });
  res.json({ ok: true });
});

router.post('/:id/publish', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const result = publishPlaylist(id);
  if (!result.ok) {
    return res.status(400).json({ error: result.error || 'Unable to publish playlist.' });
  }
  res.json({
    ok: true,
    message: 'Published successfully',
    version: result.version,
    updatedAt: result.updatedAt,
    playlist: {
      id: result.playlist.id,
      name: result.playlist.name,
      itemCount: result.items.length,
    },
  });
});

export default router;
