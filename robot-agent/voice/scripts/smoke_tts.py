"""Smoke test: Piper TTS -> WAV files (and optional playback).

Usage:  uv run python scripts/smoke_tts.py [--play]
Writes out/smoke_tts_de.wav and out/smoke_tts_en.wav.
"""

from __future__ import annotations

import sys
import time
import wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from voice_service.config import VoiceConfig
from voice_service.tts.piper_engine import PiperEngine

PHRASES = {
    "de": "Hallo! Ich bin der Sprachassistent des Roboters. Wie kann ich helfen?",
    "en": "Hello! I am the robot's voice assistant. How can I help you today?",
}


def write_wav(path: Path, pcm: bytes, rate: int) -> None:
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm)


def main() -> int:
    play = "--play" in sys.argv
    config = VoiceConfig.from_env()
    engine = PiperEngine(config)
    t0 = time.perf_counter()
    engine.load()
    print(f"load: {time.perf_counter() - t0:.2f}s")

    out_dir = Path(__file__).resolve().parent.parent / "out"
    out_dir.mkdir(exist_ok=True)
    failures = 0
    for lang, text in PHRASES.items():
        t0 = time.perf_counter()
        pcm, rate = engine.synthesize(text, lang)
        dt = time.perf_counter() - t0
        seconds = len(pcm) / 2 / rate
        print(f"[{lang}] {seconds:.2f}s audio in {dt:.2f}s ({seconds / dt:.1f}x realtime), rate={rate}")
        if seconds < 1.0:
            print(f"[{lang}] FAIL: suspiciously short audio")
            failures += 1
        path = out_dir / f"smoke_tts_{lang}.wav"
        write_wav(path, pcm, rate)
        print(f"[{lang}] wrote {path}")
        if play:
            import sounddevice as sd
            import numpy as np

            sd.play(np.frombuffer(pcm, dtype=np.int16), rate)
            sd.wait()
    print("OK" if failures == 0 else f"{failures} FAILURES")
    return failures


if __name__ == "__main__":
    raise SystemExit(main())
