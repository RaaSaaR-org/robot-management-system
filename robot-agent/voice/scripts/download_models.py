"""Fetch the models the voice service needs into voice/models/.

- Silero VAD ONNX (MIT) from the silero-vad GitHub repo
- Piper voices for the configured languages (also auto-fetched on first run)
- Whisper weights download automatically on first STT load (HF cache)

Usage: uv run python scripts/download_models.py
"""

from __future__ import annotations

import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from voice_service.config import VoiceConfig
from voice_service.vad.silero_onnx import MODEL_FILENAME

SILERO_URL = (
    "https://github.com/snakers4/silero-vad/raw/master/"
    "src/silero_vad/data/silero_vad.onnx"
)


def main() -> int:
    config = VoiceConfig.from_env()
    config.models_dir.mkdir(parents=True, exist_ok=True)

    silero_path = config.models_dir / MODEL_FILENAME
    if silero_path.exists():
        print(f"silero: already present ({silero_path})")
    else:
        print(f"silero: downloading {SILERO_URL} ...")
        urllib.request.urlretrieve(SILERO_URL, silero_path)
        print(f"silero: saved {silero_path} ({silero_path.stat().st_size // 1024} KiB)")

    from piper.download_voices import download_voice

    piper_dir = config.models_dir / "piper"
    piper_dir.mkdir(exist_ok=True)
    for lang in config.languages:
        name = config.piper_voice_for(lang)
        if (piper_dir / f"{name}.onnx").exists():
            print(f"piper:  {name} already present")
        else:
            print(f"piper:  downloading {name} ...")
            download_voice(name, piper_dir)
    print("done")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
