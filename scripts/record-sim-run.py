#!/usr/bin/env python3
"""Record one Agent Mode command against the MuJoCo sim into its own folder.

Drives the command through the same path the UI uses
(server :3001 -> robot-agent :41246 -> sim :8777), polls both sim cameras at
~4 fps, and writes a self-contained run folder:

    sim-runs/<NN>-<slug>/
      room_overview.mp4     wide shot of the room
      head_camera.mp4       what the vision model actually sees
      side_by_side.mp4      the two above, stacked
      first.jpg / last.jpg  opening and closing frame of the overview
      head_last.jpg         the robot's own last view
      run.log               block-by-block trace with odometry
      run.json              the same, machine-readable

Usage:
    python3 scripts/record-sim-run.py "turn left and look around"
    python3 scripts/record-sim-run.py "walk forward" --no-reset --name custom-slug

Requires the Agent Mode stack to be up (see robot-agent/AGENTS.md) and ffmpeg
on PATH. Without ffmpeg the frames are still written; only the MP4s are skipped.
"""
from __future__ import annotations

import argparse
import base64
import json
import math
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.request

SIM = os.environ.get("SIM_URL", "http://localhost:8777")
ROBOT_ID = os.environ.get("AGENT_ROBOT_ID", "sim-robot-g1-edu")
SRV = os.environ.get("SERVER_URL", "http://localhost:3001") + f"/api/robots/{ROBOT_ID}/agent-mode"
CAMERAS = ("room_overview", "head_camera")
FPS = 4.0
START_POSE = {"x": -1.0, "y": 0.0, "yaw": 0.0}
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def http(url: str, body=None, timeout: float = 30):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        url,
        data=data,
        headers={"content-type": "application/json"},
        method="POST" if data is not None else "GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode())
    except Exception as exc:  # noqa: BLE001 — a probe failure is data, not a crash
        return {"_error": repr(exc)}


def odom() -> dict | None:
    d = http(f"{SIM}/loco/odom", timeout=5)
    if not isinstance(d, dict) or "x" not in d:
        return None
    return {"x": d["x"], "y": d["y"], "yawDeg": math.degrees(d["yaw"])}


def fmt(o: dict | None) -> str:
    if not o:
        return "odometry unavailable"
    return f"x={o['x']:+.3f} y={o['y']:+.3f} yaw={o['yawDeg']:+7.1f}deg"


def slugify(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return (s[:48] or "run").rstrip("-")


def next_run_dir(slug: str) -> str:
    root = os.path.join(REPO, "sim-runs")
    os.makedirs(root, exist_ok=True)
    used = [int(m.group(1)) for d in os.listdir(root)
            if (m := re.match(r"^(\d+)-", d))]
    return os.path.join(root, f"{max(used, default=0) + 1:02d}-{slug}")


class Recorder:
    """Polls every sim camera into <out>/frames/<cam>/NNNNN.jpg until stopped."""

    def __init__(self, out: str) -> None:
        self.out = out
        self.stop = threading.Event()
        self.counts = {c: 0 for c in CAMERAS}
        self.threads = [threading.Thread(target=self._grab, args=(c,), daemon=True)
                        for c in CAMERAS]

    def _grab(self, cam: str) -> None:
        d = os.path.join(self.out, "frames", cam)
        os.makedirs(d, exist_ok=True)
        period = 1.0 / FPS
        while not self.stop.is_set():
            t = time.time()
            r = http(f"{SIM}/cameras/{cam}/snapshot", timeout=10)
            b64 = r.get("jpeg_base64") if isinstance(r, dict) else None
            if b64:
                path = os.path.join(d, f"{self.counts[cam]:05d}.jpg")
                with open(path, "wb") as f:
                    f.write(base64.b64decode(b64))
                self.counts[cam] += 1
            time.sleep(max(0.0, period - (time.time() - t)))

    def __enter__(self) -> "Recorder":
        for t in self.threads:
            t.start()
        return self

    def __exit__(self, *exc) -> None:
        self.stop.set()
        for t in self.threads:
            t.join(timeout=5)


def encode(out: str, counts: dict[str, int]) -> list[str]:
    """Stitch frames to MP4 and pull representative stills. Best-effort."""
    made: list[str] = []
    if not shutil.which("ffmpeg"):
        print("  ffmpeg not on PATH — frames kept, videos skipped")
        return made

    for cam in CAMERAS:
        if counts.get(cam, 0) < 2:
            continue
        src = os.path.join(out, "frames", cam, "*.jpg")
        dst = os.path.join(out, f"{cam}.mp4")
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-framerate", "12",
             "-pattern_type", "glob", "-i", src,
             "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
             "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "23",
             "-movflags", "+faststart", dst],
            check=False,
        )
        if os.path.exists(dst):
            made.append(os.path.basename(dst))

    a, b = (os.path.join(out, f"{c}.mp4") for c in CAMERAS)
    if os.path.exists(a) and os.path.exists(b):
        dst = os.path.join(out, "side_by_side.mp4")
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", a, "-i", b,
             "-filter_complex", "[0:v][1:v]hstack=inputs=2[v]", "-map", "[v]",
             "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "23",
             "-movflags", "+faststart", dst],
            check=False,
        )
        if os.path.exists(dst):
            made.append("side_by_side.mp4")

    # Stills straight off the frame dirs — no re-encode, so they stay sharp.
    for cam, names in (("room_overview", ("first.jpg", "last.jpg")),
                       ("head_camera", (None, "head_last.jpg"))):
        d = os.path.join(out, "frames", cam)
        if not os.path.isdir(d):
            continue
        frames = sorted(f for f in os.listdir(d) if f.endswith(".jpg"))
        if not frames:
            continue
        for name, src in zip(names, (frames[0], frames[-1])):
            if name:
                shutil.copy(os.path.join(d, src), os.path.join(out, name))
                made.append(name)
    return made


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", help="what to tell the robot, in plain language")
    ap.add_argument("--no-reset", action="store_true",
                    help="start from the current pose instead of the standard start pose")
    ap.add_argument("--name", help="folder slug (default: derived from the command)")
    ap.add_argument("--keep-frames", action="store_true",
                    help="keep the raw JPEG frames next to the videos")
    args = ap.parse_args()

    out = next_run_dir(args.name or slugify(args.command))
    os.makedirs(out, exist_ok=True)
    lines: list[str] = []

    def say(s: str = "") -> None:
        print(s)
        lines.append(s)

    if not args.no_reset:
        http(f"{SIM}/sim/reset-pose", START_POSE)
        time.sleep(2)

    say(f"COMMAND : {args.command}")
    say(f"FOLDER  : {os.path.relpath(out, REPO)}")

    with Recorder(out) as rec:
        before = odom()
        say(f"BEFORE  : {fmt(before)}")
        say()

        t0 = time.time()
        acc = http(f"{SRV}/command", {"text": args.command})
        say(f"ACCEPTED: {json.dumps(acc, ensure_ascii=False)[:200]}")
        say()

        # Track THIS plan only: the mirror still holds the previous plan for a
        # beat after the command is accepted, and its terminal status would end
        # the loop before the new plan has even been planned.
        want = acc.get("planId") if isinstance(acc, dict) else None
        seen, plan = None, {}
        for _ in range(240):
            s = http(SRV, timeout=10)
            p = s.get("plan") if isinstance(s, dict) else None
            if not p or (want and p.get("id") != want):
                time.sleep(2)
                continue
            plan = p
            body = " ; ".join(
                f"{b['kind']}({json.dumps(b['params'], ensure_ascii=False)}) {b['status']}"
                for b in p.get("blocks", []))
            if body != seen:
                say(f"[{time.time() - t0:5.0f}s] {p.get('status'):<8} {body}")
                say(f"{'':9}@ {fmt(odom())}")
                seen = body
            if p.get("status") in ("done", "failed", "aborted"):
                break
            time.sleep(2)

        time.sleep(1)
        after = odom()
        counts = dict(rec.counts)

    say()
    say(f"AFTER   : {fmt(after)}")
    if before and after:
        dx, dy = after["x"] - before["x"], after["y"] - before["y"]
        dyaw = (after["yawDeg"] - before["yawDeg"] + 180) % 360 - 180
        say(f"DELTA   : dist={math.hypot(dx, dy):.3f}m dx={dx:+.3f} dy={dy:+.3f} dyaw={dyaw:+.1f}deg")
    say()
    say("--- blocks ---")
    for b in plan.get("blocks", []):
        say(f"  {b['kind']:<10} {b['status']:<8} {b.get('result') or b.get('error') or ''}")
    say(f"  plan={plan.get('status')}  elapsed={time.time() - t0:.0f}s  frames={counts}")

    made = encode(out, counts)
    if not args.keep_frames:
        shutil.rmtree(os.path.join(out, "frames"), ignore_errors=True)
    say()
    say(f"media   : {', '.join(made) if made else '(none)'}")

    with open(os.path.join(out, "run.log"), "w") as f:
        f.write("\n".join(lines) + "\n")
    with open(os.path.join(out, "run.json"), "w") as f:
        json.dump(
            {"command": args.command, "before": before, "after": after,
             "plan": plan, "frames": counts, "media": made},
            f, indent=2, ensure_ascii=False)

    return 0 if plan.get("status") == "done" else 1


if __name__ == "__main__":
    sys.exit(main())
