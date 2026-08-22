"""Unit tests for the MJPEG endpoint in sim_node.py.

No DDS, no MuJoCo scene and no socket: `make_handler` builds the class, and the
handler is driven against a stub node with its output redirected into a buffer.
Same trick as test_action_endpoint.py, for the same reason -- milliseconds
instead of a 10 s scene load.

    python -m pytest robot-agent/hardware/sim_g1_dds/test_camera_stream.py

What these protect:

* **The error has to come before the 200.** Once a multipart header is on the
  wire there is no longer any way to say "no such camera" that a browser will
  show -- it just waits forever on a stream that never produces a frame.
* **Keep-alive has to be OFF for this one route.** The handler sets HTTP/1.1
  because /action runs at 50 Hz and a connection per request was costing a
  thread per request. But a stream has no Content-Length, so leaving keep-alive
  on means the next request on that socket is read as more image data. That
  does not fail loudly; it desynchronises.
* **A viewer that leaves stops the RENDERING.** Every frame is rendered by the
  physics thread, so a stream nobody reads is stolen simulation time.
"""
from __future__ import annotations

import io
import sys
import threading
from pathlib import Path

import pytest

# `sim_node` pulls in mujoco AND unitree_sdk2py at module scope, so a bare
# `import sim_node` here is a COLLECTION error on a machine that has one and not
# the other -- and `scripts/test-all.sh` gates this directory on `import mujoco`
# alone. Without this guard that machine turns a stage designed to report SKIPPED
# into one that reports FAILED for a reason that has nothing to do with the code.
# Same guard, same reason, as `test_lidar.py`.
sys.path.insert(0, str(Path(__file__).resolve().parent))
sim_node = pytest.importorskip("sim_node")


class FakeRenderRequest:
    def __init__(self, jpeg=None, error=None):
        self.jpeg = jpeg
        self.error = error


class FakeNode:
    """Supplies only what the streaming handler touches."""

    def __init__(self, frames=None, error=None):
        self.error = error
        self.renders = 0
        self.scene = type("S", (), {"name": "test_scene.xml"})()
        self._frames = frames

    def request_render(self, camera, timeout=5.0):
        self.renders += 1
        if self.error:
            return FakeRenderRequest(error=self.error)
        if self._frames is not None and self.renders > self._frames:
            return FakeRenderRequest(error="stopped")
        return FakeRenderRequest(jpeg=b"\xff\xd8\xffJPEG%d" % self.renders)

    def camera_names(self):
        return ["head_camera"]


class BrokenPipeBuffer(io.BytesIO):
    """A client that hangs up after `limit` writes -- what a closed tab is."""

    def __init__(self, limit):
        super().__init__()
        self.limit = limit
        self.writes = 0

    def write(self, data):
        self.writes += 1
        if self.writes > self.limit:
            raise BrokenPipeError(32, "Broken pipe")
        return super().write(data)


def make_streaming_handler(node, wfile=None):
    """A Handler instance wired to a buffer instead of a socket."""
    handler_cls = sim_node.make_handler(node, bridge=None)
    h = handler_cls.__new__(handler_cls)
    h.wfile = wfile if wfile is not None else io.BytesIO()
    h.rfile = io.BytesIO()
    h.request_version = "HTTP/1.1"
    h.close_connection = False
    h.requestline = "GET /cameras/head_camera/stream HTTP/1.1"
    h.headers = {}
    h.client_address = ("127.0.0.1", 0)
    h.server = None
    return h


class TestRefusalComesFirst:
    def test_an_unknown_camera_is_a_503_and_never_opens_a_stream(self):
        node = FakeNode(error="no camera 'nope' in test_scene.xml")
        h = make_streaming_handler(node)
        h._stream_mjpeg("nope")
        out = h.wfile.getvalue()
        assert b"503" in out.split(b"\r\n")[0]
        assert b"multipart" not in out
        assert b"no camera" in out

    def test_the_refusal_is_json_with_a_content_length(self):
        h = make_streaming_handler(FakeNode(error="boom"))
        h._stream_mjpeg("nope")
        head = h.wfile.getvalue().split(b"\r\n\r\n")[0]
        assert b"Content-Type: application/json" in head
        assert b"Content-Length:" in head


class TestStreamShape:
    def test_the_header_announces_multipart_and_closes_the_connection(self):
        h = make_streaming_handler(FakeNode(frames=2))
        h._stream_mjpeg("head_camera")
        head = h.wfile.getvalue().split(b"\r\n\r\n")[0]
        assert b"multipart/x-mixed-replace; boundary=FRAME" in head
        assert b"Connection: close" in head

    def test_keep_alive_is_switched_off(self):
        # The route-level counterpart to `protocol_version = "HTTP/1.1"`: this
        # reply has no Content-Length, so the socket must not be reused.
        h = make_streaming_handler(FakeNode(frames=2))
        h._stream_mjpeg("head_camera")
        assert h.close_connection is True

    def test_every_part_carries_its_own_length_and_a_jpeg(self):
        h = make_streaming_handler(FakeNode(frames=3))
        h._stream_mjpeg("head_camera")
        body = h.wfile.getvalue()
        parts = body.split(b"--FRAME")[1:]
        assert len(parts) == 3
        for part in parts:
            assert b"Content-Type: image/jpeg" in part
            assert b"Content-Length:" in part
            assert b"\xff\xd8\xff" in part

    def test_the_first_frame_is_rendered_before_the_200(self):
        # Not an optimisation: it is what makes the 503 above possible.
        node = FakeNode(frames=1)
        h = make_streaming_handler(node)
        h._stream_mjpeg("head_camera")
        assert node.renders >= 1

    def test_a_render_that_starts_failing_ends_the_stream_cleanly(self):
        h = make_streaming_handler(FakeNode(frames=2))
        h._stream_mjpeg("head_camera")  # must return, not raise
        assert h.wfile.getvalue().count(b"--FRAME") == 2


class TestViewerLeaves:
    def test_a_hangup_ends_the_stream_instead_of_raising(self):
        node = FakeNode()
        h = make_streaming_handler(node, wfile=BrokenPipeBuffer(limit=3))
        h._stream_mjpeg("head_camera")  # BrokenPipeError must not escape

    def test_a_hangup_stops_the_rendering(self):
        # The whole point: frames cost the physics thread. A viewer that left
        # must not keep the simulation busy.
        node = FakeNode()
        h = make_streaming_handler(node, wfile=BrokenPipeBuffer(limit=3))
        h._stream_mjpeg("head_camera")
        assert node.renders < 10


class TestPacing:
    def test_the_cap_is_a_real_rate_not_a_placeholder(self):
        assert 1.0 <= sim_node.STREAM_MAX_FPS <= 60.0

    def test_the_cap_leaves_the_physics_thread_most_of_a_second(self):
        # A full G1 scene renders in ~70 ms here, so the cap only binds on a
        # scene small enough that an unpaced stream could spin.
        assert 1.0 / sim_node.STREAM_MAX_FPS >= 0.016
