#!/usr/bin/env python3
"""
demo_clip.py -- record one Agent Mode command as a captioned explainer clip.

    python demo_clip.py "Go to the table and tell me what is on it" \\
        --out clips/table.mp4 [--cam follow|orbit|wide|head_camera] \\
        [--size 1080x1920] [--start 0,0,0] [--title "Agent Mode"] [--no-captions]

What it does, in order:
  1. resets the sim robot to --start (x, y, yaw deg)
  2. starts the sim's cinematic recorder (POST /record/start on the facade)
  3. submits the command to the robot-agent (POST .../agent-mode/command)
  4. polls the plan until it is done / failed / aborted
  5. stops the recorder and writes <out>.json with the plan + block timings
  6. burns captions (command, then each block as it runs, then the outcome)
     into <out> (PNG overlays via ffmpeg) -- the raw render is kept as <out>.raw.mp4

Needs Pillow (for the caption overlays) + ffmpeg -- run it with the sim venv's
python. Timings come from the blocks' own
startedAt/finishedAt stamps, offset by when the recorder started, so the
captions line up with what the robot is doing on screen.

Env: SIM_URL (default http://localhost:8777), AGENT_URL
(default http://localhost:41246), ROBOT_ID (default sim-robot-g1-edu).
"""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime

SIM_URL = os.environ.get("SIM_URL", "http://localhost:8777")
AGENT_URL = os.environ.get("AGENT_URL", "http://localhost:41246")
ROBOT_ID = os.environ.get("ROBOT_ID", "sim-robot-g1-edu")
# The robot's durable memory on disk (`--layout memory` reads the place notes
# and the journal straight from the workspace -- see robot-agent/src/agent-mode/workspace.ts).
WORKSPACE_DIR = pathlib.Path(os.environ.get(
    "WORKSPACE_DIR", str(pathlib.Path(__file__).resolve().parents[2] / "data" / f"workspace-{ROBOT_ID}")))

# Block kind -> short caption verb + emoji-free glyph (drawtext fonts rarely
# have emoji; keep it to ASCII so it renders everywhere).
BLOCK_LABELS = {
    "walk": "walk", "turn": "turn", "goto": "go to", "look": "look",
    "scan_room": "scan the room", "wave": "wave", "greet": "greet",
    "posture": "posture", "speak": "say", "wait": "wait", "remember": "remember",
}


def http(method: str, url: str, body: dict | None = None, timeout: float = 30.0) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method,
                                 headers={"content-type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as exc:
        raise SystemExit(f"{method} {url} -> {exc.code}: {exc.read().decode(errors='replace')[:300]}")
    except urllib.error.URLError as exc:
        raise SystemExit(f"{method} {url} failed: {exc.reason} (is it running?)")


class SimClock:
    """Maps wall time to VIDEO time.

    The recorder emits one frame per SIM-time period and drops the frames it
    cannot render when the sim catches up (offscreen renders + a VLM on the
    same GPU), so the clip is a time-compressed version of the wall clock and
    captions timed in wall seconds land late. Sampling the recorder's own frame
    counter during the recording gives the exact mapping:
    video_t(wall) = (frames(wall) - frames(wall0)) / fps.
    """

    def __init__(self, sim_url: str, fps: int, period: float = 0.2) -> None:
        self.sim_url, self.fps, self.period = sim_url, fps, period
        self.samples: list[tuple[float, int]] = []   # (wall, frames emitted so far)
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self.wall0: float | None = None

    def start(self) -> None:
        self.wall0 = time.time()
        self._sample()
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        self._sample()

    def _sample(self) -> None:
        try:
            r = http("GET", f"{self.sim_url}/record", timeout=2)
            recs = r.get("recorders") or {}
            if not recs and r.get("current"):
                recs = {"main": r["current"]}
            self.samples.append((time.time(), {k: int(v.get("frames") or 0) for k, v in recs.items()}))
        except Exception:  # noqa: BLE001 -- a missed sample is a small timing error, not a failure
            pass

    def _run(self) -> None:
        while not self._stop.wait(self.period):
            self._sample()

    def frames(self, wall: float, rec: str = "main") -> float:
        pts = [(w, d.get(rec, 0)) for w, d in self.samples]
        if not pts:
            return 0.0
        prev = pts[0]
        for cur in pts:
            if cur[0] >= wall:
                if cur[0] == prev[0]:
                    return float(cur[1])
                f = (wall - prev[0]) / (cur[0] - prev[0])
                return prev[1] + f * (cur[1] - prev[1])
            prev = cur
        # past the last sample: the recorder is stopped, the clip ends here
        return float(prev[1])

    def video_t(self, wall: float | None) -> float | None:
        if wall is None or self.wall0 is None:
            return None
        return (self.frames(wall) - self.frames(self.wall0)) / self.fps

    def wall_of_video_t(self, t: float) -> float:
        """Inverse of video_t (main recorder): the wall time at which frame t*fps was emitted."""
        if not self.samples or self.wall0 is None:
            return (self.wall0 or 0.0) + t
        target = self.frames(self.wall0) + t * self.fps
        prev = (self.samples[0][0], self.samples[0][1].get("main", 0))
        for w, d in self.samples:
            cur = (w, d.get("main", 0))
            if cur[1] >= target:
                if cur[1] == prev[1]:
                    return cur[0]
                f = (target - prev[1]) / (cur[1] - prev[1])
                return prev[0] + f * (cur[0] - prev[0])
            prev = cur
        return prev[0]

    def has(self, rec: str) -> bool:
        return any(rec in d for _, d in self.samples)


def iso_to_s(stamp: str) -> float:
    return datetime.fromisoformat(stamp.replace("Z", "+00:00")).timestamp()


def block_caption(b: dict) -> str:
    kind, p = b["kind"], b.get("params") or {}
    verb = BLOCK_LABELS.get(kind, kind)
    if kind == "walk":
        d = p.get("distanceM")
        dist = f"{float(d):.1f}" if isinstance(d, (int, float)) else "?"
        return f"{verb} {dist} m {p.get('direction', '')}".strip()
    if kind == "turn":
        a = float(p.get("angleDeg", 0))
        return f"{verb} {abs(a):.0f} deg {'left' if a > 0 else 'right'}"
    if kind == "goto":
        if p.get("place"):
            return f"go into the {p['place']}"
        return f"{verb} the {p.get('entity', '?')}"
    if kind in ("speak", "greet"):
        return f'{verb}: "{p.get("text", "")}"'
    if kind == "posture":
        return f"{verb}: {p.get('pose', '')}"
    if kind == "wait":
        return f"{verb} {p.get('seconds', '')} s"
    if kind == "remember":
        return f"{verb}: {p.get('text', '')}"
    if kind == "scan_room":
        return verb
    if kind == "look" and p.get("speak") is True:
        return "look and tell"
    return verb


_SAID_RE = re.compile(r'[Ss]aid[^"]*"(.+?)"\s*$', re.S)


def spoken_text(result: str | None) -> str | None:
    """The quoted utterance at the end of a speak/greet/look-and-tell result."""
    m = _SAID_RE.search(result or "")
    return m.group(1).strip() if m else None


def short_result(b: dict) -> str | None:
    """One readable line from a block result: what it saw / where it arrived."""
    res = (b.get("result") or b.get("error") or "").strip()
    if not res:
        return None
    if b["kind"] in ("look", "scan_room"):
        res = re.sub(r"^(Looked|Scanned[^;]*;)\s*:?\s*", "", res)
        res = re.sub(r"\s*\(entities:.*?\)", "", res)
        res = re.sub(r"\s*[—-]+\s*said.*$", "", res, flags=re.S)
        return res.strip() or None
    if b["kind"] == "goto":
        return res.split(":")[0].strip()
    return None


def wrap(text: str, width: int) -> str:
    words, lines, cur = text.split(), [], ""
    for w in words:
        if len(cur) + len(w) + 1 > width and cur:
            lines.append(cur)
            cur = w
        else:
            cur = f"{cur} {w}".strip()
    if cur:
        lines.append(cur)
    return "\n".join(lines[:4])


_FONT_CANDIDATES = (
    "/System/Library/Fonts/Helvetica.ttc",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
)


def _font(size: int):
    from PIL import ImageFont
    for path in _FONT_CANDIDATES:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default()


class CaptionSheet:
    """Renders caption boxes to transparent PNGs; ffmpeg's `overlay` composites
    them with per-caption enable windows. Used instead of drawtext because a
    stock Homebrew ffmpeg is often built without libfreetype."""

    def __init__(self, size: tuple[int, int], workdir: pathlib.Path) -> None:
        self.w, self.h = size
        self.workdir = workdir
        self.items: list[tuple[pathlib.Path, float, float | None]] = []
        self.pad = int(self.w * 0.05)

    pip_y: int = 0

    def add(self, text: str, *, fontsize: int, color: str, y: str, t0: float = 0.0,
            t1: float | None = None, alpha: int = 235, x_right: bool = False,
            pip_w: int = 0) -> None:
        from PIL import Image, ImageDraw
        img = Image.new("RGBA", (self.w, self.h), (0, 0, 0, 0))
        draw = ImageDraw.Draw(img)
        font = _font(fontsize)
        lines = text.split("\n")
        spacing = int(fontsize * 0.35)
        line_h = fontsize + spacing
        tw = max(int(draw.textlength(ln, font=font)) for ln in lines)
        th = line_h * len(lines) - spacing
        bx = 18
        x0 = self.pad
        if x_right:
            x0 = self.w - self.pad - tw
        if y == "pip-label":
            # sits just above the PiP inset (which hangs under the command box)
            pip_h = int(pip_w * 3 / 4)
            self.pip_y = self.h - self.pad - pip_h - int(self.h * 0.21)
            y0 = self.pip_y - th - bx * 2 - 6
        elif y == "top":
            y0 = self.pad
        elif y.startswith("top+"):
            y0 = self.pad + int(y[4:])
        elif y == "bottom":
            y0 = self.h - self.pad - th - bx * 2 - int(self.h * 0.06)
        elif y == "bottom2":  # a smaller line under `bottom`
            y0 = self.h - self.pad - th - bx * 2
        else:
            y0 = int(y)
        draw.rounded_rectangle([x0 - bx, y0 - bx, x0 + tw + bx, y0 + th + bx],
                               radius=14, fill=(0, 0, 0, 150))
        yy = y0
        for ln in lines:
            draw.text((x0, yy), ln, font=font, fill=color)
            yy += line_h
        path = self.workdir / f"cap{len(self.items):03d}.png"
        img.save(path)
        self.items.append((path, t0, t1))

    def ffmpeg_args(self, raw: pathlib.Path, out: pathlib.Path, pip: pathlib.Path | None = None,
                    pip_w: int = 0, pip_y: int = 0,
                    map_seq: tuple[pathlib.Path, int, int, int] | None = None,
                    stack: tuple[int, int] | None = None,
                    extra_seqs: "list[tuple[pathlib.Path, int, int, int]] | None" = None) -> list[str]:
        """map_seq = (png pattern, fps, x, y): a pre-rendered inset sequence.
        stack = (cam_w, cam_h): the raw stream is NOT the canvas -- it is
        scaled to cam_w x cam_h and placed at the top of a dark canvas of the
        sheet's size (the map sequence then fills the rest)."""
        args = [shutil.which("ffmpeg") or "ffmpeg", "-loglevel", "error", "-y", "-i", str(raw)]
        for path, _, _ in self.items:
            args += ["-i", str(path)]
        n_cap = len(self.items)
        if pip is not None and pip_w:
            args += ["-i", str(pip)]
        n_in = n_cap + (1 if pip is not None and pip_w else 0)
        seqs = ([map_seq] if map_seq is not None else []) + list(extra_seqs or [])
        for seq in seqs:
            args += ["-framerate", str(seq[1]), "-i", str(seq[0])]
        chain, prev = [], "[0:v]"
        if stack is not None:
            chain.append(f"color=c=0x0e1117:s={self.w}x{self.h}:r=30[bg]")
            chain.append(f"[0:v]scale={stack[0]}:{stack[1]}[cam]")
            chain.append(f"[bg][cam]overlay={(self.w - stack[0]) // 2}:0:shortest=1[vs]")
            prev = "[vs]"
        for k, seq in enumerate(seqs):
            chain.append(f"{prev}[{n_in + 1 + k}:v]overlay={seq[2]}:{seq[3]}:eof_action=repeat[vm{k}]")
            prev = f"[vm{k}]"
        if pip is not None and pip_w:
            # Inset first so captions draw over it. Rounded look is not worth a
            # mask; a 3 px border reads fine.
            x = self.w - self.pad - pip_w
            chain.append(f"[{n_cap + 1}:v]scale={pip_w}:-2,pad=iw+6:ih+6:3:3:white@0.9[pip]")
            chain.append(f"{prev}[pip]overlay={x - 3}:{pip_y - 3}:eof_action=pass[vp]")
            prev = "[vp]"
        for i, (_, t0, t1) in enumerate(self.items):
            en = f"gte(t,{t0:.2f})" if t1 is None else f"between(t,{t0:.2f},{t1:.2f})"
            lab = f"[v{i}]"
            chain.append(f"{prev}[{i + 1}:v]overlay=0:0:enable='{en}'{lab}")
            prev = lab
        args += ["-filter_complex", ";".join(chain), "-map", prev,
                 "-c:v", "libx264", "-preset", "medium", "-crf", "18",
                 "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(out)]
        return args


class MapLog:
    """Samples the robot-agent's `/map` (grid + keepouts + peers + planned route)
    at a few Hz while recording, so the clip can carry a live map inset."""

    def __init__(self, url: str, period: float = 0.25) -> None:
        self.url, self.period = url, period
        self.samples: list[tuple[float, dict]] = []
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True)

    def start(self) -> None:
        self._sample()
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    def _sample(self) -> None:
        try:
            m = http("GET", self.url, timeout=2)
            if m.get("ok"):
                self.samples.append((time.time(), m))
        except Exception:  # noqa: BLE001 -- a missed sample is a stale inset frame, not a failure
            pass

    def _run(self) -> None:
        while not self._stop.wait(self.period):
            self._sample()


def _decode_grid(grid: dict) -> tuple[list[int], int, int]:
    import base64
    raw = base64.b64decode(grid["cells"])
    cells = [b - 256 if b > 127 else b for b in raw]
    return cells, int(grid["width"]), int(grid["height"])


def render_map_frames(samples: list[tuple[float, dict]], video_t, seconds: float, fps: int,
                      size_px: "int | tuple[int, int]", workdir: pathlib.Path,
                      window: "tuple[float, float, float, float] | None" = None,
                      places: "list[dict] | None" = None) -> tuple[pathlib.Path, dict] | None:
    """PNG sequence of the map inset (north up, fixed window over the known
    room -- or `window` = (x0, y0, x1, y1) metres when given, so several clips
    share one frame), one frame per 1/fps video-seconds. `places` (the place
    graph's non-keepout polygons) are drawn as faint outlines with their names.
    Returns (pattern, window)."""
    from PIL import Image, ImageDraw
    if not samples:
        return None
    Wpx, Hpx = (size_px, size_px) if isinstance(size_px, int) else size_px
    # A fixed window: the known cells plus every keepout and peer, padded.
    xs, ys = [], []
    for _, m in samples[-1:]:
        g = m.get("grid")
        if g:
            cells, gw, gh = _decode_grid(g)
            res, ox, oy = g["resolution"], g["originX"], g["originY"]
            for idx, v in enumerate(cells):
                if v >= g["occupiedAbove"] or v <= g["freeBelow"]:
                    xs.append(ox + (idx % gw) * res); ys.append(oy + (idx // gw) * res)
        for k in m.get("keepouts") or []:
            for x, y in k["polygon"]:
                xs.append(x); ys.append(y)
    for _, m in samples:
        p = m.get("pose")
        if p:
            xs.append(p["x"]); ys.append(p["y"])
        for pr in m.get("peers") or []:
            xs.append(pr["x"]); ys.append(pr["y"])
    if window is not None:
        x0, y0, x1, y1 = window
    elif xs:
        pad = 0.6
        x0, x1, y0, y1 = min(xs) - pad, max(xs) + pad, min(ys) - pad, max(ys) + pad
    else:
        return None
    scale = min(Wpx / (x1 - x0), Hpx / (y1 - y0))
    span = max(x1 - x0, y1 - y0)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    x0, y0 = cx - Wpx / scale / 2, cy - Hpx / scale / 2
    def px(x: float, y: float) -> tuple[float, float]:
        return ((x - x0) * scale, Hpx - (y - y0) * scale)

    mdir = workdir / "map"
    mdir.mkdir(parents=True, exist_ok=True)
    stamped = [(video_t(w), m) for w, m in samples]
    stamped = [(t, m) for t, m in stamped if t is not None]
    n = int(seconds * fps) + 1
    j = 0
    last_key, last_img = None, None
    for f in range(n):
        t = f / fps
        while j + 1 < len(stamped) and stamped[j + 1][0] <= t:
            j += 1
        m = stamped[j][1]
        key = id(m)
        if key == last_key and last_img is not None:
            last_img.save(mdir / f"{f:05d}.png")
            continue
        img = Image.new("RGBA", (Wpx, Hpx), (18, 21, 27, 235))
        d = ImageDraw.Draw(img, "RGBA")
        g = m.get("grid")
        if g:
            cells, gw, gh = _decode_grid(g)
            res, ox, oy = g["resolution"], g["originX"], g["originY"]
            cs = max(1.0, res * scale)
            for idx, v in enumerate(cells):
                if v == 0:
                    continue
                if v >= g["occupiedAbove"]:
                    col = (236, 238, 242, 255)
                elif v <= g["freeBelow"]:
                    col = (48, 54, 64, 255)
                else:
                    continue
                X, Y = px(ox + (idx % gw) * res, oy + (idx // gw) * res + res)
                d.rectangle([X, Y, X + cs, Y + cs], fill=col)
        for pl in places or []:
            pts = [px(x, y) for x, y in pl["polygon"]]
            d.polygon(pts, outline=(90, 100, 120, 160))
            nx = sum(x for x, _ in pts) / len(pts); ny = sum(y for _, y in pts) / len(pts)
            lab = pl.get("name") or pl.get("id") or ""
            fnt = _font(22)
            d.text((nx - d.textlength(lab, font=fnt) / 2, ny - 14), lab, font=fnt, fill=(150, 160, 180, 230))
        for k in m.get("keepouts") or []:
            pts = [px(x, y) for x, y in k["polygon"]]
            d.polygon(pts, fill=(255, 170, 40, 60), outline=(255, 170, 40, 230))
        for pr in m.get("peers") or []:
            X, Y = px(pr["x"], pr["y"]); r = max(4.0, pr.get("footprintRadiusM", 0.35) * scale)
            d.ellipse([X - r, Y - r, X + r, Y + r], fill=(255, 120, 60, 200), outline=(255, 200, 160, 255), width=2)
        nav = m.get("nav")
        if nav:
            path = nav.get("path") or []
            if len(path) >= 2:
                pts = [px(x, y) for x, y in path]
                # dashed cobalt polyline
                import math
                for (ax, ay), (bx, by) in zip(pts, pts[1:]):
                    L = math.hypot(bx - ax, by - ay)
                    if L < 1e-6:
                        continue
                    n_d = max(1, int(L / 12))
                    for k2 in range(n_d):
                        f0, f1 = k2 / n_d, (k2 + 0.55) / n_d
                        d.line([(ax + (bx - ax) * f0, ay + (by - ay) * f0),
                                (ax + (bx - ax) * f1, ay + (by - ay) * f1)], fill=(42, 95, 255, 255), width=4)
                for X, Y in pts[1:-1]:
                    d.ellipse([X - 4, Y - 4, X + 4, Y + 4], fill=(42, 95, 255, 255))
            goal = nav.get("goal")
            if goal:
                X, Y = px(goal["x"], goal["y"]); r = 0.15 * scale
                d.ellipse([X - r, Y - r, X + r, Y + r], outline=(42, 95, 255, 255), width=3)
        p = m.get("pose")
        if p:
            import math
            X, Y = px(p["x"], p["y"]); yaw = math.radians(p["yawDeg"]); r = 0.3 * scale
            tip = (X + r * math.cos(yaw), Y - r * math.sin(yaw))
            l = (X + 0.5 * r * math.cos(yaw + 2.5), Y - 0.5 * r * math.sin(yaw + 2.5))
            rr = (X + 0.5 * r * math.cos(yaw - 2.5), Y - 0.5 * r * math.sin(yaw - 2.5))
            d.polygon([tip, l, rr], fill=(120, 230, 255, 255))
        d.rectangle([0, 0, Wpx - 1, Hpx - 1], outline=(255, 255, 255, 200), width=2)
        img.save(mdir / f"{f:05d}.png")
        last_key, last_img = key, img
    return mdir / "%05d.png", {"x0": x0, "y0": y0, "span": span}


class MemLog:
    """Samples the robot's durable memory while recording -- `MEMORY.md` and the
    digest over HTTP, the place notes and today's journal from the workspace on
    disk -- and keeps a sample only when something changed."""

    def __init__(self, agent_robot_url: str, workspace: pathlib.Path, period: float = 0.5) -> None:
        self.url, self.workspace, self.period = agent_robot_url, workspace, period
        self.samples: list[tuple[float, dict]] = []
        self._last_key: str | None = None
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True)

    def start(self) -> None:
        self._sample(force=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        self._sample(force=True)

    def read(self) -> dict:
        digest: dict = {}
        memory_md = ""
        try:
            digest = http("GET", f"{self.url}/memory", timeout=2)
        except Exception:  # noqa: BLE001
            pass
        try:
            req = urllib.request.Request(f"{self.url}/memory.md")
            with urllib.request.urlopen(req, timeout=2) as r:
                memory_md = r.read().decode("utf-8", "replace")
        except Exception:  # noqa: BLE001
            pass
        places: dict[str, str] = {}
        pdir = self.workspace / "places"
        if pdir.is_dir():
            for f in sorted(pdir.glob("*.md"), key=lambda f: f.stat().st_mtime):
                try:
                    places[f.stem] = f.read_text()
                except OSError:
                    pass
        journal: list[dict] = []
        jdir = self.workspace / "journal"
        if jdir.is_dir():
            files = sorted(jdir.glob("*.jsonl"))[-2:]
            for f in files:
                try:
                    for ln in f.read_text().splitlines():
                        try:
                            journal.append(json.loads(ln))
                        except ValueError:
                            pass
                except OSError:
                    pass
        return {"digest": digest, "memory_md": memory_md, "places": places, "journal": journal[-60:]}

    def _sample(self, force: bool = False) -> None:
        try:
            m = self.read()
        except Exception:  # noqa: BLE001
            return
        key = json.dumps({k: m[k] for k in ("memory_md", "places")}, sort_keys=True) + str(len(m["journal"])) + (
            m["journal"][-1].get("t", "") if m["journal"] else "")
        if force or key != self._last_key:
            self._last_key = key
            self.samples.append((time.time(), m))

    def _run(self) -> None:
        while not self._stop.wait(self.period):
            self._sample()


def _local_hms(stamp: str) -> str:
    try:
        return datetime.fromisoformat(stamp.replace("Z", "+00:00")).astimezone().strftime("%H:%M:%S")
    except ValueError:
        return "--:--:--"


def render_memory_frames(samples: list[tuple[float, dict]], video_t, seconds: float, fps: int,
                         size: tuple[int, int], workdir: pathlib.Path) -> pathlib.Path | None:
    """PNG sequence of the memory pane: place notes (durable, from
    `places/<ID>.md`), MEMORY.md entries, and the tail of the journal. A line
    that has just appeared is drawn green for a moment, then white."""
    from PIL import Image, ImageDraw
    if not samples:
        return None
    W, H = size
    fs, fs_small = 27, 22
    lh = int(fs * 1.3)
    font, small = _font(fs), _font(fs_small)
    mdir = workdir / "mem"
    mdir.mkdir(parents=True, exist_ok=True)
    stamped = [(video_t(w), m) for w, m in samples]
    stamped = [(t, m) for t, m in stamped if t is not None]
    if not stamped:
        return None
    # When each journal record / note line first showed up (video seconds), for the flash.
    first_seen: dict[str, float] = {}
    for i, (t, m) in enumerate(stamped):
        if i == 0:
            t = -1e9  # what was already there when the clip began never flashes
        for rec in m["journal"]:
            first_seen.setdefault(f"j:{rec.get('t')}:{rec.get('block')}", t)
        for pid, text in m["places"].items():
            for ln in text.splitlines():
                if ln.startswith("- "):
                    first_seen.setdefault(f"p:{pid}:{ln}", t)
        for ln in m["memory_md"].splitlines():
            if ln.startswith("- "):
                first_seen.setdefault(f"g:{ln}", t)
    FLASH_S = 2.5
    pad = 30
    n = int(seconds * fps) + 1
    j = 0
    last_key, last_img = None, None

    def fit(d, text: str, width: int, f) -> str:
        if d.textlength(text, font=f) <= width:
            return text
        while text and d.textlength(text + "…", font=f) > width:
            text = text[:-1]
        return text.rstrip() + "…"

    for fi in range(n):
        t = fi / fps
        while j + 1 < len(stamped) and stamped[j + 1][0] <= t:
            j += 1
        m = stamped[j][1]
        # Frames only differ when the sample or a flash state changes; bucket time by 0.5 s for the flash.
        key = (id(m), int(t * 2))
        if key == last_key and last_img is not None:
            last_img.save(mdir / f"{fi:05d}.png")
            continue
        img = Image.new("RGBA", (W, H), (14, 17, 23, 255))
        d = ImageDraw.Draw(img, "RGBA")
        d.line([(0, 0), (W, 0)], fill=(60, 66, 78, 255), width=2)
        d.text((pad, 10), "memory", font=small, fill=(140, 150, 165, 255))
        dg = m.get("digest") or {}
        right = ""
        if dg:
            nplaces = len(dg.get("places") or [])
            right = f"{dg.get('memoryEntries', 0)} global · {nplaces} place{'s' if nplaces != 1 else ''} with notes · journal {len(m['journal'])}"
            d.text((W - pad - d.textlength(right, font=small), 10), right, font=small, fill=(140, 150, 165, 255))
        y = 10 + fs_small + 14
        col_new, col_txt, col_dim, col_place = (124, 255, 178, 255), (236, 238, 242, 255), (150, 158, 172, 255), (120, 230, 255, 255)

        # 1. place notes (durable) -- most recent places last, at most 6 lines
        lines: list[tuple[str, tuple, object]] = []
        for pid, text in m["places"].items():
            notes = [ln[2:] for ln in text.splitlines() if ln.startswith("- ")]
            if not notes:
                continue
            lines.append((pid.replace("-", " ").title(), col_place, font))
            for ln, raw in zip(notes, [l for l in text.splitlines() if l.startswith("- ")]):
                # "2026-08-15 (operator) the red hat is on the table" -> "(operator) the red hat ..."
                ln = re.sub(r"^\d{4}-\d{2}-\d{2}\s+", "", ln)
                fresh = t - first_seen.get(f"p:{pid}:{raw}", 0.0) < FLASH_S
                lines.append(("   " + ln, col_new if fresh else col_txt, font))
        for ln in m["memory_md"].splitlines():
            if ln.startswith("- "):
                fresh = t - first_seen.get(f"g:{ln}", 0.0) < FLASH_S
                lines.append(("global  " + re.sub(r"^\d{4}-\d{2}-\d{2}\s+", "", ln[2:]), col_new if fresh else col_txt, font))
        if not lines:
            lines.append(("no notes yet — nothing has been remembered", col_dim, font))
        max_note_lines = 7
        if len(lines) > max_note_lines:
            lines = lines[-max_note_lines:]
        for text, col, f in lines:
            d.text((pad, y), fit(d, text, W - 2 * pad, f), font=f, fill=col)
            y += lh

        # 2. the journal tail: what the robot did, one line each, newest last
        y += 8
        d.text((pad, y), "journal", font=small, fill=(140, 150, 165, 255))
        y += fs_small + 8
        room = max(1, (H - y - 10) // lh)
        recs = [r for r in m["journal"] if r.get("kind") == "block"][-room:]
        for rec in recs:
            fresh = t - first_seen.get(f"j:{rec.get('t')}:{rec.get('block')}", 0.0) < FLASH_S
            place = (rec.get("place") or "?").replace("-", " ").title()
            msg = (rec.get("msg") or "").replace("\n", " ")
            msg = re.sub(r"\s*\(entities:.*?\)", "", msg)
            msg = re.sub(r"^(Looked|Scanned[^;]*;)\s*:?\s*", "", msg)
            msg = re.sub(r"^Said \([^)]*\):\s*", "Said: ", msg)
            head = f"{_local_hms(rec.get('t', ''))}  {place:<12} "
            kind = f"{rec.get('block', ''):<9} "
            col = col_new if fresh else (col_dim if rec.get("trust") == "untrusted" else col_txt)
            hx = d.textlength(head, font=font)
            kx = d.textlength(kind, font=font)
            d.text((pad, y), head, font=font, fill=col if fresh else col_dim)
            d.text((pad + hx, y), kind, font=font,
                   fill=(255, 107, 107, 255) if not rec.get("ok") else (col_new if fresh else col_place))
            d.text((pad + hx + kx, y), fit(d, msg, W - 2 * pad - hx - kx, font), font=font, fill=col)
            y += lh
        img.save(mdir / f"{fi:05d}.png")
        last_key, last_img = key, img
    return mdir / "%05d.png"


def retime_pip(pip: pathlib.Path, clock: "SimClock", pip_fps: int, seconds: float,
               workdir: pathlib.Path) -> pathlib.Path:
    """The eye-view recorder drops frames differently from the main one, so the
    two streams drift apart. Re-cut the pip onto the MAIN video's timeline:
    for every 1/pip_fps of video time, pick the pip frame that was emitted at
    the same wall moment."""
    fdir = workdir / "pip"
    fdir.mkdir(parents=True, exist_ok=True)
    subprocess.run([shutil.which("ffmpeg") or "ffmpeg", "-loglevel", "error", "-y", "-i", str(pip),
                    str(fdir / "%05d.png")], check=True)
    n_src = len(list(fdir.glob("*.png")))
    if n_src == 0:
        return pip
    base = clock.frames(clock.wall0 or 0.0, "pip")
    lst = workdir / "pip.txt"
    lines = []
    n = int(seconds * pip_fps) + 1
    for k in range(n):
        wall = clock.wall_of_video_t(k / pip_fps)
        idx = int(round(clock.frames(wall, "pip") - base))
        idx = min(max(idx, 0), n_src - 1)
        lines.append(f"file '{(fdir / f'{idx + 1:05d}.png').resolve()}'\nduration {1 / pip_fps:.5f}")
    lines.append(f"file '{(fdir / f'{n_src:05d}.png').resolve()}'")
    lst.write_text("\n".join(lines) + "\n")
    out = workdir / "pip-retimed.mp4"
    subprocess.run([shutil.which("ffmpeg") or "ffmpeg", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0",
                    "-i", str(lst), "-fps_mode", "vfr", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "veryfast",
                    "-crf", "18", str(out)], check=True)
    return out


def burn_stacked(raw: pathlib.Path, out: pathlib.Path, meta: dict, cam_size: tuple[int, int],
                 title: str | None, map_samples: list[tuple[float, dict]], video_t) -> None:
    """`--layout stack`: the robot's own camera full-width on top, its map
    full-width below, and as little text as possible -- the command, the block
    that is running, and the outcome."""
    cw, ch = cam_size
    W = 1080
    cam_h = int(ch * W / cw)
    band = 96
    map_px = min(W - 2 * 30, 1920 - cam_h - band - 30)
    H = cam_h + band + map_px + 30
    workdir = out.parent / f".{out.stem}-captions"
    workdir.mkdir(parents=True, exist_ok=True)
    sheet = CaptionSheet((W, H), workdir)
    fs_cmd, fs_blk = 46, 42
    ytop = "top"
    if title:
        sheet.add(title, fontsize=34, color="#ffffffd9", y="top")
        ytop = "top+80"
    sheet.add(wrap(f"> {meta['command']}", 36), fontsize=fs_cmd, color="#ffffff", y=ytop)

    band_y = str(cam_h + (band - fs_blk) // 2 - 6)
    blocks = [b for b in meta["blocks"] if b.get("t0") is not None]
    first_start = blocks[0]["t0"] if blocks else None
    plan_t0, plan_t1 = meta["command_t"], first_start if first_start is not None else meta["end_t"]
    if plan_t1 - plan_t0 > 0.3:
        sheet.add("thinking (local LLM) ...", fontsize=fs_blk, color="#ffd166", y=band_y, t0=plan_t0, t1=plan_t1)
    for i, b in enumerate(blocks):
        t0 = b["t0"]
        t1 = blocks[i + 1]["t0"] if i + 1 < len(blocks) else meta["end_t"]
        color = "#ff6b6b" if b.get("status") == "failed" else "#7CFFB2"
        sheet.add(f"› {b['caption']}", fontsize=fs_blk, color=color, y=band_y, t0=t0, t1=max(t1, t0 + 0.6))
    # The closing line sits over the bottom of the map: the one sentence that
    # says what happened. For a plan that ended well that is the last block's
    # own report ("Walked 2.08 m ... Stopped 0.90 m short ... keepout ahead",
    # "Stopped at \"chair\" after 4 stages"), not the word "done".
    closing = meta.get("outcome")
    if meta["status"] == "done":
        # A goto's report outranks the looks it ran ("Stopped at \"chair\" ...").
        last = next((b for b in reversed(meta["blocks"]) if b["kind"] == "goto" and (b.get("result") or "").strip()),
                    None) or next((b for b in reversed(meta["blocks"])
                                   if b["kind"] not in ("wait",) and (b.get("result") or "").strip()), None)
        if last:
            closing = short_result(last) if last["kind"] in ("look", "scan_room", "goto") else last["result"]
            if last["kind"] == "goto":
                closing = last["result"].split(":")[0].strip()
    if closing:
        col = "#7CFFB2" if meta["status"] == "done" else "#ff6b6b"
        text = wrap(closing, 48)
        n_lines = text.count("\n") + 1
        sheet.add(text, fontsize=34, color=col, y=str(H - 30 - 30 - int(34 * 1.35) * n_lines), t0=meta["end_t"])

    map_seq = None
    rendered = render_map_frames(map_samples, video_t, float(meta["recorder"].get("seconds") or 0) + 1.0,
                                 5, map_px, workdir) if map_samples else None
    if rendered:
        map_seq = (rendered[0], 5, (W - map_px) // 2, cam_h + band)
    subprocess.run(sheet.ffmpeg_args(raw, out, map_seq=map_seq, stack=(W, cam_h)), check=True)
    shutil.rmtree(workdir, ignore_errors=True)


def burn_memory_layout(raw: pathlib.Path, out: pathlib.Path, meta: dict, cam_size: tuple[int, int],
                       title: str | None, map_samples: list[tuple[float, dict]],
                       mem_samples: list[tuple[float, dict]], video_t,
                       map_window: "tuple[float, float, float, float] | None" = None,
                       places: "list[dict] | None" = None) -> None:
    """`--layout memory`: three panes on a 1080x1920 canvas -- the robot's own
    camera on top, its map in the middle, its durable memory at the bottom.
    Text stays minimal: the command, the running block, one closing line."""
    cw, ch = cam_size
    W, H = 1080, 1920
    cam_h = int(ch * W / cw)            # 648 for the 5:3 head-camera render this layout asks for
    band = 96
    mem_h = 520
    map_h = H - cam_h - band - mem_h    # 656
    map_w = W - 2 * 30
    workdir = out.parent / f".{out.stem}-captions"
    workdir.mkdir(parents=True, exist_ok=True)
    sheet = CaptionSheet((W, H), workdir)
    fs_cmd, fs_blk = 44, 38
    ytop = "top"
    if title:
        sheet.add(title, fontsize=32, color="#ffffffd9", y="top")
        ytop = "top+76"
    sheet.add(wrap(f"> {meta['command']}", 38), fontsize=fs_cmd, color="#ffffff", y=ytop)

    band_y = str(cam_h + (band - fs_blk) // 2 - 8)
    blocks = [b for b in meta["blocks"] if b.get("t0") is not None]
    first_start = blocks[0]["t0"] if blocks else None
    plan_t0, plan_t1 = meta["command_t"], first_start if first_start is not None else meta["end_t"]
    if plan_t1 - plan_t0 > 0.3:
        sheet.add("thinking (local LLM) ...", fontsize=fs_blk, color="#ffd166", y=band_y, t0=plan_t0, t1=plan_t1)
    for i, b in enumerate(blocks):
        t0 = b["t0"]
        t1 = blocks[i + 1]["t0"] if i + 1 < len(blocks) else meta["end_t"]
        color = "#ff6b6b" if b.get("status") == "failed" else "#7CFFB2"
        # No two captions in the band at once, and the closing line (from
        # end_t) never shares a frame with the last block's caption.
        t1 = min(max(t1, t0 + 0.05), meta["end_t"] - 0.05)
        if t1 <= t0:
            continue
        sheet.add(f"› {wrap(b['caption'], 46)}", fontsize=fs_blk, color=color, y=band_y, t0=t0, t1=t1)
    closing = meta.get("outcome")
    if meta["status"] == "done":
        # What the plan amounted to: a spoken answer if there was one (the
        # "tell me what you see"), else the goto's own report, else the last
        # block's line.
        # The LAST thing of consequence the plan did: a remember, something
        # said, or a goto's arrival -- whichever came last, so a plan that
        # ends with "come back to the kitchen" closes on the arrival, not on
        # a description spoken two rooms earlier.
        for b in reversed(meta["blocks"]):
            res = (b.get("result") or "").strip()
            if not res:
                continue
            if b["kind"] == "remember":
                closing = res
                break
            if b["kind"] in ("speak", "look", "greet") and spoken_text(res):
                closing = f"“{spoken_text(res)}”"
                break
            if b["kind"] == "goto":
                closing = res.split(":")[0].strip()
                break
        else:
            last = next((b for b in reversed(meta["blocks"]) if b["kind"] != "wait" and (b.get("result") or "").strip()), None)
            if last:
                closing = short_result(last) or last["result"]
    if closing:
        # In the band, where the running block was: the plan is over, so the
        # one line that says how it went takes that spot (a long line runs
        # down over the top of the map, which is dark there anyway).
        col = "#7CFFB2" if meta["status"] == "done" else "#ff6b6b"
        sheet.add(wrap(closing, 52), fontsize=32, color=col, y=str(cam_h + 22), t0=meta["end_t"])

    seconds = float(meta["recorder"].get("seconds") or 0) + 1.0
    seqs = []
    rendered = render_map_frames(map_samples, video_t, seconds, 5, (map_w, map_h - 8), workdir,
                                 window=map_window, places=places) if map_samples else None
    if rendered:
        seqs.append((rendered[0], 5, (W - map_w) // 2, cam_h + band))
    mem = render_memory_frames(mem_samples, video_t, seconds, 5, (W, mem_h), workdir) if mem_samples else None
    if mem:
        seqs.append((mem, 5, 0, H - mem_h))
    subprocess.run(sheet.ffmpeg_args(raw, out, stack=(W, cam_h), extra_seqs=seqs), check=True)
    shutil.rmtree(workdir, ignore_errors=True)


def burn_captions(raw: pathlib.Path, out: pathlib.Path, meta: dict, size: tuple[int, int],
                  title: str | None, pip: pathlib.Path | None = None,
                  map_samples: list[tuple[float, dict]] | None = None, clock: "SimClock | None" = None,
                  layout: str = "inset", mem_samples: list[tuple[float, dict]] | None = None,
                  map_window: "tuple[float, float, float, float] | None" = None,
                  places: "list[dict] | None" = None) -> None:
    video_t = clock.video_t if clock else (lambda w: w)
    if layout == "stack":
        burn_stacked(raw, out, meta, size, title, map_samples or [], video_t)
        return
    if layout == "memory":
        burn_memory_layout(raw, out, meta, size, title, map_samples or [], mem_samples or [], video_t,
                           map_window=map_window, places=places)
        return
    w, h = size
    vertical = h > w
    fs_cmd = int(w * (0.048 if vertical else 0.032))
    fs_blk = int(w * (0.042 if vertical else 0.027))
    fs_title = int(w * (0.034 if vertical else 0.022))
    wrap_w = 34 if vertical else 62
    workdir = out.parent / f".{out.stem}-captions"
    workdir.mkdir(parents=True, exist_ok=True)
    sheet = CaptionSheet(size, workdir)

    ytop = "top"
    if title:
        sheet.add(title, fontsize=fs_title, color="#ffffffd9", y="top")
        ytop = f"top+{fs_title + 46}"
    sheet.add(wrap(f"> {meta['command']}", wrap_w), fontsize=fs_cmd, color="#ffffff", y=ytop)

    blocks = [b for b in meta["blocks"] if b.get("t0") is not None]
    first_start = blocks[0]["t0"] if blocks else None
    plan_t0 = meta["command_t"]
    plan_t1 = first_start if first_start is not None else meta["end_t"]
    if plan_t1 - plan_t0 > 0.3:
        sheet.add("thinking (local LLM) ...", fontsize=fs_blk, color="#ffd166", y="bottom",
                  t0=plan_t0, t1=plan_t1)

    for i, b in enumerate(blocks):
        t0 = b["t0"]
        t1 = blocks[i + 1]["t0"] if i + 1 < len(blocks) else meta["end_t"]
        color = "#ff6b6b" if b.get("status") == "failed" else "#7CFFB2"
        sheet.add(wrap(f"› {b['caption']}", wrap_w), fontsize=fs_blk,
                  color=color, y="bottom", t0=t0, t1=max(t1, t0 + 0.6))
        res = short_result(b)
        # A look-and-tell's result IS its spoken line; the closing caption shows it.
        if res and b.get("t1") is not None and res != spoken_text(b.get("result")):
            sheet.add(wrap(res, wrap_w + 8), fontsize=int(fs_blk * 0.72), color="#ffffffe6",
                      y="bottom2", t0=b["t1"], t1=max(t1, b["t1"] + 1.0))

    # Closing caption: what the robot SAID last, if anything -- that is the
    # answer the operator asked for -- else the plan outcome.
    last_said = next((spoken_text(b.get("result")) for b in reversed(meta["blocks"])
                      if spoken_text(b.get("result"))), None)
    if meta["status"] == "done" and last_said:
        sheet.add(wrap(f'"{last_said}"', wrap_w), fontsize=fs_blk, color="#ffffff",
                  y="bottom", t0=meta["end_t"])
    elif meta.get("outcome"):
        col = "#7CFFB2" if meta["status"] == "done" else "#ff6b6b"
        sheet.add(wrap(meta["outcome"], wrap_w), fontsize=fs_blk, color=col, y="bottom",
                  t0=meta["end_t"])

    if pip is not None and pip.exists():
        # "what the robot sees" inset, top-right under the command box, with a
        # tiny label. Both streams started within a few ms of each other, but
        # drop frames independently -- so the pip is re-cut onto the main
        # timeline when the clock saw both recorders.
        if clock is not None and clock.has("pip") and clock.has("main"):
            pip = retime_pip(pip, clock, 15, float(meta["recorder"].get("seconds") or 0) + 1.0, workdir)
        pip_w = int(w * (0.42 if vertical else 0.24))
        sheet.add("robot's eye view", fontsize=int(fs_title * 0.9), color="#ffffffcc",
                  y="pip-label", x_right=True, pip_w=pip_w)
    map_seq = None
    if map_samples:
        # "the robot's map" inset: same band as the eye view, on the left --
        # grid, keepouts (amber), peers (orange), the planned route (cobalt).
        inset = int(w * (0.42 if vertical else 0.24))
        pip_h = int(inset * 3 / 4)
        map_y = h - sheet.pad - pip_h - int(h * 0.21) - (inset - pip_h)
        sheet.add("the robot's map", fontsize=int(fs_title * 0.9), color="#ffffffcc",
                  y=str(map_y - int(fs_title * 0.9) - 20 - 6))
        rendered = render_map_frames(map_samples, video_t, float(meta["recorder"].get("seconds") or 0) + 1.0,
                                     5, inset, workdir)
        if rendered:
            map_seq = (rendered[0], 5, sheet.pad, map_y)
    subprocess.run(sheet.ffmpeg_args(raw, out, pip=pip, pip_w=pip_w if pip is not None and pip.exists() else 0,
                                     pip_y=sheet.pip_y, map_seq=map_seq), check=True)
    shutil.rmtree(workdir, ignore_errors=True)


def poll_plan(agent: str, command: str, timeout: float, quiet: bool = False) -> dict | None:
    """Poll the agent until the plan for `command` finishes; prints blocks as they start."""
    plan = None
    deadline = time.time() + timeout
    last_cursor = None
    while time.time() < deadline:
        st = http("GET", agent)
        plan = st.get("plan")
        if plan and plan.get("command") == command:
            if plan.get("cursor") != last_cursor and plan.get("cursor", -1) >= 0:
                last_cursor = plan["cursor"]
                b = plan["blocks"][last_cursor]
                if not quiet:
                    print(f"[clip]   [{last_cursor + 1}/{len(plan['blocks'])}] {block_caption(b)}")
            if plan.get("status") in ("done", "failed", "aborted"):
                return plan
        time.sleep(0.2)
    print("[clip] timed out waiting for the plan", file=sys.stderr)
    return plan


def wait_plan(agent: str, command: str, timeout: float, quiet: bool = False) -> dict | None:
    res = http("POST", f"{agent}/command", {"text": command})
    if res.get("accepted") is False:
        raise SystemExit(f"command refused: {res}")
    plan = poll_plan(agent, command, timeout, quiet=quiet)
    if plan:
        print(f"[clip]   -> {plan.get('status')}")
    return plan


def parse_window(text: str | None) -> "tuple[float, float, float, float] | None":
    if not text:
        return None
    x0, y0, x1, y1 = (float(v) for v in text.split(","))
    return x0, y0, x1, y1


def load_places(path: str | None) -> "list[dict] | None":
    """The place graph's rooms (non-keepout polygons) for the map's outlines."""
    if not path:
        return None
    data = json.loads(pathlib.Path(path).read_text())
    return [p for p in data.get("places", []) if not p.get("keepout") and p.get("polygon")]


def make_card(text: str, out: pathlib.Path, seconds: float, size: tuple[int, int] = (1080, 1920),
              fontsize: int = 54, sub: str | None = None) -> None:
    """A title card: `text` centred on the dark canvas for `seconds`."""
    from PIL import Image, ImageDraw
    W, H = size
    img = Image.new("RGB", (W, H), (14, 17, 23))
    d = ImageDraw.Draw(img)
    lines = wrap(text, 30).split("\n") if len(text) > 30 else [text]
    f = _font(fontsize)
    lh = int(fontsize * 1.4)
    total = lh * len(lines) + (int(fontsize * 0.7) * 2 if sub else 0)
    y = H // 2 - total // 2
    for ln in lines:
        d.text(((W - d.textlength(ln, font=f)) / 2, y), ln, font=f, fill=(236, 238, 242))
        y += lh
    if sub:
        fs = _font(int(fontsize * 0.55))
        y += int(fontsize * 0.4)
        for ln in sub.split("\n"):
            d.text(((W - d.textlength(ln, font=fs)) / 2, y), ln, font=fs, fill=(150, 158, 172))
            y += int(fontsize * 0.8)
    png = out.with_suffix(".png")
    img.save(png)
    subprocess.run([shutil.which("ffmpeg") or "ffmpeg", "-loglevel", "error", "-y", "-loop", "1", "-i", str(png),
                    "-t", f"{seconds:.2f}", "-r", "30", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "medium",
                    "-crf", "18", str(out)], check=True)


def concat(parts: list[pathlib.Path], out: pathlib.Path) -> None:
    """Concatenate clips of the same size (re-encoded, so cards and clips mix)."""
    args = [shutil.which("ffmpeg") or "ffmpeg", "-loglevel", "error", "-y"]
    for p in parts:
        args += ["-i", str(p)]
    n = len(parts)
    chain = "".join(f"[{i}:v]scale=1080:1920,setsar=1,fps=30,format=yuv420p[v{i}];" for i in range(n))
    chain += "".join(f"[v{i}]" for i in range(n)) + f"concat=n={n}:v=1:a=0[v]"
    args += ["-filter_complex", chain, "-map", "[v]", "-c:v", "libx264", "-preset", "medium", "-crf", "18",
             "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(out)]
    subprocess.run(args, check=True)


def recaption(args) -> int:
    """Re-burn captions for an existing clip from its sidecars."""
    out = pathlib.Path(args.out)
    meta = json.loads(out.with_suffix(".json").read_text())
    raw = out.with_suffix(".raw.mp4")
    if not raw.exists():
        raise SystemExit(f"{raw} not found -- the clip was recorded with --no-captions?")
    w, h = (int(v) for v in meta.get("size", args.size).lower().split("x"))
    clock = SimClock(SIM_URL, int(meta.get("fps") or args.fps))
    clock.wall0 = meta.get("rec_t0_wall")
    clock.samples = [(t, d) for t, d in meta.get("sim_clock") or []]
    if not clock.samples or clock.wall0 is None:
        clock = None
    pip = out.with_suffix(".pip.mp4")
    mp = out.with_suffix(".maplog.json")
    map_samples = [(t, m) for t, m in json.loads(mp.read_text())] if mp.exists() else None
    ml = out.with_suffix(".memlog.json")
    mem_samples = [(t, m) for t, m in json.loads(ml.read_text())] if ml.exists() else None
    burn_captions(raw, out, meta, (w, h), args.title, pip=pip if pip.exists() else None,
                  map_samples=map_samples, clock=clock, layout=args.layout, mem_samples=mem_samples,
                  map_window=parse_window(args.map_window), places=load_places(args.places))
    print(f"[clip] recaptioned -> {out}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", nargs="?", default=None)
    ap.add_argument("--out", default="clip.mp4")
    ap.add_argument("--cam", default="follow")
    ap.add_argument("--size", default="1080x1920")
    ap.add_argument("--fps", type=int, default=30)
    ap.add_argument("--start", default="0,0,0", help="x,y,yaw_deg to reset the robot to first")
    ap.add_argument("--no-reset", action="store_true", help="keep pose + scene memory from before")
    ap.add_argument("--title", default=None)
    ap.add_argument("--lead", type=float, default=1.5, help="seconds of footage before the command")
    ap.add_argument("--tail", type=float, default=2.5, help="seconds after the plan finishes")
    ap.add_argument("--timeout", type=float, default=240.0)
    ap.add_argument("--no-captions", action="store_true")
    ap.add_argument("--prime", default=None, metavar="COMMAND",
                    help="run this Agent Mode command BEFORE recording (e.g. \"look around\") "
                         "so scene memory is warm; the clip itself starts afterwards")
    ap.add_argument("--pip", default=None, metavar="CAMERA",
                    help="also record this MJCF camera (e.g. head_camera) and inset it "
                         "picture-in-picture -- 'what the robot sees'")
    ap.add_argument("--layout", choices=("inset", "stack", "memory"), default="inset",
                    help="inset: the scene camera with small insets (default). stack: the robot's "
                         "own camera full-width on top, its map below, minimal text -- implies "
                         "--map, and --cam defaults to head_camera at 1080x810. memory: like stack "
                         "with a third pane at the bottom showing the robot's durable memory (place "
                         "notes, MEMORY.md, journal tail) sampled while recording")
    ap.add_argument("--map-window", default=None, metavar="X0,Y0,X1,Y1",
                    help="fixed map window in metres (default: fit the known area) -- give the same "
                         "one to every clip of a multi-clip video so the map does not jump")
    ap.add_argument("--places", default=None, metavar="GRAPH.json",
                    help="place graph whose rooms are outlined + named on the map "
                         "(e.g. ../sim_evaluator/places/places.house.json)")
    ap.add_argument("--card", default=None, metavar="TEXT",
                    help="do not record: write a title card (TEXT centred, --tail seconds long) to --out")
    ap.add_argument("--card-sub", default=None, help="smaller second line for --card")
    ap.add_argument("--concat", nargs="+", default=None, metavar="CLIP",
                    help="do not record: concatenate these clips/cards (1080x1920) into --out")
    ap.add_argument("--map", action="store_true",
                    help="also sample the agent's /map while recording and inset it -- "
                         "grid, keepouts, peers and the planned route (TASK-206..208)")
    ap.add_argument("--recaption", action="store_true",
                    help="do not record: rebuild <out> from <out>.raw.mp4 + <out>.json (+ .pip.mp4, "
                         ".maplog.json) with the current caption code / --layout / --title")
    args = ap.parse_args()
    if args.card is not None:
        make_card(args.card, pathlib.Path(args.out), args.tail, sub=args.card_sub)
        print(f"[clip] card -> {args.out}")
        return 0
    if args.concat:
        concat([pathlib.Path(p) for p in args.concat], pathlib.Path(args.out))
        print(f"[clip] concatenated {len(args.concat)} parts -> {args.out}")
        return 0
    if args.recaption:
        return recaption(args)
    if not args.command:
        ap.error("command is required (or use --card / --concat / --recaption)")
    if args.layout in ("stack", "memory"):
        args.map = True
        if args.cam == "follow":
            args.cam = "head_camera"
        if args.size == "1080x1920":
            # The memory layout renders the head camera wider (5:3): the MJCF
            # camera keeps its vertical FOV, so a wider frame simply sees more
            # to the sides -- and leaves room for the map and the memory pane.
            args.size = "1080x648" if args.layout == "memory" else "1080x810"
        args.pip = None

    out = pathlib.Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    raw = out.with_suffix(".raw.mp4") if not args.no_captions else out
    w, h = (int(v) for v in args.size.lower().split("x"))
    agent = f"{AGENT_URL}/api/v1/robots/{ROBOT_ID}/agent-mode"

    st = http("GET", agent)
    if not st.get("enabled"):
        raise SystemExit("Agent Mode is not enabled on the robot-agent")
    if st.get("plan") and st["plan"].get("status") in ("planning", "running"):
        raise SystemExit("a plan is already running -- wait or e-stop first")

    if not args.no_reset:
        x, y, yaw = (float(v) for v in args.start.split(","))
        # Scene memory is deliberately NOT cleared: it is keyed to world
        # coordinates the sim reports as ground truth, so a teleport keeps it
        # valid -- and "it remembers where the table is" is part of the story.
        # Restart the robot-agent for a clean-slate clip.
        http("POST", f"{SIM_URL}/sim/reset-pose", {"x": x, "y": y, "yaw": yaw * 3.141592653589793 / 180})
        time.sleep(0.5)

    if args.prime:
        print(f"[clip] priming (not recorded): > {args.prime}")
        wait_plan(agent, args.prime, args.timeout, quiet=True)

    print(f"[clip] recording -> {raw}  cam={args.cam} {w}x{h}@{args.fps}")
    r = http("POST", f"{SIM_URL}/record/start",
             {"path": str(raw.resolve()), "cam": args.cam, "size": f"{w}x{h}", "fps": args.fps})
    if not r.get("ok"):
        raise SystemExit(f"recorder refused: {r}")
    pip_raw = None
    if args.pip:
        pip_raw = out.with_suffix(".pip.mp4")
        pw, ph = (640, 480) if w >= h else (480, 360)
        # Flat and 15 fps: every render runs on the sim's physics thread, and a
        # second shadowed stream pushed the sim under real time (measured: 50%).
        r2 = http("POST", f"{SIM_URL}/record/start",
                  {"id": "pip", "path": str(pip_raw.resolve()), "cam": args.pip,
                   "size": f"{pw}x{ph}", "fps": 15, "shadows": False})
        if not r2.get("ok"):
            http("POST", f"{SIM_URL}/record/stop")
            raise SystemExit(f"pip recorder refused: {r2}")
    clock = SimClock(SIM_URL, args.fps)
    clock.start()
    maplog = MapLog(f"{AGENT_URL}/api/v1/robots/{ROBOT_ID}/map") if args.map else None
    if maplog:
        maplog.start()
    memlog = MemLog(f"{AGENT_URL}/api/v1/robots/{ROBOT_ID}", WORKSPACE_DIR) if args.layout == "memory" else None
    if memlog:
        memlog.start()
    rec_t0 = clock.wall0 or time.time()
    time.sleep(args.lead)

    print(f"[clip] > {args.command}")
    cmd_t = time.time()
    res = http("POST", f"{agent}/command", {"text": args.command})
    if not res.get("accepted", True) and res.get("accepted") is False:
        http("POST", f"{SIM_URL}/record/stop")
        raise SystemExit(f"command refused: {res}")

    plan = poll_plan(agent, args.command, args.timeout)

    end_t = time.time()
    time.sleep(args.tail)
    clock.stop()
    if maplog:
        maplog.stop()
    if memlog:
        memlog.stop()
    stop = http("POST", f"{SIM_URL}/record/stop", timeout=60)
    rec = stop.get("current") or stop.get("last") or {}
    print(f"[clip] recorder: {rec.get('frames')} frames, {rec.get('seconds')} s"
          + (f", ERROR {rec['error']}" if rec.get("error") else ""))

    blocks_meta = []
    for b in (plan or {}).get("blocks", []):
        w0 = iso_to_s(b["startedAt"]) if b.get("startedAt") else None
        w1 = iso_to_s(b["finishedAt"]) if b.get("finishedAt") else None
        blocks_meta.append({"kind": b["kind"], "params": b.get("params"), "status": b.get("status"),
                            "caption": block_caption(b), "reasoning": b.get("reasoning"),
                            "result": b.get("result"), "error": b.get("error"),
                            # video seconds (what the overlays are timed in) ...
                            "t0": clock.video_t(w0), "t1": clock.video_t(w1),
                            # ... and wall seconds since recording started, for the record
                            "t0_wall": (w0 - rec_t0) if w0 else None,
                            "t1_wall": (w1 - rec_t0) if w1 else None})
    status = (plan or {}).get("status", "unknown")
    outcome = None
    if plan:
        last = next((b for b in reversed(plan["blocks"]) if b.get("result") or b.get("error")), None)
        if status == "done":
            outcome = "done"
        elif last:
            outcome = f"{status}: {last.get('error') or last.get('result')}"
        else:
            outcome = status
    meta = {"command": args.command, "status": status, "outcome": outcome,
            "command_t": clock.video_t(cmd_t), "end_t": clock.video_t(end_t),
            "command_t_wall": cmd_t - rec_t0, "end_t_wall": end_t - rec_t0,
            "rec_t0_wall": rec_t0, "sim_clock": clock.samples, "blocks": blocks_meta,
            "plan": plan, "recorder": rec, "cam": args.cam, "size": args.size, "fps": args.fps}
    meta_path = out.with_suffix(".json")
    meta_path.write_text(json.dumps(meta, indent=2))
    if maplog:
        # Big (the grid rides along in every sample) but it is what makes
        # `--recaption` possible without driving the robot again.
        out.with_suffix(".maplog.json").write_text(json.dumps(maplog.samples))
    if memlog:
        out.with_suffix(".memlog.json").write_text(json.dumps(memlog.samples))
    print(f"[clip] plan {status}; wrote {meta_path}")

    if not args.no_captions:
        burn_captions(raw, out, meta, (w, h), args.title, pip=pip_raw,
                      map_samples=maplog.samples if maplog else None, clock=clock, layout=args.layout,
                      mem_samples=memlog.samples if memlog else None,
                      map_window=parse_window(args.map_window), places=load_places(args.places))
        print(f"[clip] captioned -> {out}")
    return 0 if status == "done" else 1


if __name__ == "__main__":
    sys.exit(main())
