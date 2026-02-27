#!/bin/bash
# Convert Playwright .webm videos to .mp4
# Requires: ffmpeg

RESULTS_DIR="$(dirname "$0")/../test-results-videos"

if ! command -v ffmpeg &> /dev/null; then
  echo "ffmpeg not found — skipping mp4 conversion"
  echo "Install: sudo apt-get install ffmpeg"
  exit 0
fi

echo "Converting videos in $RESULTS_DIR ..."
find "$RESULTS_DIR" -name "*.webm" | while read -r webm; do
  mp4="${webm%.webm}.mp4"
  if [ ! -f "$mp4" ]; then
    echo "  Converting: $webm"
    ffmpeg -i "$webm" -c:v libx264 -crf 23 -preset fast -movflags +faststart "$mp4" -y -loglevel error
    echo "  Created: $mp4"
  fi
done
echo "Done."
