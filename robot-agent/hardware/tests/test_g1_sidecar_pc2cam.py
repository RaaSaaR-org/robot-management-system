"""
Tests for the PC2 head-camera source in g1_sidecar.py (TASK-233).

This is the route that actually reaches the G1 EDU's eyes in this lab. The head
RealSense D435i is on PC2's USB, not the workstation's, and PC2 serves it with
`g1_cam_pub.py` under the `g1-head-cam` systemd unit — a script that exists
because PC2's ROS 2 Foxy install segfaults, so it skips ROS and speaks straight
TCP:

    uint32 be length | uint64 be ns timestamp | <length> bytes of JPEG

Every test here runs against a real socket server built in this file, so the
framing, the reconnect and the cheap-failure path are exercised for real.

The two behaviours worth stating outright, because both were observed on the
robot and both would otherwise be silent bugs:

  • The publisher encodes ONLY while a client is connected. A reader that
    reconnected per frame would spend its life waiting for the first encode,
    so the reader holds the socket open.
  • When the RealSense re-enumerated on PC2's USB (2026-09-04 00:44) the
    publisher dropped its clients. A sidecar that gave up there would need a
    restart to see the camera again, so the reader reconnects by itself — and
    drops its cached frame, because a frozen picture labelled LIVE is worse
    than an honest empty panel.

@status test
"""

import os
import socket
import struct
import sys
import threading
import time

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import g1_sidecar  # noqa: E402

HDR = struct.Struct("!IQ")
JPEG_A = b"\xff\xd8\xff\xdb\x00\x01\xaa\xff\xd9"
JPEG_B = b"\xff\xd8\xff\xdb\x00\x01\xbb\xff\xd9"


class FakePublisher:
    """g1_cam_pub.py's wire protocol, in-process."""

    def __init__(self, frames=(JPEG_A, JPEG_B), corrupt_length=False):
        self.frames = frames
        self.corrupt_length = corrupt_length
        self._srv = socket.socket()
        self._srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self._srv.bind(("127.0.0.1", 0))
        self._srv.listen(4)
        self.port = self._srv.getsockname()[1]
        self._stop = threading.Event()
        self.connections = 0
        self._thread = threading.Thread(target=self._serve, daemon=True)

    def start(self):
        self._thread.start()
        return self

    def _serve(self):
        self._srv.settimeout(0.2)
        while not self._stop.is_set():
            try:
                conn, _ = self._srv.accept()
            except socket.timeout:
                continue
            except OSError:
                break
            self.connections += 1
            threading.Thread(target=self._pump, args=(conn,), daemon=True).start()

    def _pump(self, conn):
        i = 0
        try:
            while not self._stop.is_set():
                payload = self.frames[i % len(self.frames)]
                length = 1 << 30 if self.corrupt_length else len(payload)
                conn.sendall(HDR.pack(length, time.time_ns()) + payload)
                i += 1
                time.sleep(0.02)
        except OSError:
            pass
        finally:
            conn.close()

    def drop_clients(self):
        """What the publisher does when the camera re-enumerates."""
        self._stop.set()
        time.sleep(0.15)
        self._stop.clear()

    def stop(self):
        self._stop.set()
        try:
            self._srv.close()
        except OSError:
            pass


@pytest.fixture(autouse=True)
def _reset(monkeypatch):
    monkeypatch.setattr(g1_sidecar, "_pc2cam_reader", None, raising=False)
    monkeypatch.setattr(g1_sidecar, "_pc2cam_absent_until", 0.0, raising=False)
    monkeypatch.setenv("G1_CAMERA_SOURCE", "pc2cam")
    monkeypatch.setenv("G1_PC2_CAMERA_HOST", "127.0.0.1")
    yield
    reader = getattr(g1_sidecar, "_pc2cam_reader", None)
    if reader is not None:
        reader._stop.set()


@pytest.fixture
def publisher(monkeypatch):
    pub = FakePublisher().start()
    monkeypatch.setenv("G1_PC2_CAMERA_PORT", str(pub.port))
    yield pub
    pub.stop()


def _wait_for_frame(timeout=5.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        jpeg = g1_sidecar._pc2cam_jpeg_bytes()
        if jpeg:
            return jpeg
        time.sleep(0.05)
    return None


def test_the_camera_is_advertised_when_pc2_is_serving(publisher):
    source, names = g1_sidecar._camera_source_and_names()
    assert source == "pc2cam"
    assert names == ("head_camera",)


def test_frames_are_length_prefix_framed_and_passed_through(publisher):
    jpeg = _wait_for_frame()
    assert jpeg in (JPEG_A, JPEG_B)
    # Byte-exact: the sidecar must not decode and re-encode the robot's frames.
    assert jpeg.startswith(b"\xff\xd8") and jpeg.endswith(b"\xff\xd9")


def test_the_grabber_reports_the_pc2cam_source(publisher):
    _wait_for_frame()
    jpeg, source, error, kind = g1_sidecar._grab_camera_jpeg("head_camera")
    assert error is None and kind is None
    assert source == "pc2cam"
    assert jpeg in (JPEG_A, JPEG_B)


def test_frames_keep_advancing(publisher):
    _wait_for_frame()
    seen = set()
    deadline = time.time() + 3.0
    while len(seen) < 2 and time.time() < deadline:
        jpeg = g1_sidecar._pc2cam_jpeg_bytes()
        if jpeg:
            seen.add(jpeg)
        time.sleep(0.03)
    assert seen == {JPEG_A, JPEG_B}, "the reader is handing back one cached frame"


def test_one_connection_is_held_open_not_reopened_per_frame(publisher):
    # The publisher idles until a client connects; reconnecting per frame would
    # mean never catching an encode.
    _wait_for_frame()
    for _ in range(10):
        g1_sidecar._pc2cam_jpeg_bytes()
        time.sleep(0.02)
    # One probe connect from _pc2cam_available() plus the reader's own.
    assert publisher.connections <= 2


def test_an_unknown_camera_is_a_name_error(publisher):
    _wait_for_frame()
    jpeg, source, error, kind = g1_sidecar._grab_camera_jpeg("nose_camera")
    assert jpeg is None
    assert kind == "unknown_name"
    assert source == "pc2cam"


def test_it_reconnects_after_the_publisher_drops_clients(publisher):
    # Exactly what happened on the robot when the D435i re-enumerated.
    assert _wait_for_frame() is not None
    before = publisher.connections
    publisher.drop_clients()
    assert _wait_for_frame(timeout=8.0) is not None
    assert publisher.connections > before, "the reader never reconnected"


def test_an_implausible_frame_length_is_refused(monkeypatch):
    # Trusting the header would mean allocating whatever it claims.
    pub = FakePublisher(corrupt_length=True).start()
    monkeypatch.setenv("G1_PC2_CAMERA_PORT", str(pub.port))
    monkeypatch.setenv("G1_PC2_CAMERA_FIRST_FRAME_S", "0.5")
    try:
        assert g1_sidecar._pc2cam_jpeg_bytes() is None
    finally:
        pub.stop()


def test_no_publisher_fails_fast_and_caches_absence(monkeypatch):
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    dead_port = s.getsockname()[1]
    s.close()
    monkeypatch.setenv("G1_PC2_CAMERA_PORT", str(dead_port))

    t0 = time.time()
    assert g1_sidecar._pc2cam_available() is False
    first = time.time() - t0

    t1 = time.time()
    assert g1_sidecar._pc2cam_available() is False
    cached = time.time() - t1

    assert first < 2.0, "a missing publisher must not stall a camera request"
    assert cached < 0.05, "absence must be cached, not re-probed at frame rate"


def test_the_no_source_message_points_at_pc2():
    # The operator reads this in the cockpit; it has to name the thing to check.
    detail = g1_sidecar._NO_CAMERA_SOURCE_DETAIL
    assert "g1-head-cam" in detail
    assert "5600" in detail
