#!/usr/bin/env python3
"""Serve the sidecar camera contract from `sim_main.py`'s ZMQ image server (NeoDEM, TASK-227).

@file isaac_camera_facade.py
@description Subscribes to the frames Unitree's `unitree_sim_isaaclab` image server already
    publishes over ZMQ and re-serves them on `GET /cameras/<name>/snapshot`, the route
    `robot-agent/src/hardware/HardwareClient.ts` fetches for Agent Mode's `look`,
    `scan_room` and `capture`.
@feature hardware

Why this exists
---------------
There are two Isaac rigs in this repo and only one of them can be seen out of.

  * The NVIDIA warehouse takes run `isaac_capture.py`, which renders its own cameras inside
    the Isaac process and answers the sidecar sensor contract on `--serve 8779`. Agent Mode
    perception works there.
  * The factory scene (`Isaac-Factory-PauseRoom-G129-Dex3-Wholebody`) runs under the
    vendor's `sim_main.py` with the wholebody DDS action provider. That process renders
    head and wrist cameras and publishes them, but it speaks ZMQ, not HTTP, so nothing in
    NeoDEM can read them. Agent Mode is blind in the factory scene, which is why no Agent
    Mode run has ever happened there.

This is the adapter, and nothing else changes:

    sim_main.py -> IsaacSimCamera -> cv2.imencode(".jpg") -> ZMQ PUB :55555/6/7
                                                                  |
                                              (this process SUBscribes)
                                                                  |
    Agent Mode -> HardwareClient.snapshot() -> GET /cameras/head_camera/snapshot

The frames arrive already JPEG-encoded, so the whole path is a byte copy plus a base64.
There is no OpenCV, no numpy and no decode step here; `pyzmq` is the only import that is
not in the standard library, and it is imported lazily so the module (and its offline
verifier) load on an interpreter that has none.

The ZMQ contract, and where it comes from
-----------------------------------------
Read out of the vendor tree at
`third_party/checkouts/unitree_sim_isaaclab/teleimager/src/teleimager/`:

  * `image_client.py:110-115` — the publisher is `zmq.PUB`, `SNDHWM=1`, `LINGER=0`,
    `bind("tcp://0.0.0.0:<port>")`.
  * `image_server.py:1358-1366` — `_zmq_pub` calls `publish(jpeg_bytes, camera.get_zmq_port())`
    once per frame, and `ZMQ_PublisherThread.send` (`image_client.py:79-88`) rejects anything
    that is not bytes. So a frame is ONE single-part message whose entire body is the JPEG.
    No topic prefix, no header struct, no length prefix, no msgpack, no multipart.
  * `image_server.py:1173-1181` — the bytes are `cv2.imencode(".jpg", frame_data)[1].tobytes()`,
    OpenCV's default quality 95, BGR-ordered (the RGB->BGR conversion happens upstream in
    `tools/shared_memory_utils.py:113-116`). BGR vs RGB does not matter to us: JPEG carries
    its own colour and we never decode.
  * `image_client.py:325-338` — the known-good consumer is `zmq.SUB`, `RCVHWM=1`,
    `LINGER=0`, `connect(...)`, `setsockopt_string(SUBSCRIBE, "")`, `poller.poll(100)`.
    Note there is deliberately no `CONFLATE`: latest-frame semantics come from HWM 1 at both
    ends. This file matches those options exactly by default. `--conflate` opts into the
    stricter socket-level last-message-wins, which is better in principle but is NOT what
    the proven consumer does, so it is not the default.
  * `image_client.py:498-532` + `image_server.py:1216` — a `REQ`/`REP` handshake on port
    60000 answers any single-part request with the camera config as JSON. That is where the
    name->port mapping really lives, so this process asks for it at startup and only falls
    back to the hardcoded table below if nobody answers.
  * `teleimager/cam_config_server.yaml` — that hardcoded fallback: `head_camera` 55555,
    `left_wrist_camera` 55556, `right_wrist_camera` 55557, all 480x640 @ 30 fps.

The two staleness questions, which are not the same question
------------------------------------------------------------
Serving a stale frame silently is the worst thing this file could do: Agent Mode writes
what it sees into scene memory, and an observation of where the robot was thirty seconds
ago is not recoverable downstream — it reads exactly like an observation of where it is.
So refusing is always better than answering.

There are two different clocks and this process can only see one of them:

  1. DELIVERY age — how long since a ZMQ message arrived. This is measured, it is what
     `--max-age` gates, and a snapshot older than that is a 503 with the age in the text.
  2. CONTENT age — how long since the picture actually CHANGED. `sim_main.py`'s publisher
     runs on its own 30 Hz thread and re-publishes whatever is in shared memory, so if
     Isaac's renderer stalls the frames keep arriving on time and only the picture is
     frozen. Byte-identical consecutive payloads are the only handle on this, and they are
     reported as `content_age_s`, but they are NOT rejected by default: a genuinely static
     scene (robot standing still, nothing moving, deterministic renderer) legitimately
     produces identical JPEGs. `--max-content-age` turns rejection on for callers that know
     their scene is never still.

`--max-age` defaults to 0.5 s. At the configured 30 fps that is fifteen missed frames —
far past any scheduling jitter, and still well inside the 1500 ms `AbortSignal.timeout`
`HardwareClient.snapshot()` gives the request, so the caller sees this file's error text
rather than its own timeout. A request that finds nothing fresh waits at most `--wait-ms`
(250 ms) for a frame to land before giving up, so the worst case is bounded and small; it
never blocks waiting for freshness that may never come.

Running it
----------
    python3 robot-agent/hardware/isaac_camera_facade.py --serve 8779

`--serve 8779` is `isaac_capture.py`'s port on purpose: the two rigs never run at once, so
one `HARDWARE_SIDECAR_URL` reaches whichever scene is up.

By itself this answers only `/health`, `/cameras` and `/cameras/<n>/snapshot`. Agent Mode
needs one base URL for perception AND locomotion, so point `--sidecar-url` at the process
that owns the rest (`g1_sidecar.py` on :8767 in the factory rig) and every other route is
forwarded verbatim, the way `isaac_capture.py` forwards `/loco/*`. Without it, everything
else is a 404 and this is a camera-only endpoint.

@status UNPROVEN AGAINST A LIVE SIM. Every line below was written and checked offline —
`verify_isaac_camera_facade_offline.py` covers the mapping, the staleness policy, the
not-ready path and the HTTP shape against a fake publisher. Nothing here has yet seen a
frame from Isaac. See that verifier's docstring for the list of things only a running sim
can settle.
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import signal
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# --------------------------------------------------------------------------------------
# The wire facts, in one place.
# --------------------------------------------------------------------------------------

#: teleimager/cam_config_server.yaml. The order matters as well as the values:
#: `skill-executor.ts`'s `captureHardware()` maps vla-server's camera names onto whatever
#: `/cameras` returns BY POSITION, and `g1_sidecar.py:1968` answers this exact list in this
#: exact order. Reordering it would silently feed a wrist frame to a model trained on the
#: head view.
DEFAULT_CAMERA_PORTS: dict[str, int] = {
    "head_camera": 55555,
    "left_wrist_camera": 55556,
    "right_wrist_camera": 55557,
}

#: Names a caller might ask for that mean one of the three above. `head_camera` is what
#: `config.ts:673` (`AGENT_CAMERA_NAME`) defaults to and what Agent Mode actually sends.
#: `front_camera` and `front` appear NOWHERE in this repo's camera plumbing — `front` is a
#: vla-server-side model input name (`skill-executor.ts:1608`), which is resolved
#: positionally against `/cameras`, not by string. They are accepted here defensively so a
#: caller that guesses a plausible name gets a picture instead of a 404, and they are
#: deliberately kept OUT of `/cameras` so the positional mapping is not polluted.
CAMERA_ALIASES: dict[str, str] = {
    "front_camera": "head_camera",
    "front": "head_camera",
    "head": "head_camera",
    "left_wrist": "left_wrist_camera",
    "right_wrist": "right_wrist_camera",
}

#: Start Of Image. Every payload the vendor publishes begins with it.
JPEG_SOI = b"\xff\xd8\xff"

#: How far into a payload to look for the SOI before declaring the message unrecognisable.
#: The vendor sends the JPEG bare (offset 0); this small tolerance exists so that if someone
#: ever adds a topic envelope the frames keep flowing AND the prefix length is reported,
#: rather than the stream silently going dark.
MAX_ENVELOPE_PREFIX = 64

#: `image_client.py:508` — the config REQ/REP ignores the body; any single-part message
#: gets the JSON back. Sending the same literal keeps us indistinguishable from ImageClient.
CONFIG_REQUEST = b"GET_DATA"

BOOT_ID = uuid.uuid4().hex[:12]


# --------------------------------------------------------------------------------------
# Pure logic. Everything here is exercised by verify_isaac_camera_facade_offline.py.
# --------------------------------------------------------------------------------------

def resolve_camera(name: str, ports: dict[str, int],
                   aliases: dict[str, str] | None = None) -> str | None:
    """Canonical camera name for whatever the caller asked for, or None if unknown.

    Deliberately exact rather than fuzzy: a near-miss that silently resolves to the head
    camera would hand a caller the wrong viewpoint with no way to notice.
    """
    if name in ports:
        return name
    target = (CAMERA_ALIASES if aliases is None else aliases).get(name)
    if target is not None and target in ports:
        return target
    return None


def parse_camera_overrides(items: list[str]) -> dict[str, int]:
    """`["head_camera=55555", ...]` -> `{"head_camera": 55555}`.

    Raises ValueError on anything malformed. A typo'd `--camera` must stop the process at
    startup; the alternative is a facade that runs, looks healthy, and subscribes to a port
    nothing publishes on.
    """
    out: dict[str, int] = {}
    for item in items:
        name, sep, port = item.partition("=")
        name, port = name.strip(), port.strip()
        if not sep or not name or not port:
            raise ValueError(f"--camera expects NAME=PORT, got {item!r}")
        try:
            port_i = int(port)
        except ValueError:
            raise ValueError(f"--camera {item!r}: {port!r} is not a port number") from None
        if not 1 <= port_i <= 65535:
            raise ValueError(f"--camera {item!r}: port {port_i} out of range")
        out[name] = port_i
    return out


def parse_cam_config(cam_config: object) -> dict[str, int]:
    """Name->port out of the JSON the vendor's config REP socket answers with.

    Shape (`teleimager/cam_config_server.yaml`, served verbatim by
    `ZMQ_Responser._run`): `{"head_camera": {"enable_zmq": true, "zmq_port": 55555, ...}}`.
    Cameras with `enable_zmq` false publish nothing, so they are dropped here rather than
    becoming a `/cameras` entry that can only ever 503.
    """
    out: dict[str, int] = {}
    if not isinstance(cam_config, dict):
        return out
    for name, cfg in cam_config.items():
        if not isinstance(name, str) or not isinstance(cfg, dict):
            continue
        if not cfg.get("enable_zmq"):
            continue
        port = cfg.get("zmq_port")
        if isinstance(port, bool) or not isinstance(port, int):
            continue
        if not 1 <= port <= 65535:
            continue
        out[name] = port
    return out


def select_cameras(ports: dict[str, int], wanted: list[str]) -> dict[str, int]:
    """Restrict `ports` to `wanted`, preserving the ORDER of `wanted`.

    Order is load-bearing for `/cameras` (see DEFAULT_CAMERA_PORTS). Raises ValueError
    naming what is available, because a `--cameras` typo would otherwise silently produce a
    facade that serves fewer cameras than the operator asked for.
    """
    if not wanted:
        return dict(ports)
    out: dict[str, int] = {}
    for name in wanted:
        canonical = resolve_camera(name, ports)
        if canonical is None:
            raise ValueError(f"--cameras: unknown camera {name!r} "
                             f"(known: {', '.join(ports) or 'none'})")
        out[canonical] = ports[canonical]
    return out


def parse_envelope(payload: bytes) -> tuple[bytes | None, int]:
    """`(jpeg_bytes, prefix_len)` for one ZMQ message, or `(None, 0)` if it is not a frame.

    The vendor publishes the JPEG bare, so `prefix_len` is 0 for every real message today.
    A non-zero one is surfaced in `/health` rather than being quietly tolerated: it means
    the publisher grew an envelope and somebody should look.
    """
    if not payload:
        return None, 0
    data = bytes(payload)
    idx = data.find(JPEG_SOI, 0, MAX_ENVELOPE_PREFIX + len(JPEG_SOI))
    if idx < 0:
        return None, 0
    return (data if idx == 0 else data[idx:]), idx


def jpeg_dimensions(data: bytes) -> tuple[int, int] | None:
    """`(width, height)` read off the JPEG's SOF marker, without decoding it.

    Worth the twenty lines: it is the only cheap way to notice that the head camera came up
    binocular (`binocular: true` concatenates left+right, so 1280x480 instead of 640x480) —
    a frame that is silently twice as wide as expected would be cropped or squashed by
    every downstream consumer.
    """
    if len(data) < 4 or data[:2] != b"\xff\xd8":
        return None
    # SOF0/1/2/3, 5/6/7, 9/10/11, 13/14/15 all carry the frame header; DHT (C4), JPG (C8)
    # and DAC (CC) share the range and do not.
    sof = {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7,
           0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}
    i, n = 2, len(data)
    while i + 3 < n:
        if data[i] != 0xFF:
            i += 1
            continue
        marker = data[i + 1]
        if marker == 0xFF:          # fill byte
            i += 1
            continue
        if marker == 0x01 or 0xD0 <= marker <= 0xD9:   # TEM, RSTn, SOI/EOI: no length field
            i += 2
            continue
        seg = int.from_bytes(data[i + 2:i + 4], "big")
        if seg < 2:
            return None
        if marker in sof:
            if i + 9 > n:
                return None
            return (int.from_bytes(data[i + 7:i + 9], "big"),
                    int.from_bytes(data[i + 5:i + 7], "big"))
        if marker == 0xDA:          # SOS: entropy-coded data follows, stop scanning
            return None
        i += 2 + seg
    return None


def frame_verdict(seq: int, age_s: float | None, max_age_s: float,
                  content_age_s: float | None = None,
                  max_content_age_s: float = 0.0) -> str:
    """`"ok"` | `"never"` | `"stale"` | `"frozen"` — the whole staleness policy, in one place.

    `"never"` and `"stale"` are different failures and are reported differently: the first
    means the sim (or its image server) is not up, the second means it stopped feeding us.
    `"frozen"` is only reachable when `max_content_age_s > 0` — see the module docstring on
    why identical frames are reported but not refused by default.
    """
    if seq <= 0 or age_s is None:
        return "never"
    if age_s > max_age_s:
        return "stale"
    if max_content_age_s > 0.0 and content_age_s is not None \
            and content_age_s > max_content_age_s:
        return "frozen"
    return "ok"


def verdict_error(verdict: str, name: str, port: int, age_s: float | None,
                  max_age_s: float, content_age_s: float | None,
                  max_content_age_s: float, waited_s: float) -> str:
    """The `error` string the caller sees. `HardwareClient` surfaces it verbatim, so it has
    to say what is wrong and where to look, not just that something is."""
    if verdict == "never":
        return (f"no frame has EVER arrived for '{name}' on ZMQ tcp://:{port} "
                f"(waited {waited_s * 1000:.0f} ms). The Isaac sim's image server is not "
                f"publishing — check sim_main.py is up, was started with --enable_cameras, "
                f"and that '{name}' has enable_zmq in cam_config_server.yaml.")
    if verdict == "stale":
        return (f"last frame for '{name}' is {age_s:.2f}s old, older than the {max_age_s:.2f}s "
                f"limit (waited {waited_s * 1000:.0f} ms for a fresh one). Refusing to serve "
                f"it: a stale view written into scene memory is indistinguishable from a "
                f"current one.")
    if verdict == "frozen":
        return (f"frames for '{name}' keep arriving but the picture has not changed for "
                f"{content_age_s:.2f}s, past the {max_content_age_s:.2f}s --max-content-age "
                f"limit. The image server is alive and Isaac's renderer is not advancing.")
    return ""


# --------------------------------------------------------------------------------------
# The latest-frame slot.
# --------------------------------------------------------------------------------------

class FrameSlot:
    """The single hand-off between one ZMQ subscriber thread and the HTTP workers.

    Modelled on `isaac_capture.py`'s `SensorState`: an HTTP worker only ever gets a
    consistent snapshot taken under the lock, never a live read of a buffer the subscriber
    is mid-write on. The Condition on top of that lock is what lets a request wait a bounded
    time for a frame instead of polling.
    """

    def __init__(self, name: str, port: int) -> None:
        self.name = name
        self.port = port
        self._cond = threading.Condition(threading.Lock())
        self._jpeg: bytes | None = None
        self._at = 0.0              # monotonic time the last frame was accepted
        self._changed_at = 0.0      # monotonic time the PICTURE last differed
        self._seq = 0
        self._accepted = 0
        self._rejected = 0
        self._last_reject = ""
        self._prefix_bytes = 0
        self._dims: tuple[int, int] | None = None
        self._first_at: float | None = None

    # -- writer side ------------------------------------------------------------------
    def publish(self, payload: bytes) -> bool:
        """Take one ZMQ message. Returns False (and counts it) if it is not a JPEG."""
        jpeg, prefix = parse_envelope(payload)
        now = time.monotonic()
        with self._cond:
            if jpeg is None:
                self._rejected += 1
                self._last_reject = (f"{len(payload)} B payload with no JPEG SOI in its "
                                     f"first {MAX_ENVELOPE_PREFIX} bytes")
                return False
            changed = jpeg != self._jpeg
            self._jpeg = jpeg
            self._at = now
            if changed or self._seq == 0:
                self._changed_at = now
                self._dims = jpeg_dimensions(jpeg)
            self._seq += 1
            self._accepted += 1
            self._prefix_bytes = prefix
            if self._first_at is None:
                self._first_at = now
            self._cond.notify_all()
            return True

    # -- reader side ------------------------------------------------------------------
    def _snapshot_locked(self) -> dict:
        now = time.monotonic()
        return {
            "jpeg": self._jpeg,
            "seq": self._seq,
            "age_s": None if self._seq == 0 else now - self._at,
            "content_age_s": None if self._seq == 0 else now - self._changed_at,
            "accepted": self._accepted,
            "rejected": self._rejected,
            "last_reject": self._last_reject,
            "prefix_bytes": self._prefix_bytes,
            "dims": self._dims,
            "uptime_s": None if self._first_at is None else now - self._first_at,
        }

    def snapshot(self) -> dict:
        with self._cond:
            return self._snapshot_locked()

    def wait_fresh(self, max_age_s: float, timeout_s: float,
                   max_content_age_s: float = 0.0) -> tuple[dict, float]:
        """Block until a frame passing the policy exists, or `timeout_s` elapses.

        Returns `(snapshot, waited_s)` either way — never raises, never waits longer than
        asked. The point of the bound is that `HardwareClient.snapshot()` aborts at 1500 ms:
        an unbounded wait here turns an honest "the sim is not publishing" into the caller's
        own timeout, which says nothing about why.
        """
        started = time.monotonic()
        deadline = started + max(0.0, timeout_s)
        with self._cond:
            while True:
                snap = self._snapshot_locked()
                if frame_verdict(snap["seq"], snap["age_s"], max_age_s,
                                 snap["content_age_s"], max_content_age_s) == "ok":
                    return snap, time.monotonic() - started
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return snap, time.monotonic() - started
                self._cond.wait(remaining)


# --------------------------------------------------------------------------------------
# The ZMQ side.
# --------------------------------------------------------------------------------------

def request_cam_config(host: str, port: int, timeout_s: float) -> dict[str, int]:
    """Ask the sim's config REP socket what the ports are. `{}` if nobody answers.

    `image_client.py:508-517` does exactly this with a 1000 ms poll and falls back to a
    local YAML. We fall back to DEFAULT_CAMERA_PORTS, which is that YAML's content.
    """
    try:
        import zmq
    except ImportError:
        return {}
    ctx = zmq.Context.instance()
    sock = ctx.socket(zmq.REQ)
    try:
        sock.setsockopt(zmq.LINGER, 0)
        sock.connect(f"tcp://{host}:{port}")
        sock.send(CONFIG_REQUEST)
        poller = zmq.Poller()
        poller.register(sock, zmq.POLLIN)
        if not dict(poller.poll(timeout=int(timeout_s * 1000))).get(sock):
            return {}
        return parse_cam_config(sock.recv_json())
    except Exception:  # noqa: BLE001 — a missing config server is normal, not fatal
        return {}
    finally:
        sock.close(linger=0)


class CameraSubscriber(threading.Thread):
    """One SUB socket per camera, mirroring `ZMQ_SubscriberThread` in the vendor client.

    Socket options are the vendor's, verbatim (`image_client.py:328-333`), because that
    consumer is proven against this publisher and deviating from it is how a stream that
    "should" work delivers nothing. `--conflate` is the one opt-in deviation.
    """

    def __init__(self, slot: FrameSlot, host: str, poll_ms: int, conflate: bool,
                 quiet: bool) -> None:
        super().__init__(daemon=True, name=f"sub-{slot.name}")
        self.slot = slot
        self.host = host
        self.poll_ms = poll_ms
        self.conflate = conflate
        self.quiet = quiet
        self.error: Exception | None = None
        # NOT `self._stop`: `threading.Thread._stop` is an internal METHOD that `join()`
        # calls, and shadowing it with an Event makes every join raise
        # `TypeError: 'Event' object is not callable` — i.e. the facade crashes on the way
        # out, on 3.12 (the interpreter the sim stack uses) though not on 3.14.
        # `isaac_loco_bridge.py` gets away with the same name because its class is not a
        # Thread.
        self._stopping = threading.Event()
        self._announced = False

    def stop(self) -> None:
        self._stopping.set()

    def run(self) -> None:
        try:
            import zmq
        except ImportError as exc:
            self.error = exc
            print(f"[cam] FATAL: pyzmq is not importable ({exc}). Install it in the "
                  f"interpreter that runs this facade.", file=sys.stderr, flush=True)
            return
        sock = None
        try:
            ctx = zmq.Context.instance()
            sock = ctx.socket(zmq.SUB)
            if self.conflate:
                # Must be set BEFORE connect, and it supersedes RCVHWM.
                sock.setsockopt(zmq.CONFLATE, 1)
            else:
                sock.setsockopt(zmq.RCVHWM, 1)
            sock.setsockopt(zmq.LINGER, 0)
            sock.connect(f"tcp://{self.host}:{self.slot.port}")
            sock.setsockopt_string(zmq.SUBSCRIBE, "")
            poller = zmq.Poller()
            poller.register(sock, zmq.POLLIN)
            # A TCP connect to a port nothing is listening on is not an error in ZMQ — it
            # retries in the background forever. That is exactly the behaviour we want when
            # the facade is started before the sim: no frames, /health says so, and the
            # stream simply begins when the publisher appears.
            while not self._stopping.is_set():
                if not dict(poller.poll(timeout=self.poll_ms)).get(sock):
                    continue
                payload = sock.recv()
                ok = self.slot.publish(payload)
                if ok and not self._announced:
                    self._announced = True
                    snap = self.slot.snapshot()
                    dims = snap["dims"]
                    size = f"{dims[0]}x{dims[1]}" if dims else "unknown size"
                    extra = (f", {snap['prefix_bytes']} B envelope prefix"
                             if snap["prefix_bytes"] else "")
                    if not self.quiet:
                        print(f"[cam] first frame from {self.slot.name} on :{self.slot.port} "
                              f"— {size}, {len(payload)} B{extra}", flush=True)
                elif not ok and not self.quiet and self.slot.snapshot()["rejected"] == 1:
                    print(f"[cam] WARNING: {self.slot.name} on :{self.slot.port} sent "
                          f"{self.slot.snapshot()['last_reject']} — not a JPEG. The "
                          f"publisher's payload format has changed; frames are being "
                          f"dropped, not silently mangled.", flush=True)
        except Exception as exc:  # noqa: BLE001
            self.error = exc
            print(f"[cam] subscriber for {self.slot.name} died: {exc!r}",
                  file=sys.stderr, flush=True)
        finally:
            if sock is not None:
                try:
                    sock.close(linger=0)
                except Exception:  # noqa: BLE001
                    pass


# --------------------------------------------------------------------------------------
# The HTTP side.
# --------------------------------------------------------------------------------------

#: The two POST routes `--manip-url` diverts to `isaac_manip_bridge.py`. Everything
#: else — `/state`, `/state/fast`, `/loco/*`, `/record/*`, `/pointcloud/*` — keeps
#: going to the sidecar, which is the only thing that serves them.
MANIP_ROUTES: frozenset[str] = frozenset({"/action", "/estop"})


def qs_one(query: dict[str, list[str]], key: str) -> str | None:
    values = query.get(key)
    return values[0] if values else None


def make_handler(slots: dict[str, FrameSlot], *, max_age_s: float, wait_s: float,
                 max_content_age_s: float, scene: str, sidecar_url: str,
                 manip_url: str = ""):
    """The sidecar camera contract, answered from the ZMQ slots.

    Routes owned here: `/health`, `/cameras`, `/cameras/<name>/snapshot`. Anything else is
    forwarded to `sidecar_url` when one was given (so Agent Mode can keep ONE base URL for
    perception and locomotion) and 404s when it was not.

    `manip_url` splits TWO of those forwarded routes off to `isaac_manip_bridge.py`:
    `POST /action` and `POST /estop`. THE CALLER STILL SEES ONE BASE URL — that is the
    whole point, and it is why this is a routing table here rather than a second
    `HARDWARE_SIDECAR_URL` for somebody to configure. Repointing the agent at the manip
    bridge instead would take `/state`, `/state/fast`, `/loco/*` and every camera down
    with it.

    Why those two and nothing else: on the Isaac rig the sidecar's `/action` is a
    real-robot path that cannot work (no `lerobot` in the rig's interpreter, DDS domain 0
    hardcoded, no Dex3 publisher), and its `/estop` clears a ramp-state dict that is empty
    under `G1_READ_ONLY=1`. The manipulation bridge is the only process in the rig that
    publishes rt/lowcmd and rt/dex3/*/cmd, so it is the only one that can move — or stop —
    the simulated arms. With no `--manip-url` this file behaves exactly as it did before.
    """

    def proxy(method: str, path: str, body: bytes | None, *, base: str = "",
              label: str = "sidecar", timeout: float = 30.0) -> tuple[int, dict]:
        """Forward verbatim. A dead upstream is reported AS dead — never softened into
        `{"ok": true}`, which would make Agent Mode believe a walk it never took."""
        upstream = (base or sidecar_url).rstrip("/")
        req = urllib.request.Request(
            upstream + path, method=method, data=body,
            headers={"Content-Type": "application/json"} if body else {})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as res:
                return res.status, json.loads(res.read() or b"{}")
        except urllib.error.HTTPError as exc:
            try:
                return exc.code, json.loads(exc.read() or b"{}")
            except json.JSONDecodeError:
                return exc.code, {"ok": False, "error": f"{label} HTTP {exc.code}"}
        except Exception as exc:  # noqa: BLE001
            return 503, {"ok": False, "error": f"{label} {upstream} unreachable: {exc}"}

    def camera_health() -> tuple[bool, dict]:
        report: dict = {}
        ready = False
        for name, slot in slots.items():
            snap = slot.snapshot()
            verdict = frame_verdict(snap["seq"], snap["age_s"], max_age_s,
                                    snap["content_age_s"], max_content_age_s)
            ready = ready or verdict == "ok"
            entry = {
                "port": slot.port,
                "state": verdict,
                "frames": snap["accepted"],
                "dropped": snap["rejected"],
                # Reported, not gated. See the module docstring: delivery age is measured,
                # content age is a hint about a clock this process cannot see.
                "age_s": None if snap["age_s"] is None else round(snap["age_s"], 3),
                "content_age_s": (None if snap["content_age_s"] is None
                                  else round(snap["content_age_s"], 3)),
                "size": (f"{snap['dims'][0]}x{snap['dims'][1]}" if snap["dims"] else None),
                "bytes": None if snap["jpeg"] is None else len(snap["jpeg"]),
            }
            if snap["prefix_bytes"]:
                entry["envelope_prefix_bytes"] = snap["prefix_bytes"]
            if snap["rejected"]:
                entry["last_dropped"] = snap["last_reject"]
            report[name] = entry
        return ready, report

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"
        # Every reply below sets Content-Length, so keep-alive is safe. And a keep-alive
        # connection must be able to die on its own: without this the handler blocks in
        # rfile.readline() forever between requests, stranding a thread per robot-agent
        # that vanished without closing its sockets. Same reasoning, same number, as
        # sim_g1_dds/sim_node.py.
        timeout = 30

        def _send(self, code: int, payload: dict) -> None:
            body = json.dumps(payload).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _send_bytes(self, code: int, content_type: str, body: bytes) -> None:
            """`?format=raw`. `HardwareClient.snapshotRaw()` prefers this because a JPEG
            base64'd into JSON costs 1.33x on the wire and this route emits it twice."""
            self.send_response(code)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args) -> None:  # the operational log below is the useful one
            pass

        # -- GET ----------------------------------------------------------------------
        def do_GET(self) -> None:
            # Route on the path alone. `HardwareClient.snapshotRaw()` appends
            # `?format=raw&shadows=0&...`; g1_sidecar.py matches on the whole path, so those
            # requests 404 there and it retries plain. Here they are served.
            path, _, raw_query = self.path.partition("?")
            query = urllib.parse.parse_qs(raw_query)

            if path == "/health":
                self._send(200, self._health())
                return
            if path == "/cameras":
                # Canonical names only, in DEFAULT_CAMERA_PORTS order. Aliases are resolved
                # on the snapshot route but never listed: skill-executor.ts maps vla-server
                # camera names onto this list BY POSITION, so an alias in it would shift
                # every model input by one.
                self._send(200, {"cameras": list(slots)})
                return
            if path.startswith("/cameras/") and path.endswith("/snapshot"):
                self._snapshot(urllib.parse.unquote(
                    path[len("/cameras/"):-len("/snapshot")]), query)
                return
            if sidecar_url:
                self._send(*proxy("GET", self.path, None))
                return
            self._send(404, {"ok": False, "error": f"not found: {path}"})

        def do_POST(self) -> None:
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length) if length else b""
            path, _, _q = self.path.partition("?")
            if manip_url and path in MANIP_ROUTES:
                # The 2 s timeout is not the generic 30: `HardwareClient.sendAction()`
                # aborts at 1000 ms and a VLA rollout drives this at rollout rate, so a
                # 30 s wait on a dead inlet only strands one thread per abandoned frame
                # and tells the caller nothing it did not already time out on.
                self._send(*proxy("POST", self.path, raw or b"{}", base=manip_url,
                                  label="manip bridge", timeout=2.0))
                return
            if sidecar_url:
                self._send(*proxy("POST", self.path, raw or b"{}"))
                return
            self._send(404, {"ok": False, "error": f"not found: {self.path}"})

        # -- the two routes that matter -----------------------------------------------
        def _health(self) -> dict:
            ready, cameras = camera_health()
            payload: dict = {
                "source": "isaac-zmq",
                "ready": ready,
                "cameras": cameras,
                "max_age_s": max_age_s,
                "max_content_age_s": max_content_age_s,
            }
            if sidecar_url:
                # The upstream owns whether the ROBOT is available; a camera that has not
                # warmed up yet must not switch off locomotion. `HardwareClient._tryConnect`
                # gates `sidecarAvailable` on `status === "ok"`, and turning that off would
                # stop Agent Mode talking to the sidecar at all — including the /loco routes
                # that work fine. So upstream's verdict passes through untouched, and a cold
                # camera shows up as a 503 on the snapshot route, where it belongs.
                code, up = proxy("GET", "/health", None)
                payload["upstream"] = {"url": sidecar_url, "status_code": code}
                for key in ("status", "connected", "boot_id", "sim", "scene", "behind_s"):
                    if key in up:
                        payload[key] = up[key]
                payload.setdefault("status", "ok" if code == 200 else "degraded")
                payload.setdefault("connected", code == 200)
            else:
                # Standalone: this process IS the sidecar, and it has exactly one job. Until
                # a frame has arrived it is not able to do it, and says so rather than
                # advertising itself and then 503ing every snapshot.
                payload["status"] = "ok" if ready else "starting"
                payload["connected"] = ready
            if manip_url:
                # CONFIGURATION, NOT LIVENESS, and labelled as such. Probing the inlet
                # from here would put a second upstream call on a route HardwareClient
                # polls, and a manip bridge that is down must not be able to turn
                # `connected` off — locomotion and the cameras do not depend on it.
                # `GET {url}/health` is the liveness answer; the bringup script waits
                # on exactly that.
                payload["manip"] = {
                    "url": manip_url, "routes": sorted(MANIP_ROUTES), "probed": False,
                    "note": "routing only — GET <url>/health for whether it is alive",
                }
            payload.setdefault("sim", True)
            payload.setdefault("scene", scene)
            payload.setdefault("boot_id", BOOT_ID)
            return payload

        def _snapshot(self, name: str, query: dict[str, list[str]]) -> None:
            canonical = resolve_camera(name, {k: s.port for k, s in slots.items()})
            if canonical is None:
                # 404 and not a 200-with-ok:false, so the error cannot be mistaken for a
                # camera that exists but is cold. `snapshotRaw()` retries a 404 once without
                # the query string; the retry 404s too and the text below is what surfaces.
                self._send(404, {"ok": False, "camera": name,
                                 "error": f"no camera '{name}' — this facade serves "
                                          f"{', '.join(slots) or 'nothing'} "
                                          f"(aliases: {', '.join(CAMERA_ALIASES)})"})
                return
            slot = slots[canonical]
            snap, waited = slot.wait_fresh(max_age_s, wait_s, max_content_age_s)
            verdict = frame_verdict(snap["seq"], snap["age_s"], max_age_s,
                                    snap["content_age_s"], max_content_age_s)
            if verdict != "ok":
                # 503, always — never a black frame, never the last good one. An observation
                # written into scene memory cannot be un-written, and a picture that is
                # merely OLD looks exactly like a picture that is current.
                self._send(503, {
                    "ok": False, "camera": canonical, "source": "isaac-zmq",
                    "state": verdict, "port": slot.port, "frame": snap["seq"],
                    "age_s": None if snap["age_s"] is None else round(snap["age_s"], 3),
                    "waited_ms": round(waited * 1000, 1),
                    "error": verdict_error(verdict, canonical, slot.port, snap["age_s"],
                                           max_age_s, snap["content_age_s"],
                                           max_content_age_s, waited),
                })
                return
            jpeg = snap["jpeg"]
            assert jpeg is not None  # frame_verdict "ok" implies seq > 0 implies a frame
            if qs_one(query, "format") == "raw":
                self._send_bytes(200, "image/jpeg", jpeg)
                return
            b64 = base64.b64encode(jpeg).decode()
            self._send(200, {
                "ok": True, "camera": canonical, "source": "isaac-zmq",
                # Both keys, for the same reason sim_node.py and isaac_capture.py emit both:
                # g1_sidecar.py answers `jpeg_base64` and HardwareClient historically read
                # `image_b64`. `HardwareClient.snapshot()` takes `image_b64 ?? jpeg_base64`.
                "jpeg_base64": b64, "image_b64": b64,
                "frame": snap["seq"], "port": slot.port, "bytes": len(jpeg),
                "age_s": round(snap["age_s"], 3),
                "content_age_s": round(snap["content_age_s"], 3),
                "size": (f"{snap['dims'][0]}x{snap['dims'][1]}" if snap["dims"] else None),
                # `?shadows`, `?reflection` and `?quality` are accepted (so the request does
                # not 404 and force a retry) and ignored: these frames were encoded inside
                # sim_main.py at OpenCV's default quality and there is nothing here to
                # re-render. Said out loud rather than pretended.
                "reencoded": False,
            })

    return Handler


# --------------------------------------------------------------------------------------
# Wiring.
# --------------------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(
        description="Serve the sidecar camera contract from the Isaac sim's ZMQ image server.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter)
    ap.add_argument("--serve", type=int, default=8779,
                    help="HTTP port. 8779 matches isaac_capture.py, so one "
                         "HARDWARE_SIDECAR_URL reaches either rig.")
    ap.add_argument("--bind", default="0.0.0.0", help="HTTP bind address")
    ap.add_argument("--zmq-host", default="127.0.0.1",
                    help="host the sim's image server publishes on")
    ap.add_argument("--camera", action="append", default=[], metavar="NAME=PORT",
                    help="add or override one camera's ZMQ port; repeatable")
    ap.add_argument("--cameras", default="",
                    help="comma-separated subset to serve, in this order (default: all)")
    ap.add_argument("--config-port", type=int, default=60000,
                    help="the sim's REQ/REP camera-config port; 0 skips the handshake and "
                         "uses the built-in table")
    ap.add_argument("--config-timeout", type=float, default=1.0,
                    help="seconds to wait for that handshake before falling back")
    ap.add_argument("--max-age", type=float, default=0.5,
                    help="refuse a snapshot whose last frame is older than this")
    ap.add_argument("--max-content-age", type=float, default=0.0,
                    help="also refuse when the PICTURE has not changed for this long; "
                         "0 disables (a static scene legitimately repeats frames)")
    ap.add_argument("--wait-ms", type=int, default=250,
                    help="how long a request may wait for a fresh frame before failing")
    ap.add_argument("--poll-ms", type=int, default=100,
                    help="ZMQ poll timeout, matching the vendor client")
    ap.add_argument("--conflate", action="store_true",
                    help="use ZMQ_CONFLATE instead of RCVHWM=1; stricter latest-message-wins, "
                         "but NOT what the proven vendor consumer does")
    ap.add_argument("--sidecar-url", default="",
                    help="forward every non-camera route to this sidecar (e.g. "
                         "http://localhost:8767) so Agent Mode needs one base URL")
    ap.add_argument("--manip-url", default="",
                    help="send POST /action and POST /estop to this manipulation bridge "
                         "(e.g. http://localhost:8778) instead of the sidecar. The one "
                         "process that can move the simulated arms and hands; the "
                         "sidecar's /action is a real-robot path that cannot serve this "
                         "rig. Callers keep ONE base URL either way.")
    ap.add_argument("--scene", default="Isaac-Factory-PauseRoom-G129-Dex3-Wholebody",
                    help="scene label reported by /health")
    ap.add_argument("--log-every", type=float, default=10.0,
                    help="seconds between status lines; 0 disables")
    ap.add_argument("--quiet", action="store_true", help="startup banner and errors only")
    return ap


def resolve_ports(args: argparse.Namespace) -> tuple[dict[str, int], str]:
    """The name->port table plus a one-line provenance string for the banner."""
    ports = dict(DEFAULT_CAMERA_PORTS)
    source = "built-in table (teleimager/cam_config_server.yaml)"
    if args.config_port:
        served = request_cam_config(args.zmq_host, args.config_port, args.config_timeout)
        if served:
            ports = served
            source = f"the sim's config socket on :{args.config_port}"
    overrides = parse_camera_overrides(args.camera)
    if overrides:
        ports.update(overrides)
        source += f" + {len(overrides)} --camera override(s)"
    wanted = [n.strip() for n in args.cameras.split(",") if n.strip()]
    return select_cameras(ports, wanted), source


def main() -> int:
    ap = build_parser()
    args = ap.parse_args()

    if args.max_age <= 0:
        ap.error("--max-age must be > 0 (a zero window rejects every frame)")
    if args.wait_ms < 0:
        ap.error("--wait-ms must be >= 0")
    if args.wait_ms > 1400:
        # HardwareClient.snapshot() aborts at 1500 ms. Waiting longer than that here means
        # the caller times out first and never sees the reason, which is the one thing this
        # file exists to avoid.
        print(f"[cam] WARNING: --wait-ms {args.wait_ms} is close to or past the 1500 ms "
              f"AbortSignal.timeout in HardwareClient.snapshot(), so the caller will time "
              f"out before this facade can explain why. Use <= 1000.", flush=True)
    if args.poll_ms <= 0:
        ap.error("--poll-ms must be > 0")

    try:
        ports, source = resolve_ports(args)
    except ValueError as exc:
        ap.error(str(exc))
        return 2  # unreachable; argparse exits. Kept so the type is honest.
    if not ports:
        ap.error("no cameras to serve")

    slots = {name: FrameSlot(name, port) for name, port in ports.items()}

    print(f"[cam] isaac_camera_facade — sidecar camera contract from Isaac's ZMQ image "
          f"server (boot {BOOT_ID})", flush=True)
    print(f"[cam] cameras from {source}:", flush=True)
    for name, port in ports.items():
        alias = [a for a, t in CAMERA_ALIASES.items() if t == name]
        print(f"[cam]   {name:<20} <- zmq SUB tcp://{args.zmq_host}:{port}"
              + (f"   (also answers: {', '.join(alias)})" if alias else ""), flush=True)
    print(f"[cam] serving GET /health, /cameras, /cameras/<name>/snapshot[?format=raw] "
          f"on http://{args.bind}:{args.serve}", flush=True)
    print(f"[cam] refusing any frame older than {args.max_age:g}s; a request waits at most "
          f"{args.wait_ms} ms for a fresh one, then 503s with the age. "
          + (f"Frozen-picture rejection at {args.max_content_age:g}s."
             if args.max_content_age > 0 else
             "Frozen-picture age is REPORTED, not rejected (--max-content-age).")
          + f" Socket: {'CONFLATE' if args.conflate else 'RCVHWM=1 (vendor default)'}.",
          flush=True)
    routes = f"proxied to {args.sidecar_url}" if args.sidecar_url else "404 (camera-only)"
    print(f"[cam] non-camera routes: {routes}", flush=True)
    if args.manip_url:
        print(f"[cam]   except POST {', '.join(sorted(MANIP_ROUTES))} -> "
              f"{args.manip_url} (the manipulation bridge: the only process that can "
              f"move or stop the simulated arms)", flush=True)
    print("[cam] nothing is decoded or re-encoded here — the sim's JPEG bytes are passed "
          "through unchanged.", flush=True)

    subs = [CameraSubscriber(slot, args.zmq_host, args.poll_ms, args.conflate, args.quiet)
            for slot in slots.values()]
    for sub in subs:
        sub.start()

    httpd = ThreadingHTTPServer(
        (args.bind, args.serve),
        make_handler(slots, max_age_s=args.max_age, wait_s=args.wait_ms / 1000.0,
                     max_content_age_s=args.max_content_age, scene=args.scene,
                     sidecar_url=args.sidecar_url.rstrip("/"),
                     manip_url=args.manip_url.rstrip("/")))
    httpd.daemon_threads = True
    http_thread = threading.Thread(target=httpd.serve_forever, daemon=True,
                                   name="http")
    http_thread.start()

    stopping = threading.Event()

    def _sig(_signum, _frame):
        stopping.set()

    signal.signal(signal.SIGINT, _sig)
    signal.signal(signal.SIGTERM, _sig)

    last_log = time.monotonic()
    was_ready: dict[str, bool] = {name: False for name in slots}
    ever_ready: dict[str, bool] = {name: False for name in slots}
    try:
        # No `except KeyboardInterrupt`: the handler above replaces the default, so Ctrl-C
        # sets `stopping` rather than raising.
        while not stopping.is_set():
            time.sleep(0.2)
            now = time.monotonic()
            for name, slot in slots.items():
                snap = slot.snapshot()
                ok = frame_verdict(snap["seq"], snap["age_s"], args.max_age,
                                   snap["content_age_s"], args.max_content_age) == "ok"
                if ok != was_ready[name] and not args.quiet:
                    # Transitions are logged even under --log-every 0: losing a camera
                    # mid-run is the event an operator most needs in the scrollback.
                    age = snap["age_s"]
                    age_txt = "never" if age is None else f"{age:.1f}s"
                    if ok:
                        detail = "FRESH again" if ever_ready[name] else "FRESH"
                    else:
                        detail = f"NO FRESH FRAME (age {age_txt})"
                    print(f"[cam] {name}: {detail}", flush=True)
                was_ready[name] = ok
                ever_ready[name] = ever_ready[name] or ok
            if args.log_every > 0 and now - last_log >= args.log_every and not args.quiet:
                last_log = now
                bits = []
                for name, slot in slots.items():
                    snap = slot.snapshot()
                    if snap["seq"] == 0:
                        bits.append(f"{name}=none")
                        continue
                    fps = (snap["accepted"] / snap["uptime_s"]
                           if snap["uptime_s"] and snap["uptime_s"] > 0 else 0.0)
                    bits.append(f"{name}={snap['accepted']}f @{fps:.1f}Hz "
                                f"age={snap['age_s']:.2f}s still={snap['content_age_s']:.1f}s")
                print("[cam] " + "  ".join(bits), flush=True)
            dead = [s for s in subs if s.error is not None]
            if dead:
                print(f"[cam] subscriber thread(s) died: "
                      f"{', '.join(s.slot.name for s in dead)} — exiting rather than "
                      f"serving a stream that can never refresh", file=sys.stderr, flush=True)
                return 1
    finally:
        for sub in subs:
            sub.stop()
        httpd.shutdown()
        httpd.server_close()
        for sub in subs:
            sub.join(timeout=1.0)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
