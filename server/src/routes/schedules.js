import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { logActivity } from '../services/activity.js';
import { bumpVersionForScheduleChange } from '../services/signage.js';

const router = Router();

router.get('/', requireAuth, (_req, res) => {
  const rows = db
    .prepare(
      `SELECT s.*, m.original_name, m.filename, m.type
       FROM schedules s
       JOIN media m ON m.id = s.media_id
       ORDER BY s.id DESC`
    )
    .all();

  res.json({
    schedules: rows.map((s) => ({
      id: s.id,
      mediaId: s.media_id,
      startAt: s.start_at,
      endAt: s.end_at,
      active: !!s.active,
      originalName: s.original_name,
      filename: s.filename,
      type: s.type,
      url: `/uploads/${s.filename}`,
      createdAt: s.created_at,
    })),
  });
});

router.post('/', requireAuth, (req, res) => {
  const { mediaId, startAt, endAt } = req.body || {};
  if (!mediaId || !startAt || !endAt) {
    return res.status(400).json({ error: 'mediaId, startAt, and endAt are required' });
  }

  const media = db.prepare('SELECT * FROM media WHERE id = ?').get(Number(mediaId));
  if (!media) {
    return res.status(404).json({ error: 'Media not found' });
  }

  if (new Date(endAt) <= new Date(startAt)) {
    return res.status(400).json({ error: 'End must be after start' });
  }

  const result = db
    .prepare(
      `INSERT INTO schedules (media_id, start_at, end_at, active) VALUES (?, ?, ?, 1)`
    )
    .run(Number(mediaId), startAt, endAt);

  const bumped = bumpVersionForScheduleChange();
  logActivity('schedule', `Schedule created for ${media.original_name}`, {
    scheduleId: result.lastInsertRowid,
  });

  res.status(201).json({
    ok: true,
    scheduleId: result.lastInsertRowid,
    version: bumped.version,
  });
});

router.delete('/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM schedules WHERE id = ?').get(id);
  if (!row) {
    return res.status(404).json({ error: 'Schedule not found' });
  }
  db.prepare('DELETE FROM schedules WHERE id = ?').run(id);
  const bumped = bumpVersionForScheduleChange();
  logActivity('schedule', `Schedule deleted (#${id})`);
  res.json({ ok: true, version: bumped.version });
});

export default router;
