import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { getRecentActivity } from '../services/activity.js';
import { publishMedia, publishPlaylist, resolveCurrentContent } from '../services/signage.js';

const router = Router();
const ONLINE_MS = 90_000;

function deviceStatus(lastSeen) {
  if (!lastSeen) return 'offline';
  const age = Date.now() - new Date(lastSeen).getTime();
  return age <= ONLINE_MS ? 'online' : 'offline';
}

router.post('/publish', requireAuth, (req, res) => {
  if (req.body?.playlistId) {
    const result = publishPlaylist(Number(req.body.playlistId));
    if (!result.ok) {
      return res.status(400).json({ error: result.error || 'Unable to publish. Please try again.' });
    }
    return res.json({
      ok: true,
      message: 'Published successfully',
      version: result.version,
      updatedAt: result.updatedAt,
      mode: 'playlist',
      playlist: {
        id: result.playlist.id,
        name: result.playlist.name,
        itemCount: result.items.length,
      },
    });
  }

  const mediaId = Number(req.body?.mediaId);
  if (!mediaId) {
    return res.status(400).json({ error: 'mediaId or playlistId is required' });
  }
  const result = publishMedia(mediaId);
  if (!result.ok) {
    return res.status(404).json({ error: result.error || 'Unable to publish. Please try again.' });
  }
  res.json({
    ok: true,
    message: 'Published successfully',
    version: result.version,
    updatedAt: result.updatedAt,
    mode: 'single',
    media: {
      id: result.media.id,
      originalName: result.media.original_name,
      url: `/uploads/${result.media.filename}`,
      type: result.media.type,
    },
  });
});

router.get('/status', requireAuth, (_req, res) => {
  const content = resolveCurrentContent();
  const devices = db.prepare(`SELECT * FROM devices WHERE status = 'registered'`).all();
  const mediaCount = db.prepare('SELECT COUNT(*) AS c FROM media').get().c;
  const online = devices.filter((d) => deviceStatus(d.last_seen) === 'online');
  const offline = devices.filter((d) => deviceStatus(d.last_seen) === 'offline');

  res.json({
    screens: {
      total: devices.length,
      online: online.length,
      offline: offline.length,
    },
    content: {
      totalMedia: mediaCount,
      published: content.mediaId || content.playlistId ? 1 : 0,
    },
    current: content,
    devices: devices.map((d) => ({
      id: d.id,
      deviceId: d.device_id,
      name: d.name,
      status: deviceStatus(d.last_seen),
      lastSeen: d.last_seen,
      currentVersion: d.current_version,
      appVersion: d.app_version,
    })),
    activity: getRecentActivity(15),
  });
});

export default router;
