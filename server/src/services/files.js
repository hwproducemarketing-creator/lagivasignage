import path from 'path';
import { randomUUID } from 'crypto';

const ALLOWED = {
  'image/jpeg': { ext: ['.jpg', '.jpeg'], type: 'image' },
  'image/png': { ext: ['.png'], type: 'image' },
  'image/webp': { ext: ['.webp'], type: 'image' },
  'video/mp4': { ext: ['.mp4'], type: 'video' },
};

export function getAllowedMimes() {
  return Object.keys(ALLOWED);
}

export function validateUpload(file) {
  if (!file) {
    return { ok: false, error: 'No file provided' };
  }

  const meta = ALLOWED[file.mimetype];
  if (!meta) {
    return { ok: false, error: 'Unsupported file format. Use JPG, PNG, WEBP, or MP4.' };
  }

  const ext = path.extname(file.originalname).toLowerCase();
  if (!meta.ext.includes(ext)) {
    return {
      ok: false,
      error: `File extension ${ext || '(none)'} does not match type ${file.mimetype}`,
    };
  }

  return { ok: true, type: meta.type, ext };
}

export function sanitizeFilename(originalName, forcedExt) {
  const base = path
    .basename(originalName, path.extname(originalName))
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 60) || 'file';
  const ext = forcedExt || path.extname(originalName).toLowerCase();
  return `${Date.now()}-${randomUUID().slice(0, 8)}-${base}${ext}`;
}

export function safeJoinUploads(uploadsDir, filename) {
  const resolved = path.resolve(uploadsDir, filename);
  if (!resolved.startsWith(path.resolve(uploadsDir))) {
    throw new Error('Invalid path');
  }
  return resolved;
}
