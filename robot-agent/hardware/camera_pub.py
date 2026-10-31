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
    picture labelled LIVE is worse than an honest empty panel.

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
    """Serves one frame source on a TCP port in the head camera's wire format."""

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
        self._listener = None  # type: Optional[socket.socket]
        self._clients = []  # type: List[_Client]
        self._clients_lock = threading.Lock()
        self._stop = threading.Event()
        self._threads = []  # type: List[threading.Thread]
        self._last_open_error = ""

    # -- lifecycle ----------------------------------------------------------------

    def start(self) -> "CameraPublisher":
        srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            srv.bind((self.bind, self._requested_port))
            srv.listen(8)
        except OSError:
            srv.close()
            raise
        srv.settimeout(0.5)
        self._listener = srv
        self.log("serving on %s:%d" % (self.bind, self.port))
        for target in (self._accept_loop, self._capture_loop):
            t = threading.Thread(target=target, daemon=True)
            t.start()
            self._threads.append(t)
        return self

    def stop(self, timeout: float = 3.0) -> None:
        self._stop.set()
        if self._listener is not None:
            try:
                self._listener.close()
            except OSError:
                pass
        self._drop_clients()
        for t in self._threads:
            t.join(timeout)
        # The capture thread closes the source on its way out. When it is still stuck
        # in a driver call, releasing the device under it could crash the process;
        # leave it to the exit instead.

    @property
    def port(self) -> int:
        if self._listener is None:
            return self._requested_port
        return self._listener.getsockname()[1]

    @property
    def client_count(self) -> int:
        with self._clients_lock:
            return len(self._clients)

    def log(self, msg: str) -> None:
        self._log("[camera_pub %s] %s" % (self.name, msg))

    # -- clients ------------------------------------------------------------------

    def _accept_loop(self) -> None:
        while not self._stop.is_set():
            try:
                conn, addr = self._listener.accept()
            except socket.timeout:
                continue
            except OSError:
                break  # listener closed by stop()
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
                            self.log("cannot open the camera%s; retrying every %gs"
                                     % (why, self.reopen_delay_s))
                        self._stop.wait(self.reopen_delay_s)
                        continue
                    opened = True
                    if not ever_opened and outage_since is None:
                        self.log("camera open (%s)" % self._describe_source())
                    ever_opened = True

                if self._grab_and_publish():
                    if outage_since is not None:
                        self.log("camera back after %.1fs (%s)"
                                 % (time.time() - outage_since, self._describe_source()))
                        outage_since = None
                    continue

                if outage_since is None:
                    # The head publisher's words, so one grep finds both in a journal.
                    self.log("read failed, reopening")
                    outage_since = time.time()
                self.source.close()
                opened = False
                self._drop_clients()
                self._stop.wait(self.reopen_delay_s)
        finally:
            try:
                self.source.close()
            except Exception:  # noqa: BLE001
                pass

    def _grab_and_publish(self) -> bool:
        """One frame: grab always, encode and send only while someone watches.

        False on a read failure, which the caller turns into a reopen.
        """
        try:
            if not self.source.grab():
                return False
        except Exception:  # noqa: BLE001
            return False
        ts_ns = time.time_ns()
        with self._clients_lock:
            clients = list(self._clients)
        if not clients:
            return True
        try:
            jpeg = self.source.retrieve_jpeg(self.quality)
        except Exception:  # noqa: BLE001
            jpeg = None
        if not jpeg:
            return False
        packet = FRAME_HEADER.pack(len(jpeg), ts_ns) + jpeg
        for client in clients:
            if not client.offer(packet):
                self.log("client %s cannot keep up; dropping it" % client.label)
                client.close()
        return True


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
        print("[camera_pub %s] cannot listen on %s:%d: %s"
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
