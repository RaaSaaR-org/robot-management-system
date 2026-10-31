"""
Tests for camera_pub.py, the wrist camera publisher (TASK-444).

The publisher must be indistinguishable on the wire from PC2's head publisher
`g1_cam_pub.py`, because the sidecar reads a wrist camera with exactly the reader it
uses for the head:

    uint32 be length | uint64 be ns timestamp | <length> bytes of JPEG

Every test runs the publisher on a real socket with a fake frame source in place of
OpenCV, so the framing, the shared encode, the slow-client drop and the reopen after a
USB re-enumeration are exercised for real. The last test points the sidecar's own pc2cam
reader at a running publisher and takes a frame out of /cameras/head_camera/snapshot.

@status test
"""

import ast
import base64
import io
import json
import os
import signal
import socket
import struct
import subprocess
import sys
import threading
import time
import urllib.request

import pytest

HW_DIR = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, HW_DIR)

import camera_pub  # noqa: E402

HDR = struct.Struct("!IQ")
#: A real 8x8 JPEG, so "valid JPEG" can mean more than the two marker bytes.
JPEG = bytes.fromhex(
    "ffd8ffe000104a46494600010100000100010000ffdb004300100b0c0e0c0a100e0d0e121110131828"
    "1a181616183123251d283a333d3c3933383740485c4e404457453738506d51575f626768673e4d7179"
    "7064785c656763ffdb0043011112121815182f1a1a2f6342384263636363636363636363636363636363"
    "63636363636363636363636363636363636363636363636363636363636363636363ffc00011080008"
    "000803012200021101031101ffc4001f0000010501010101010100000000000000000102030405060708"
    "090a0bffc400b5100002010303020403050504040000017d010203000411051221314106135161072271"
    "14328191a1082342b1c11552d1f02433627282090a161718191a25262728292a3435363738393a434445"
    "464748494a535455565758595a636465666768696a737475767778797a838485868788898a9293949596"
    "9798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae1e2"
    "e3e4e5e6e7e8e9eaf1f2f3f4f5f6f7f8f9faffc4001f01000301010101010101010100000000000001020304"
    "05060708090a0bffc400b51100020102040403040705040400010277000102031104052131061241510761"
    "711322328108144291a1b1c109233352f0156272d10a162434e125f11718191a262728292a3536373839"
    "3a434445464748494a535455565758595a636465666768696a737475767778797a82838485868788898a"
    "92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7"
    "d8d9dae2e3e4e5e6e7e8e9eaf2f3f4f5f6f7f8f9faffda000c03010002110311003f00cba28a2b88fa63ffd9"
)


class FakeSource:
    """Stands in for UvcCamera: paced grabs, a counted encode, scriptable failures.

    Each encode returns JPEG with a 4-byte frame number appended after EOI (decoders
    ignore trailing bytes), so two clients can be shown to receive the same frames.
    """

    def __init__(self, period=0.01):
        self.period = period
        self.opens = 0
        self.closes = 0
        self.encodes = 0
        self.fail_grabs = 0     # the next N grabs fail
        self.fail_opens = 0     # the next N opens fail
        self.is_open = False
        self._frame = 0
        self._lock = threading.Lock()

    def open(self):
        with self._lock:
            if self.fail_opens > 0:
                self.fail_opens -= 1
                return False
            self.opens += 1
            self.is_open = True
            return True

    def grab(self):
        time.sleep(self.period)
        with self._lock:
            if self.fail_grabs > 0:
                self.fail_grabs -= 1
                return False
            self._frame += 1
            return True

    def retrieve_jpeg(self, quality):
        with self._lock:
            self.encodes += 1
            return JPEG + struct.pack("!I", self._frame)

    def close(self):
        with self._lock:
            if self.is_open:
                self.closes += 1
            self.is_open = False


@pytest.fixture
def source():
    return FakeSource()


@pytest.fixture
def publisher(source):
    logs = []
    pub = camera_pub.CameraPublisher(source, port=0, bind="127.0.0.1", name="test",
                                     reopen_delay_s=0.05, log=logs.append)
    pub.logs = logs
    pub.start()
    yield pub
    pub.stop()


def _read_exactly(sock, n):
    buf = bytearray()
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            return None
        buf += chunk
    return bytes(buf)


def _read_frame(sock):
    header = _read_exactly(sock, HDR.size)
    if header is None:
        return None
    length, ts_ns = HDR.unpack(header)
    payload = _read_exactly(sock, length)
    return length, ts_ns, payload


def _connect(pub):
    sock = socket.create_connection(("127.0.0.1", pub.port), timeout=5.0)
    sock.settimeout(5.0)
    return sock


def _wait_until(pred, timeout=5.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if pred():
            return True
        time.sleep(0.01)
    return pred()


def test_a_client_receives_frames_in_the_head_cameras_wire_format(publisher):
    with _connect(publisher) as sock:
        before = time.time_ns()
        length, ts_ns, payload = _read_frame(sock)
        after = time.time_ns()
    assert length == len(payload) == len(JPEG) + 4
    assert payload.startswith(b"\xff\xd8") and payload[:len(JPEG)].endswith(b"\xff\xd9")
    # A wall-clock capture time in ns, like the head publisher's — not monotonic,
    # not seconds. The frame was grabbed at most a moment before the read.
    assert before - 2_000_000_000 < ts_ns <= after
    try:
        from PIL import Image
    except ImportError:
        return
    assert Image.open(io.BytesIO(payload)).size == (8, 8)


def test_two_clients_get_the_same_frames_from_one_encode(publisher, source):
    with _connect(publisher) as a, _connect(publisher) as b:
        assert _wait_until(lambda: publisher.client_count == 2)
        # Both clients see the same frame numbers once both are connected. Skip
        # whatever arrived before the second connect.
        first_b = _read_frame(b)[2]
        frames_a = [_read_frame(a)[2] for _ in range(40)]
        assert first_b in frames_a
        start = frames_a.index(first_b)
        frames_b = [first_b] + [_read_frame(b)[2] for _ in range(len(frames_a) - start - 1)]
        assert frames_a[start:] == frames_b
        # One encode per frame, not one per client.
        frame_numbers = {struct.unpack("!I", f[-4:])[0] for f in frames_a}
        assert source.encodes <= max(frame_numbers) + 1


def test_nothing_is_encoded_while_nobody_is_watching(publisher, source):
    assert _wait_until(lambda: source._frame >= 20), "the camera should still be grabbed"
    assert source.encodes == 0
    with _connect(publisher) as sock:
        assert _read_frame(sock) is not None
    assert source.encodes > 0
    assert _wait_until(lambda: publisher.client_count == 0)
    settled = source.encodes
    grabbed = source._frame
    assert _wait_until(lambda: source._frame >= grabbed + 20)
    # At most the frame already in flight when the client went away.
    assert source.encodes <= settled + 1


def test_a_read_failure_reopens_the_camera_and_drops_the_clients(publisher, source):
    with _connect(publisher) as sock:
        assert _read_frame(sock) is not None
        source.fail_grabs = 1
        # Dropped, like the head publisher does on a USB re-enumeration: the sidecar
        # then clears its cached frame instead of showing a frozen one as live.
        deadline = time.time() + 5.0
        frame = True
        while frame is not None and time.time() < deadline:
            frame = _read_frame(sock)
        assert frame is None
    assert _wait_until(lambda: source.opens == 2)
    assert source.closes >= 1
    with _connect(publisher) as sock:
        assert _read_frame(sock) is not None, "serving resumes after the reopen"
    assert sum("read failed, reopening" in line for line in publisher.logs) == 1


def test_an_outage_is_logged_once_however_long_it_lasts(publisher, source):
    assert _wait_until(lambda: source.opens == 1)
    source.fail_opens = 10
    source.fail_grabs = 1
    assert _wait_until(lambda: source.fail_opens == 0 and source.opens == 2)
    assert _wait_until(lambda: any("camera back" in line for line in publisher.logs))
    assert sum("read failed, reopening" in line for line in publisher.logs) == 1
    assert not any("cannot open" in line for line in publisher.logs)


def test_a_camera_absent_at_start_is_waited_for(source):
    source.fail_opens = 5
    logs = []
    pub = camera_pub.CameraPublisher(source, port=0, bind="127.0.0.1",
                                     reopen_delay_s=0.02, log=logs.append).start()
    try:
        # The port is up even while the camera is not, so the sidecar can connect.
        with _connect(pub) as sock:
            assert _read_frame(sock) is not None
    finally:
        pub.stop()
    assert sum("cannot open the camera" in line for line in logs) == 1


class BigFrameSource(FakeSource):
    """Quarter-megabyte frames, so a client that never reads fills its socket fast."""

    def retrieve_jpeg(self, quality):
        jpeg = super().retrieve_jpeg(quality)
        return jpeg[:-4] + b"\x00" * (256 * 1024) + jpeg[-4:]


def test_a_slow_client_is_dropped_and_the_others_keep_their_frames():
    source = BigFrameSource()
    logs = []
    pub = camera_pub.CameraPublisher(source, port=0, bind="127.0.0.1",
                                     client_backlog=2, log=logs.append).start()
    slow = socket.socket()
    slow.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 4096)
    slow.connect(("127.0.0.1", pub.port))  # and never read from it
    try:
        with _connect(pub) as fast:
            assert _wait_until(lambda: pub.client_count == 2)
            deadline = time.time() + 15.0
            while pub.client_count > 1 and time.time() < deadline:
                assert _read_frame(fast) is not None, "the fast client was stalled or dropped"
            assert pub.client_count == 1, "the slow client should have been dropped"
            for _ in range(10):
                assert _read_frame(fast) is not None
    finally:
        slow.close()
        pub.stop()
    assert any("cannot keep up" in line for line in logs)


def test_stop_closes_the_device_and_the_port(source):
    pub = camera_pub.CameraPublisher(source, port=0, bind="127.0.0.1",
                                     log=lambda _m: None).start()
    port = pub.port
    assert _wait_until(lambda: source.is_open)
    pub.stop()
    assert not source.is_open
    with pytest.raises(OSError):
        socket.create_connection(("127.0.0.1", port), timeout=1.0).close()


# -- portability: PC2 runs Python 3.8 and may have no OpenCV ----------------------

def test_the_file_parses_with_python_38_grammar():
    with open(os.path.join(HW_DIR, "camera_pub.py")) as f:
        source = f.read()
    ast.parse(source, feature_version=(3, 8))


def _run_python(code, timeout=20):
    return subprocess.run([sys.executable, "-c", code], cwd=HW_DIR,
                          capture_output=True, text=True, timeout=timeout)


def test_it_imports_without_opencv():
    # sys.modules[name] = None makes any import of it fail, installed or not.
    out = _run_python(
        "import sys; sys.modules['cv2'] = None\n"
        "import camera_pub\n"
        "camera_pub.CameraPublisher(object(), port=0)\n"
        "print('ok')\n"
    )
    assert out.returncode == 0, out.stderr
    assert out.stdout.strip() == "ok"


def test_without_opencv_main_says_so_and_exits_2():
    out = _run_python(
        "import sys; sys.modules['cv2'] = None\n"
        "import camera_pub\n"
        "sys.exit(camera_pub.main(['--device', '/dev/null', '--port', '0']))\n"
    )
    assert out.returncode == 2
    assert "OpenCV is not installed" in out.stderr


def test_sigterm_closes_the_sockets_and_the_device(tmp_path):
    marker = tmp_path / "closed"
    script = (
        "import sys, time\n"
        "import camera_pub\n"
        "class Src:\n"
        "    def open(self): return True\n"
        "    def grab(self): time.sleep(0.01); return True\n"
        "    def retrieve_jpeg(self, q): return b'\\xff\\xd8\\xff\\xd9'\n"
        "    def close(self): open(%r, 'w').write('closed')\n"
        "pub = camera_pub.CameraPublisher(Src(), port=0, bind='127.0.0.1')\n"
        "_start = pub.start\n"
        "def start():\n"
        "    r = _start(); print('PORT', pub.port, flush=True); return r\n"
        "pub.start = start\n"
        "sys.exit(camera_pub.serve_until_signalled(pub))\n"
    ) % str(marker)
    proc = subprocess.Popen([sys.executable, "-c", script], cwd=HW_DIR,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        port = None
        deadline = time.time() + 10.0
        while port is None and time.time() < deadline:
            line = proc.stdout.readline()
            if line.startswith("PORT "):
                port = int(line.split()[1])
        assert port, "the publisher never came up"
        client = socket.create_connection(("127.0.0.1", port), timeout=5.0)
        client.settimeout(5.0)
        assert _read_frame(client) is not None
        proc.send_signal(signal.SIGTERM)
        assert proc.wait(timeout=10) == 0
        assert _drain_until_eof(client), "the client socket should be closed"
        client.close()
        assert marker.read_text() == "closed"
    finally:
        if proc.poll() is None:
            proc.terminate()
            proc.wait(timeout=10)


def _drain_until_eof(sock):
    while True:
        chunk = sock.recv(1 << 20)
        if not chunk:
            return True


def test_the_cli_defaults_match_the_wrist_camera_contract():
    args = camera_pub.parse_args(["--device", "/dev/v4l/by-id/x"])
    assert (args.port, args.bind) == (5601, "0.0.0.0")
    assert (args.width, args.height, args.fps, args.quality) == (640, 480, 30, 85)


# -- round trip through the sidecar's own reader ---------------------------------

def test_the_sidecars_pc2cam_reader_gets_a_frame_through_snapshot(monkeypatch, publisher):
    from http.server import ThreadingHTTPServer

    import g1_sidecar

    monkeypatch.setattr(g1_sidecar, "_pc2cam_reader", None, raising=False)
    monkeypatch.setattr(g1_sidecar, "_pc2cam_absent_until", 0.0, raising=False)
    monkeypatch.setenv("G1_CAMERA_SOURCE", "pc2cam")
    monkeypatch.setenv("G1_PC2_CAMERA_HOST", "127.0.0.1")
    monkeypatch.setenv("G1_PC2_CAMERA_PORT", str(publisher.port))

    server = ThreadingHTTPServer(("127.0.0.1", 0), g1_sidecar.Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        url = "http://127.0.0.1:%d/cameras/head_camera/snapshot" % server.server_address[1]
        body = {}
        deadline = time.time() + 10.0
        while not body.get("ok") and time.time() < deadline:
            with urllib.request.urlopen(url, timeout=10) as res:
                body = json.loads(res.read())
            if not body.get("ok"):
                time.sleep(0.1)
    finally:
        server.shutdown()
        server.server_close()
        reader = g1_sidecar._pc2cam_reader
        if reader is not None:
            reader._stop.set()

    assert body.get("ok"), body
    assert body["source"] == "pc2cam"
    jpeg = base64.b64decode(body["jpeg_base64"])
    assert jpeg[:len(JPEG)] == JPEG
