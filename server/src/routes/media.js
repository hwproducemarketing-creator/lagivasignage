import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import { db, uploadsDir } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { logActivity } from '../services/activity.js';
import {
  getAllowedMimes,
  sanitizeFilename,
  safeJoinUploads,
  validateUpload,
} from '../services/files.js';
import { setDefaultMedia } from '../services/signage.js';
import {
  shouldTranscodeVideo,
  transcodeVideoToH264,
  isLikelyH264,
} from '../services/transcode.js';

const router = Router();

const maxMb = Number(process.env.MAX_UPLOAD_MB || 100);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const check = validateUpload(file);
    if (!check.ok) {
      return cb(new Error(check.error));
    }
    cb(null, sanitizeFilename(file.originalname, check.ext));
  },
});

const upload = multer({
  storage,
  limits: { fileSize: maxMb * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const check = validateUpload(file);
    if (!check.ok) {
      return cb(new Error(check.error));
    }
    if (!getAllowedMimes().includes(file.mimetype)) {
      return cb(new Error('Unsupported file format.'));
    }
    cb(null, true);
  },
});

function mediaRowToDto(row, publishedMediaId) {
  return {
    id: row.id,
    filename: row.filename,
    originalName: row.original_name,
    mimeType: row.mime_type,
    type: row.type,
    size: row.size,
    width: row.width,
    height: row.height,
    url: `/uploads/${row.filename}`,
    isDefault: !!row.is_default,
    isPublished: publishedMediaId != null && row.id === publishedMediaId,
    createdAt: row.created_at,
  };
}

router.get('/', requireAuth, (_req, res) => {
  const state = db.prepare('SELECT media_id FROM signage_state WHERE id = 1').get();
  const rows = db.prepare('SELECT * FROM media ORDER BY id DESC').all();
  res.json({ media: rows.map((r) => mediaRowToDto(r, state?.media_id)) });
});

router.post('/upload', requireAuth, (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      const message =
        err.code === 'LIMIT_FILE_SIZE'
          ? `Upload failed. Maximum file size is ${maxMb} MB.`
          : err.message || 'Upload failed.';
      return res.status(400).json({ error: message });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    const check = validateUpload(req.file);
    if (!check.ok) {
      try {
        fs.unlinkSync(req.file.path);
      } catch {
        /* ignore */
      }
      return res.status(400).json({ error: check.error });
    }

    const width = req.body.width ? Number(req.body.width) : null;
    const height = req.body.height ? Number(req.body.height) : null;

    (async () => {
      let filename = req.file.filename;
      let mimeType = req.file.mimetype;
      let size = req.file.size;
      let transcoded = false;

      // Pi Chromium needs H.264 — VLC plays HEVC but Chromium often shows a blank screen
      if (check.type === 'video' && shouldTranscodeVideo()) {
        try {
          const already = await isLikelyH264(uploadsDir, filename);
          if (!already) {
            const out = await transcodeVideoToH264(uploadsDir, filename);
            filename = out.filename;
            mimeType = out.mimeType;
            size = out.size;
            transcoded = true;
          }
        } catch (err) {
          console.warn('[hw-signage] video transcode skipped:', err.message || err);
          // Keep original file so upload still succeeds; player will show codec message if needed
        }
      }

      const result = db
        .prepare(
          `INSERT INTO media (filename, original_name, mime_type, type, size, width, height, path)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          filename,
          req.file.originalname,
          mimeType,
          check.type,
          size,
          width,
          height,
          filename
        );

      const media = db.prepare('SELECT * FROM media WHERE id = ?').get(result.lastInsertRowid);
      logActivity(
        'upload',
        `New ${check.type} uploaded: ${media.original_name}${transcoded ? ' (transcoded H.264)' : ''}`,
        { mediaId: media.id }
      );

      const state = db.prepare('SELECT media_id FROM signage_state WHERE id = 1').get();
      res.status(201).json({
        ok: true,
        message: transcoded ? 'Upload successful (converted to H.264 for Chromium)' : 'Upload successful',
        transcoded,
        media: mediaRowToDto(media, state?.media_id),
      });
    })().catch((err) => {
      console.error('[hw-signage] upload handler failed', err);
      try {
        fs.unlinkSync(req.file.path);
      } catch {
        /* ignore */
      }
      if (!res.headersSent) {
        res.status(500).json({ error: err.message || 'Upload failed' });
      }
    });
  });
});

router.delete('/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const media = db.prepare('SELECT * FROM media WHERE id = ?').get(id);
  if (!media) {
    return res.status(404).json({ error: 'Media not found' });
  }

  const state = db.prepare('SELECT media_id FROM signage_state WHERE id = 1').get();
  if (state?.media_id === id) {
    return res.status(400).json({
      error: 'Cannot delete the currently published media. Publish something else first.',
    });
  }

  const scheduled = db.prepare('SELECT id FROM schedules WHERE media_id = ? LIMIT 1').get(id);
  if (scheduled) {
    db.prepare('DELETE FROM schedules WHERE media_id = ?').run(id);
  }

  db.prepare('DELETE FROM media WHERE id = ?').run(id);
  try {
    fs.unlinkSync(safeJoinUploads(uploadsDir, media.filename));
  } catch {
    /* ignore missing file */
  }

  logActivity('delete', `Deleted media: ${media.original_name}`, { mediaId: id });
  res.json({ ok: true });
});

router.post('/:id/default', requireAuth, (req, res) => {
  const result = setDefaultMedia(Number(req.params.id));
  if (!result.ok) {
    return res.status(404).json({ error: result.error });
  }
  logActivity('settings', `Set default media: ${result.media.original_name}`);
  res.json({ ok: true });
});

export default router;
