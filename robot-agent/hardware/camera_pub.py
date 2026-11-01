#!/usr/bin/env python3
"""
camera_pub.py — one USB (UVC) camera served over TCP in the head camera's wire format.

The G1's head camera reaches the sidecar through PC2's `g1_cam_pub.py` (systemd unit
`g1-head-cam`, port 5600). This is the same thing for a wrist camera, one process per
camera, so the sidecar reads a wrist camera with exactly the reader it already uses for
the head (`g1_sidecar.py`, pc2cam). Per frame, to every connected client:

    uint32 be length | uint64 be ns timestamp | <length> bytes of JPEG

Behaviour the sidecar relies on, kept identical to the head publisher:

  • It encodes ONLY while at least one client is connected. While nobody watches it
    still grabs (no decode, no encode), so the camera's own buffer never hands the
    next client a picture from minutes ago, and an unplugged camera is noticed at once.
  • One encode per frame, shared by every client. A client that cannot keep up is
    dropped rather than allowed to stall the others — the sidecar reconnects by itself.
  • A read failure (USB re-enumeration, a loose cable) closes the device, drops the
    clients, and reopens it once a second until it is back, logging once per outage.
    Dropping the clients is what makes the sidecar clear its cached frame: a frozen
    picture labelled LIVE is worse than an honest empty panel. A single frame that
    will not encode is skipped; MAX_BAD_FRAMES in a row count as a read failure.
  • The port takes connections ONLY while the camera delivers frames. It is bound at
    start (so a port in use fails at once) but listens only from the first good frame;
    an outage closes the listener with the clients, and it listens again on the same
    port once the camera is back. So a successful TCP connect means "this camera is up" — the
    sidecar's availability check and the supervisor's Set up step rely on that, and a
    missing wrist camera is refused rather than accepted and left silent.

Pass the device by a stable path — `/dev/v4l/by-id/...` or `/dev/v4l/by-path/...` — so
the camera keeps its identity when it re-enumerates as a different `/dev/videoN`. The
path is resolved again on every reopen.

Runs on PC2 (Ubuntu 20.04, Python 3.8, apt's python3-opencv) or on the lab PC: stdlib
plus OpenCV, and OpenCV is imported only when a real camera is opened, so the module and
its tests load without it. Read-only towards the robot: it opens a camera and a TCP
listener, and nothing else.

    python3 camera_pub.py --device /dev/v4l/by-id/usb-...-video-index0 --port 5601 \
        --name left_wrist_camera

Install steps and a systemd unit: docs/g1-edu-lab-bringup.md, "Wrist cameras".

@status live-conditional — runs only where an operator installs it (TASK-444)
"""

import argparse
import os
import queue
import signal
import socket
import struct
import sys
import threading
import time
from typing import Callable, List, Optional

#: The head camera's frame header: payload length, then capture time in ns.
FRAME_HEADER = struct.Struct("!IQ")

DEFAULT_PORT = 5601
REOPEN_DELAY_S = 1.0
#: How long a client may block one send before it counts as gone.
CLIENT_SEND_TIMEOUT_S = 5.0
#: How often the accept loop wakes to see whether it should stop.
ACCEPT_POLL_S = 0.5
#: Frames in a row that grab but will not decode or encode before the camera counts as
#: failed. A single bad frame is skipped; a run of them means the device is broken.
MAX_BAD_FRAMES = 5

# What one pass of the capture loop came to (CameraPublisher._grab_and_publish).
_SENT = "sent"
_GRABBED = "grabbed"
_BAD_FRAME = "bad_frame"
_READ_FAILED = "read_failed"


class UvcCamera:
    """The real frame source: OpenCV over V4L2, MJPG requested from the camera.

    The publisher talks to a source through four methods only — `open`, `grab`,
    `retrieve_jpeg`, `close` — so the tests can hand it a fake one. `grab` takes a
    frame off the device without decoding it; `retrieve_jpeg` decodes and encodes the
    last grabbed frame, and is only called while someone is watching.
    """

    def __init__(self, device: str, width: int, height: int, fps: int):
        self.device = device
        self.width = width
        self.height = height
        self.fps = fps
        self._cap = None
        self._cv2 = None

    def _target(self):
        # A bare index ("0") is what OpenCV expects for /dev/video0; anything else is a
        # path, resolved now so a by-id symlink follows the camera to its new node.
        if self.device.isdigit():
            return int(self.device)
        return os.path.realpath(self.device)

    def open(self) -> bool:
        import cv2  # lazily: the module and its tests must load without OpenCV

        self._cv2 = cv2
        cap = cv2.VideoCapture(self._target(), cv2.CAP_V4L2)
        if not cap.isOpened():
            cap.release()
            return False
        # FOURCC before the size: some UVC cameras offer 640x480@30 only as MJPG and
        # fall back to a slow YUYV mode when the size is set first.
        cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, self.width)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self.height)
        cap.set(cv2.CAP_PROP_FPS, self.fps)
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        self._cap = cap
        return True

    def describe(self) -> str:
        """The mode the camera actually agreed to, which need not be the one asked for."""
        if self._cap is None or self._cv2 is None:
            return "closed"
        cv2 = self._cv2
        w = int(self._cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        h = int(self._cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        fps = self._cap.get(cv2.CAP_PROP_FPS)
        code = int(self._cap.get(cv2.CAP_PROP_FOURCC))
        fourcc = "".join(chr((code >> (8 * i)) & 0xFF) for i in range(4))
        return "%dx%d@%g %s" % (w, h, fps, fourcc)

    def grab(self) -> bool:
        return self._cap is not None and bool(self._cap.grab())

    def retrieve_jpeg(self, quality: int) -> Optional[bytes]:
        if self._cap is None or self._cv2 is None:
            return None
        ok, frame = self._cap.retrieve()
        if not ok or frame is None:
            return None
        ok, buf = self._cv2.imencode(".jpg", frame, [int(self._cv2.IMWRITE_JPEG_QUALITY), quality])
        return buf.tobytes() if ok else None

    def close(self) -> None:
        if self._cap is not None:
            try:
                self._cap.release()
            finally:
                self._cap = None


class _Client:
    """One connected reader: a bounded queue of frames and a thread that sends them.

    The capture loop never blocks on a client; it offers each frame, and a client whose
    queue is full is too slow and gets dropped.
    """

    def __init__(self, sock: socket.socket, addr, backlog: int,
                 on_gone: Callable[["_Client"], None]):
        self.sock = sock
        self.label = "%s:%s" % (addr[0], addr[1]) if isinstance(addr, tuple) else str(addr)
        self._queue = queue.Queue(maxsize=backlog)  # type: queue.Queue
        self._closed = threading.Event()
        self._on_gone = on_gone
        self._thread = threading.Thread(target=self._send_loop, daemon=True)

    def start(self) -> None:
        self._thread.start()

    def offer(self, packet: bytes) -> bool:
        """Queue one frame; False when the client is too far behind to take it."""
        if self._closed.is_set():
            return False
        try:
            self._queue.put_nowait(packet)
            return True
        except queue.Full:
            return False

    def close(self) -> None:
        if self._closed.is_set():
            return
        self._closed.set()
        try:
            self.sock.shutdown(socket.SHUT_RDWR)  # unblocks a sendall in progress
        except OSError:
            pass
        try:
            self._queue.put_nowait(None)  # wakes a sender waiting for a frame
        except queue.Full:
            pass

    def _send_loop(self) -> None:
        try:
            while not self._closed.is_set():
                packet = self._queue.get()
                if packet is None or self._closed.is_set():
                    break
                self.sock.sendall(packet)
        except OSError:
            pass
        finally:
            self._closed.set()
            try:
                self.sock.close()
            except OSError:
                pass
            self._on_gone(self)


class CameraPublisher:
    """Serves one frame source on a TCP port in the head camera's wire format.

    `start()` binds the port once to check it, so a port already in use fails at once,
    and then lets go of it: the port listens only while the camera delivers frames.
    Before the first frame and during an outage no socket is open on it, so a connect
    is refused and a probe that can connect knows the camera is up. (A socket bound
    without listening would not do: macOS drops the SYN instead of refusing it.)
    """

    def __init__(self, source, port: int = DEFAULT_PORT, bind: str = "0.0.0.0",
                 quality: int = 85, name: str = "camera",
                 reopen_delay_s: float = REOPEN_DELAY_S, client_backlog: int = 30,
                 log: Optional[Callable[[str], None]] = None):
        self.source = source
        self.bind = bind
        self.quality = quality
        self.name = name
        self.reopen_delay_s = reopen_delay_s
        self.client_backlog = max(1, client_backlog)
        self._log = log or (lambda msg: print(msg, flush=True))
        self._requested_port = port
        self._port = None  # type: Optional[int]
        # The listening socket, open only while the camera is up. A new one after each
        # outage, since a socket cannot stop listening without being closed.
        self._sock = None  # type: Optional[socket.socket]
        self._accepting = False
        self._accept_thread = None  # type: Optional[threading.Thread]
        self._accept_closing = None  # type: Optional[threading.Event]
        self._sock_lock = threading.Lock()
        self._listen_error = ""
        self._served_before = False
        self._clients = []  # type: List[_Client]
        self._clients_lock = threading.Lock()
        self._stop = threading.Event()
        self._threads = []  # type: List[threading.Thread]
        self._last_open_error = ""

    # -- lifecycle ----------------------------------------------------------------

    def start(self) -> "CameraPublisher":
        # Bind once to fail fast on a port in use and to learn the port when 0 was asked
        # for, then release it until the camera delivers its first frame.
        probe = self._bind_socket(self._requested_port)
        self._port = probe.getsockname()[1]
        self._close_quietly(probe)
        t = threading.Thread(target=self._capture_loop, daemon=True)
        t.start()
        self._threads.append(t)
        return self

    def stop(self, timeout: float = 3.0) -> None:
        self._stop.set()
        self._stop_accepting()
        for t in self._threads:
            t.join(timeout)
        # The capture thread closes the source on its way out. When it is still stuck
        # in a driver call, releasing the device under it could crash the process;
        # leave it to the exit instead.

    @property
    def port(self) -> int:
        return self._requested_port if self._port is None else self._port

    @property
    def accepting(self) -> bool:
        """True while the port takes connections, i.e. while the camera is up."""
        return self._accepting

    @property
    def client_count(self) -> int:
        with self._clients_lock:
            return len(self._clients)

    def log(self, msg: str) -> None:
        self._log("[camera_pub %s] %s" % (self.name, msg))

    # -- the port -----------------------------------------------------------------

    def _bind_socket(self, port: int) -> socket.socket:
        srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        # SO_REUSEADDR so the port can be bound again right after start() or an outage,
        # while the connections just dropped still sit in TIME_WAIT.
        srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            srv.bind((self.bind, port))
        except OSError:
            srv.close()
            raise
        return srv

    @staticmethod
    def _close_quietly(sock: socket.socket) -> None:
        try:
            sock.close()
        except OSError:
            pass

    def _start_accepting(self) -> bool:
        """Listen on the port and start taking clients; False when that failed."""
        with self._sock_lock:
            if self._stop.is_set():
                return False
            if self._accepting:
                return True
            try:
                self._sock = self._bind_socket(self.port)
                self._sock.listen(8)
                self._sock.settimeout(ACCEPT_POLL_S)
            except OSError as e:
                if self._sock is not None:
                    self._close_quietly(self._sock)
                    self._sock = None
                if str(e) != self._listen_error:
                    self._listen_error = str(e)
                    self.log("cannot listen on %s:%d: %s; retrying every %gs"
                             % (self.bind, self.port, e, self.reopen_delay_s))
                return False
            self._listen_error = ""
            closing = threading.Event()
            thread = threading.Thread(target=self._accept_loop, args=(self._sock, closing),
                                      daemon=True)
            self._accept_closing = closing
            self._accept_thread = thread
            self._accepting = True
            thread.start()
            if not self._served_before:
                self._served_before = True
                self.log("serving on %s:%d" % (self.bind, self.port))
            return True

    def _stop_accepting(self) -> None:
        """Close the listener and drop every client; a connect is refused from here on.

        The accept thread is joined before the clients are dropped, so no client it
        accepted can slip in after the drop.
        """
        with self._sock_lock:
            if self._accepting:
                self._accepting = False
                sock, thread, closing = self._sock, self._accept_thread, self._accept_closing
                self._sock = self._accept_thread = self._accept_closing = None
                if closing is not None:
                    closing.set()
                if sock is not None:
                    try:
                        sock.shutdown(socket.SHUT_RDWR)  # wakes accept() where it can
                    except OSError:
                        pass
                if thread is not None:
                    thread.join(ACCEPT_POLL_S * 4)
                if sock is not None:
                    self._close_quietly(sock)
        self._drop_clients()

    # -- clients ------------------------------------------------------------------

    def _accept_loop(self, srv: socket.socket, closing: threading.Event) -> None:
        while not closing.is_set():
            try:
                conn, addr = srv.accept()
            except socket.timeout:
                continue
            except OSError:
                break  # listener closed: an outage, or stop()
            if closing.is_set():
                self._close_quietly(conn)
                break
            conn.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
            conn.settimeout(CLIENT_SEND_TIMEOUT_S)
            client = _Client(conn, addr, self.client_backlog, self._client_gone)
            with self._clients_lock:
                self._clients.append(client)
                watching = len(self._clients)
            client.start()
            self.log("client %s connected (%d watching)" % (client.label, watching))

    def _client_gone(self, client: _Client) -> None:
        with self._clients_lock:
            if client not in self._clients:
                return
            self._clients.remove(client)
            watching = len(self._clients)
        self.log("client %s left (%d watching)" % (client.label, watching))

    def _drop_clients(self) -> None:
        with self._clients_lock:
            clients = list(self._clients)
        for client in clients:
            client.close()

    # -- capture ------------------------------------------------------------------

    def _open_source(self) -> bool:
        try:
            return bool(self.source.open())
        except Exception as e:  # noqa: BLE001 — a missing node raises in some drivers
            self._last_open_error = str(e)
            return False

    def _describe_source(self) -> str:
        describe = getattr(self.source, "describe", None)
        return describe() if callable(describe) else "open"

    def _capture_loop(self) -> None:
        opened = False
        ever_opened = False
        bad_frames = 0
        listen_retry_at = 0.0
        # Set from the first failure until the next good frame, so an outage is logged
        # once however many reopen attempts it takes, and a camera that opens and then
        # fails at once (flapping) does not log every second.
        outage_since = None  # type: Optional[float]
        try:
            while not self._stop.is_set():
                if not opened:
                    self._last_open_error = ""
                    if not self._open_source():
                        if outage_since is None:
                            outage_since = time.time()
                            why = (": " + self._last_open_error) if self._last_open_error else ""
                            self.log("cannot open the camera%s; retrying every %gs; "
                                     "refusing clients until it opens"
                                     % (why, self.reopen_delay_s))
                        self._stop.wait(self.reopen_delay_s)
                        continue
                    opened = True
                    bad_frames = 0
                    if not ever_opened and outage_since is None:
                        self.log("camera open (%s)" % self._describe_source())
                    ever_opened = True

                result = self._grab_and_publish()
                failure = ""
                if result == _READ_FAILED:
                    failure = "read failed, reopening"  # the head publisher's words
                elif result == _BAD_FRAME:
                    bad_frames += 1
                    if bad_frames >= MAX_BAD_FRAMES:
                        failure = ("%d frames in a row would not encode, reopening"
                                   % bad_frames)
                else:
                    if result == _SENT:
                        bad_frames = 0
                    # A frame came off the camera: it is up, so the port takes clients.
                    if not self._accepting and time.time() >= listen_retry_at:
                        if not self._start_accepting():
                            listen_retry_at = time.time() + self.reopen_delay_s
                    if outage_since is not None and self._accepting:
                        self.log("camera back after %.1fs (%s)"
                                 % (time.time() - outage_since, self._describe_source()))
                        outage_since = None
                if not failure:
                    continue

                if outage_since is None:
                    self.log(failure + "; refusing clients until the camera is back")
                    outage_since = time.time()
                # Clients first: they see the stream end, and a new connect is refused
                # from here until the camera delivers frames again.
                self._stop_accepting()
                self.source.close()
                opened = False
                self._stop.wait(self.reopen_delay_s)
        finally:
            # However the loop ends, nobody may stay connected to a camera that is no
            # longer being read.
            self._stop_accepting()
            try:
                self.source.close()
            except Exception:  # noqa: BLE001
                pass

    def _grab_and_publish(self) -> str:
        """One frame: grab always, encode and send only while someone watches.

        Returns `_READ_FAILED` when the grab failed (the caller reopens), `_BAD_FRAME`
        when the grabbed frame would not decode or encode (the caller skips it, and
        reopens only after `MAX_BAD_FRAMES` in a row), `_GRABBED` when nobody watches,
        and `_SENT` when the frame went out.
        """
        try:
            if not self.source.grab():
                return _READ_FAILED
        except Exception:  # noqa: BLE001
            return _READ_FAILED
        ts_ns = time.time_ns()
        with self._clients_lock:
            clients = list(self._clients)
        if not clients:
            return _GRABBED
        try:
            jpeg = self.source.retrieve_jpeg(self.quality)
        except Exception:  # noqa: BLE001
            jpeg = None
        if not jpeg:
            return _BAD_FRAME
        packet = FRAME_HEADER.pack(len(jpeg), ts_ns) + jpeg
        for client in clients:
            if not client.offer(packet):
                self.log("client %s cannot keep up; dropping it" % client.label)
                client.close()
        return _SENT


def serve_until_signalled(publisher: CameraPublisher) -> int:
    """Run until SIGTERM or SIGINT, then close the sockets and the device."""
    done = threading.Event()

    def _on_signal(signum, _frame):
        done.set()

    signal.signal(signal.SIGTERM, _on_signal)
    signal.signal(signal.SIGINT, _on_signal)
    try:
        publisher.start()
    except OSError as e:
        print("[camera_pub %s] cannot bind %s:%d: %s"
              % (publisher.name, publisher.bind, publisher.port, e), file=sys.stderr, flush=True)
        return 1
    try:
        # A timed wait, so the signal handler gets to run on every Python version.
        while not done.wait(0.5):
            pass
    finally:
        publisher.log("stopping")
        publisher.stop()
    return 0


def parse_args(argv=None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Serve one UVC camera over TCP in the G1 head camera's wire format "
                    "(uint32 be length | uint64 be ns timestamp | JPEG).")
    p.add_argument("--device", required=True,
                   help="camera path, preferably /dev/v4l/by-id/... or /dev/v4l/by-path/... "
                        "(a bare index such as 0 also works)")
    p.add_argument("--port", type=int, default=DEFAULT_PORT,
                   help="TCP port (default %d; the right wrist uses 5602)" % DEFAULT_PORT)
    p.add_argument("--bind", default="0.0.0.0", help="listen address (default 0.0.0.0)")
    p.add_argument("--width", type=int, default=640)
    p.add_argument("--height", type=int, default=480)
    p.add_argument("--fps", type=int, default=30)
    p.add_argument("--quality", type=int, default=85, help="JPEG quality 1-100 (default 85)")
    p.add_argument("--name", default="camera", help="name used in log lines only")
    args = p.parse_args(argv)
    if not 1 <= args.quality <= 100:
        p.error("--quality must be between 1 and 100")
    return args


def main(argv=None) -> int:
    args = parse_args(argv)
    try:
        import cv2  # noqa: F401
    except ImportError:
        print("[camera_pub %s] OpenCV is not installed for %s — on PC2: "
              "sudo apt install python3-opencv" % (args.name, sys.executable),
              file=sys.stderr, flush=True)
        return 2
    source = UvcCamera(args.device, args.width, args.height, args.fps)
    publisher = CameraPublisher(source, port=args.port, bind=args.bind,
                                quality=args.quality, name=args.name)
    publisher.log("device %s (%dx%d@%d, quality %d)"
                  % (args.device, args.width, args.height, args.fps, args.quality))
    return serve_until_signalled(publisher)


if __name__ == "__main__":
    sys.exit(main())
