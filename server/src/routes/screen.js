import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { getRecentActivity, logActivity } from '../services/activity.js';
import { publishMedia, resolveCurrentContent } from '../services/signage.js';

const router = Router();
const ONLINE_MS = 90_000;

router.get('/current', (_req, res) => {
  const content = resolveCurrentContent();
  res.json({
    version: content.version,
    type: content.type,
    url: content.url,
    imageUrl: content.type === 'image' ? content.url : null,
    updatedAt: content.updatedAt,
    filename: content.filename,
    source: content.source,
  });
});

router.post('/heartbeat', (req, res) => {
  const { deviceId, currentVersion, appVersion } = req.body || {};
  if (!deviceId) {
    return res.status(400).json({ error: 'deviceId is required' });
  }

  const device = db.prepare('SELECT * FROM devices WHERE device_id = ?').get(deviceId);
  if (!device) {
    return res.status(404).json({ error: 'Device not registered' });
  }

  const now = new Date().toISOString();
  const wasOffline =
    !device.last_seen || Date.now() - new Date(device.last_seen).getTime() > ONLINE_MS;

  db.prepare(
    `UPDATE devices
     SET last_seen = ?, current_version = ?, app_version = ?
     WHERE device_id = ?`
  ).run(now, currentVersion ?? device.current_version, appVersion || device.app_version, deviceId);

  if (wasOffline) {
    logActivity('device_connected', `${device.name || deviceId} connected.`);
  }

  res.json({ ok: true, serverTime: now });
});

export default router;
