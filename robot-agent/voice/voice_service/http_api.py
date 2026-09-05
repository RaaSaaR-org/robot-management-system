"""HTTP control API for the voice service (stdlib, per repo sidecar convention).

Endpoints:
    GET  /health          liveness + model/agent readiness + the voice packs
    GET  /status          pipeline state, session, last transcript/reply, latency
                          (including TTS latency per voice pack)
    GET  /voices          the declared voice packs and which one is active
    GET  /config          full resolved config
    POST /config          patch runtime-mutable config keys
    POST /say             {"text": "...", "language": "de"|"en"?, "voice": "id"?}
                          -> direct TTS
    POST /listen/toggle   pause/resume the mic pipeline
    POST /session/reset   start a fresh conversation (new A2A contextId)
    GET  /events          Server-Sent Events stream of pipeline events

`voice` is a separate axis from `language` (see tts/registry.py): language says
what the text is, voice says who says it. An unknown voice is 404 and an
unloaded one 409 — never a silent fall back to the default pack, which would
answer a customer's own voice request in somebody else's voice while every
health check stayed green.

The pipeline runs in an asyncio loop; this server runs in threads and calls
into the pipeline only through the thread-safe PipelineController protocol.
"""

from __future__ import annotations

import json
import queue
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Protocol

from .events import EventBus
from .tts.registry import UnknownVoiceError, VoiceError

SSE_HEARTBEAT_S = 15.0


class _QuietHTTPServer(ThreadingHTTPServer):
    """ThreadingHTTPServer that doesn't traceback-spam on client disconnects.

    Pollers (curl, Invoke-RestMethod) drop keep-alive connections between
    requests; on Windows that surfaces as ConnectionResetError (WinError
    10054) inside handle_one_request — routine, not an error.
    """

    def handle_error(self, request, client_address) -> None:
        exc = sys.exc_info()[1]
        if isinstance(exc, (ConnectionResetError, ConnectionAbortedError, BrokenPipeError)):
            return
        super().handle_error(request, client_address)


class PipelineController(Protocol):
    """Thread-safe surface the HTTP API needs from the pipeline."""

    def health(self) -> dict: ...
    def status(self) -> dict: ...
    def voices(self) -> dict: ...
    def get_config(self) -> dict: ...
    def patch_config(self, patch: dict) -> dict: ...
    def say(self, text: str, language: str | None, voice: str | None = None) -> str: ...
    # returns the pack id the utterance will be spoken in
    def toggle_listen(self) -> bool: ...  # returns True if now paused
    def reset_session(self) -> str: ...  # returns new context id


class VoiceHttpServer:
    def __init__(self, port: int, controller: PipelineController, bus: EventBus) -> None:
        self.port = port
        controller_ref = controller
        bus_ref = bus

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            # -- helpers -------------------------------------------------
            def _send(self, code: int, payload: dict) -> None:
                body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
                self.send_response(code)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(body)

            def _read_json(self) -> dict:
                length = int(self.headers.get("Content-Length") or 0)
                if length == 0:
                    return {}
                raw = self.rfile.read(length)
                try:
                    parsed = json.loads(raw)
                except json.JSONDecodeError as exc:
                    raise ValueError(f"invalid JSON body: {exc}") from exc
                if not isinstance(parsed, dict):
                    raise ValueError("JSON body must be an object")
                return parsed

            def log_message(self, fmt: str, *args: object) -> None:
                pass  # keep console output for pipeline events only

            # -- routes --------------------------------------------------
            def do_GET(self) -> None:  # noqa: N802 (stdlib naming)
                try:
                    if self.path == "/health":
                        self._send(200, controller_ref.health())
                    elif self.path == "/status":
                        self._send(200, controller_ref.status())
                    elif self.path == "/voices":
                        self._send(200, controller_ref.voices())
                    elif self.path == "/config":
                        self._send(200, controller_ref.get_config())
                    elif self.path == "/events":
                        self._serve_sse()
                    else:
                        self._send(404, {"error": f"unknown path {self.path}"})
                except BrokenPipeError:
                    pass
                except Exception as exc:  # noqa: BLE001 — report, don't kill the thread
                    self._send(500, {"error": str(exc)})

            def do_POST(self) -> None:  # noqa: N802
                try:
                    if self.path == "/config":
                        changed = controller_ref.patch_config(self._read_json())
                        self._send(200, {"changed": changed})
                    elif self.path == "/say":
                        body = self._read_json()
                        text = str(body.get("text") or "").strip()
                        if not text:
                            self._send(400, {"error": "missing 'text'"})
                            return
                        voice = body.get("voice") or None
                        if voice is not None and not isinstance(voice, str):
                            self._send(400, {"error": "'voice' must be a pack id"})
                            return
                        pack = controller_ref.say(text, body.get("language"), voice)
                        # Echo the pack that will speak, not the one asked for:
                        # a caller that omitted `voice` learns which it got.
                        self._send(202, {"accepted": True, "text": text, "voice": pack})
                    elif self.path == "/listen/toggle":
                        paused = controller_ref.toggle_listen()
                        self._send(200, {"paused": paused})
                    elif self.path == "/session/reset":
                        context_id = controller_ref.reset_session()
                        self._send(200, {"contextId": context_id})
                    else:
                        self._send(404, {"error": f"unknown path {self.path}"})
                except VoiceError as exc:
                    # The client asked for a voice this service cannot speak in.
                    # 404 = no such pack, 409 = declared but did not load; both
                    # carry the registry's own reason, which is the only thing
                    # that tells an operator which of the two it is.
                    code = 404 if isinstance(exc, UnknownVoiceError) else 409
                    self._send(code, {"error": str(exc)})
                except ValueError as exc:
                    self._send(400, {"error": str(exc)})
                except RuntimeError as exc:
                    self._send(503, {"error": str(exc)})
                except BrokenPipeError:
                    pass
                except Exception as exc:  # noqa: BLE001
                    self._send(500, {"error": str(exc)})

            # -- SSE -----------------------------------------------------
            def _serve_sse(self) -> None:
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream; charset=utf-8")
                self.send_header("Cache-Control", "no-cache")
                self.send_header("Access-Control-Allow-Origin", "*")
                # SSE is an unbounded stream: no Content-Length, close on done.
                self.send_header("Connection", "close")
                self.end_headers()
                q = bus_ref.subscribe()
                try:
                    for event in bus_ref.history(limit=5):
                        self._write_sse(event.to_json())
                    while True:
                        try:
                            event = q.get(timeout=SSE_HEARTBEAT_S)
                            self._write_sse(event.to_json())
                        except queue.Empty:
                            self.wfile.write(b": heartbeat\n\n")
                            self.wfile.flush()
                except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
                    pass
                finally:
                    bus_ref.unsubscribe(q)

            def _write_sse(self, data: str) -> None:
                self.wfile.write(f"data: {data}\n\n".encode("utf-8"))
                self.wfile.flush()

        self._server = _QuietHTTPServer(("0.0.0.0", port), Handler)
        self._server.daemon_threads = True
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        self._thread = threading.Thread(
            target=self._server.serve_forever, name="voice-http", daemon=True
        )
        self._thread.start()
        print(f"[Voice] HTTP control API listening on :{self.port}")

    def stop(self) -> None:
        self._server.shutdown()
        self._server.server_close()
