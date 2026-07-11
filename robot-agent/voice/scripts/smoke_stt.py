"""Smoke test: Piper-generated speech -> Silero VAD segmenter -> faster-whisper.

Self-contained round trip with golden transcripts — no mic or robot needed.
Also validates language auto-detection (DE + EN) and prints STT latency.

Usage: uv run python scripts/smoke_stt.py
"""

from __future__ import annotations

import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8")

from voice_service.config import FRAME_BYTES, PIPELINE_SAMPLE_RATE, VoiceConfig
from voice_service.audio.resample import resample_s16le
from voice_service.stt.faster_whisper_stt import FasterWhisperSTT
from voice_service.tts.piper_engine import PiperEngine
from voice_service.vad.segmenter import SpeechEnd, UtteranceSegmenter
from voice_service.vad.silero_onnx import SileroVad

FIXTURES = {
    "de": "Wie hoch ist der Akkustand des Roboters?",
    "en": "What is the current battery level of the robot?",
}


def normalize(text: str) -> set[str]:
    return set(re.sub(r"[^\w\säöüß]", "", text.lower()).split())


def main() -> int:
    config = VoiceConfig.from_env()
    tts = PiperEngine(config)
    tts.load()
    stt = FasterWhisperSTT(config)
    t0 = time.perf_counter()
    stt.load()
    print(f"whisper load+warmup: {time.perf_counter() - t0:.1f}s")

    failures = 0
    silence = bytes(FRAME_BYTES)
    for lang, sentence in FIXTURES.items():
        pcm22, rate = tts.synthesize(sentence, lang)
        pcm16 = resample_s16le(pcm22, rate, PIPELINE_SAMPLE_RATE)

        # --- VAD path: silence + speech + silence must yield one utterance
        vad = SileroVad(config.models_dir)
        seg = UtteranceSegmenter(
            vad,
            threshold=config.vad_threshold,
            min_speech_ms=config.vad_min_speech_ms,
            min_silence_ms=config.vad_min_silence_ms,
            max_utterance_s=config.vad_max_utterance_s,
            pre_roll_ms=config.vad_pre_roll_ms,
        )
        utterances: list[SpeechEnd] = []
        stream = silence * 15 + pcm16 + silence * 40
        for i in range(0, len(stream) - FRAME_BYTES + 1, FRAME_BYTES):
            event = seg.push(stream[i : i + FRAME_BYTES])
            if isinstance(event, SpeechEnd):
                utterances.append(event)
        if len(utterances) != 1:
            print(f"[{lang}] FAIL: VAD produced {len(utterances)} utterances, expected 1")
            failures += 1
            audio_for_stt = pcm16
        else:
            print(f"[{lang}] VAD: 1 utterance, {utterances[0].duration_s:.2f}s")
            audio_for_stt = utterances[0].pcm

        # --- STT path
        t0 = time.perf_counter()
        result = stt.transcribe(audio_for_stt)
        dt = time.perf_counter() - t0
        print(f"[{lang}] STT ({dt:.2f}s, logprob {result.avg_logprob:.2f}, "
              f"detected={result.language}): {result.text}")
        expected, got = normalize(sentence), normalize(result.text)
        overlap = len(expected & got) / max(1, len(expected))
        if result.language != lang:
            print(f"[{lang}] FAIL: language detected as {result.language}")
            failures += 1
        if overlap < 0.75:
            print(f"[{lang}] FAIL: word overlap only {overlap:.0%}")
            failures += 1

    print("OK" if failures == 0 else f"{failures} FAILURES")
    return failures


if __name__ == "__main__":
    raise SystemExit(main())
