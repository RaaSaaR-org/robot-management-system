"""
Tests for the teleimager image-server camera source in g1_sidecar.py (TASK-233).

On a real G1 this is the only route to the robot's own eyes. Its DDS sibling,
the `videohub` service behind `rt/api/videohub/request`, is regularly dead
(`video_hub_pc4` at status=-1, refusing ServiceSwitch with 5201), whereas
`image_server.py` on PC2 publishes plain JPEG over ZMQ and Unitree's own
teleoperation depends on it.

Everything here runs against a REAL image server — a miniature one built in
this file, speaking the protocol read out of `teleimager/image_client.py`:

  • REQ b"GET_DATA" on the config port -> JSON camera config
  • SUB on each camera's `zmq_port` -> one raw JPEG per message

so the wire format, the "advertise only what can stream" rule and the cheap
failure path when nothing is listening are all exercised for real rather than
mocked. What is NOT covered here is the robot's own server: that it publishes
these ports at all is a robot-day check.

@status test
"""

import os
import sys
import threading
import time

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import g1_sidecar  # noqa: E402

zmq = pytest.importorskip("zmq", reason="teleimager transport needs pyzmq")

# A one-pixel JPEG is a real JPEG: SOI ... EOI. Enough to assert pass-through
# byte for byte, which is the property that matters — the sidecar must not
# re-encode the robot's frames.
JPEG_A = bytes.fromhex("ffd8ffdb0001" "aa" * 1) + b"\xff\xd9"
JPEG_B = bytes.fromhex("ffd8ffdb0001" "bb" * 1) + b"\xff\xd9"


class FakeImageServer:
    """The robot side of the teleimager protocol, in-process."""

    def __init__(self, config_port, cameras):
        """cameras: {name: (zmq_port, enable_zmq)}"""
        self.config_port = config_port
        self.cameras = cameras
        self.cam_config = {
            name: {
                "zmq_port": port,
                "enable_zmq": enabled,
                "image_shape": [480, 640, 3],
                "binocular": False,
            }
            for name, (port, enabled) in cameras.items()
        }
        self._ctx = zmq.Context()
        self._stop = threading.Event()
        self._threads = []

    def start(self):
        rep = self._ctx.socket(zmq.REP)
        rep.bind(f"tcp://127.0.0.1:{self.config_port}")
        self._threads.append(self._spawn(self._serve_config, rep))
        for name, (port, enabled) in self.cameras.items():
            if not enabled:
                continue  # WebRTC-only camera: config advertises it, nothing publishes
            pub = self._ctx.socket(zmq.PUB)
            pub.bind(f"tcp://127.0.0.1:{port}")
            self._threads.append(self._spawn(self._publish, pub, name))
        return self

    def _spawn(self, target, *args):
        t = threading.Thread(target=target, args=args, daemon=True)
        t.start()
        return t

    def _serve_config(self, sock):
        try:
            while not self._stop.is_set():
                if sock.poll(100) & zmq.POLLIN:
                    sock.recv()
                    sock.send_json(self.cam_config)
        finally:
            sock.close()

    def _publish(self, sock, name):
        # Alternating payloads, so a test can tell a live stream from one
        # repeated frame handed back by a stale cache.
        frames = (JPEG_A, JPEG_B) if name == "head_camera" else (JPEG_B, JPEG_A)
        i = 0
        try:
            while not self._stop.is_set():
                sock.send(frames[i % 2])
                i += 1
                time.sleep(0.02)
        finally:
            sock.close()

    def stop(self):
        self._stop.set()
        for t in self._threads:
            t.join(timeout=1.0)
        self._ctx.term()


@pytest.fixture(autouse=True)
def _reset_sidecar_state(monkeypatch):
    """The source caches aggressively on purpose; each test starts clean."""
    monkeypatch.setattr(g1_sidecar, "_teleimager_config", None, raising=False)
    monkeypatch.setattr(g1_sidecar, "_teleimager_subs", {}, raising=False)
    monkeypatch.setattr(g1_sidecar, "_teleimager_absent_until", 0.0, raising=False)
    # Keep the auto-order deterministic: never let a developer's own D435 or a
    # loaded lerobot driver decide what these tests see.
    monkeypatch.setenv("G1_CAMERA_SOURCE", "teleimager")
    yield


@pytest.fixture
def server(monkeypatch, unused_tcp_ports):
    config_port, head_port, wrist_port = unused_tcp_ports
    srv = FakeImageServer(
        config_port,
        {
            "head_camera": (head_port, True),
            "left_wrist_camera": (wrist_port, True),
            # enable_zmq False: the vendor config routes this one to WebRTC.
            "right_wrist_camera": (wrist_port + 1, False),
        },
    ).start()
    monkeypatch.setenv("G1_IMAGE_SERVER_HOST", "127.0.0.1")
    monkeypatch.setenv("G1_IMAGE_SERVER_PORT", str(config_port))
    yield srv
    srv.stop()


@pytest.fixture
def unused_tcp_ports():
    """Three free ports. Bound and released, which is racy in theory and fine
    here — nothing else on a test box is fighting for them."""
    import socket

    ports = []
    socks = []
    for _ in range(3):
        s = socket.socket()
        s.bind(("127.0.0.1", 0))
        socks.append(s)
        ports.append(s.getsockname()[1])
    for s in socks:
        s.close()
    return ports


def test_config_request_finds_the_cameras(server):
    cfg = g1_sidecar._teleimager_cam_config()
    assert cfg is not None
    assert set(cfg) == {"head_camera", "left_wrist_camera", "right_wrist_camera"}


def test_only_zmq_cameras_are_advertised(server):
    # A camera the sidecar cannot stream must not appear in /cameras: that is
    # exactly the defect this whole task exists to stop — offering a name whose
    # stream can never open.
    source, names = g1_sidecar._camera_source_and_names()
    assert source == "teleimager"
    assert names == ("head_camera", "left_wrist_camera")
    assert "right_wrist_camera" not in names


def test_frames_arrive_and_are_passed_through_unmodified(server):
    jpeg = g1_sidecar._teleimager_jpeg_bytes("head_camera")
    assert jpeg in (JPEG_A, JPEG_B)
    assert jpeg.startswith(b"\xff\xd8") and jpeg.endswith(b"\xff\xd9")


def test_the_stream_grabber_reports_the_teleimager_source(server):
    jpeg, source, error, kind = g1_sidecar._grab_camera_jpeg("head_camera")
    assert error is None and kind is None
    assert source == "teleimager"
    assert jpeg in (JPEG_A, JPEG_B)


def test_an_unknown_camera_is_a_name_error_not_a_dead_source(server):
    jpeg, source, error, kind = g1_sidecar._grab_camera_jpeg("nose_camera")
    assert jpeg is None
    assert kind == "unknown_name"
    assert source == "teleimager"
    assert "head_camera" in error


def test_a_webrtc_only_camera_is_refused_by_name(server):
    # It exists in the robot's config but publishes no JPEG, so asking for it
    # must fail as a name, immediately, rather than hanging on a silent socket.
    jpeg, _, _, kind = g1_sidecar._grab_camera_jpeg("right_wrist_camera")
    assert jpeg is None
    assert kind == "unknown_name"


def test_the_stream_keeps_getting_new_frames(server):
    seen = set()
    deadline = time.time() + 3.0
    while len(seen) < 2 and time.time() < deadline:
        jpeg = g1_sidecar._teleimager_jpeg_bytes("head_camera")
        if jpeg:
            seen.add(jpeg)
        time.sleep(0.05)
    # Both alternating payloads means the SUB socket is live, not a cache
    # handing back the one frame it caught on connect.
    assert seen == {JPEG_A, JPEG_B}


def test_no_server_fails_fast_and_stays_cheap(monkeypatch):
    # The failure path matters as much as the happy one: Agent Mode polls a
    # camera every 3 s, and a source that blocks while holding a lock is how
    # the RealSense probe once wedged the whole sidecar.
    import socket

    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    dead_port = s.getsockname()[1]
    s.close()

    monkeypatch.setenv("G1_IMAGE_SERVER_HOST", "127.0.0.1")
    monkeypatch.setenv("G1_IMAGE_SERVER_PORT", str(dead_port))
    monkeypatch.setenv("G1_IMAGE_SERVER_TIMEOUT_MS", "300")

    t0 = time.time()
    assert g1_sidecar._teleimager_cam_config() is None
    first = time.time() - t0

    t1 = time.time()
    assert g1_sidecar._teleimager_cam_config() is None
    cached = time.time() - t1

    assert first < 2.0, "a missing image server must not stall a camera request"
    assert cached < 0.05, "absence must be cached, not re-probed at frame rate"


def test_no_source_message_names_the_image_server():
    # The operator reads this sentence in the cockpit. It has to say which
    # thing to go and start.
    assert "image server" in g1_sidecar._no_camera_source_detail()
    assert "60000" in g1_sidecar._no_camera_source_detail()
