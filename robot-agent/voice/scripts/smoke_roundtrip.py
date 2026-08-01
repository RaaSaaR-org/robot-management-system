"""End-to-end round trip WITHOUT a microphone:

    Piper (question audio) -> VAD segmenter -> faster-whisper -> A2A agent
    -> reply text -> Piper (answer audio) -> out/roundtrip_<lang>.wav

Prerequisites: robot-agent running (e.g. `npm run dev:g1-edu-sim`) and
Ollama serving its model. Agent URL from VOICE_AGENT_URL (default :41244).

Usage: uv run python scripts/smoke_roundtrip.py [--lang de|en] [--text "..."]
"""

from __future__ import annotations

import argparse
import asyncio
import sys
import time
import uuid
import wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8")

from voice_service.a2a_client import A2AClient
from voice_service.audio.resample import resample_s16le
from voice_service.config import FRAME_BYTES, PIPELINE_SAMPLE_RATE, VoiceConfig
from voice_service.pipeline import VOICE_METADATA_KEY
from voice_service.stt.faster_whisper_stt import FasterWhisperSTT
from voice_service.tts.piper_engine import PiperEngine
from voice_service.vad.segmenter import SpeechEnd, UtteranceSegmenter
from voice_service.vad.silero_onnx import SileroVad

QUESTIONS = {
    "de": "Hallo Roboter, wie hoch ist dein Akkustand und in welcher Zone bist du gerade?",
    "en": "Hello robot, what is your battery level and which zone are you in right now?",
}

# Against an Agent-Mode agent the question above is not the interesting one --
# it answers with a plan, not a battery reading. Pass --text with a command
# ("dreh dich nach links") to exercise that path from a machine with no mic.


async def run(lang: str, text: str | None) -> int:
    config = VoiceConfig.from_env()
    question = text or QUESTIONS[lang]
    print(f"question ({lang}): {question}")

    tts = PiperEngine(config)
    tts.load()
    stt = FasterWhisperSTT(config)
    stt.load()

    timings: dict[str, float] = {}

    # 1) synthesize the "spoken" question and run it through VAD
    pcm22, rate = tts.synthesize(question, lang)
    pcm16 = resample_s16le(pcm22, rate, PIPELINE_SAMPLE_RATE)
    seg = UtteranceSegmenter(SileroVad(config.models_dir), threshold=config.vad_threshold)
    stream = bytes(FRAME_BYTES) * 15 + pcm16 + bytes(FRAME_BYTES) * 40
    utterance = None
    for i in range(0, len(stream) - FRAME_BYTES + 1, FRAME_BYTES):
        event = seg.push(stream[i : i + FRAME_BYTES])
        if isinstance(event, SpeechEnd):
            utterance = event
    assert utterance is not None, "VAD produced no utterance"

    # 2) STT
    t0 = time.perf_counter()
    transcript = stt.transcribe(utterance.pcm)
    timings["stt"] = time.perf_counter() - t0
    print(f"transcript ({transcript.language}, {timings['stt']:.2f}s): {transcript.text}")
    assert transcript.text, "empty transcript"

    # 3) A2A agent
    client = A2AClient(config.agent_url, timeout_s=config.a2a_timeout_s)
    context_id = str(uuid.uuid4())
    t0 = time.perf_counter()
    # The same speech hint the live pipeline sends. Without it an Agent-Mode
    # agent would hold this call open until the whole plan had RUN, and the
    # round trip would measure plan execution instead of the answer latency.
    reply = await client.send(
        transcript.text,
        context_id,
        {VOICE_METADATA_KEY: {"speech": True, "language": transcript.language}},
    )
    timings["agent"] = time.perf_counter() - t0
    print(f"reply ({reply.state}, {timings['agent']:.2f}s): {reply.text}")
    await client.aclose()
    assert reply.text.strip(), "empty agent reply"
    assert reply.state in ("completed", "input-required"), f"agent state {reply.state}"

    # 4) TTS of the answer
    t0 = time.perf_counter()
    answer_pcm, answer_rate = tts.synthesize(reply.text, transcript.language)
    timings["tts"] = time.perf_counter() - t0

    out_dir = Path(__file__).resolve().parent.parent / "out"
    out_dir.mkdir(exist_ok=True)
    out_path = out_dir / f"roundtrip_{lang}.wav"
    with wave.open(str(out_path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(answer_rate)
        w.writeframes(answer_pcm)
    audio_s = len(answer_pcm) / 2 / answer_rate
    print(f"answer audio: {audio_s:.1f}s -> {out_path}")

    pipeline_s = timings["stt"] + timings["tts"]
    print(
        f"\nlatency: stt={timings['stt']:.2f}s agent={timings['agent']:.2f}s "
        f"tts={timings['tts']:.2f}s | pipeline-without-LLM={pipeline_s:.2f}s"
    )
    print("OK")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--lang", choices=("de", "en"), default="de")
    parser.add_argument("--text")
    args = parser.parse_args()
    return asyncio.run(run(args.lang, args.text))


if __name__ == "__main__":
    raise SystemExit(main())
