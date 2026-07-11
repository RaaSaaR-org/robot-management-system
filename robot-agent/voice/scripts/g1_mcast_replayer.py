"""Replay a WAV file the way the G1 multicasts its microphone audio:
16 kHz mono s16le PCM in 5120-byte (160 ms) UDP packets, paced in real time.

Lets us test the G1 mic backend without the robot:

    Terminal 1:  VOICE_G1_MCAST_GROUP=127.0.0.1 VOICE_INPUT_BACKEND=g1 \
                 uv run python -m voice_service ...
    Terminal 2:  uv run python scripts/g1_mcast_replayer.py out/smoke_tts_de.wav

Usage: g1_mcast_replayer.py <wav> [--dest 127.0.0.1] [--port 5555] [--loop N]
"""

from __future__ import annotations

import argparse
import socket
import sys
import time
import wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from voice_service.audio.resample import downmix_to_mono_s16le, resample_s16le
from voice_service.config import PIPELINE_SAMPLE_RATE

PACKET_BYTES = 16_000 * 2 * 160 // 1000  # 5120 — WAV_LEN_ONCE in the C++ example
PACKET_S = 0.160


def load_wav_as_16k_mono(path: Path) -> bytes:
    with wave.open(str(path), "rb") as w:
        assert w.getsampwidth() == 2, "expected 16-bit WAV"
        pcm = w.readframes(w.getnframes())
        if w.getnchannels() > 1:
            pcm = downmix_to_mono_s16le(pcm, w.getnchannels())
        return resample_s16le(pcm, w.getframerate(), PIPELINE_SAMPLE_RATE)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("wav", type=Path)
    parser.add_argument("--dest", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=5555)
    parser.add_argument("--loop", type=int, default=1)
    parser.add_argument("--tail-silence", type=float, default=2.0,
                        help="seconds of silence packets after the audio")
    args = parser.parse_args()

    pcm = load_wav_as_16k_mono(args.wav)
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    seconds = len(pcm) / 2 / PIPELINE_SAMPLE_RATE
    print(f"replaying {args.wav} ({seconds:.1f}s) -> udp://{args.dest}:{args.port}")

    for _ in range(args.loop):
        for offset in range(0, len(pcm), PACKET_BYTES):
            sock.sendto(pcm[offset : offset + PACKET_BYTES], (args.dest, args.port))
            time.sleep(PACKET_S)
        silence = bytes(PACKET_BYTES)
        for _ in range(int(args.tail_silence / PACKET_S)):
            sock.sendto(silence, (args.dest, args.port))
            time.sleep(PACKET_S)
    print("done")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
