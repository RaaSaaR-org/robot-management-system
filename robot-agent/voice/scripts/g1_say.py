"""Speak text out of the real G1 speaker from the command line (TASK-181 step 2).

Piper -> resample to 16 kHz -> POST /play on the audio adapter. No robot-agent,
no LLM, no microphone involved: this is the output leg of the voice pipeline on
its own, which makes it the quickest way to prove the speaker works and a handy
demo trigger.

Needs the adapter running:  scripts/run_g1_adapter.ps1

    uv run python scripts/g1_say.py "Hallo, ich bin ein Roboter."
    uv run python scripts/g1_say.py "Hello there" --lang en
    uv run python scripts/g1_say.py "Ein langer Satz ..." --stop-after 2
    uv run python scripts/g1_say.py --volume 60
    uv run python scripts/g1_say.py "Test" --save out/test.wav

Language is auto-detected from the text unless --lang says otherwise; the
detection is a deliberately dumb stopword check, so pass --lang when it matters.
"""

from __future__ import annotations

import argparse
import sys
import threading
import time
import wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx

from voice_service.audio.resample import resample_s16le
from voice_service.config import PIPELINE_SAMPLE_RATE, VoiceConfig
from voice_service.tts.piper_engine import PiperEngine

# Enough to separate the two languages we ship voices for. Anything cleverer
# belongs in the voice service, which already does real detection via Whisper.
GERMAN_HINTS = {
    "ich", "bin", "ein", "eine", "der", "die", "das", "und", "ist", "nicht",
    "du", "sie", "wir", "hallo", "guten", "danke", "bitte", "was", "wie",
    "kannst", "mir", "mich", "auf", "mit", "für", "von", "zu", "roboter",
    # Counting out loud is a natural way to test playback length, and without
    # these a German count gets read by the English voice.
    "eins", "zwei", "drei", "vier", "fünf", "fuenf", "sechs", "sieben", "acht",
    "neun", "zehn", "elf", "zwölf", "zwoelf", "dreizehn", "vierzehn", "fünfzehn",
    "fuenfzehn",
}


def detect_language(text: str) -> str:
    words = {w.strip(".,!?;:\"'").lower() for w in text.split()}
    return "de" if words & GERMAN_HINTS else "en"


def write_wav(path: Path, pcm: bytes, rate: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("text", nargs="?", help="what the robot should say")
    parser.add_argument("--lang", choices=["de", "en"], help="voice language (default: auto-detect)")
    parser.add_argument("--adapter", default="http://localhost:8766", help="adapter base URL")
    parser.add_argument("--volume", type=int, metavar="0..100", help="set speaker volume (before speaking, if text given)")
    parser.add_argument("--stop-after", type=float, metavar="SECONDS", help="POST /stop mid-playback, to verify it cuts")
    parser.add_argument("--save", metavar="PATH", help="also write the 16 kHz PCM to a WAV file")
    args = parser.parse_args()

    if args.text is None and args.volume is None:
        parser.error("give TEXT to speak, or --volume to set the level")

    try:
        health = httpx.get(args.adapter + "/health", timeout=5.0).json()
    except httpx.HTTPError as exc:
        print(f"adapter unreachable at {args.adapter}: {exc}")
        print("fix: scripts/run_g1_adapter.ps1   (starts it in the 3.10 DDS venv)")
        return 1

    if health.get("mock"):
        # Otherwise everything below "succeeds" and no sound ever leaves the robot.
        print("WARNING: adapter is in MOCK mode - nothing will reach the speaker.")
        print("fix: restart it without -Mock")

    if args.volume is not None:
        if not 0 <= args.volume <= 100:
            parser.error("--volume must be 0..100")
        r = httpx.post(args.adapter + "/volume", json={"volume": args.volume}, timeout=5.0)
        print(f"volume -> {args.volume}: {r.status_code} {r.text.strip()}")
        if args.text is None:
            return 0 if r.status_code == 200 else 1

    language = args.lang or detect_language(args.text)
    config = VoiceConfig.from_env()
    engine = PiperEngine(config)
    engine.load()

    t0 = time.perf_counter()
    pcm, rate = engine.synthesize(args.text, language)
    print(f"tts [{language}]: {len(pcm) / 2 / rate:.2f}s audio @ {rate} Hz in {time.perf_counter() - t0:.2f}s")

    pcm16 = resample_s16le(pcm, rate, PIPELINE_SAMPLE_RATE)
    seconds = len(pcm16) / 2 / PIPELINE_SAMPLE_RATE

    if args.save:
        path = Path(args.save)
        write_wav(path, pcm16, PIPELINE_SAMPLE_RATE)
        print(f"wrote {path} ({seconds:.2f}s @ {PIPELINE_SAMPLE_RATE} Hz)")

    stop_timer: threading.Timer | None = None
    if args.stop_after is not None:
        def _stop() -> None:
            # The adapter's PlayStop is a DDS round trip with a 10s SDK timeout,
            # and cancelling fires it from two threads at once, so give this
            # more than 10s or it reports a false failure while the cut succeeds.
            try:
                r = httpx.post(args.adapter + "/stop", timeout=15.0)
                print(f"\n  /stop after {args.stop_after:.1f}s -> {r.status_code} {r.text.strip()}")
            except httpx.HTTPError as exc:
                print(f"\n  /stop failed: {exc}")

        stop_timer = threading.Timer(args.stop_after, _stop)
        stop_timer.start()

    print(f"POST {args.adapter}/play  ({seconds:.2f}s, {len(pcm16)} bytes) ...")
    t0 = time.perf_counter()
    try:
        response = httpx.post(
            args.adapter + "/play",
            content=pcm16,
            headers={"Content-Type": "application/octet-stream"},
            timeout=seconds + 20.0,
        )
    finally:
        if stop_timer is not None:
            stop_timer.cancel()

    elapsed = time.perf_counter() - t0
    print(f"-> {response.status_code} {response.text.strip()} (round trip {elapsed:.2f}s)")

    if response.status_code != 200:
        return 1

    if args.stop_after is not None:
        # Judge the cut by what the adapter actually played, not by when /play
        # returned: the return also covers PlayStop teardown, which would make
        # a clean cut look slow.
        body = response.json()
        played = body.get("played_s", 0.0)
        overshoot = played - args.stop_after
        if not body.get("cancelled"):
            print("FAIL: /stop did not cancel playback")
            return 1
        print(f"cut at {played:.2f}s, {overshoot:+.2f}s vs the /stop at {args.stop_after:.1f}s "
              + ("(within 1s: OK)" if abs(overshoot) <= 1.0 else "(SLOW: >1s)"))

    # /play returns when the SDK drained the audio, which is not proof it was
    # audible - a busy vui assistant can swallow it. Trust your ears.
    return 0


if __name__ == "__main__":
    sys.exit(main())
