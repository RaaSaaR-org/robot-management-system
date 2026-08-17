#!/usr/bin/env python3
"""
say_service.py -- a stand-in for the robot's voice service, for filming.

    python3 say_service.py [--port 8768] [--out-dir DIR] [--voice-de Anna] [--voice-en Samantha]

The robot-agent POSTs every utterance to `VOICE_SERVICE_URL/say` and treats the
response as "this reached the visitor's ears" -- that is what
`TourRun.disclosureSpoken` records (TASK-213). Without a service running, host
mode still works but every block reports "text-only", and a demo video of a
robot that TALKS to people then has nothing to hear.

This serves that endpoint with macOS `say`. It is not the production voice
service and does not pretend to be one: no wake word, no microphone, no
half-duplex muting. What it gives the camera is real: each utterance takes the
time it takes to speak, so the robot's timeline paces itself the way it would
next to a person, and every line is written to `voicelog.jsonl` with the wall
clock and its duration -- which is what lets a clip be re-mixed with the audio
sitting exactly where the robot said it.

    POST /say   {"text": "...", "language": "de"|"en"}  -> {"ok": true, "seconds": 4.2}
    GET  /health                                         -> {"ok": true, "spoken": 12}
"""

from __future__ import annotations

import argparse
import json
import pathlib
import re
import subprocess
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

STATE = {"out_dir": pathlib.Path("."), "voice": {"de": "Anna", "en": "Samantha"},
         "rate": 175, "spoken": 0, "log": None, "mute": False, "max_block": 8.5}
LOCK = threading.Lock()  # one mouth: utterances queue instead of overlapping


def _slug(text: str, n: int = 40) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower())[:n].strip("-") or "utterance"


def speak(text: str, language: str) -> dict:
    """Synthesise, then play. Returns the record that was appended to the log."""
    with LOCK:
        # One mouth: an utterance that outran `max_block` is still playing, and
        # the next line waits for it rather than talking over it.
        prev = STATE.get("playing")
        if prev is not None and prev.poll() is None:
            prev.wait()
        idx = STATE["spoken"] + 1
        voice = STATE["voice"].get(language, STATE["voice"]["en"])
        path = STATE["out_dir"] / f"{idx:03d}-{_slug(text)}.aiff"
        subprocess.run(["say", "-v", voice, "-r", str(STATE["rate"]), "-o", str(path), text],
                       check=True)
        seconds = 0.0
        try:
            out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                                  "-of", "csv=p=0", str(path)], capture_output=True, text=True, check=True)
            seconds = float(out.stdout.strip())
        except Exception:  # noqa: BLE001 -- a missing duration only costs the mixer a hint
            pass
        wall = time.time()
        if not STATE["mute"]:
            play = subprocess.Popen(["afplay", str(path)])
            STATE["playing"] = play
            # The agent's voice client gives up after 10 s
            # (`speakThroughVoiceService`) and then records the utterance as NOT
            # spoken -- so a long line is answered before its tail has played
            # rather than being reported as silence. The audio is real either
            # way; only the robot's wait for it is cut short.
            try:
                play.wait(timeout=STATE["max_block"])
            except subprocess.TimeoutExpired:
                print(f"[say]   (still playing at {STATE['max_block']}s -- answering now)")
        rec = {"at": datetime.now(timezone.utc).isoformat(), "wall": wall, "seconds": seconds,
               "language": language, "voice": voice, "text": text, "file": path.name}
        STATE["spoken"] = idx
        with STATE["log"].open("a") as fh:
            fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
        print(f"[say] {seconds:5.1f}s {language} {text[:70]}")
        return rec


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args) -> None:  # noqa: D102 -- the prints above are the log
        pass

    def _send(self, code: int, body: dict) -> None:
        raw = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self) -> None:  # noqa: N802
        if self.path.startswith("/health"):
            self._send(200, {"ok": True, "spoken": STATE["spoken"], "voice": STATE["voice"]})
        else:
            self._send(404, {"ok": False, "error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        if not self.path.startswith("/say"):
            self._send(404, {"ok": False, "error": "not found"})
            return
        try:
            n = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(n) or b"{}")
        except Exception as err:  # noqa: BLE001
            self._send(400, {"ok": False, "error": str(err)})
            return
        text = (body.get("text") or "").strip()
        if not text:
            self._send(400, {"ok": False, "error": "'text' is required"})
            return
        try:
            rec = speak(text, body.get("language") or "en")
        except Exception as err:  # noqa: BLE001
            self._send(500, {"ok": False, "error": str(err)})
            return
        self._send(200, {"ok": True, "seconds": rec["seconds"], "file": rec["file"]})


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=8768)
    ap.add_argument("--out-dir", default="./voice")
    ap.add_argument("--voice-de", default="Anna")
    ap.add_argument("--voice-en", default="Samantha")
    ap.add_argument("--rate", type=int, default=175, help="words per minute")
    ap.add_argument("--max-block-s", type=float, default=8.5, dest="max_block",
                    help="stop waiting for an utterance after this many seconds and answer the "
                         "robot; it keeps playing (default 8.5 -- the agent gives up at 10)")
    ap.add_argument("--mute", action="store_true",
                    help="synthesise and log, but do not play out loud (keeps the timing, "
                         "spares the room)")
    args = ap.parse_args()
    out = pathlib.Path(args.out_dir).resolve()
    out.mkdir(parents=True, exist_ok=True)
    STATE.update({"out_dir": out, "voice": {"de": args.voice_de, "en": args.voice_en},
                  "rate": args.rate, "log": out / "voicelog.jsonl", "mute": args.mute,
                  "max_block": args.max_block})
    print(f"[say] voice service stand-in on :{args.port} -> {out}  "
          f"(de={args.voice_de}, en={args.voice_en}, {args.rate} wpm)")
    ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
