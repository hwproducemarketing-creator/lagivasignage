import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { db, uploadsDir } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { logActivity } from '../services/activity.js';
import { sanitizeFilename, validateUpload } from '../services/files.js';
import {
  bumpVersionForScheduleChange,
  publishMedia,
} from '../services/signage.js';

const router = Router();
const maxMb = Number(process.env.MAX_UPLOAD_MB || 100);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const check = validateUpload(file);
    if (!check.ok) return cb(new Error(check.error));
    cb(null, sanitizeFilename(file.originalname, check.ext));
  },
});

const upload = multer({
  storage,
  limits: { fileSize: maxMb * 1024 * 1024 },
});

router.get('/', requireAuth, (_req, res) => {
  const rows = db
    .prepare(
      `SELECT p.*,
              gm.filename AS generated_filename
       FROM promotions p
       LEFT JOIN media gm ON gm.id = p.generated_media_id
       ORDER BY p.id DESC`
    )
    .all();

  res.json({
    promotions: rows.map((p) => ({
      id: p.id,
      productName: p.product_name,
      price: p.price,
      unit: p.unit,
      description: p.description,
      imageMediaId: p.image_media_id,
      generatedMediaId: p.generated_media_id,
      generatedUrl: p.generated_filename ? `/uploads/${p.generated_filename}` : null,
      startAt: p.start_at,
      endAt: p.end_at,
      createdAt: p.created_at,
    })),
  });
});

router.post('/', requireAuth, (req, res) => {
  upload.single('image')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || 'Upload failed' });
    }

    const {
      productName,
      price,
      unit,
      description,
      startAt,
      endAt,
      generatedDataUrl,
      publish: shouldPublish,
      schedule,
    } = req.body || {};

    if (!productName?.trim() || !price?.trim()) {
      return res.status(400).json({ error: 'Product name and price are required' });
    }
    if (!generatedDataUrl) {
      return res.status(400).json({ error: 'Generated promotion image is required' });
    }

    let imageMediaId = null;
    if (req.file) {
      const check = validateUpload(req.file);
      if (!check.ok) {
        try {
          fs.unlinkSync(req.file.path);
        } catch {
          /* ignore */
        }
        return res.status(400).json({ error: check.error });
      }
      const ins = db
        .prepare(
          `INSERT INTO media (filename, original_name, mime_type, type, size, width, height, path)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          req.file.filename,
          req.file.originalname,
          req.file.mimetype,
          'image',
          req.file.size,
          null,
          null,
          req.file.filename
        );
      imageMediaId = Number(ins.lastInsertRowid);
    }

    const match = String(generatedDataUrl).match(/^data:image\/png;base64,(.+)$/);
    if (!match) {
      return res.status(400).json({ error: 'Invalid generated image data' });
    }

    const buffer = Buffer.from(match[1], 'base64');
    const filename = sanitizeFilename(`${productName}-promo.png`, '.png');
    const dest = path.join(uploadsDir, filename);
    fs.writeFileSync(dest, buffer);

    const mediaIns = db
      .prepare(
        `INSERT INTO media (filename, original_name, mime_type, type, size, width, height, path)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        filename,
        `${productName.trim()} Promotion.png`,
        'image/png',
        'image',
        buffer.length,
        1920,
        1080,
        filename
      );
    const generatedMediaId = Number(mediaIns.lastInsertRowid);

    const promoIns = db
      .prepare(
        `INSERT INTO promotions
         (product_name, price, unit, description, image_media_id, generated_media_id, start_at, end_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        productName.trim(),
        price.trim(),
        unit || null,
        description || null,
        imageMediaId,
        generatedMediaId,
        startAt || null,
        endAt || null
      );

    const promoId = Number(promoIns.lastInsertRowid);
    logActivity('promotion_created', `Promotion created: ${productName.trim()}`, { promoId });

    let version = null;
    if ((schedule === 'true' || schedule === true) && startAt && endAt) {
      db.prepare(
        `INSERT INTO schedules (media_id, start_at, end_at, active) VALUES (?, ?, ?, 1)`
      ).run(generatedMediaId, startAt, endAt);
      version = bumpVersionForScheduleChange().version;
      logActivity('schedule', `Scheduled promotion: ${productName.trim()}`);
    }

    if (shouldPublish === 'true' || shouldPublish === true) {
      const published = publishMedia(generatedMediaId);
      version = published.version;
    }

    res.status(201).json({
      ok: true,
      promotion: {
        id: promoId,
        productName: productName.trim(),
        generatedMediaId,
        generatedUrl: `/uploads/${filename}`,
      },
      version,
    });
  });
});

router.delete('/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const promo = db.prepare('SELECT * FROM promotions WHERE id = ?').get(id);
  if (!promo) {
    return res.status(404).json({ error: 'Promotion not found' });
  }
  db.prepare('DELETE FROM promotions WHERE id = ?').run(id);
  logActivity('promotion_deleted', `Promotion deleted: ${promo.product_name}`);
  res.json({ ok: true });
});

export default router;
