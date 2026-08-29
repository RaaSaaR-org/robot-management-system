#!/usr/bin/env python3
"""Offline check for the Isaac ZMQ -> sidecar camera facade (NeoDEM, TASK-227).

@file verify_isaac_camera_facade_offline.py
@description Exercises `isaac_camera_facade.py` -- name resolution, envelope parsing, the
    staleness policy and the whole HTTP surface -- with no simulator, no GPU, no ZMQ peer
    and no pyzmq. Frames are injected straight into the `FrameSlot` a subscriber would
    write to, and the HTTP server is the real one, bound to an ephemeral loopback port.
    Runs in about a second on `python3`.
@feature hardware

Why this exists as a standalone script rather than as an in-sim assertion: the GPU on this
box is serialised and a second Isaac instance SIGKILLs the first, so every minute spent
finding a CPU bug inside a sim boot is a minute stolen from another job. Everything below
is a CPU bug.

The defect it is built around is the one that cannot be seen from the outside: a facade
that serves a STALE frame. Agent Mode's `look` writes what it sees into scene memory, and
an observation of where the robot stood thirty seconds ago is byte-for-byte
indistinguishable from an observation of where it stands now -- no downstream consumer can
catch it, ever. So checks (4) and (5) assert that a stale slot produces a 503 and NOT the
last good picture, and check (5) additionally asserts the response shape against
`HardwareClient.ts`'s own source, so a change on the TypeScript side fails here rather than
silently on the robot.

What this cannot check -- and this list is the honest half of the file:
  * that the sim publishes anything at all, on any port
  * that the ports in `DEFAULT_CAMERA_PORTS` are the ports THIS scene uses (only the
    running sim's config socket settles that; the facade asks it at startup for exactly
    this reason)
  * that a ZMQ SUB with these socket options actually receives from that PUB
  * that the picture on `head_camera` is the head camera's, right way up, or of this scene
  * that Isaac's renderer is advancing. `content_age_s` is the only handle on that and it
    is a hint, not a measurement -- see the facade's module docstring.

Run:
    python3 robot-agent/hardware/verify_isaac_camera_facade_offline.py
"""
import base64
import json
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

import isaac_camera_facade as facade  # noqa: E402

FAILURES = []


def check(ok, label, detail=""):
    print(f"    {'PASS' if ok else 'FAIL'}  {label}" + (f"  [{detail}]" if detail else ""))
    if not ok:
        FAILURES.append(label)


# A real 32x32 gray JPEG, Pillow-generated at quality 70. Lifted verbatim from
# `robot-agent/src/vla/skill-executor.ts:109` (`SYNTHETIC_GRAY_JPEG_B64`) so that the
# dimension parser below is checked against bytes a real encoder produced, not against a
# header this file wrote to match its own reader.
REAL_JPEG = base64.b64decode(
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcv"
    "Jik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7"
    "Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wAARCAAgACADASIAAhEBAxEB/8QAHwAAAQUBAQEB"
    "AQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKB"
    "kaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1"
    "dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl"
    "5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcF"
    "BAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5"
    "OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0"
    "tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwAooooAKKKK"
    "ACiiigAooooA/9k=")


def fake_jpeg(width, height, tail=b"\x00"):
    """A byte string with a real SOI and a real SOF0, so `jpeg_dimensions` has something to
    read, and `tail` to make two frames of the same size differ."""
    sof = (b"\xff\xc0" + (17).to_bytes(2, "big") + b"\x08"
           + height.to_bytes(2, "big") + width.to_bytes(2, "big")
           + b"\x03" + b"\x01\x11\x00\x02\x11\x01\x03\x11\x01")
    return b"\xff\xd8\xff\xe0" + (16).to_bytes(2, "big") + b"JFIF\x00" + b"\x00" * 9 \
        + sof + b"\xff\xda" + (8).to_bytes(2, "big") + b"\x01\x01\x00\x00\x3f\x00" \
        + tail + b"\xff\xd9"


def get(url, timeout=5.0):
    """-> (status, content_type, body_bytes). An HTTP error is a result here, not a raise:
    every failure path this file checks is a non-2xx with a body worth reading."""
    try:
        with urllib.request.urlopen(url, timeout=timeout) as res:
            return res.status, res.headers.get("Content-Type", ""), res.read()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.headers.get("Content-Type", ""), exc.read()


def get_json(url, timeout=5.0):
    code, ctype, body = get(url, timeout)
    try:
        return code, ctype, json.loads(body or b"{}")
    except json.JSONDecodeError:
        return code, ctype, {}


print(__doc__.splitlines()[0])
print()

# --------------------------------------------------------------------------------------
print("(1) camera names resolve onto the ports the vendor config publishes on")
check(facade.DEFAULT_CAMERA_PORTS == {"head_camera": 55555,
                                      "left_wrist_camera": 55556,
                                      "right_wrist_camera": 55557},
      "the built-in table is teleimager/cam_config_server.yaml's",
      str(facade.DEFAULT_CAMERA_PORTS))
check(list(facade.DEFAULT_CAMERA_PORTS) == ["head_camera", "left_wrist_camera",
                                            "right_wrist_camera"],
      "in g1_sidecar.py:1968's order — skill-executor.ts maps vla-server's cameras onto "
      "/cameras BY POSITION")
ports = dict(facade.DEFAULT_CAMERA_PORTS)
check(facade.resolve_camera("head_camera", ports) == "head_camera",
      "head_camera resolves to itself (config.ts:673's AGENT_CAMERA_NAME default)")
for alias, target in (("front_camera", "head_camera"), ("front", "head_camera"),
                      ("head", "head_camera"), ("left_wrist", "left_wrist_camera"),
                      ("right_wrist", "right_wrist_camera")):
    check(facade.resolve_camera(alias, ports) == target,
          f"alias {alias!r} -> {target}", str(facade.resolve_camera(alias, ports)))
check(facade.resolve_camera("nose_camera", ports) is None,
      "an unknown name resolves to None, never to a near miss")
check(facade.resolve_camera("HEAD_CAMERA", ports) is None,
      "resolution is exact, not case-folded — a wrong viewpoint served silently is worse "
      "than a 404")
check(facade.resolve_camera("front_camera", {"left_wrist_camera": 55556}) is None,
      "an alias whose target is not being served does not resolve")

# --camera / --cameras
check(facade.parse_camera_overrides(["head_camera=9001"]) == {"head_camera": 9001},
      "--camera NAME=PORT parses")
for bad in ("head_camera", "head_camera=", "=9001", "head_camera=nope",
            "head_camera=0", "head_camera=70000"):
    try:
        facade.parse_camera_overrides([bad])
        check(False, f"--camera {bad!r} is rejected")
    except ValueError:
        check(True, f"--camera {bad!r} is rejected at startup, not at first frame")
sel = facade.select_cameras(ports, ["right_wrist_camera", "head_camera"])
check(list(sel) == ["right_wrist_camera", "head_camera"],
      "--cameras keeps the order the operator asked for", str(list(sel)))
check(list(facade.select_cameras(ports, [])) == list(ports),
      "an empty --cameras serves them all, in table order")
try:
    facade.select_cameras(ports, ["chest_camera"])
    check(False, "--cameras with an unknown name is rejected")
except ValueError as exc:
    check("chest_camera" in str(exc) and "head_camera" in str(exc),
          "--cameras rejects an unknown name and lists the known ones", str(exc)[:70])

# The config handshake's payload shape (teleimager/cam_config_server.yaml, served as JSON
# by ZMQ_Responser). This is where the mapping REALLY comes from at runtime.
served = facade.parse_cam_config({
    "head_camera": {"enable_zmq": True, "zmq_port": 55555, "image_shape": [480, 640]},
    "left_wrist_camera": {"enable_zmq": True, "zmq_port": 55556},
    "right_wrist_camera": {"enable_zmq": False, "zmq_port": 55557},
    "junk": "not a dict",
})
check(served == {"head_camera": 55555, "left_wrist_camera": 55556},
      "parse_cam_config takes zmq_port for enable_zmq cameras and drops the rest",
      str(served))
check(facade.parse_cam_config({"c": {"enable_zmq": True, "zmq_port": True}}) == {},
      "a bool zmq_port is not a port (True == 1 in Python; that would subscribe to :1)")
check(facade.parse_cam_config(None) == {} and facade.parse_cam_config([]) == {},
      "a garbage config answer degrades to the built-in table rather than raising")

# --------------------------------------------------------------------------------------
print("\n(2) one ZMQ message is one bare JPEG — and anything else is refused")
# image_server.py:1358-1366 publishes `jpeg_bytes` as a single-part message with no topic
# and no header. parse_envelope must accept exactly that, and must not invent frames.
jpeg, prefix = facade.parse_envelope(REAL_JPEG)
check(jpeg == REAL_JPEG and prefix == 0,
      "a bare JPEG is passed through byte-identical, prefix 0")
jpeg, prefix = facade.parse_envelope(b"head_camera " + REAL_JPEG)
check(jpeg == REAL_JPEG and prefix == 12,
      "a topic envelope, if one ever appears, is stripped AND its length reported",
      f"prefix={prefix}")
check(facade.parse_envelope(b"") == (None, 0), "an empty message is not a frame")
check(facade.parse_envelope(b"\x89PNG\r\n\x1a\n" + b"\x00" * 200) == (None, 0),
      "a PNG is not a frame (the publisher's format changing must go loud, not quiet)")
check(facade.parse_envelope(b"x" * 200 + REAL_JPEG)[0] is None,
      f"an SOI past {facade.MAX_ENVELOPE_PREFIX} B is not hunted for — that would be "
      f"scanning arbitrary payloads for something JPEG-shaped")

check(facade.jpeg_dimensions(REAL_JPEG) == (32, 32),
      "jpeg_dimensions reads a real encoder's SOF0", str(facade.jpeg_dimensions(REAL_JPEG)))
check(facade.jpeg_dimensions(fake_jpeg(640, 480)) == (640, 480),
      "…and the 640x480 the factory scene's cam_config declares")
check(facade.jpeg_dimensions(fake_jpeg(1280, 480)) == (1280, 480),
      "…and would show a binocular head camera as 1280x480 rather than silently "
      "half-cropping downstream")
check(facade.jpeg_dimensions(b"not a jpeg") is None, "and gives up rather than guessing")

# --------------------------------------------------------------------------------------
print("\n(3) the staleness policy, as a pure function")
check(facade.frame_verdict(0, None, 0.5) == "never",
      "no frame ever -> 'never' (a different failure from 'stale', reported differently)")
check(facade.frame_verdict(3, 0.10, 0.5) == "ok", "a 0.10 s old frame inside a 0.5 s window")
check(facade.frame_verdict(3, 0.50, 0.5) == "ok", "the boundary is inclusive")
check(facade.frame_verdict(3, 0.51, 0.5) == "stale", "…and one tick past it is stale")
check(facade.frame_verdict(3, 30.0, 0.5) == "stale", "a 30 s old frame is never served")
check(facade.frame_verdict(3, 0.1, 0.5, 90.0, 0.0) == "ok",
      "a frozen PICTURE is not refused by default — a static scene legitimately repeats "
      "byte-identical JPEGs")
check(facade.frame_verdict(3, 0.1, 0.5, 90.0, 5.0) == "frozen",
      "…but --max-content-age turns that into a refusal for callers whose scene is never "
      "still")
check(facade.frame_verdict(3, 0.1, 0.5, 1.0, 5.0) == "ok",
      "a picture that changed recently passes even with --max-content-age set")
for verdict in ("never", "stale", "frozen"):
    msg = facade.verdict_error(verdict, "head_camera", 55555, 12.0, 0.5, 40.0, 5.0, 0.25)
    check("head_camera" in msg and len(msg) > 60,
          f"the {verdict!r} error names the camera and says what to look at",
          msg[:64] + "…")
check("55555" in facade.verdict_error("never", "head_camera", 55555, None, 0.5,
                                      None, 0.0, 0.25),
      "the 'never' error names the ZMQ port nothing is publishing on")

# --------------------------------------------------------------------------------------
print("\n(4) FrameSlot: the bounded wait, and what it does when nothing arrives")
slot = facade.FrameSlot("head_camera", 55555)
snap = slot.snapshot()
check(snap["seq"] == 0 and snap["jpeg"] is None and snap["age_s"] is None,
      "a fresh slot has no frame and no age (not an age of 0)")

t0 = time.monotonic()
snap, waited = slot.wait_fresh(0.5, 0.15)
elapsed = time.monotonic() - t0
check(snap["jpeg"] is None, "waiting on an empty slot yields no frame")
check(0.14 <= elapsed <= 0.6,
      "…and returns at the deadline rather than blocking indefinitely",
      f"{elapsed * 1000:.0f} ms")
check(0.14 <= waited <= 0.6, "the wait it reports is the wait it took",
      f"{waited * 1000:.0f} ms")

# A frame that lands DURING the wait must wake the waiter immediately, not at the deadline:
# that is the difference between `look` costing 20 ms and costing the full --wait-ms.
def _publish_soon(target, payload, delay):
    def _go():
        time.sleep(delay)
        target.publish(payload)
    threading.Thread(target=_go, daemon=True).start()


_publish_soon(slot, fake_jpeg(640, 480, b"\x01"), 0.05)
t0 = time.monotonic()
snap, waited = slot.wait_fresh(0.5, 2.0)
elapsed = time.monotonic() - t0
check(snap["jpeg"] is not None, "a frame arriving mid-wait is picked up")
check(elapsed < 0.5, "…and wakes the waiter at once, not at the 2 s deadline",
      f"{elapsed * 1000:.0f} ms")

check(slot.publish(b"\x89PNG\r\n\x1a\n" + b"\x00" * 50) is False,
      "a non-JPEG payload is refused")
snap = slot.snapshot()
check(snap["rejected"] == 1 and snap["seq"] == 1,
      "…counted, and it does NOT become the latest frame", str(snap["rejected"]))
check(snap["jpeg"] == fake_jpeg(640, 480, b"\x01"),
      "the last good frame is still the last good frame")
check(snap["dims"] == (640, 480), "the slot remembers the frame size", str(snap["dims"]))

# content age: identical bytes must not reset it, different bytes must.
slot2 = facade.FrameSlot("head_camera", 55555)
still = fake_jpeg(640, 480, b"\x07")
slot2.publish(still)
time.sleep(0.12)
slot2.publish(still)
snap = slot2.snapshot()
check(snap["age_s"] < 0.05,
      "re-publishing an identical frame refreshes DELIVERY age", f"{snap['age_s']:.3f}s")
check(snap["content_age_s"] >= 0.10,
      "…but not CONTENT age — this is the only handle on a frozen renderer",
      f"{snap['content_age_s']:.3f}s")
slot2.publish(fake_jpeg(640, 480, b"\x08"))
check(slot2.snapshot()["content_age_s"] < 0.05,
      "a changed picture resets content age")

print("\n  (4b) CameraSubscriber does not shadow anything threading.Thread needs")
# This is not hypothetical. `self._stop = threading.Event()` -- the name isaac_loco_bridge.py
# uses, on a class that is NOT a Thread -- shadows `threading.Thread._stop`, an internal
# METHOD that `join()` calls. The result is `TypeError: 'Event' object is not callable` on
# every shutdown, on Python 3.12 (which is what ~/anaconda3/envs/unitree_sim_env6 runs)
# though not on 3.14. It got caught only by running the verifier under both.
probe = facade.CameraSubscriber(facade.FrameSlot("head_camera", 55555), "127.0.0.1",
                                100, conflate=False, quiet=True)
collisions = sorted(
    name for name in vars(probe)
    if callable(getattr(threading.Thread, name, None)) and not callable(vars(probe)[name]))
check(not collisions,
      "no instance attribute overwrites a Thread method",
      "none" if not collisions else f"SHADOWED: {collisions}")
# And the flag stop() sets must be the one run()'s loop reads, or stop() is decorative.
before = {n for n, v in vars(probe).items() if isinstance(v, threading.Event)}
probe.stop()
flags = sorted(n for n in before if vars(probe)[n].is_set())
check(flags == ["_stopping"], "stop() sets exactly the subscriber's own Event", str(flags))
check("_stopping" in facade.CameraSubscriber.run.__code__.co_names,
      "…and run()'s loop reads that same attribute, so stop() really ends the thread")

# --------------------------------------------------------------------------------------
print("\n(5) the HTTP surface, against a real server on an ephemeral loopback port")
slots = {
    "head_camera": facade.FrameSlot("head_camera", 55555),
    "left_wrist_camera": facade.FrameSlot("left_wrist_camera", 55556),
}
MAX_AGE, WAIT_S = 0.20, 0.05
httpd = ThreadingHTTPServer(
    ("127.0.0.1", 0),
    facade.make_handler(slots, max_age_s=MAX_AGE, wait_s=WAIT_S, max_content_age_s=0.0,
                        scene="offline-test", sidecar_url=""))
httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
BASE = f"http://127.0.0.1:{httpd.server_address[1]}"

try:
    # -- 5a. before any frame: not ready, and honest about it --------------------------
    print("  (5a) the not-ready path — the facade started before the sim")
    code, _ctype, body = get_json(f"{BASE}/health")
    check(code == 200, "/health answers 200 even with no frames (it must be diagnosable)",
          str(code))
    check(body.get("status") == "starting" and body.get("connected") is False,
          "…reporting status 'starting' / connected false, not 'ok'",
          f"{body.get('status')}/{body.get('connected')}")
    check(body.get("ready") is False, "…and ready false")
    check(body["cameras"]["head_camera"]["state"] == "never"
          and body["cameras"]["head_camera"]["port"] == 55555,
          "…with a per-camera state and the port it is waiting on",
          json.dumps(body["cameras"]["head_camera"]))
    check(body.get("scene") == "offline-test" and body.get("sim") is True
          and isinstance(body.get("boot_id"), str),
          "…and the scene/sim/boot_id fields HardwareClient._tryConnect() reads")

    t0 = time.monotonic()
    code, _ctype, body = get_json(f"{BASE}/cameras/head_camera/snapshot")
    elapsed = time.monotonic() - t0
    check(code == 503, "a snapshot with no frame is a 503, not a black picture", str(code))
    check(body.get("ok") is False and "image_b64" not in body and "jpeg_base64" not in body,
          "…carrying no image key at all")
    check("EVER" in body.get("error", "") and "55555" in body.get("error", ""),
          "…and an error naming the port nothing published on",
          body.get("error", "")[:70] + "…")
    check(elapsed < 1.4,
          "…returned well inside HardwareClient.snapshot()'s 1500 ms AbortSignal",
          f"{elapsed * 1000:.0f} ms")

    code, _ctype, body = get_json(f"{BASE}/cameras")
    check(code == 200 and body.get("cameras") == ["head_camera", "left_wrist_camera"],
          "/cameras lists the canonical names in table order, before any frame arrives",
          str(body.get("cameras")))
    check("front_camera" not in body.get("cameras", []),
          "…and aliases are NOT listed — skill-executor.ts indexes this list positionally")

    # -- 5b. with a frame: the shape HardwareClient parses -----------------------------
    print("\n  (5b) the success path — the exact shape HardwareClient.snapshot() parses")
    slots["head_camera"].publish(REAL_JPEG)
    code, ctype, body = get_json(f"{BASE}/cameras/head_camera/snapshot")
    check(code == 200 and ctype.startswith("application/json"),
          "200 application/json", f"{code} {ctype}")
    check(body.get("ok") is True and body.get("camera") == "head_camera", "ok + camera name")
    check(isinstance(body.get("image_b64"), str)
          and body.get("image_b64") == body.get("jpeg_base64"),
          "BOTH image_b64 and jpeg_base64 are present and equal (TASK-194: G1 snapshots "
          "failed for years because only one was)")
    check(base64.b64decode(body["image_b64"]) == REAL_JPEG,
          "…and decode byte-for-byte to the JPEG the sim published — nothing is re-encoded")
    check(body.get("reencoded") is False,
          "…which the payload states rather than leaving the caller to assume")
    check(isinstance(body.get("age_s"), (int, float)) and body["age_s"] < MAX_AGE,
          "the frame's age is reported", str(body.get("age_s")))
    check(body.get("size") == "32x32" and body.get("frame") == 1,
          "…with its size and sequence number", f"{body.get('size')} #{body.get('frame')}")

    code, ctype, raw = get(f"{BASE}/cameras/head_camera/snapshot?format=raw")
    check(code == 200 and ctype == "image/jpeg" and raw == REAL_JPEG,
          "?format=raw answers image/jpeg bytes — snapshotRaw()'s preferred path",
          f"{code} {ctype} {len(raw)} B")
    code, ctype, raw = get(
        f"{BASE}/cameras/head_camera/snapshot?format=raw&shadows=0&reflection=0&quality=70")
    check(code == 200 and ctype == "image/jpeg" and raw == REAL_JPEG,
          "…and snapshotRaw()'s full query string does not 404 into a retry — the render "
          "options are accepted and ignored, which the JSON reply states as reencoded:false",
          f"{code} {ctype}")

    code, _ctype, body = get_json(f"{BASE}/cameras/front_camera/snapshot")
    check(code == 200 and body.get("camera") == "head_camera",
          "an alias serves the head camera and REPORTS the canonical name it served",
          str(body.get("camera")))

    code, _ctype, body = get_json(f"{BASE}/health")
    check(body.get("status") == "ok" and body.get("connected") is True
          and body.get("ready") is True,
          "/health flips to ok once a camera is fresh",
          f"{body.get('status')}/{body.get('connected')}")
    check(body["cameras"]["left_wrist_camera"]["state"] == "never",
          "…while a camera that never got a frame still says so individually")

    # -- 5c. the failure that matters most ---------------------------------------------
    print("\n  (5c) the stale path — a frame exists, and is refused anyway")
    time.sleep(MAX_AGE + 0.15)
    t0 = time.monotonic()
    code, _ctype, body = get_json(f"{BASE}/cameras/head_camera/snapshot")
    elapsed = time.monotonic() - t0
    check(code == 503, "a stale frame is a 503", str(code))
    check("image_b64" not in body and "jpeg_base64" not in body,
          "…and the last good picture is NOT served as a consolation. This is the whole "
          "point of the file: a stale view in scene memory is unrecoverable downstream")
    check(body.get("state") == "stale" and isinstance(body.get("age_s"), (int, float)),
          "…the reply says 'stale' and states the age", str(body.get("age_s")))
    check(f"{MAX_AGE:.2f}" in body.get("error", ""),
          "…and quotes the limit it exceeded", body.get("error", "")[:70] + "…")
    check(WAIT_S - 0.02 <= elapsed < 1.4,
          "…after waiting --wait-ms for a fresh one and no longer",
          f"{elapsed * 1000:.0f} ms")
    code, _ctype, body = get_json(f"{BASE}/health")
    check(body.get("status") == "starting" and body["cameras"]["head_camera"]["state"] == "stale",
          "/health goes back to not-ready when every camera has gone stale",
          f"{body.get('status')}/{body['cameras']['head_camera']['state']}")

    # A fresh frame brings it straight back — no latching, no restart needed.
    slots["head_camera"].publish(fake_jpeg(640, 480, b"\x02"))
    code, _ctype, body = get_json(f"{BASE}/cameras/head_camera/snapshot")
    check(code == 200 and body.get("size") == "640x480",
          "…and one fresh frame restores service without a restart", str(code))

    # -- 5d. unknown routes and unknown cameras ----------------------------------------
    print("\n  (5d) unknown cameras and unproxied routes")
    code, _ctype, body = get_json(f"{BASE}/cameras/chest_camera/snapshot")
    check(code == 404, "an unknown camera is a 404, not a cold-camera 503", str(code))
    check("chest_camera" in body.get("error", "") and "head_camera" in body.get("error", ""),
          "…naming what was asked for and what is on offer", body.get("error", "")[:70] + "…")
    code, _ctype, body = get_json(f"{BASE}/state")
    check(code == 404 and "not found" in body.get("error", ""),
          "with no --sidecar-url this is a camera-only endpoint and says so", str(code))
finally:
    httpd.shutdown()
    httpd.server_close()

# --------------------------------------------------------------------------------------
print("\n(6) that shape is only right because HardwareClient.ts reads it — assert it there")
# Same tactic as verify_isaac_odom_offline.py's (5b): pin the contract against the consumer's
# own source, so a change on the TypeScript side fails HERE and not on the robot.
hc_path = os.path.join(_HERE, "..", "src", "hardware", "HardwareClient.ts")
if not os.path.exists(hc_path):
    check(False, f"HardwareClient.ts not found at {hc_path}")
else:
    src = open(hc_path, encoding="utf-8").read()
    check("/cameras/${encodeURIComponent(name)}/snapshot" in src,
          "it still fetches /cameras/<name>/snapshot")
    check("data.image_b64 ?? data.jpeg_base64" in src,
          "it still takes image_b64 ?? jpeg_base64 — both keys must keep being emitted")
    check("data.error ? ` — ${data.error}` : ''" in src,
          "it still surfaces our `error` text verbatim on a non-2xx")
    check("AbortSignal.timeout(1500)" in src,
          "snapshot() still aborts at 1500 ms — the ceiling --wait-ms is chosen under")
    check("params = new URLSearchParams({ format: 'raw' })" in src
          and "res.status === 404 || res.status === 400" in src,
          "snapshotRaw() still asks for ?format=raw and retries plain on 404/400")
    check("contentType.startsWith('image/')" in src,
          "…and accepts the raw reply only when the content type is an image")
    check("data.cameras ?? []" in src, "getCameras() still reads {cameras: [...]}")
    check("this.sidecarAvailable = data.status === 'ok'" in src,
          "/health.status still gates sidecarAvailable — which is why standalone mode "
          "reports 'starting' rather than 'ok' before the first frame")
    check("`${getSidecarUrl()}/health`" in src and "`${getSidecarUrl()}/state`" in src,
          "…and /state is on the SAME base URL, i.e. --sidecar-url proxying is required "
          "for Agent Mode, not optional")

# --------------------------------------------------------------------------------------
print("\n(7) every args.<x> the facade reads has an --option behind it")
# The house lesson: an `args.X` with no matching add_argument raises AttributeError at
# runtime, and neither `--help` nor `py_compile` catches it — the process starts, prints its
# banner, and dies on the line that touches it. This check is that missing safety net.
parser = facade.build_parser()
dests = {a.dest for a in parser._actions}
source = open(os.path.join(_HERE, "isaac_camera_facade.py"), encoding="utf-8").read()
used = set(re.findall(r"\bargs\.([A-Za-z_][A-Za-z0-9_]*)", source))
missing = sorted(used - dests)
check(not missing, "no args.<x> without an add_argument",
      f"used {len(used)}: {', '.join(sorted(used))}" if not missing
      else f"MISSING: {missing}")
unused = sorted(dests - used - {"help"})
check(not unused, "and no --option the code never reads",
      "none" if not unused else f"DEAD: {unused}")

# The parser must also survive being built and asked for defaults — an add_argument with a
# bad type= or a `default` that argparse cannot format blows up only at construction.
defaults = vars(parser.parse_args([]))
check(defaults["serve"] == 8779 and defaults["max_age"] == 0.5
      and defaults["wait_ms"] == 250 and defaults["zmq_host"] == "127.0.0.1",
      "defaults parse: --serve 8779, --max-age 0.5, --wait-ms 250, --zmq-host 127.0.0.1")
check(defaults["camera"] == [] and defaults["cameras"] == ""
      and defaults["conflate"] is False and defaults["quiet"] is False,
      "…and the list/flag defaults are empty rather than None")
check(defaults["wait_ms"] / 1000.0 < 1.5,
      "the default wait is inside HardwareClient's 1500 ms abort",
      f"{defaults['wait_ms']} ms")

# resolve_ports must not need a running config socket. --config-port 0 skips the handshake.
ns = parser.parse_args(["--config-port", "0", "--camera", "head_camera=9001",
                        "--cameras", "head_camera"])
resolved, provenance = facade.resolve_ports(ns)
check(resolved == {"head_camera": 9001}, "resolve_ports honours --camera and --cameras "
      "with the handshake disabled", str(resolved))
check("built-in table" in provenance and "override" in provenance,
      "…and reports where the mapping came from, for the banner", provenance)

# --------------------------------------------------------------------------------------
print("\n(8) it loads and runs without pyzmq — the verifier itself is the proof")
check("import zmq" not in source.split('"""', 2)[-1].split("def request_cam_config")[0],
      "zmq is not imported at module scope (this file imported the facade already)")
check(facade.request_cam_config.__doc__ is not None
      and "nobody answers" in facade.request_cam_config.__doc__,
      "the config handshake documents its no-answer fallback")
try:
    import zmq  # noqa: F401
    print("    NOTE  pyzmq IS importable here, so the lazy-import path was not the one "
          "under test above; it is still exercised on an interpreter without it")
except ImportError:
    zmq = None
    print("    NOTE  pyzmq is NOT importable here, and every check above still ran — "
          "which is the claim")

# --------------------------------------------------------------------------------------
print("\n(9) the SUB half, against a loopback PUB using the vendor's own socket options")
# Everything above injects frames straight into the FrameSlot, which never touches ZMQ. This
# is the one check that drives CameraSubscriber for real. The publisher below is
# `ZMQ_PublisherThread.run` (image_client.py:110-115) reduced to its socket setup: PUB,
# SNDHWM=1, LINGER=0, bind, single-part `send(jpeg_bytes)`. It proves the two ends agree.
# It does NOT prove anything about Isaac -- see this file's docstring.
if zmq is None:
    print("    SKIP  pyzmq not importable here; the HTTP and policy checks above stand "
          "on their own")
else:
    ctx = zmq.Context()
    pub = ctx.socket(zmq.PUB)
    pub.setsockopt(zmq.SNDHWM, 1)
    pub.setsockopt(zmq.LINGER, 0)
    pub_port = pub.bind_to_random_port("tcp://127.0.0.1")
    live = facade.FrameSlot("head_camera", pub_port)
    sub = facade.CameraSubscriber(live, "127.0.0.1", 50, conflate=False, quiet=True)
    sub.start()
    try:
        # PUB drops anything sent before a subscriber has finished connecting (the "slow
        # joiner" problem), which is why this publishes repeatedly rather than once.
        deadline = time.time() + 5.0
        while time.time() < deadline and live.snapshot()["seq"] == 0:
            pub.send(REAL_JPEG)
            time.sleep(0.02)
        snap = live.snapshot()
        check(snap["seq"] > 0, "a JPEG published on a PUB socket reaches the FrameSlot",
              f"{snap['seq']} frame(s)")
        check(snap["jpeg"] == REAL_JPEG,
              "…byte-identical: no decode, no re-encode, no envelope assumed")
        check(snap["dims"] == (32, 32) and snap["rejected"] == 0,
              "…parsed and none dropped", f"{snap['dims']} rejected={snap['rejected']}")
        check(facade.frame_verdict(snap["seq"], snap["age_s"], 0.5) == "ok",
              "…and fresh enough to serve", f"age {snap['age_s']:.3f}s")
        # A payload the publisher should never send, over the real transport.
        pub.send(b"\x89PNG\r\n\x1a\n" + b"\x00" * 64)
        deadline = time.time() + 2.0
        while time.time() < deadline and live.snapshot()["rejected"] == 0:
            time.sleep(0.02)
        after = live.snapshot()
        check(after["rejected"] == 1 and after["jpeg"] == REAL_JPEG,
              "a non-JPEG on the wire is dropped and does not replace the good frame",
              f"rejected={after['rejected']}")
        check(sub.error is None, "the subscriber thread is still alive")
        sub.stop()
        try:
            sub.join(timeout=2.0)
            joined = not sub.is_alive()
            detail = "" if joined else "still running after 2 s"
        except Exception as exc:  # noqa: BLE001
            joined, detail = False, repr(exc)
        # `join()` is where a `_stop` attribute shadowing `Thread._stop` blows up — see (4b).
        check(joined, "stop() + join() shut the subscriber down cleanly", detail)
    finally:
        sub.stop()
        pub.close(linger=0)
        ctx.term()

print()
if FAILURES:
    print(f"FAILED: {len(FAILURES)} check(s): {FAILURES}")
    sys.exit(1)
print("all isaac_camera_facade offline checks passed")
