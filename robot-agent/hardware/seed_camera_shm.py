#!/usr/bin/env python3
"""Pre-seed Isaac's camera shared memory so the vendor image server's ZMQ sockets bind.

@file seed_camera_shm.py
@description Creates /dev/shm/isaac_{head,left,right}_image_shm, each holding one valid
    placeholder frame, BEFORE sim_main.py starts. Run from factory_mission_bringup.sh
    between the `docker rm -f` of any old container and the `docker run` that starts Isaac.
@feature hardware

The race this file exists to lose deliberately
----------------------------------------------
`unitree_sim_isaaclab`'s image server has a fatal startup race, and losing it costs the
whole run's cameras:

  * `image_server.py:1433-1467` (`ImageServer.start`) starts one `_update_frames` thread per
    camera, sleeps 2.0 s, calls `wait_until_ready()` on each camera, and only then starts the
    `_zmq_pub` threads. That readiness gate is a no-op for this rig: `IsaacSimCamera.__init__`
    sets `self._ready` immediately, "since the camera object is initialized and will wait for
    shared memory data in _update_frame". So nothing at all gates on a frame existing.
  * `_zmq_pub`'s FIRST iteration (`image_server.py:1358-1370`) reads the camera's ring buffer.
    If it is empty it logs "[Image Server] <cam> returned no frame.", sets the SHARED
    `_stop_event`, and breaks. That one empty read kills the frame threads for ALL THREE
    cameras, not just its own.
  * The ring buffer is filled by `IsaacSimCamera._update_frame`, which reads POSIX shared
    memory that Isaac's own `MultiImageWriter` creates only after the scene has loaded.
  * The ZMQ PUB socket is created and `bind()`s LAZILY, inside `publish()`, which is only
    reached once there is a frame to publish. No frame, no bind.

Measured on this box: `_zmq_pub` ran at 19:51:22.064; the writer created
/dev/shm/isaac_head_image_shm at 19:51:23.800. **Missed by 1.74 seconds.**

The result is a failure that looks like health. Port 60000 (the REQ/REP camera-config
responder) keeps answering normally, so the server is up and describes three cameras, while
55555/55556/55557 never bind at all for the entire life of the sim. `isaac_camera_facade.py`
then reports every camera as "never" and Agent Mode is blind, with nothing in the Isaac log
except one warning line buried in a hundred thousand others.

The fix, and why it is enough
-----------------------------
Create the three segments ourselves, with a real decodable frame in them, before the sim
starts. Then:

  * `_update_frame`'s very first read succeeds (`MultiImageReader.last_timestamps` starts at
    0, so any timestamp we write is "new data"), and the ring buffer is non-empty within one
    camera tick, i.e. ~33 ms.
  * The vendor's own 2.0 s sleep between starting `_update_frames` and starting `_zmq_pub`
    then covers that tick with two orders of magnitude to spare, so `_zmq_pub`'s first read
    cannot be empty, `publish()` runs, and the sockets bind.
  * Isaac's writer opens the SAME name a few seconds later (`shared_memory_utils.py:100-106`
    tries `SharedMemory(name=...)` first and only creates when that raises FileNotFoundError),
    so it overwrites our placeholder in place. Nothing is left behind and no vendor file is
    touched. The checkout stays read-only, which is the policy.

The placeholder is visible for those few seconds, so it is drawn to be unmistakable: magenta
and yellow bars with "NO CAMERA SIGNAL" across the middle. It is deliberately NOT black. A
black frame is exactly what a stall produces, so a black placeholder would be indistinguish-
able from an unlit render and could be written into Agent Mode's scene memory as if it were
an observation of a dark room.

The shared memory layout
------------------------
`tools/shared_memory_utils.py:29-42`, `SimpleImageHeader`, a `ctypes.LittleEndianStructure`.
Verified empirically against the live writer on 2026-08-29 (all three segments: 921728 B,
480x640x3, encoding 1, quality 85, payloads 13.7-15.1 kB).

    path: /dev/shm/isaac_<name>_image_shm   <name> is exactly `head`, `left`, `right`
    total size: EXACTLY 921728 bytes        ( = 640*480*3 + 128 )

    offset  size  type      field       value we write
    ------  ----  --------  ----------  ---------------------------------------------
         0     8  uint64    timestamp   int(time.time()*1000), wall clock milliseconds
         8     4  uint32    height      480
        12     4  uint32    width       640
        16     4  uint32    channels    3
        20    16  char[16]  image_name  b'head' / b'left' / b'right', NUL-padded
        36     4  uint32    data_size   length in bytes of the payload
        40     4  uint32    encoding    1 = JPEG, 0 = raw BGR
        44     4  uint32    quality     85 (meaningful only when encoding = 1)
        48   ...  bytes     payload     data_size bytes; the rest to 921728 is padding

There is NO lock and NO sequence counter other than `timestamp`, which is why the timestamp
we write must be the real current wall clock and must never be nudged forward: the reader
(`shared_memory_utils.py:315-318`) skips any header whose timestamp is <= the last one it
saw, so a placeholder stamped in the future would make Isaac's real frames invisible until
the clock caught up.

Doing the /dev/shm work as root, without sudo
---------------------------------------------
The sim container runs `--user 0` with `--ipc=host`, so the segments Isaac creates are
root:root mode 0600 on the HOST's /dev/shm. This user (uid 1002, no sudo) cannot unlink or
overwrite them, and a leftover from a previous run is therefore a landmine a host-side seed
cannot clear. So every /dev/shm operation here — read, unlink, create, read back — happens
inside a short-lived throwaway container that runs as root:

    docker run --rm --ipc=host --network none --user 0 -v /dev/shm:/dev/shm \\
        neodem-isaac-host:latest <interpreter> seed_camera_shm.py --worker

`neodem-isaac-host:latest` is the same image the sim uses. It ships NO python of its own
(checked: `command -v python3` finds nothing, there is no /usr/bin/python*), which is why the
sim invokes /home/humanoid/anaconda3/envs/unitree_sim_env6/bin/python through a bind mount —
and so do we. That env is self-contained, so only it and this script's own directory are
mounted, both read-only; the wholesale bind of $HOME the sim does is not needed here.

`--worker` runs THIS FILE inside the container, so there is one implementation of the layout
rather than a code string embedded in a shell pipeline. It speaks JSON over stdin/stdout, so
the frame bytes never appear in `ps` and never hit a temp file.

Refusing to seed over a live sim
--------------------------------
Unlinking a segment a running sim has mapped is silent and unrecoverable: the writer keeps
writing to the now-nameless inode while every reader opens the new one, and the cameras go
dark for good with no error anywhere. mtime cannot detect this — the segments are written
through an mmap, so their mtime is frozen at creation (measured: mtime still read
21:51:23.800 fourteen minutes into a sim that was publishing at that instant). The header's
own timestamp is the only honest liveness signal, and reading it needs root, which is another
reason the check runs in the container. So `--seed` reads all three headers FIRST and refuses
the whole operation if any of them was written within --live-window seconds. `--force`
overrides, and should only be used by someone who knows the sim is gone.

Usage
-----
    seed_camera_shm.py                 seed all three, then verify by reading them back
    seed_camera_shm.py --check         report the current state; non-zero if not all good
    seed_camera_shm.py --clean         remove all three
    seed_camera_shm.py --prefix rehearsal ...   operate on /dev/shm/rehearsal_*_image_shm,
                                       so the create/verify path can be exercised without
                                       going anywhere near a live sim's segments
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import shutil
import struct
import subprocess
import sys
import time

# --------------------------------------------------------------------------------------
# The wire facts, in one place. See the layout table in the module docstring.
# --------------------------------------------------------------------------------------

SHM_DIR = "/dev/shm"

#: `shared_memory_utils.py:22` — get_shm_name() is f"isaac_{image_name}_image_shm", and
#: `image_server.py:1307-1325` derives image_name from the camera topic, so these three
#: spellings are the only ones the sim will ever open. Not configurable by the vendor.
IMAGE_NAMES = ("head", "left", "right")

#: `shared_memory_utils.py:24` — SHM_SIZE_PER_IMAGE. The +128 is header (48) plus slack, and
#: it is exactly what makes a full raw BGR frame (921600 + 48 = 921648) fit.
SHM_SIZE = 640 * 480 * 3 + 128          # 921728
HEADER_SIZE = 48                        # ctypes.sizeof(SimpleImageHeader)

WIDTH, HEIGHT, CHANNELS = 640, 480, 3
ENCODING_RAW, ENCODING_JPEG = 0, 1
JPEG_QUALITY = 85                       # what the live writer uses; matched for consistency

DEFAULT_PREFIX = "isaac"

#: The sim's image, and the stock interpreter inside it. The image itself has no python, so
#: this path is not optional decoration — see the docstring. It is only a fallback for a hand
#: run: factory_mission_bringup.sh passes --interpreter from its own CONDA_ENV, because a
#: default that disagrees with the env the sim uses fails as unreadable docker noise.
DEFAULT_DOCKER_IMAGE = "neodem-isaac-host:latest"
DEFAULT_INTERPRETER = "/home/humanoid/anaconda3/envs/unitree_sim_env6/bin/python"

#: A header written within this many seconds means something is still writing. Isaac's writer
#: is rate-limited to 50 Hz (`shared_memory_utils.py:53`), so a live segment is never more
#: than ~20 ms stale; five seconds is two orders of magnitude of slack and still far below
#: the gap between two runs.
DEFAULT_LIVE_WINDOW_S = 5.0

#: 0666, not the 0600 python's own shared_memory module would give us. Two reasons, and
#: neither is laziness: (a) --check must be able to decode the header from the host without
#: paying for a container, and (b) a sim run as somebody other than root must still be able
#: to overwrite what we seeded — a segment it cannot open is worse than no segment at all.
#: This is not a meaningful widening: /dev/shm is drwxrwxrwt, so any local user can already
#: create these names before the sim does, which is precisely what this script does.
DEFAULT_MODE = 0o666

JPEG_SOI = b"\xff\xd8"
JPEG_EOI = b"\xff\xd9"


def segment_path(prefix: str, name: str) -> str:
    """`/dev/shm/<prefix>_<name>_image_shm` — the vendor's get_shm_name() with the stem
    parameterised, so a rehearsal can exercise this code without touching isaac_*."""
    return os.path.join(SHM_DIR, f"{prefix}_{name}_image_shm")


# --------------------------------------------------------------------------------------
# The header, packed and unpacked by hand.
# --------------------------------------------------------------------------------------
# ctypes would let us mirror SimpleImageHeader exactly, but it would also mean this file
# quietly inherits whatever padding the compiler picks. struct with explicit little-endian
# offsets is the same 48 bytes and says out loud where every field lives. The two halves are
# packed separately because char[16] sits between them at offset 20 and needs no alignment.

_HEAD_FMT = "<QIII"     # timestamp, height, width, channels   -> offsets 0, 8, 12, 16
_TAIL_FMT = "<III"      # data_size, encoding, quality         -> offsets 36, 40, 44


def pack_header(name: str, data_size: int, encoding: int, quality: int,
                timestamp_ms: int) -> bytes:
    """The 48-byte header. Raises ValueError rather than writing something a reader would
    misparse — a short header is not a thing that can be noticed downstream."""
    if len(name.encode()) > 15:
        # The vendor truncates to 15 and pads to 16 (`shared_memory_utils.py:118`). We refuse
        # instead: a truncated name would still decode, just into a camera nobody asked for.
        raise ValueError(f"image name {name!r} does not fit in char[16] with its NUL")
    if data_size < 0 or HEADER_SIZE + data_size > SHM_SIZE:
        raise ValueError(f"payload of {data_size} B does not fit in {SHM_SIZE} B segment "
                         f"(header is {HEADER_SIZE} B)")
    blob = (struct.pack(_HEAD_FMT, timestamp_ms, HEIGHT, WIDTH, CHANNELS)
            + name.encode()[:15].ljust(16, b"\x00")
            + struct.pack(_TAIL_FMT, data_size, encoding, quality))
    assert len(blob) == HEADER_SIZE, len(blob)   # the one invariant everything else assumes
    return blob


def unpack_header(buf: bytes) -> dict:
    """Header fields out of the first 48 bytes. Raises ValueError if there are not 48."""
    if len(buf) < HEADER_SIZE:
        raise ValueError(f"only {len(buf)} B where a {HEADER_SIZE} B header should be")
    ts, height, width, channels = struct.unpack_from(_HEAD_FMT, buf, 0)
    name = buf[20:36].split(b"\x00", 1)[0].decode("utf-8", "replace")
    data_size, encoding, quality = struct.unpack_from(_TAIL_FMT, buf, 36)
    return {"timestamp": ts, "height": height, "width": width, "channels": channels,
            "image_name": name, "data_size": data_size, "encoding": encoding,
            "quality": quality}


def header_complaints(hdr: dict, name: str, size: int) -> list[str]:
    """Everything wrong with one segment, as sentences. Empty means it is good.

    Collected rather than raised one at a time: when a segment is wrong an operator wants the
    whole picture, not the first field that failed.
    """
    bad: list[str] = []
    if size != SHM_SIZE:
        bad.append(f"size is {size} B, not {SHM_SIZE} B")
    if hdr["image_name"] != name:
        bad.append(f"header names it {hdr['image_name']!r}, not {name!r}")
    if (hdr["height"], hdr["width"], hdr["channels"]) != (HEIGHT, WIDTH, CHANNELS):
        bad.append(f"header says {hdr['height']}x{hdr['width']}x{hdr['channels']}, "
                   f"not {HEIGHT}x{WIDTH}x{CHANNELS}")
    if hdr["data_size"] <= 0:
        bad.append("data_size is 0 — the header is there but there is no frame behind it")
    elif HEADER_SIZE + hdr["data_size"] > SHM_SIZE:
        bad.append(f"data_size {hdr['data_size']} B overruns the segment")
    if hdr["encoding"] not in (ENCODING_RAW, ENCODING_JPEG):
        bad.append(f"encoding {hdr['encoding']} is neither 0 (raw BGR) nor 1 (JPEG)")
    if hdr["encoding"] == ENCODING_RAW and hdr["data_size"] != WIDTH * HEIGHT * CHANNELS:
        # `shared_memory_utils.py:331-336` rejects exactly this, silently, per frame.
        bad.append(f"raw payload is {hdr['data_size']} B, not {WIDTH * HEIGHT * CHANNELS} B")
    # A timestamp ahead of the clock is the one corruption that would poison a HEALTHY sim:
    # the reader ignores every frame stamped at or before the last one it saw.
    ahead_ms = hdr["timestamp"] - int(time.time() * 1000)
    if ahead_ms > 1000:
        bad.append(f"timestamp is {ahead_ms / 1000:.1f}s in the FUTURE — Isaac's real frames "
                   f"would be ignored until the clock caught up")
    return bad


# --------------------------------------------------------------------------------------
# The placeholder frame.
# --------------------------------------------------------------------------------------

def build_placeholder(name: str) -> tuple[bytes, int, int]:
    """`(payload, encoding, quality)` for one camera.

    Pillow draws a labelled magenta/yellow bar pattern and encodes it as JPEG. Pillow is
    present in the host interpreter this script runs under, but it is not required: without
    it we fall back to a flat magenta RAW BGR frame, which needs nothing but the standard
    library and which the vendor reader handles on its own documented path
    (`shared_memory_utils.py:329-336`, encoding 0). That fallback is preferred over a
    5 kB base64 constant pasted into this file: 640*480*3 + 48 is exactly what the segment
    was sized for, it is one line of stdlib, and it cannot rot the way a blob nobody can read
    can. Either way the frame is pure magenta-family colour, which no real render produces.

    The frame bytes never leave this process except as base64 inside the worker's JSON, so
    nothing here depends on Pillow (or cv2, or numpy) being importable in the container.
    """
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError:
        # Flat magenta, BGR order (B=255, G=0, R=255 — which happens to be byte-identical to
        # RGB magenta, so the channel order cannot be got wrong here).
        return bytes([255, 0, 255]) * (WIDTH * HEIGHT), ENCODING_RAW, 0

    import io

    def font(size: int):
        try:
            return ImageFont.load_default(size=size)   # Pillow >= 10.1
        except TypeError:
            return ImageFont.load_default()            # older: 11 px bitmap, still legible

    img = Image.new("RGB", (WIDTH, HEIGHT), (255, 0, 255))
    draw = ImageDraw.Draw(img)
    for y in range(0, HEIGHT, 64):
        if (y // 64) % 2:
            draw.rectangle([0, y, WIDTH - 1, y + 63], fill=(255, 214, 0))
    draw.rectangle([0, 208, WIDTH - 1, 300], fill=(0, 0, 0))
    draw.text((24, 218), "NO CAMERA SIGNAL", font=font(40), fill=(255, 255, 255))
    # ASCII only in the drawn text: the default bitmap font has no em dash and renders
    # anything it lacks as a tofu box, which reads as a corrupt frame rather than a label.
    draw.text((24, 268), f"seed_camera_shm.py placeholder for '{name}' - "
                         f"Isaac has not rendered yet", font=font(16), fill=(255, 214, 0))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=JPEG_QUALITY)
    return buf.getvalue(), ENCODING_JPEG, JPEG_QUALITY


def payload_complaint(payload: bytes, encoding: int) -> str:
    """One sentence about a payload that is not what its encoding claims, or ""."""
    if encoding == ENCODING_JPEG:
        if not payload.startswith(JPEG_SOI):
            return f"encoding says JPEG but the payload starts {payload[:2].hex()}, not ffd8"
        if not payload.endswith(JPEG_EOI):
            return f"encoding says JPEG but the payload ends {payload[-2:].hex()}, not ffd9"
    elif encoding == ENCODING_RAW and len(payload) != WIDTH * HEIGHT * CHANNELS:
        return f"raw payload is {len(payload)} B, not {WIDTH * HEIGHT * CHANNELS} B"
    return ""


# --------------------------------------------------------------------------------------
# The worker. Everything that touches /dev/shm runs here, as root, inside the container
# (or in this process under --no-docker). It speaks JSON and writes nothing else to stdout.
# --------------------------------------------------------------------------------------

def _stat_of(path: str) -> dict | None:
    try:
        st = os.stat(path)
    except FileNotFoundError:
        return None
    return {"size": st.st_size, "uid": st.st_uid, "gid": st.st_gid,
            "mode": st.st_mode & 0o7777}


def _read_segment(path: str, want_payload: bool) -> dict:
    """State of one segment: presence, stat, decoded header, payload sanity.

    Never raises for an absent or unreadable segment — a report that dies on the first
    unreadable file cannot tell you which of the three is the problem.
    """
    out: dict = {"path": path}
    st = _stat_of(path)
    if st is None:
        out["present"] = False
        return out
    out["present"] = True
    out.update(st)
    try:
        with open(path, "rb") as fh:
            head = fh.read(HEADER_SIZE)
            hdr = unpack_header(head)
            out["header"] = hdr
            size = min(hdr["data_size"], SHM_SIZE - HEADER_SIZE)
            if size > 0:
                if want_payload:
                    out["payload_b64"] = base64.b64encode(fh.read(size)).decode()
                else:
                    # Enough to answer "is this a JPEG that ends where it says it does"
                    # without hauling a megabyte through a JSON pipe.
                    out["payload_head"] = fh.read(2).hex()
                    fh.seek(HEADER_SIZE + size - 2)
                    out["payload_tail"] = fh.read(2).hex()
    except PermissionError as exc:
        out["unreadable"] = f"{exc.strerror} (mode {oct(st['mode'])}, uid {st['uid']})"
    except (OSError, ValueError) as exc:
        out["unreadable"] = str(exc)
    return out


def _age_ms(state: dict, now_ms: int) -> int | None:
    hdr = state.get("header")
    return None if hdr is None else now_ms - hdr["timestamp"]


def worker_check(prefix: str, names: list[str]) -> dict:
    now_ms = int(time.time() * 1000)
    return {"now_ms": now_ms,
            "segments": [_read_segment(segment_path(prefix, n), False) for n in names]}


def worker_clean(prefix: str, names: list[str]) -> dict:
    results = []
    for name in names:
        path = segment_path(prefix, name)
        entry = {"name": name, "path": path}
        try:
            os.unlink(path)
            entry["removed"] = True
        except FileNotFoundError:
            entry["removed"] = False          # already gone is a success, not an error
        except OSError as exc:
            entry["removed"] = False
            entry["error"] = f"{exc.strerror} — cannot unlink (are we root?)"
        results.append(entry)
    return {"segments": results}


def worker_seed(prefix: str, payloads: dict, mode: int, force: bool,
                live_window_s: float) -> dict:
    """Remove and re-create every segment, then read each one back and prove it.

    The liveness pre-scan covers ALL of them before anything is unlinked: seeding two
    segments and then refusing on the third would leave the sim reading a mix of a live
    stream and two placeholders, which is worse than either outcome on its own.
    """
    now_ms = int(time.time() * 1000)
    live = []
    for name in payloads:
        state = _read_segment(segment_path(prefix, name), False)
        age = _age_ms(state, now_ms)
        if age is not None and age < live_window_s * 1000:
            live.append({"name": name, "age_ms": age})
    if live and not force:
        return {"refused": "live", "live": live, "live_window_s": live_window_s}

    results = []
    for name, payload_b64 in payloads.items():
        payload = base64.b64decode(payload_b64["data"])
        encoding = int(payload_b64["encoding"])
        quality = int(payload_b64["quality"])
        path = segment_path(prefix, name)
        entry: dict = {"name": name, "path": path, "verified": False}
        try:
            # 1. Unlink. A stale root-owned leftover from a previous run is the normal case,
            #    not an exception, and unlink is the only way this user can clear one.
            try:
                os.unlink(path)
                entry["removed_existing"] = True
            except FileNotFoundError:
                entry["removed_existing"] = False

            # 2. Create, with plain os.open and NOT multiprocessing.shared_memory.
            #    That module registers every segment it touches with resource_tracker --
            #    on ATTACH as well as on create (CPython bpo-38119) -- and the tracker
            #    unlinks them when the process exits. A seeder built on it would delete the
            #    three segments on its way out and leave the sim exactly as blind as before.
            #    Observed here: a throwaway verification container that merely OPENED a
            #    segment to decode it unlinked it on exit. POSIX shm on Linux is a file in
            #    /dev/shm, so open/ftruncate/pwrite is both simpler and free of that.
            #    O_EXCL so that losing a race against another creator is an error we can
            #    see, rather than two processes silently sharing one segment. The mode
            #    passed to os.open is filtered by the umask, so fchmod says what we mean.
            fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_RDWR, mode)
            try:
                os.fchmod(fd, mode)
                # ftruncate first: the tail past the payload has to be the zero padding a
                # 921728 B segment is defined to have, not whatever the tmpfs page held.
                os.ftruncate(fd, SHM_SIZE)
                # Timestamp taken HERE, not at the top of this function: it must be the real
                # wall clock, and it must be in the past by the time Isaac writes its own.
                stamp = int(time.time() * 1000)
                blob = pack_header(name, len(payload), encoding, quality, stamp) + payload
                os.pwrite(fd, blob, 0)
                os.fsync(fd)
            finally:
                os.close(fd)

            # 3. Read it back, from a FRESH open, and compare. Nothing here reports success
            #    on the strength of a write having not raised.
            with open(path, "rb") as fh:
                got = fh.read(HEADER_SIZE + len(payload))
            st = _stat_of(path)
            if st is None:
                entry["error"] = "the segment vanished between writing and reading it back"
            elif got != blob:
                entry["error"] = (f"read-back differs from what was written "
                                  f"({len(got)} B of {len(blob)} B match "
                                  f"{'in length' if len(got) == len(blob) else 'nowhere'})")
            else:
                hdr = unpack_header(got[:HEADER_SIZE])
                bad = header_complaints(hdr, name, st["size"])
                complaint = payload_complaint(got[HEADER_SIZE:], encoding)
                if complaint:
                    bad.append(complaint)
                if bad:
                    entry["error"] = "; ".join(bad)
                else:
                    entry["verified"] = True
                entry["header"] = hdr
                entry.update(st)
        except OSError as exc:
            entry["error"] = f"{exc.strerror or exc} ({path})"
        except ValueError as exc:
            entry["error"] = str(exc)
        results.append(entry)
    return {"segments": results}


def run_worker() -> int:
    """`--worker`: read one JSON job from stdin, write one JSON result to stdout.

    stdout is JSON and nothing but JSON — every diagnostic goes to stderr, because the
    outer process parses this and a stray print would look like a crash.
    """
    try:
        job = json.loads(sys.stdin.read() or "{}")
        op = job.get("op")
        if op == "check":
            result = worker_check(job["prefix"], job["names"])
        elif op == "clean":
            result = worker_clean(job["prefix"], job["names"])
        elif op == "seed":
            result = worker_seed(job["prefix"], job["payloads"], int(job["mode"]),
                                 bool(job.get("force")), float(job["live_window_s"]))
        else:
            raise ValueError(f"unknown op {op!r}")
        result["ok"] = True
    except Exception as exc:  # noqa: BLE001 — the outer process needs the reason, not a stack
        result = {"ok": False, "error": f"{type(exc).__name__}: {exc}"}
    sys.stdout.write(json.dumps(result))
    sys.stdout.flush()
    return 0 if result.get("ok") else 1


# --------------------------------------------------------------------------------------
# Getting the worker to run as root.
# --------------------------------------------------------------------------------------

def docker_command(args: argparse.Namespace) -> list[str]:
    """The throwaway container. Every flag here is load-bearing.

    `--user 0` is the whole point: the segments Isaac leaves behind are root:root 0600 and
    this user has no sudo. `-v /dev/shm:/dev/shm` is what makes the container's /dev/shm the
    host's; `--ipc=host` matches how the sim itself is launched and would give us the same
    /dev/shm on its own, so the two together are belt and braces rather than a mistake.
    `--network none` because this needs no network at all. The two read-only mounts are the
    interpreter's conda prefix (the image ships no python — checked) and this script's own
    directory, so the container runs THIS file rather than a code string.
    """
    prefix_dir = os.path.dirname(os.path.dirname(os.path.abspath(args.interpreter)))
    # realpath, not abspath: if this script is reached through a symlink, the directory we
    # bind-mount has to be the one the file really lives in or the container finds nothing.
    script_path = os.path.realpath(__file__)
    script_dir = os.path.dirname(script_path)
    mounts = []
    for path in (prefix_dir, script_dir):
        if path not in mounts:
            mounts.append(path)
    cmd = ["docker", "run", "--rm", "-i", "--user", "0",
           "--ipc=host", "--network", "none", "-e", "PYTHONPATH=",
           "-v", "/dev/shm:/dev/shm"]
    for path in mounts:
        cmd += ["-v", f"{path}:{path}:ro"]
    cmd += [args.docker_image, args.interpreter, script_path, "--worker"]
    return cmd


def run_job(args: argparse.Namespace, job: dict) -> dict:
    """Run one worker job, in the container unless --no-docker, and return its result."""
    payload = json.dumps(job)
    if args.no_docker:
        # In-process. Only useful when this is already running as root, or for a --prefix
        # rehearsal on segments this user owns. It is NOT the path the bringup takes.
        import io
        saved_stdin, saved_stdout = sys.stdin, sys.stdout
        sys.stdin, sys.stdout = io.StringIO(payload), io.StringIO()
        try:
            run_worker()
            return json.loads(sys.stdout.getvalue())
        finally:
            sys.stdin, sys.stdout = saved_stdin, saved_stdout

    if shutil.which("docker") is None:
        return {"ok": False, "error": "docker is not on PATH, and without it there is no "
                                      "way to touch root-owned segments as this user. "
                                      "Use --no-docker only if already root."}
    cmd = docker_command(args)
    if args.verbose:
        print("+ " + " ".join(cmd), file=sys.stderr)
    try:
        proc = subprocess.run(cmd, input=payload, capture_output=True, text=True,
                              timeout=args.timeout)
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": f"the helper container did not finish within "
                                      f"{args.timeout}s"}
    except OSError as exc:
        return {"ok": False, "error": f"could not run docker: {exc}"}
    if proc.stderr.strip() and args.verbose:
        print(proc.stderr.rstrip(), file=sys.stderr)
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError:
        # Nearly always the image or the interpreter path being wrong. Show both streams:
        # docker's own errors go to stderr and would otherwise be swallowed here.
        return {"ok": False,
                "error": f"the helper container returned no JSON (exit {proc.returncode}).\n"
                         f"  stdout: {proc.stdout.strip()[:400] or '(empty)'}\n"
                         f"  stderr: {proc.stderr.strip()[:400] or '(empty)'}"}


# --------------------------------------------------------------------------------------
# Reporting.
# --------------------------------------------------------------------------------------

def owner(uid: int, gid: int) -> str:
    try:
        import grp
        import pwd
        return f"{pwd.getpwuid(uid).pw_name}:{grp.getgrgid(gid).gr_name}"
    except Exception:  # noqa: BLE001 — a numeric id is a fine answer
        return f"{uid}:{gid}"


def describe(state: dict, name: str, now_ms: int) -> tuple[str, list[str]]:
    """One report line for a segment, plus everything wrong with it."""
    if not state.get("present"):
        return f"{name:<6} ABSENT   {state['path']}", [f"{name}: no segment at "
                                                       f"{state['path']}"]
    head = (f"{name:<6} present  {state['size']} B  "
            f"{owner(state['uid'], state['gid'])} {oct(state['mode'])[2:]:>4}")
    if "unreadable" in state:
        # Expected for a live sim's 0600 root segments when read from the host. Not a
        # verdict on the segment — a verdict on who is asking.
        return head + f"  header unreadable: {state['unreadable']}", \
            [f"{name}: header could not be read ({state['unreadable']})"]
    hdr = state.get("header")
    if hdr is None:
        return head + "  no header", [f"{name}: nothing that parses as a header"]
    age_s = (now_ms - hdr["timestamp"]) / 1000.0
    enc = {ENCODING_JPEG: "JPEG", ENCODING_RAW: "raw BGR"}.get(hdr["encoding"],
                                                               f"encoding {hdr['encoding']}")
    line = (head + f"  '{hdr['image_name']}' {hdr['height']}x{hdr['width']}x"
                   f"{hdr['channels']} {enc}"
            + (f" q{hdr['quality']}" if hdr["encoding"] == ENCODING_JPEG else "")
            + f" {hdr['data_size']} B  ts={hdr['timestamp']} age={age_s:.1f}s")
    bad = header_complaints(hdr, name, state["size"])
    tail = state.get("payload_tail")
    if hdr["encoding"] == ENCODING_JPEG and state.get("payload_head") not in (None, "ffd8"):
        bad.append(f"payload starts {state['payload_head']}, not ffd8")
    if hdr["encoding"] == ENCODING_JPEG and tail not in (None, "ffd9"):
        bad.append(f"payload ends {tail}, not ffd9")
    return line, [f"{name}: {b}" for b in bad]


def report_check(result: dict, names: list[str]) -> int:
    now_ms = result.get("now_ms", int(time.time() * 1000))
    problems: list[str] = []
    print(f"{'':6} {'state':<8} segment")
    for name, state in zip(names, result["segments"]):
        line, bad = describe(state, name, now_ms)
        print("  " + line, flush=True)
        problems.extend(bad)
    if problems:
        print("\nNOT READY:")
        for problem in problems:
            print(f"  - {problem}")
        return 1
    fresh = [s for s in result["segments"]
             if s.get("header") and now_ms - s["header"]["timestamp"] < 5000]
    print(f"\nall {len(names)} segments present and well-formed"
          + (f"; {len(fresh)} were written within the last 5s, so either a sim is writing "
             f"them right now or they have just been seeded. Seeding refuses over the "
             f"former -- see --live-window." if fresh else ""))
    return 0


# --------------------------------------------------------------------------------------
# Wiring.
# --------------------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(
        prog="seed_camera_shm.py",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        description=(
            "Pre-seed Isaac's camera shared memory so the vendor image server's ZMQ\n"
            "publishers actually bind.\n\n"
            "The vendor's _zmq_pub thread reads a frame on its first iteration and, finding\n"
            "none, sets a SHARED stop event that kills all three cameras for the life of the\n"
            "sim -- while the config responder on :60000 keeps answering, so it looks\n"
            "healthy. Isaac's own writer creates the shared memory 1.74s too late (measured).\n"
            "Putting a valid placeholder frame there first makes that first read succeed;\n"
            "Isaac overwrites the same segments seconds later.\n\n"
            "All /dev/shm work runs as root inside a short-lived throwaway container,\n"
            "because leftovers from a previous run are root:root 0600 and this user has no\n"
            "sudo. Nothing in the vendor checkout is touched."),
        epilog=(
            "modes:\n"
            "  (default)     remove and re-create all three, then read them back and verify\n"
            "  --check       report the state of all three; exit 1 if any is missing or wrong\n"
            "  --clean       remove all three and exit\n\n"
            "examples:\n"
            "  seed_camera_shm.py --check\n"
            "  seed_camera_shm.py\n"
            "  seed_camera_shm.py --prefix rehearsal        # exercise it away from isaac_*\n"
            "  seed_camera_shm.py --prefix rehearsal --clean\n"))
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--check", action="store_true",
                      help="report the current state of the three segments and exit "
                           "non-zero unless all three are present and correctly sized")
    mode.add_argument("--clean", action="store_true",
                      help="remove the three segments and exit")
    mode.add_argument("--worker", action="store_true",
                      help=argparse.SUPPRESS)   # internal: this file, re-run in the container
    ap.add_argument("--prefix", default=DEFAULT_PREFIX, metavar="STEM",
                    help="segment name stem: /dev/shm/<STEM>_{head,left,right}_image_shm. "
                         "Anything but 'isaac' is a rehearsal the sim will never look at "
                         "(default: %(default)s)")
    ap.add_argument("--names", default=",".join(IMAGE_NAMES), metavar="A,B,C",
                    help="which segments to operate on (default: %(default)s)")
    ap.add_argument("--force", action="store_true",
                    help="seed even if a segment was written in the last --live-window "
                         "seconds. Unlinking a segment a running sim has mapped kills its "
                         "cameras silently and for good, so only pass this knowing the sim "
                         "is gone")
    ap.add_argument("--live-window", type=float, default=DEFAULT_LIVE_WINDOW_S,
                    metavar="S", help="a header written this recently means something is "
                                      "still writing (default: %(default)s)")
    ap.add_argument("--mode", default=format(DEFAULT_MODE, "04o"),
                    help="permissions for the segments we create. 0666 so --check can read "
                         "them without a container and a non-root sim can overwrite them "
                         "(default: %(default)s)")
    ap.add_argument("--docker-image", default=DEFAULT_DOCKER_IMAGE,
                    help="image for the throwaway root container (default: %(default)s)")
    ap.add_argument("--interpreter", default=DEFAULT_INTERPRETER,
                    help="python INSIDE that image. The image ships none of its own, so this "
                         "is the sim's conda env, bind-mounted read-only "
                         "(default: %(default)s)")
    ap.add_argument("--no-docker", action="store_true",
                    help="do the /dev/shm work in this process instead. Only works if "
                         "already root or if the segments belong to this user")
    ap.add_argument("--timeout", type=float, default=120.0,
                    help="seconds to wait for the helper container (default: %(default)s)")
    ap.add_argument("-v", "--verbose", action="store_true",
                    help="print the docker command line and the helper's stderr")
    return ap


def main() -> int:
    ap = build_parser()
    args = ap.parse_args()

    if args.worker:
        return run_worker()

    names = [n.strip() for n in args.names.split(",") if n.strip()]
    if not names:
        ap.error("--names is empty; there is nothing to do")
    for name in names:
        if len(name.encode()) > 15:
            ap.error(f"--names: {name!r} does not fit the char[16] image_name field")
    if not args.prefix or "/" in args.prefix:
        ap.error("--prefix must be a plain name stem, not a path")
    try:
        mode = int(str(args.mode), 8)
    except ValueError:
        ap.error(f"--mode {args.mode!r} is not an octal permission mask")
        return 2   # unreachable; argparse exits. Kept so the type is honest.

    # ---- --check ----------------------------------------------------------------------
    if args.check:
        result = run_job(args, {"op": "check", "prefix": args.prefix, "names": names})
        if not result.get("ok"):
            print(f"FAILED to inspect /dev/shm: {result.get('error')}", file=sys.stderr)
            return 2
        print(f"segments /dev/shm/{args.prefix}_<name>_image_shm:")
        return report_check(result, names)

    # ---- --clean ----------------------------------------------------------------------
    if args.clean:
        result = run_job(args, {"op": "clean", "prefix": args.prefix, "names": names})
        if not result.get("ok"):
            print(f"FAILED to remove segments: {result.get('error')}", file=sys.stderr)
            return 2
        failed = False
        for entry in result["segments"]:
            if "error" in entry:
                print(f"  {entry['name']:<6} ERROR    {entry['error']}", file=sys.stderr)
                failed = True
            else:
                print(f"  {entry['name']:<6} "
                      f"{'removed' if entry['removed'] else 'was already absent'}"
                      f"  {entry['path']}")
        return 1 if failed else 0

    # ---- seed -------------------------------------------------------------------------
    payloads = {}
    for name in names:
        data, encoding, quality = build_placeholder(name)
        complaint = payload_complaint(data, encoding)
        if complaint:
            # The frame is built here, in this process, so this can only fire if Pillow
            # produced something unexpected. Better to stop than to seed a frame the sim's
            # cv2.imdecode will reject, which would put us straight back in the race.
            print(f"FATAL: the placeholder built for {name} is not usable: {complaint}",
                  file=sys.stderr)
            return 2
        payloads[name] = {"data": base64.b64encode(data).decode(),
                          "encoding": encoding, "quality": quality}
    kind = ("JPEG" if payloads[names[0]]["encoding"] == ENCODING_JPEG
            else "raw BGR (Pillow unavailable)")
    print(f"placeholder: 640x480 {kind}, "
          f"{len(base64.b64decode(payloads[names[0]]['data']))} B for '{names[0]}'",
          flush=True)

    result = run_job(args, {"op": "seed", "prefix": args.prefix, "payloads": payloads,
                            "mode": mode, "force": args.force,
                            "live_window_s": args.live_window})
    if not result.get("ok"):
        print(f"FAILED to seed: {result.get('error')}", file=sys.stderr)
        return 2
    if result.get("refused") == "live":
        for entry in result["live"]:
            print(f"  {entry['name']:<6} was written {entry['age_ms'] / 1000.0:.1f}s ago",
                  file=sys.stderr)
        print(f"REFUSING to seed: something is writing these segments right now, which "
              f"means a sim is running.\nUnlinking a segment a live sim has mapped kills its "
              f"cameras silently and permanently:\nthe writer keeps writing to the nameless "
              f"inode and every reader opens the new one.\nStop the sim first, or pass "
              f"--force if you are certain it is gone.", file=sys.stderr)
        return 3

    failed = False
    for entry in result["segments"]:
        if entry.get("verified"):
            hdr = entry["header"]
            print(f"  {entry['name']:<6} seeded   {entry['path']}  "
                  f"{entry['size']} B {oct(entry['mode'])[2:]:>4}  "
                  f"{hdr['data_size']} B payload, ts={hdr['timestamp']}"
                  + ("  (replaced a leftover)" if entry.get("removed_existing") else ""))
        else:
            print(f"  {entry['name']:<6} FAILED   {entry.get('error', 'unknown')}",
                  file=sys.stderr)
            failed = True
    if failed:
        print("\nAt least one segment is not what it should be. Do NOT start the sim "
              "expecting cameras.", file=sys.stderr)
        return 1

    # An independent second opinion, from OUTSIDE the container that did the writing and as
    # the unprivileged host user. The container already read back every byte it wrote; this
    # catches the class of failure where the container wrote into its own /dev/shm rather
    # than the host's, which the readback inside it could never notice.
    host_view = run_job(argparse.Namespace(**{**vars(args), "no_docker": True}),
                        {"op": "check", "prefix": args.prefix, "names": names})
    if host_view.get("ok"):
        problems = []
        now_ms = host_view["now_ms"]
        for name, state in zip(names, host_view["segments"]):
            _, bad = describe(state, name, now_ms)
            problems.extend(bad)
        if problems:
            print("\nThe helper container reported success but the HOST cannot confirm it:",
                  file=sys.stderr)
            for problem in problems:
                print(f"  - {problem}", file=sys.stderr)
            print("The segments the container wrote are not the ones the sim will read.",
                  file=sys.stderr)
            return 1
        print(f"\nverified from the host as {owner(os.getuid(), os.getgid())}: "
              f"all {len(names)} segments present, {SHM_SIZE} B, headers decode.")
    else:
        print(f"\n(host-side re-check skipped: {host_view.get('error')})")

    print("Isaac's writer will overwrite these in place once the scene loads.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
