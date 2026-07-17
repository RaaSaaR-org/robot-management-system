"""G1 audio adapter — HTTP wrapper around unitree_sdk2py AudioClient.

Runs in the legacy Python 3.10 DDS venv (cyclonedds 0.10.2 has no cp312
wheels), with PYTHONPATH pointing at unitree_sdk2_python. The 3.12 voice
service talks to it via G1Speaker (voice_service/audio/g1_speaker.py).

    GET  /health   {"status": "ok", "mock": bool}
    POST /play     raw 16 kHz mono s16le PCM body; returns after playback
    POST /stop     stop current playback (PlayStop)
    GET  /volume   {"volume": n}
    POST /volume   {"volume": 0..100}
    POST /led      {"r": 0..255, "g": 0..255, "b": 0..255}

Env: G1_AUDIO_ADAPTER_PORT (8766), G1_NET_INTERFACE ("Ethernet 3"),
     G1_AUDIO_MOCK=1 for robot-less testing (no SDK import).

Run (real robot): scripts/run_g1_adapter.ps1 — or by hand from C:\\Unitree:
    .venv-g1-audio\\Scripts\\python.exe  robot-management-system\\robot-agent\\voice\\adapters\\g1_audio_adapter.py
    (with PYTHONPATH=C:\\Unitree\\unitree_sdk2_python)

We deliberately use PlayStream only — TtsMaker is Chinese/English-only and
its Python binding has a broken tts_index increment.
"""

from __future__ import annotations

import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("G1_AUDIO_ADAPTER_PORT", "8766"))
NET_INTERFACE = os.environ.get("G1_NET_INTERFACE", "Ethernet 3")
MOCK = os.environ.get("G1_AUDIO_MOCK", "0") == "1"

SAMPLE_RATE = 16_000
CHUNK_BYTES = 96_000  # 3 s at 16 kHz s16le — per the official example
CHUNK_SLEEP_S = 1.0
APP_NAME = "neodem-voice"


class MockAudioClient:
    """Stands in for unitree_sdk2py's AudioClient (G1_AUDIO_MOCK=1)."""

    def Init(self) -> None:
        print("[G1 Audio Adapter] MOCK AudioClient initialized")

    def SetTimeout(self, t: float) -> None:
        pass

    def PlayStream(self, app_name: str, stream_id: str, chunk: bytes):
        print(f"[G1 Audio Adapter] MOCK PlayStream({app_name}, {stream_id}, {len(chunk)}B)")
        return 0, None

    def PlayStop(self, app_name: str) -> int:
        print(f"[G1 Audio Adapter] MOCK PlayStop({app_name})")
        return 0

    def GetVolume(self):
        return 0, {"volume": 50}

    def SetVolume(self, volume: int) -> int:
        print(f"[G1 Audio Adapter] MOCK SetVolume({volume})")
        return 0

    def LedControl(self, r: int, g: int, b: int) -> int:
        print(f"[G1 Audio Adapter] MOCK LedControl({r},{g},{b})")
        return 0


def make_client():
    if MOCK:
        return MockAudioClient()
    from unitree_sdk2py.core.channel import ChannelFactoryInitialize
    from unitree_sdk2py.g1.audio.g1_audio_client import AudioClient

    # Domain 0 = real robot (1 = simulation). Never mix.
    ChannelFactoryInitialize(0, NET_INTERFACE)
    client = AudioClient()
    client.SetTimeout(10.0)
    client.Init()
    return client


class Playback:
    """Serialized, cancellable PlayStream playback."""

    def __init__(self, client) -> None:
        self.client = client
        self.lock = threading.Lock()
        self.cancel_event = threading.Event()

    def play(self, pcm: bytes) -> dict:
        if not self.lock.acquire(blocking=False):
            raise BusyError("playback already in progress")
        try:
            self.cancel_event.clear()
            total_s = len(pcm) / 2 / SAMPLE_RATE
            stream_id = str(int(time.time() * 1000))
            started = time.monotonic()
            chunks = 0
            for offset in range(0, len(pcm), CHUNK_BYTES):
                if self.cancel_event.is_set():
                    self.client.PlayStop(APP_NAME)
                    return {"played_s": time.monotonic() - started, "cancelled": True}
                code, _ = self.client.PlayStream(APP_NAME, stream_id, pcm[offset : offset + CHUNK_BYTES])
                if code != 0:
                    self.client.PlayStop(APP_NAME)
                    raise RuntimeError(f"PlayStream failed with code {code}")
                chunks += 1
                if offset + CHUNK_BYTES < len(pcm):
                    self._sleep_cancellable(CHUNK_SLEEP_S)
            # Block until the robot finished the buffered audio, then close
            # the stream. PlayStop right after the last chunk would cut it.
            remaining = total_s - (time.monotonic() - started) + 0.5
            if remaining > 0:
                self._sleep_cancellable(remaining)
            self.client.PlayStop(APP_NAME)
            return {
                "played_s": round(total_s, 2),
                "chunks": chunks,
                "cancelled": self.cancel_event.is_set(),
            }
        finally:
            self.lock.release()

    def _sleep_cancellable(self, seconds: float) -> None:
        self.cancel_event.wait(timeout=seconds)

    def stop(self) -> None:
        self.cancel_event.set()
        self.client.PlayStop(APP_NAME)


class BusyError(Exception):
    pass


def main() -> None:
    client = make_client()
    playback = Playback(client)

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def _send(self, code: int, payload: dict) -> None:
            body = json.dumps(payload).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _read_body(self) -> bytes:
            length = int(self.headers.get("Content-Length") or 0)
            return self.rfile.read(length) if length else b""

        def log_message(self, fmt: str, *args) -> None:
            pass

        def do_GET(self) -> None:  # noqa: N802
            if self.path == "/health":
                self._send(200, {"status": "ok", "mock": MOCK, "interface": NET_INTERFACE})
            elif self.path == "/volume":
                code, data = client.GetVolume()
                if code != 0:
                    self._send(502, {"error": f"GetVolume failed with code {code}"})
                else:
                    self._send(200, data)
            else:
                self._send(404, {"error": f"unknown path {self.path}"})

        def do_POST(self) -> None:  # noqa: N802
            try:
                if self.path == "/play":
                    pcm = self._read_body()
                    if len(pcm) < 2:
                        self._send(400, {"error": "empty PCM body"})
                        return
                    result = playback.play(pcm)
                    self._send(200, result)
                elif self.path == "/stop":
                    playback.stop()
                    self._send(200, {"stopped": True})
                elif self.path == "/volume":
                    body = json.loads(self._read_body() or b"{}")
                    volume = int(body.get("volume", -1))
                    if not 0 <= volume <= 100:
                        self._send(400, {"error": "volume must be 0..100"})
                        return
                    code = client.SetVolume(volume)
                    self._send(200 if code == 0 else 502, {"code": code})
                elif self.path == "/led":
                    body = json.loads(self._read_body() or b"{}")
                    r, g, b = (int(body.get(k, 0)) for k in ("r", "g", "b"))
                    code = client.LedControl(r, g, b)
                    self._send(200 if code == 0 else 502, {"code": code})
                else:
                    self._send(404, {"error": f"unknown path {self.path}"})
            except BusyError as exc:
                self._send(409, {"error": str(exc)})
            except Exception as exc:  # noqa: BLE001
                self._send(500, {"error": str(exc)})

    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    server.daemon_threads = True
    print(f"[G1 Audio Adapter] listening on :{PORT} (mock={MOCK}, iface={NET_INTERFACE})")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("[G1 Audio Adapter] shutting down")


if __name__ == "__main__":
    main()
