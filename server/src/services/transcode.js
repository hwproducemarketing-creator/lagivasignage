import { execFile, execFileSync } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { sanitizeFilename } from './files.js';

const execFileAsync = promisify(execFile);

let ffmpegPathCache = undefined;

/** Resolve ffmpeg binary once (PATH or common locations). */
export function findFfmpeg() {
  if (ffmpegPathCache !== undefined) return ffmpegPathCache;
  const candidates = ['ffmpeg', '/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg'];
  for (const bin of candidates) {
    try {
      execFileSync(bin, ['-version'], { stdio: 'ignore', timeout: 5000 });
      ffmpegPathCache = bin;
      return bin;
    } catch {
      /* try next */
    }
  }
  ffmpegPathCache = null;
  return null;
}

/**
 * TRANSCODE_VIDEO=true|1 → force on (if ffmpeg exists)
 * TRANSCODE_VIDEO=false|0 → off
 * unset → on when ffmpeg is available (Pi setup enables this)
 */
export function shouldTranscodeVideo() {
  const flag = String(process.env.TRANSCODE_VIDEO || '').toLowerCase();
  if (flag === 'false' || flag === '0' || flag === 'no') return false;
  const bin = findFfmpeg();
  if (!bin) return false;
  if (flag === 'true' || flag === '1' || flag === 'yes') return true;
  return true;
}

/**
 * Re-encode to H.264 yuv420p + AAC MP4 (faststart) for Pi Chromium.
 * Replaces the original upload file when conversion succeeds.
 */
export async function transcodeVideoToH264(uploadsDir, inputFilename) {
  const bin = findFfmpeg();
  if (!bin) {
    throw new Error('ffmpeg not found');
  }

  const inputPath = path.join(uploadsDir, inputFilename);
  if (!fs.existsSync(inputPath)) {
    throw new Error(`input missing: ${inputFilename}`);
  }

  const outName = sanitizeFilename(`${path.basename(inputFilename, path.extname(inputFilename))}-h264`, '.mp4');
  const outputPath = path.join(uploadsDir, outName);
  const tmpPath = `${outputPath}.tmp.mp4`;

  const args = [
    '-y',
    '-i',
    inputPath,
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-profile:v',
    'main',
    '-level',
    '4.0',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-ac',
    '2',
    '-movflags',
    '+faststart',
    tmpPath,
  ];

  console.log(`[hw-signage] transcoding ${inputFilename} → ${outName}`);
  try {
    await execFileAsync(bin, args, {
      timeout: 30 * 60 * 1000,
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (err) {
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      /* ignore */
    }
    throw new Error(`ffmpeg failed: ${err.stderr || err.message || err}`);
  }

  if (!fs.existsSync(tmpPath) || fs.statSync(tmpPath).size <= 0) {
    throw new Error('ffmpeg produced empty output');
  }

  fs.renameSync(tmpPath, outputPath);

  if (inputFilename !== outName) {
    try {
      fs.unlinkSync(inputPath);
    } catch {
      /* ignore */
    }
  }

  const size = fs.statSync(outputPath).size;
  return {
    filename: outName,
    path: outName,
    size,
    mimeType: 'video/mp4',
  };
}

/** Best-effort probe: true if stream looks like H.264/AVC. */
export async function isLikelyH264(uploadsDir, filename) {
  const bin = findFfmpeg();
  if (!bin) return false;
  const inputPath = path.join(uploadsDir, filename);
  try {
    await execFileAsync(bin, ['-hide_banner', '-i', inputPath], {
      timeout: 30_000,
      maxBuffer: 2 * 1024 * 1024,
    });
  } catch (err) {
    const text = `${err.stdout || ''}\n${err.stderr || ''}`;
    if (/Video:\s*hevc|Video:\s*h265|Video:\s*h\.?265/i.test(text)) return false;
    if (/Video:\s*h264|Video:\s*avc/i.test(text)) return true;
  }
  return false;
}
