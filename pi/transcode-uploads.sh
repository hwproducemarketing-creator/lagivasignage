#!/usr/bin/env bash
# Batch-convert existing uploads to H.264 AAC MP4 for Pi Chromium.
# Usage:
#   sudo -u pi bash pi/transcode-uploads.sh
#   bash pi/transcode-uploads.sh /home/pi/hw-signage-data/uploads
#
# After converting published files, re-publish from admin or restart hw-signage
# and hard-refresh the kiosk.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

UPLOADS_DIR="${1:-}"
if [[ -z "$UPLOADS_DIR" ]]; then
  if [[ -f "$INSTALL_DIR/.env" ]]; then
    # shellcheck disable=SC1091
    set -a
    # shellcheck disable=SC1090
    source <(grep -E '^(DATA_DIR)=' "$INSTALL_DIR/.env" | sed 's/\r$//')
    set +a
  fi
  UPLOADS_DIR="${DATA_DIR:-$HOME/hw-signage-data}/uploads"
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ERROR: ffmpeg not installed. Run: sudo apt install -y ffmpeg"
  exit 1
fi

if [[ ! -d "$UPLOADS_DIR" ]]; then
  echo "ERROR: uploads dir not found: $UPLOADS_DIR"
  exit 1
fi

echo "Transcoding videos in $UPLOADS_DIR …"
shopt -s nullglob
count=0
for f in "$UPLOADS_DIR"/*.mp4 "$UPLOADS_DIR"/*.MP4 "$UPLOADS_DIR"/*.mov "$UPLOADS_DIR"/*.MOV; do
  [[ -f "$f" ]] || continue
  base="$(basename "$f")"
  # Skip already-converted outputs
  if [[ "$base" == *-h264.mp4 ]]; then
    echo "  skip (already h264 name): $base"
    continue
  fi
  probe="$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of csv=p=0 "$f" 2>/dev/null || true)"
  if [[ "$probe" == "h264" ]]; then
    echo "  skip (already h264): $base"
    continue
  fi
  out="${f%.*}-h264.mp4"
  echo "  convert ($probe → h264): $base"
  ffmpeg -y -i "$f" \
    -c:v libx264 -pix_fmt yuv420p -profile:v main -level 4.0 \
    -preset veryfast -crf 23 \
    -c:a aac -b:a 128k -ac 2 \
    -movflags +faststart \
    "$out"
  # Keep original as .bak then replace so DB filename still works if same name preferred:
  # For DB rows pointing at original name, overwrite in place:
  mv -f "$f" "${f}.pre-h264.bak"
  mv -f "$out" "$f"
  count=$((count + 1))
done

echo "Done. Converted $count file(s)."
echo "Restart server + kiosk, then re-publish the video from admin if needed:"
echo "  sudo systemctl restart hw-signage hw-signage-kiosk"
