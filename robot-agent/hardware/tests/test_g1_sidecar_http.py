"""g1_sidecar.py's HTTP server sets TCP_NODELAY on every accepted socket (TASK-415).

`Handler._send` writes headers and body as two segments. The sim's facade, which
keeps connections alive, lost every other `/state/fast` request to Nagle holding
the body for a delayed ACK (~40 ms). This handler still answers HTTP/1.0 and
closes after each reply, which pushes the held segment out at once -- measured
offline at 0.6 ms median -- so the flag is insurance against the day it moves
to keep-alive. These tests pin the flag and that it reaches the socket.

The camera snapshot's `?format=raw` (TASK-445) is pinned here too: it is the one
route that reads a query string, and before it did, HardwareClient's snapshotRaw
paid a 404 and a retry for every recorded frame.

@status test
"""

import base64
import http.client
import json
import os
import socket
import sys
import threading
from http.server import ThreadingHTTPServer

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import g1_sidecar  # noqa: E402


def test_handler_disables_nagle():
    assert g1_sidecar.Handler.disable_nagle_algorithm is True


def test_accepted_socket_has_tcp_nodelay():
    seen = []

    class Probe(g1_sidecar.Handler):
        def setup(self):
            super().setup()
            seen.append(self.connection.getsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY))

        def do_GET(self):  # no DDS, no camera: only the socket is under test
            self._send(200, {"ok": True})

    server = ThreadingHTTPServer(("127.0.0.1", 0), Probe)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        conn = http.client.HTTPConnection("127.0.0.1", server.server_address[1], timeout=5)
        conn.request("GET", "/health")
        assert conn.getresponse().status == 200
        conn.close()
    finally:
        server.shutdown()
        server.server_close()
    assert seen and seen[0] != 0


JPEG = b"\xff\xd8\xff\xdb\x00\x01raw\xff\xd9"


def _serve(monkeypatch, grab):
    monkeypatch.setattr(g1_sidecar, "_grab_camera_jpeg", grab)
    server = ThreadingHTTPServer(("127.0.0.1", 0), g1_sidecar.Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def _get(server, path):
    conn = http.client.HTTPConnection("127.0.0.1", server.server_address[1], timeout=5)
    conn.request("GET", path)
    res = conn.getresponse()
    out = (res.status, res.getheader("Content-Type"), res.read())
    conn.close()
    return out


def test_format_raw_answers_image_jpeg(monkeypatch):
    asked = []
    server = _serve(monkeypatch, lambda name, resolved=None: asked.append(name) or (JPEG, "pc2cam", None, None))
    try:
        status, ctype, body = _get(server, "/cameras/left_wrist_camera/snapshot?format=raw")
        # The recorder's own query, render options and all.
        status2, ctype2, body2 = _get(
            server, "/cameras/head_camera/snapshot?format=raw&shadows=0&reflection=0&quality=90")
    finally:
        server.shutdown()
        server.server_close()
    assert (status, ctype, body) == (200, "image/jpeg", JPEG)
    assert (status2, ctype2, body2) == (200, "image/jpeg", JPEG)
    assert asked == ["left_wrist_camera", "head_camera"]


def test_the_plain_snapshot_is_unchanged(monkeypatch):
    server = _serve(monkeypatch, lambda name, resolved=None: (JPEG, "pc2cam", None, None))
    try:
        status, ctype, body = _get(server, "/cameras/head_camera/snapshot")
    finally:
        server.shutdown()
        server.server_close()
    assert status == 200 and ctype == "application/json"
    assert json.loads(body) == {"ok": True, "camera": "head_camera",
                                "jpeg_base64": base64.b64encode(JPEG).decode(), "source": "pc2cam"}


def test_format_raw_failure_keeps_the_plain_failure_shape(monkeypatch):
    # HardwareClient reads `error` out of a JSON 200 on the plain route; the raw
    # route fails the same way, so the caller needs no second failure path.
    server = _serve(monkeypatch, lambda name, resolved=None: (None, "pc2cam", "camera gone", "no_source"))
    try:
        status, ctype, body = _get(server, "/cameras/left_wrist_camera/snapshot?format=raw")
    finally:
        server.shutdown()
        server.server_close()
    assert status == 200 and ctype == "application/json"
    assert json.loads(body) == {"ok": False, "error": "camera gone"}


def test_other_routes_still_match_the_whole_path(monkeypatch):
    server = _serve(monkeypatch, lambda name, resolved=None: (JPEG, "pc2cam", None, None))
    try:
        status, _, _ = _get(server, "/cameras/head_camera/stream?format=raw")
        status2, _, _ = _get(server, "/cameras?x=1")
    finally:
        server.shutdown()
        server.server_close()
    assert status == 404 and status2 == 404
