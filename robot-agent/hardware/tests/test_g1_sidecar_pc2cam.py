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

    def __init__(self, frames=(JPEG_A, JPEG_B), corrupt_length=False, period=0.02):
        self.frames = frames
        self.corrupt_length = corrupt_length
        self.period = period
        self._srv = socket.socket()
        self._srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self._srv.bind(("127.0.0.1", 0))
        self._srv.listen(4)
        self.port = self._srv.getsockname()[1]
        self._stop = threading.Event()
        self._clients = set()
        self._clients_lock = threading.Lock()
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
            with self._clients_lock:
                self._clients.add(conn)
            threading.Thread(target=self._pump, args=(conn,), daemon=True).start()

    def _pump(self, conn):
        i = 0
        try:
            while not self._stop.is_set():
                payload = self.frames[i % len(self.frames)]
                length = 1 << 30 if self.corrupt_length else len(payload)
                conn.sendall(HDR.pack(length, time.time_ns()) + payload)
                i += 1
                time.sleep(self.period)
        except OSError:
            pass
        finally:
            with self._clients_lock:
                self._clients.discard(conn)
            conn.close()

    def drop_clients(self):
        """What the publisher does when the camera re-enumerates."""
        # Keep accepting reconnects. Toggling _stop also stopped the listener
        # permanently whenever its accept timeout landed during the pause.
        with self._clients_lock:
            clients = list(self._clients)
        for conn in clients:
            try:
                conn.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            conn.close()

    def stop(self):
        self._stop.set()
        self.drop_clients()
        try:
            self._srv.close()
        except OSError:
            pass


@pytest.fixture(autouse=True)
def _reset(monkeypatch):
    # Every endpoint's reader and cooldown, the head's included (TASK-445).
    monkeypatch.setattr(g1_sidecar, "_pc2cam_endpoints", {})
    monkeypatch.setenv("G1_CAMERA_SOURCE", "pc2cam")
    monkeypatch.setenv("G1_PC2_CAMERA_HOST", "127.0.0.1")
    monkeypatch.delenv("G1_WRIST_CAMERAS", raising=False)
    yield
    for state in list(g1_sidecar._pc2cam_endpoints.values()):
        if state.reader is not None:
            state.reader._stop.set()


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


def test_a_reader_faster_than_the_camera_gets_the_held_frame_at_once(monkeypatch):
    # The real head camera runs at ~15 fps and the episode recorder asks for a
    # frame 30 times a second. Every ask must answer at once with the newest
    # frame -- the same one twice when no new frame has landed -- because the
    # recorder drops any tick that has not come back within its 33 ms period,
    # and a snapshot that waited for a fresh frame would halve the dataset.
    pub = FakePublisher(period=1 / 15).start()
    monkeypatch.setenv("G1_PC2_CAMERA_PORT", str(pub.port))
    try:
        assert _wait_for_frame() is not None
        reads, slowest = [], 0.0
        for _ in range(30):
            t = time.perf_counter()
            reads.append(g1_sidecar._pc2cam_jpeg_bytes())
            slowest = max(slowest, time.perf_counter() - t)
            time.sleep(1 / 30)
        assert all(r in (JPEG_A, JPEG_B) for r in reads), "a read came back empty"
        assert slowest < 1 / 30, f"a read blocked for {slowest * 1000:.1f} ms"
        # 30 reads of a 15 fps stream: the picture can change at most ~16 times,
        # so the rest are the held frame. Loose bound; this is wall-clock.
        repeats = sum(1 for a, b in zip(reads, reads[1:]) if a == b)
        assert repeats >= 5
    finally:
        pub.stop()


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
    publisher.frames = (b"\xff\xd8reconnected\xff\xd9",)
    publisher.drop_clients()
    deadline = time.monotonic() + 8.0
    while time.monotonic() < deadline:
        if (publisher.connections > before
                and g1_sidecar._pc2cam_jpeg_bytes() == publisher.frames[0]):
            break
        time.sleep(0.05)
    else:
        pytest.fail("the reader did not receive a fresh frame after reconnecting")
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
    assert g1_sidecar._pc2cam_available() == (False, False)
    first = time.time() - t0

    t1 = time.time()
    assert g1_sidecar._pc2cam_available() == (False, False)
    cached = time.time() - t1

    assert first < 2.0, "a missing publisher must not stall a camera request"
    assert cached < 0.05, "absence must be cached, not re-probed at frame rate"


def test_the_no_source_message_points_at_pc2():
    # The operator reads this in the cockpit; it has to name the thing to check.
    detail = g1_sidecar._no_camera_source_detail()
    assert "g1-head-cam" in detail
    assert "5600" in detail


def test_the_no_source_message_names_the_configured_host(monkeypatch):
    # It has to name the box that is actually configured, not this lab's.
    monkeypatch.setenv("G1_PC2_CAMERA_HOST", "10.9.9.9")
    monkeypatch.setenv("G1_PC2_CAMERA_PORT", "5678")
    detail = g1_sidecar._no_camera_source_detail()
    assert "10.9.9.9" in detail
    assert "5678" in detail


def test_a_stream_does_not_reprobe_the_sources_ahead_of_it(monkeypatch, publisher):
    """The frame loop must not pay for a source it already ruled out.

    `auto` tries teleimager before pc2cam, and an image server that is not
    running only fails cheaply for the length of its cooldown. Measured against
    this lab's rig — pc2cam serving, pyzmq installed, no image server — a loop
    that re-resolved per frame froze the 15 fps stream for a full second every
    five. The source is therefore pinned for the life of the stream.
    """
    import json
    import urllib.error
    import urllib.request
    from http.server import ThreadingHTTPServer

    monkeypatch.setenv("G1_CAMERA_SOURCE", "auto")
    monkeypatch.setenv("G1_CAMERA_STREAM_FPS", "15")
    # Stand in for the absent image server: one probe is fine, per frame is not.
    probes = []

    def _slow_absent_teleimager():
        probes.append(time.time())
        time.sleep(1.0)
        return None

    monkeypatch.setattr(g1_sidecar, "_teleimager_cam_config", _slow_absent_teleimager)
    monkeypatch.setattr(g1_sidecar, "_lerobot_camera_names", lambda: ())
    assert _wait_for_frame() is not None

    server = ThreadingHTTPServer(("127.0.0.1", 0), g1_sidecar.Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        port = server.server_address[1]
        probes.clear()
        res = urllib.request.urlopen(
            f"http://127.0.0.1:{port}/cameras/head_camera/stream", timeout=10
        )
        assert res.status == 200
        deadline = time.time() + 3.0
        boundaries = 0
        while time.time() < deadline and boundaries < 20:
            line = res.readline()
            if not line:
                break
            if line.strip() == b"--FRAME":
                boundaries += 1
        res.close()
    finally:
        server.shutdown()
        server.server_close()

    assert boundaries >= 20, f"the 15 fps stream stalled: {boundaries} frames in 3 s"
    assert len(probes) <= 1, (
        f"the source was re-resolved {len(probes)} times mid-stream; each one is "
        "a second the viewer spends looking at a frozen picture labelled LIVE"
    )


# ---------------------------------------------------------------------------
# Wrist cameras (TASK-445)
# ---------------------------------------------------------------------------
# A wrist camera is its own publisher in the same wire format, named in
# G1_WRIST_CAMERAS. The properties pinned below are the ones an operator would
# otherwise discover on the robot: that each name shows its own camera and never
# the head's, that a missing wrist takes nothing else down with it, and that a
# robot with no wrist cameras configured answers exactly what it did before.

import json  # noqa: E402
import urllib.request  # noqa: E402
from http.server import ThreadingHTTPServer  # noqa: E402

JPEG_LEFT = b"\xff\xd8\xff\xdb\x00\x01LEFT\xff\xd9"
JPEG_RIGHT = b"\xff\xd8\xff\xdb\x00\x01RIGHT\xff\xd9"


def _dead_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


@pytest.fixture
def sidecar():
    server = ThreadingHTTPServer(("127.0.0.1", 0), g1_sidecar.Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{server.server_address[1]}"
    server.shutdown()
    server.server_close()


def _get_json(url, timeout=10):
    with urllib.request.urlopen(url, timeout=timeout) as res:
        return res.status, json.loads(res.read())


def _mjpeg_frames(res, count, timeout):
    """`[(arrival time, jpeg)]` from a multipart MJPEG response."""
    frames = []
    deadline = time.time() + timeout
    while len(frames) < count and time.time() < deadline:
        line = res.readline()
        if not line:
            break
        if line.strip() != b"--FRAME":
            continue
        length = None
        while True:
            header = res.readline().strip()
            if not header:
                break
            if header.lower().startswith(b"content-length:"):
                length = int(header.split(b":", 1)[1])
        frames.append((time.time(), res.read(length)))
    return frames


@pytest.fixture
def three_cameras(monkeypatch, publisher):
    """A head publisher plus a left and a right wrist publisher on their own ports."""
    left = FakePublisher(frames=(JPEG_LEFT,)).start()
    right = FakePublisher(frames=(JPEG_RIGHT,)).start()
    monkeypatch.setenv(
        "G1_WRIST_CAMERAS",
        f"left_wrist_camera@127.0.0.1:{left.port},right_wrist_camera@127.0.0.1:{right.port}",
    )
    yield publisher, left, right
    left.stop()
    right.stop()


# --- G1_WRIST_CAMERAS parsing -------------------------------------------------

def test_wrist_cameras_parse_in_order_and_skip_blanks(monkeypatch):
    monkeypatch.setenv("G1_WRIST_CAMERAS",
                       " left_wrist_camera@10.0.0.2:5601, ,right_wrist_camera@[::1]:5602,")
    assert list(g1_sidecar._wrist_camera_endpoints().items()) == [
        ("left_wrist_camera", ("10.0.0.2", 5601)),
        ("right_wrist_camera", ("::1", 5602)),
    ]


@pytest.mark.parametrize("raw", ["", "   ", ",,"])
def test_no_wrist_cameras_when_unset_or_empty(monkeypatch, raw):
    monkeypatch.setenv("G1_WRIST_CAMERAS", raw)
    assert g1_sidecar._wrist_camera_endpoints() == {}


def test_a_malformed_entry_is_skipped_and_logged_once(monkeypatch, capsys):
    monkeypatch.setattr(g1_sidecar, "_wrist_cameras_logged", set())
    raw = ("left_wrist_camera@10.0.0.2:5601,"
           "nohost:5601,"                      # no @
           "bad name@10.0.0.2:5603,"           # name outside [A-Za-z0-9_-]
           "x@10.0.0.2:notaport,"
           "y@10.0.0.2:70000,"
           "head_camera@10.0.0.2:5604,"        # would alias the head camera
           "left_wrist_camera@10.0.0.3:5605,"  # duplicate name
           "right_wrist_camera@10.0.0.2:5602")
    assert g1_sidecar._parse_wrist_cameras(raw) == {
        "left_wrist_camera": ("10.0.0.2", 5601),
        "right_wrist_camera": ("10.0.0.2", 5602),
    }
    first = capsys.readouterr().out
    assert first.count("G1_WRIST_CAMERAS: skipping") == 6
    g1_sidecar._parse_wrist_cameras(raw)
    assert "skipping" not in capsys.readouterr().out, "logged again on the next request"


def test_the_cameras_off_switch_turns_the_wrists_off_too(monkeypatch):
    def boom(*_a, **_k):
        raise AssertionError("probed a wrist camera with G1_CAMERA_SOURCE off")

    monkeypatch.setenv("G1_WRIST_CAMERAS", "left_wrist_camera@127.0.0.1:5601")
    monkeypatch.setattr(g1_sidecar, "_pc2cam_available", boom)
    for value in ("none", "off"):
        monkeypatch.setenv("G1_CAMERA_SOURCE", value)
        assert g1_sidecar._wrist_camera_endpoints() == {}
        assert g1_sidecar._camera_listing() == (None, (), None, g1_sidecar._no_camera_source_detail())
        jpeg, _, _, kind = g1_sidecar._grab_camera_jpeg("left_wrist_camera")
        assert jpeg is None and kind == "no_source"


# --- Head-only: what it was before -------------------------------------------

def test_head_only_cameras_body_is_todays_plus_configured(sidecar, publisher):
    # The epic's first acceptance criterion: no G1_WRIST_CAMERAS, and /cameras
    # is today's answer with one additive field and nothing else.
    _wait_for_frame()
    status, body = _get_json(f"{sidecar}/cameras")
    assert status == 200
    assert body == {"cameras": ["head_camera"], "source": "pc2cam", "configured": ["head_camera"]}


def test_head_only_without_a_camera_answers_exactly_as_before(sidecar, monkeypatch):
    monkeypatch.setenv("G1_PC2_CAMERA_PORT", str(_dead_port()))
    status, body = _get_json(f"{sidecar}/cameras")
    assert status == 200
    # No `configured` at all: a robot with nothing configured has nothing to add.
    assert set(body) == {"cameras", "source", "detail"}
    assert body["cameras"] == [] and body["source"] is None
    assert body["detail"].startswith(
        "no camera source available. The robot's head camera is served by PC2 — "
        "check `systemctl status g1-head-cam` on 127.0.0.1")
    assert "wrist" not in body["detail"]


def test_head_only_stream_resolves_once_and_probes_no_wrist(monkeypatch, sidecar, publisher):
    _wait_for_frame()
    probed = []
    real = g1_sidecar._pc2cam_available

    def spy(name=None):
        probed.append(name)
        return real(name)

    monkeypatch.setattr(g1_sidecar, "_pc2cam_available", spy)
    res = urllib.request.urlopen(f"{sidecar}/cameras/head_camera/stream", timeout=10)
    frames = _mjpeg_frames(res, 5, 3.0)
    res.close()
    assert len(frames) == 5
    assert {f for _, f in frames} <= {JPEG_A, JPEG_B}
    assert set(probed) == {None}


# --- Head + two wrists ----------------------------------------------------------

def test_all_three_are_listed_head_first(sidecar, three_cameras):
    _wait_for_frame()
    status, body = _get_json(f"{sidecar}/cameras")
    assert status == 200
    assert body == {
        "cameras": ["head_camera", "left_wrist_camera", "right_wrist_camera"],
        "source": "pc2cam",
        "configured": ["head_camera", "left_wrist_camera", "right_wrist_camera"],
    }


def _snapshot_jpeg(base, name, timeout=8.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        _, body = _get_json(f"{base}/cameras/{name}/snapshot")
        if body.get("ok"):
            import base64
            return body["source"], base64.b64decode(body["jpeg_base64"])
        time.sleep(0.05)
    pytest.fail(f"no snapshot from {name}")


def test_each_snapshot_is_that_cameras_own_frame(sidecar, three_cameras):
    assert _snapshot_jpeg(sidecar, "head_camera")[1] in (JPEG_A, JPEG_B)
    assert _snapshot_jpeg(sidecar, "left_wrist_camera") == ("pc2cam", JPEG_LEFT)
    assert _snapshot_jpeg(sidecar, "right_wrist_camera") == ("pc2cam", JPEG_RIGHT)


def test_each_raw_snapshot_is_that_cameras_own_frame(sidecar, three_cameras):
    _snapshot_jpeg(sidecar, "left_wrist_camera")  # starts the reader
    for name, expected in (("left_wrist_camera", {JPEG_LEFT}),
                           ("right_wrist_camera", {JPEG_RIGHT}),
                           ("head_camera", {JPEG_A, JPEG_B})):
        _snapshot_jpeg(sidecar, name)
        with urllib.request.urlopen(
                f"{sidecar}/cameras/{name}/snapshot?shadows=0&format=raw&quality=90",
                timeout=10) as res:
            assert res.headers["Content-Type"] == "image/jpeg"
            assert res.read() in expected


@pytest.mark.parametrize("name,expected", [
    ("left_wrist_camera", JPEG_LEFT),
    ("right_wrist_camera", JPEG_RIGHT),
])
def test_a_wrist_stream_serves_only_that_wrist(monkeypatch, sidecar, three_cameras, name, expected):
    # A wrist stream never even resolves the head's sources: it is pinned by
    # name to its own publisher.
    resolved = []
    real = g1_sidecar._head_source_and_names
    monkeypatch.setattr(g1_sidecar, "_head_source_and_names",
                        lambda: resolved.append(1) or real())
    res = urllib.request.urlopen(f"{sidecar}/cameras/{name}/stream", timeout=10)
    frames = _mjpeg_frames(res, 10, 4.0)
    res.close()
    assert len(frames) == 10
    assert {f for _, f in frames} == {expected}
    assert resolved == []


def test_a_down_wrist_is_configured_but_not_served(monkeypatch, sidecar, publisher):
    right = FakePublisher(frames=(JPEG_RIGHT,)).start()
    dead = _dead_port()
    monkeypatch.setenv(
        "G1_WRIST_CAMERAS",
        f"left_wrist_camera@127.0.0.1:{dead},right_wrist_camera@127.0.0.1:{right.port}",
    )
    try:
        _wait_for_frame()
        _, body = _get_json(f"{sidecar}/cameras")
        assert body["cameras"] == ["head_camera", "right_wrist_camera"]
        assert body["configured"] == ["head_camera", "left_wrist_camera", "right_wrist_camera"]
        assert body["source"] == "pc2cam"
        assert "detail" not in body, "the head is up: there is no 'no camera' to explain"

        # The missing wrist names its own endpoint, on the stream and the snapshot.
        try:
            urllib.request.urlopen(f"{sidecar}/cameras/left_wrist_camera/stream", timeout=10)
            pytest.fail("a down wrist answered a stream")
        except urllib.error.HTTPError as e:
            assert e.code == 503
            err = json.loads(e.read())["error"]
            assert f"127.0.0.1:{dead}" in err and "left_wrist_camera" in err
        _, snap = _get_json(f"{sidecar}/cameras/left_wrist_camera/snapshot")
        assert snap["ok"] is False and f"127.0.0.1:{dead}" in snap["error"]

        # And the others are untouched.
        assert _snapshot_jpeg(sidecar, "right_wrist_camera")[1] == JPEG_RIGHT
        assert _snapshot_jpeg(sidecar, "head_camera")[1] in (JPEG_A, JPEG_B)
    finally:
        right.stop()


def test_a_down_head_does_not_hide_live_wrists(monkeypatch, sidecar):
    left = FakePublisher(frames=(JPEG_LEFT,)).start()
    monkeypatch.setenv("G1_PC2_CAMERA_PORT", str(_dead_port()))
    dead = _dead_port()
    monkeypatch.setenv(
        "G1_WRIST_CAMERAS",
        f"left_wrist_camera@127.0.0.1:{left.port},right_wrist_camera@127.0.0.1:{dead}",
    )
    try:
        _, body = _get_json(f"{sidecar}/cameras")
        assert body["cameras"] == ["left_wrist_camera"]
        assert body["source"] == "pc2cam"
        assert body["configured"] == ["head_camera", "left_wrist_camera", "right_wrist_camera"]
        # The reason names the head, and the wrist that is down — not the live one.
        assert body["detail"].startswith("no head camera source available.")
        assert f"127.0.0.1:{dead}" in body["detail"]
        assert f"127.0.0.1:{left.port}" not in body["detail"]
        assert _snapshot_jpeg(sidecar, "left_wrist_camera")[1] == JPEG_LEFT
    finally:
        left.stop()


def test_nothing_up_lists_every_configured_camera(monkeypatch, sidecar):
    monkeypatch.setenv("G1_PC2_CAMERA_PORT", str(_dead_port()))
    monkeypatch.setenv("G1_WRIST_CAMERAS", f"left_wrist_camera@127.0.0.1:{_dead_port()}")
    _, body = _get_json(f"{sidecar}/cameras")
    assert body["cameras"] == [] and body["source"] is None
    assert body["configured"] == ["head_camera", "left_wrist_camera"]
    assert "Wrist camera 'left_wrist_camera' does not answer" in body["detail"]


def _slow_connect_for(monkeypatch, ports, delay=1.0):
    """Make a connect to `ports` behave like a host that is gone: the full
    timeout, then a failure. Every other connect is the real one."""
    real = socket.create_connection
    slow = []

    def fake(address, *args, **kwargs):
        if address[1] in ports:
            slow.append(address[1])
            time.sleep(delay)
            raise OSError("timed out")
        return real(address, *args, **kwargs)

    monkeypatch.setattr(g1_sidecar.socket, "create_connection", fake)
    return slow


def test_missing_wrists_are_probed_side_by_side_and_then_cached(monkeypatch, publisher):
    a, b = _dead_port(), _dead_port()
    monkeypatch.setenv("G1_WRIST_CAMERAS",
                       f"left_wrist_camera@127.0.0.1:{a},right_wrist_camera@127.0.0.1:{b}")
    _wait_for_frame()
    slow = _slow_connect_for(monkeypatch, {a, b})

    t0 = time.time()
    assert g1_sidecar._camera_source_and_names() == ("pc2cam", ("head_camera",))
    first = time.time() - t0
    t1 = time.time()
    assert g1_sidecar._camera_source_and_names() == ("pc2cam", ("head_camera",))
    cached = time.time() - t1

    assert sorted(slow) == sorted([a, b]), "each missing wrist is probed exactly once"
    assert first < 1.6, f"two missing wrists cost {first:.2f} s: they were probed one after the other"
    assert cached < 0.1, "a missing wrist must be cached, not re-probed per /cameras"


def test_a_flapping_wrist_never_stalls_the_head_stream(monkeypatch, sidecar, three_cameras):
    """The head stream keeps its rate while a wrist drops its clients over and
    over, a third wrist's host is gone, and /cameras is polled throughout —
    every one of which used to share the head's lock and its probe."""
    head, left, right = three_cameras
    gone = _dead_port()
    monkeypatch.setenv(
        "G1_WRIST_CAMERAS",
        f"left_wrist_camera@127.0.0.1:{left.port},"
        f"right_wrist_camera@127.0.0.1:{right.port},"
        f"third_wrist_camera@127.0.0.1:{gone}",
    )
    monkeypatch.setattr(g1_sidecar, "_PC2CAM_ABSENT_COOLDOWN_S", 0.2)
    _slow_connect_for(monkeypatch, {gone})
    monkeypatch.setenv("G1_CAMERA_STREAM_FPS", "15")
    _wait_for_frame()
    _snapshot_jpeg(sidecar, "left_wrist_camera")

    stop = threading.Event()

    def flap():
        while not stop.is_set():
            left.drop_clients()
            stop.wait(0.3)

    def poll():
        while not stop.is_set():
            try:
                _get_json(f"{sidecar}/cameras")
                _get_json(f"{sidecar}/cameras/left_wrist_camera/snapshot")
            except Exception:  # noqa: BLE001 — the flapping wrist may refuse
                pass

    workers = [threading.Thread(target=flap, daemon=True),
               threading.Thread(target=poll, daemon=True)]
    res = urllib.request.urlopen(f"{sidecar}/cameras/head_camera/stream", timeout=10)
    try:
        for w in workers:
            w.start()
        frames = _mjpeg_frames(res, 60, 6.0)
    finally:
        stop.set()
        res.close()
        for w in workers:
            w.join(timeout=5)

    assert len(frames) == 60, f"the head stream delivered {len(frames)} of 60 frames"
    assert {f for _, f in frames} <= {JPEG_A, JPEG_B}, "a wrist frame reached the head stream"
    gaps = [b[0] - a[0] for a, b in zip(frames, frames[1:])]
    assert max(gaps) < 0.4, f"the head stream froze for {max(gaps):.2f} s"
