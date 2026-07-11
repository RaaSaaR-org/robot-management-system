"""Shared test setup for the curation tool tests.

Run with any Python that has pyarrow + pandas (and ffmpeg for the video tests,
via CURATION_FFMPEG or PATH). The lerobot-backend tests additionally need
lerobot >= 0.6 and are skipped otherwise.
"""
from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path

CURATION_DIR = Path(__file__).resolve().parents[1]
if str(CURATION_DIR) not in sys.path:
    sys.path.insert(0, str(CURATION_DIR))


def find_ffmpeg() -> str | None:
    env = os.environ.get("CURATION_FFMPEG")
    if env:
        if Path(env).exists():
            return env
        return shutil.which(env)
    return shutil.which("ffmpeg")
