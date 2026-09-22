import { Router } from 'express';
import bcrypt from 'bcrypt';
import { db } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { logActivity } from '../services/activity.js';
import { setDefaultMedia } from '../services/signage.js';

const router = Router();

function getSettingsMap() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const map = {};
  for (const r of rows) map[r.key] = r.value;
  return map;
}

router.get('/', requireAuth, (_req, res) => {
  const settings = getSettingsMap();
  const user = db.prepare('SELECT id, username FROM users LIMIT 1').get();
  res.json({
    settings: {
      businessName: settings.business_name || 'H&W Produce',
      defaultMediaId: settings.default_media_id ? Number(settings.default_media_id) : null,
      imageDurationSeconds: settings.image_duration_seconds
        ? Number(settings.image_duration_seconds)
        : 10,
    },
    admin: user ? { id: user.id, username: user.username } : null,
  });
});

router.put('/', requireAuth, (req, res) => {
  const { businessName, defaultMediaId, imageDurationSeconds, currentPassword, newPassword } =
    req.body || {};

  if (businessName != null) {
    db.prepare(
      `INSERT INTO settings (key, value) VALUES ('business_name', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).run(String(businessName).trim() || 'H&W Produce');
  }

  if (imageDurationSeconds != null) {
    db.prepare(
      `INSERT INTO settings (key, value) VALUES ('image_duration_seconds', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).run(String(Number(imageDurationSeconds) || 10));
  }

  if (defaultMediaId != null && defaultMediaId !== '') {
    const result = setDefaultMedia(Number(defaultMediaId));
    if (!result.ok) {
      return res.status(404).json({ error: result.error });
    }
  }

  if (newPassword) {
    if (!currentPassword) {
      return res.status(400).json({ error: 'Current password is required to change password' });
    }
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
    if (!user || !bcrypt.compareSync(currentPassword, user.password_hash)) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    if (String(newPassword).length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }
    const hash = bcrypt.hashSync(newPassword, 10);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);
    logActivity('settings', 'Admin password changed');
  }

  logActivity('settings', 'Settings updated');
  const settings = getSettingsMap();
  res.json({
    ok: true,
    settings: {
      businessName: settings.business_name || 'H&W Produce',
      defaultMediaId: settings.default_media_id ? Number(settings.default_media_id) : null,
      imageDurationSeconds: settings.image_duration_seconds
        ? Number(settings.image_duration_seconds)
        : 10,
    },
  });
});

export default router;
