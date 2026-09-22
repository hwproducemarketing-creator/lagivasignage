import { Router } from 'express';
import { randomBytes } from 'crypto';
import { db } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { logActivity } from '../services/activity.js';
import { resolveCurrentContent } from '../services/signage.js';

const router = Router();
const ONLINE_MS = 90_000;

function makePairingCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  const bytes = randomBytes(8);
  for (let i = 0; i < 8; i++) {
    code += chars[bytes[i] % chars.length];
    if (i === 3) code += '-';
  }
  return code;
}

function makeDeviceId() {
  return `HW-TV-${randomBytes(3).toString('hex').toUpperCase()}`;
}

function statusOf(lastSeen) {
  if (!lastSeen) return 'offline';
  return Date.now() - new Date(lastSeen).getTime() <= ONLINE_MS ? 'online' : 'offline';
}

/** Fire TV: request a pairing code */
router.post('/pairing-code', (_req, res) => {
  let code;
  do {
    code = makePairingCode();
  } while (db.prepare('SELECT id FROM devices WHERE pairing_code = ?').get(code));

  const result = db
    .prepare(
      `INSERT INTO devices (pairing_code, status) VALUES (?, 'pending')`
    )
    .run(code);

  res.json({
    ok: true,
    pairingCode: code,
    id: result.lastInsertRowid,
  });
});

/** Fire TV: poll until registered */
router.get('/pairing-status/:code', (req, res) => {
  const device = db
    .prepare('SELECT * FROM devices WHERE pairing_code = ?')
    .get(req.params.code.toUpperCase());

  if (!device) {
    return res.status(404).json({ error: 'Unknown pairing code' });
  }

  if (device.status === 'registered' && device.device_id) {
    return res.json({
      status: 'registered',
      deviceId: device.device_id,
      name: device.name,
    });
  }

  res.json({ status: 'pending', pairingCode: device.pairing_code });
});

router.get('/', requireAuth, (_req, res) => {
  const content = resolveCurrentContent();
  const devices = db
    .prepare(`SELECT * FROM devices WHERE status = 'registered' ORDER BY id DESC`)
    .all();

  res.json({
    devices: devices.map((d) => ({
      id: d.id,
      deviceId: d.device_id,
      name: d.name,
      status: statusOf(d.last_seen),
      lastSeen: d.last_seen,
      currentVersion: d.current_version,
      appVersion: d.app_version,
      currentContent: content.filename,
      createdAt: d.created_at,
    })),
  });
});

router.post('/register', requireAuth, (req, res) => {
  const { pairingCode, name } = req.body || {};
  if (!pairingCode || !name?.trim()) {
    return res.status(400).json({ error: 'pairingCode and name are required' });
  }

  const code = String(pairingCode).toUpperCase().trim();
  const device = db.prepare('SELECT * FROM devices WHERE pairing_code = ?').get(code);
  if (!device) {
    return res.status(404).json({ error: 'Invalid device code' });
  }
  if (device.status === 'registered') {
    return res.status(400).json({ error: 'Device already registered' });
  }

  const deviceId = makeDeviceId();
  db.prepare(
    `UPDATE devices SET device_id = ?, name = ?, status = 'registered' WHERE id = ?`
  ).run(deviceId, name.trim(), device.id);

  logActivity('device_registered', `Device registered: ${name.trim()} (${deviceId})`, {
    deviceId,
  });

  res.json({
    ok: true,
    device: {
      id: device.id,
      deviceId,
      name: name.trim(),
      pairingCode: code,
    },
  });
});

router.patch('/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const { name } = req.body || {};
  const device = db.prepare('SELECT * FROM devices WHERE id = ?').get(id);
  if (!device) {
    return res.status(404).json({ error: 'Device not found' });
  }
  if (!name?.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  db.prepare('UPDATE devices SET name = ? WHERE id = ?').run(name.trim(), id);
  res.json({ ok: true, name: name.trim() });
});

router.delete('/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const device = db.prepare('SELECT * FROM devices WHERE id = ?').get(id);
  if (!device) {
    return res.status(404).json({ error: 'Device not found' });
  }
  db.prepare('DELETE FROM devices WHERE id = ?').run(id);
  logActivity('device_deleted', `Removed screen: ${device.name || device.device_id}`);
  res.json({ ok: true });
});

export default router;
