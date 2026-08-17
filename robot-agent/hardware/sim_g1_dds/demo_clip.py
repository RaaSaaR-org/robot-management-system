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

`--layout patrol --patrol-route ROUTE.json [--patrol-mode baseline|patrol]`
(TASK-212) starts a patrol run instead of a command (POST .../agent-mode/patrol
with the route inline) and lays out camera / map with numbered checkpoints and
red finding pins / baseline-vs-now photo pair. Stage the anomaly between the
baseline and the patrol clip with the sim facade, e.g.
`POST /sim/reset-pose {"body":"crate","x":4.5,"y":0.9}`.

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

# `DEMO_CLIP_DEBUG=1` prints every change the visitor's cue reader sees --
# what the robot was doing when a cue did or did not fire.
DEBUG_CUES = os.environ.get("DEMO_CLIP_DEBUG") == "1"
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
    "patrol": "patrol", "capture": "control photo", "inspect": "inspect",
    "tour": "guide the visitor", "present": "tell the visitor", "demo": "demonstrate",
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


def http_soft(method: str, url: str, body: dict | None = None, timeout: float = 5.0) -> "dict | None":
    """`http` for the background samplers: a missed request is a missed sample,
    not the end of the take.

    It exists because `http` reports failure by raising SystemExit -- which is a
    BaseException, so `except Exception:` in a sampler thread does NOT catch it
    and the thread dies without a word. One slow `GET /tour` (the agent was busy
    with the vision model) killed the thread the visitor's cues watch, and the
    rest of that visit was recorded as "nobody answered -- the visitor had
    left". Silence from a sampler must never be able to look like silence from
    a person."""
    try:
        return http(method, url, body, timeout)
    except (Exception, SystemExit):  # noqa: BLE001 -- see above: SystemExit is the point
        return None


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
            r = http_soft("GET", f"{self.sim_url}/record", timeout=2)
            if r is None:
                return
            recs = r.get("recorders") or {}
            if not recs and r.get("current"):
                recs = {"main": r["current"]}
            self.samples.append((time.time(), {k: int(v.get("frames") or 0) for k, v in recs.items()}))
        except (Exception, SystemExit):  # noqa: BLE001 -- a missed sample is a timing error, not a failure
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
    if kind in ("speak", "greet", "present"):
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
    if kind == "demo":
        return f"{verb}: {p.get('skillName') or p.get('skillId', '')}"
    if kind == "tour":
        return f"{verb}: {p.get('routeName') or p.get('routeId', '')}"
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


def wrap_lines(text: str, width: int) -> list[str]:
    words, lines, cur = text.split(), [], ""
    for w in words:
        if len(cur) + len(w) + 1 > width and cur:
            lines.append(cur)
            cur = w
        else:
            cur = f"{cur} {w}".strip()
    if cur:
        lines.append(cur)
    return lines


def wrap(text: str, width: int) -> str:
    # Four lines is what a caption box can hold without covering the shot.
    # Callers with a long utterance to show should page it (see the tour
    # layout) rather than let the tail be dropped here.
    return "\n".join(wrap_lines(text, width)[:4])


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
            # One full plate-height above `bottom2`, not a fixed 6% of the frame:
            # at 1600x900 that 54 px was less than this plate's own 79 px, so a
            # closing report and the look result under it overlapped by 25 px
            # whenever both were on screen.
            y0 = self.h - self.pad - th - bx * 2 - (th + bx * 2 + 12)
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
        m = http_soft("GET", self.url, timeout=2)
        if m and m.get("ok"):
            self.samples.append((time.time(), m))

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
                      places: "list[dict] | None" = None,
                      patrol_samples: "list[tuple[float, dict]] | None" = None,
                      tour_samples: "list[tuple[float, dict]] | None" = None) -> tuple[pathlib.Path, dict] | None:
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
    pstamped = [(video_t(w), p) for w, p in (patrol_samples or [])]
    pstamped = [(t, p) for t, p in pstamped if t is not None]
    tstamped = [(video_t(w), p) for w, p in (tour_samples or [])]
    tstamped = [(t, p) for t, p in tstamped if t is not None]
    n = int(seconds * fps) + 1
    j = 0
    jp = 0
    jt = 0
    last_key, last_img = None, None
    for f in range(n):
        t = f / fps
        while j + 1 < len(stamped) and stamped[j + 1][0] <= t:
            j += 1
        m = stamped[j][1]
        while jp + 1 < len(pstamped) and pstamped[jp + 1][0] <= t:
            jp += 1
        pat = pstamped[jp][1] if pstamped and pstamped[jp][0] <= t else None
        while jt + 1 < len(tstamped) and tstamped[jt + 1][0] <= t:
            jt += 1
        tou = tstamped[jt][1] if tstamped and tstamped[jt][0] <= t else None
        key = (id(m), id(pat), id(tou))
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
        if pat:
            _draw_patrol_overlay(d, px, scale, pat, places or [])
        if tou:
            _draw_tour_overlay(d, px, scale, tou, places or [])
        d.rectangle([0, 0, Wpx - 1, Hpx - 1], outline=(255, 255, 255, 200), width=2)
        img.save(mdir / f"{f:05d}.png")
        last_key, last_img = key, img
    return mdir / "%05d.png", {"x0": x0, "y0": y0, "span": span}


def _place_centroid(place_id: str, places: list[dict]) -> "tuple[float, float] | None":
    for pl in places:
        if pl.get("id") == place_id and pl.get("polygon"):
            pts = pl["polygon"]
            return sum(x for x, _ in pts) / len(pts), sum(y for _, y in pts) / len(pts)
    return None


def _draw_patrol_overlay(d, px, scale: float, pat: dict, places: list[dict]) -> None:
    """Numbered checkpoints (coloured by leg status) and red pins for the
    run's findings (TASK-212) over the map inset."""
    run = pat.get("run") or {}
    LEG_COL = {"done": (124, 255, 178, 255), "failed": (255, 107, 107, 255),
               "running": (255, 209, 102, 255), "skipped": (150, 158, 172, 255)}
    fnt = _font(24)
    for leg in run.get("legs") or []:
        # Where the robot actually stood when the leg finished, else the room's centre.
        c = (leg["pose"]["x"], leg["pose"]["y"]) if leg.get("pose") else _place_centroid(leg.get("placeId", ""), places)
        if not c:
            continue
        X, Y = px(*c)
        r = 16
        col = LEG_COL.get(leg.get("status"), (200, 205, 215, 255))
        d.ellipse([X - r, Y - r, X + r, Y + r], fill=(18, 21, 27, 230), outline=col, width=3)
        lab = str(int(leg.get("index", 0)) + 1)
        d.text((X - d.textlength(lab, font=fnt) / 2, Y - 14), lab, font=fnt, fill=col)
    for fnd in pat.get("findings") or []:
        pos = None
        blob = (fnd.get("evidence") or {}).get("blob")
        if blob:
            pos = (blob["x"], blob["y"])
        elif fnd.get("pose"):
            pos = (fnd["pose"]["x"], fnd["pose"]["y"])
        elif fnd.get("place"):
            pos = _place_centroid(fnd["place"], places)
        if not pos:
            continue
        X, Y = px(*pos)
        # a pin: red disc on a short stem
        d.line([(X, Y), (X, Y - 22)], fill=(255, 70, 70, 255), width=3)
        d.ellipse([X - 10, Y - 32, X + 10, Y - 12], fill=(255, 70, 70, 255), outline=(255, 220, 220, 255), width=2)


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
        memory_md = ""
        digest: dict = http_soft("GET", f"{self.url}/memory", timeout=2) or {}
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
        except (Exception, SystemExit):  # noqa: BLE001
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


class PatrolLog:
    """Samples the robot-agent's patrol state while recording (TASK-212):
    `GET .../agent-mode/patrol` for the active/last run, then the run's own
    endpoint for its findings. Keeps a sample only when something changed."""

    def __init__(self, agent_mode_url: str, period: float = 0.5) -> None:
        self.url, self.period = agent_mode_url, period
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
        st = http_soft("GET", f"{self.url}/patrol", timeout=2) or {}
        run = st.get("active") or st.get("lastRun") or {}
        findings: list[dict] = []
        if run.get("runId"):
            detail = http_soft("GET", f"{self.url}/patrol/runs/{run['runId']}", timeout=2)
            if detail:
                findings = detail.get("findings") or []
                run = {k: v for k, v in detail.items() if k != "findings"} or run
        return {"run": run, "findings": findings, "enabled": st.get("enabled")}

    def _sample(self, force: bool = False) -> None:
        try:
            m = self.read()
            run = m.get("run") or {}
        except (Exception, SystemExit):  # noqa: BLE001
            return
        key = json.dumps({"id": run.get("runId"), "st": run.get("status"),
                          "legs": [(l.get("status"), l.get("inspection")) for l in run.get("legs") or []],
                          "f": [f.get("id") for f in m["findings"]]}, sort_keys=True)
        if force or key != self._last_key:
            self._last_key = key
            self.samples.append((time.time(), m))

    def _run(self) -> None:
        while not self._stop.wait(self.period):
            self._sample()


class TourLog:
    """Samples host mode while recording (TASK-213): `GET .../agent-mode/tour`
    carries the bound route, the run in flight (its legs and the visitor's
    turns) and the question the robot is waiting for an answer to. A sample is
    kept only when something changed, so the pane renderer can hold a frame."""

    def __init__(self, agent_mode_url: str, period: float = 0.4) -> None:
        self.url, self.period = agent_mode_url, period
        self.samples: list[tuple[float, dict]] = []
        self._t0 = time.time()
        self._last_key: str | None = None
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True)

    def start(self) -> None:
        self._sample(force=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        self._sample(force=True)

    def latest(self) -> dict:
        return self.samples[-1][1] if self.samples else {}

    def read(self) -> dict:
        st = http_soft("GET", f"{self.url}/tour", timeout=3)
        if st is None:
            raise RuntimeError("the robot did not answer GET .../agent-mode/tour")
        if not st.get("run"):
            # `GET /tour` carries the run IN FLIGHT only. A visit that just
            # ended is exactly what the pane should keep showing -- with its
            # reason -- instead of going blank, so the last run is pulled in
            # when it belongs to this take.
            try:
                runs = (http_soft("GET", f"{self.url}/tour/runs?limit=1", timeout=3) or {}).get("runs") or []
                if runs and iso_to_s(runs[0].get("startedAt") or "1970-01-01T00:00:00Z") >= self._t0 - 5:
                    st["run"] = runs[0]
            except (Exception, SystemExit):  # noqa: BLE001
                pass
        return st

    def _sample(self, force: bool = False) -> None:
        try:
            m = self.read()
        except (Exception, SystemExit):  # noqa: BLE001 -- a missed sample holds the last frame
            return
        run = m.get("run") or {}
        key = json.dumps({"route": (m.get("route") or {}).get("id"), "src": m.get("source"),
                          "id": run.get("runId"), "st": run.get("status"),
                          "disc": run.get("disclosureSpoken"),
                          "legs": [(l.get("status"), (l.get("spoken") or {}).get("said"),
                                    (l.get("demo") or {}).get("status")) for l in run.get("legs") or []],
                          "turns": [(t.get("question"), t.get("answered")) for t in run.get("turns") or []],
                          "pending": (m.get("pending") or {}).get("kind")}, sort_keys=True)
        if force or key != self._last_key:
            self._last_key = key
            self.samples.append((time.time(), m))

    def _run(self) -> None:
        while not self._stop.wait(self.period):
            self._sample()


def _cue_state(m: dict) -> dict:
    """What a visitor cue can wait for, read off one tour sample."""
    run = m.get("run") or {}
    legs = run.get("legs") or []
    running = next((l for l in legs if l.get("status") == "running"), None)
    # `spoken` is written when a leg ENDS (host.ts sets leg.spoken there), so a
    # `said:` cue is about the stop the robot has just finished talking at.
    done = [l for l in legs if l.get("spoken")]
    pending = m.get("pending") or {}
    return {"pending": pending.get("kind"),
            # Identifies THIS question, so two `continue` cues cannot both
            # answer the same one -- and so one cue arming does not mark every
            # later question as already answered (which is what a missing
            # expiresAt did: every window looked like the same `None`).
            "pending_at": pending.get("expiresAt"),
            "run": run.get("runId"), "status": run.get("status"),
            "leg": running.get("stopId") if running else None,
            "leg_index": running.get("index") if running else None,
            "turns": len(run.get("turns") or []),
            "spoken": (done[-1].get("spoken") or {}) if done else {}}


class VisitorScript:
    """Plays the visitor's half of the conversation while the recorder runs.

    A cue is `WHEN:TEXT`, and WHEN is one of

        12            -- 12 s after the recording started
        offer+2       -- 2 s after the robot's offer goes pending
        continue+2    -- 2 s after it asks "shall we go on?"
        stop:2+15     -- 15 s after leg 2 starts (1-based, or a stop id)
        said:2+1      -- 1 s after a stop finished saying 2 talk-track chunks

    A question the robot asks is answered by exactly ONE cue: two `continue+2`
    cues answer two different "shall we go on?"s, never the same one twice.

    Event cues are what makes a take repeatable: a walk that replans twice
    drifts ten seconds against a stopwatch, but "when it gets there" does not.
    Every line goes in as `spoken` -- only a spoken utterance can answer the
    robot's question, which is the point of the flag.
    """

    def __init__(self, cues: list[str], tourlog: "TourLog", agent: str,
                 sim_url: str = SIM_URL, period: float = 0.25, on_fire=None) -> None:
        self.cues = [self.parse(c) for c in cues]
        self.tourlog, self.agent, self.sim_url, self.period = tourlog, agent, sim_url, period
        self.on_fire = on_fire
        self.said: list[dict] = []
        self._answered: set = set()
        self._state: dict = {}
        self._lock = threading.Lock()
        self._read_warned = False
        self._t0 = time.time()
        self._stop = threading.Event()
        self._reader = threading.Thread(target=self._read_loop, daemon=True)
        self._threads: list[threading.Thread] = []

    @staticmethod
    def parse(cue: str) -> dict:
        when, _, text = cue.partition(":")
        if not text:
            raise SystemExit(f"bad cue {cue!r} -- expected WHEN:TEXT")
        if when in ("offer", "continue", "stop", "said"):  # `stop:2+15:text` -- the ref went to text
            ref, _, text = text.partition(":")
            when = f"{when}:{ref}"
        base, _, delay = when.partition("+")
        d = float(delay) if delay else 0.0
        kind, _, ref = base.partition(":")
        KINDS = ("offer", "continue", "stop", "said")
        if kind not in KINDS and not base.replace(".", "", 1).isdigit():
            raise SystemExit(f"bad cue trigger {base!r} "
                             "(seconds | offer | continue | stop:<n|id> | said:<n>)")
        return {"kind": kind if kind in KINDS else "at",
                "ref": ref, "at": float(base) if kind not in KINDS else 0.0,
                "delay": d, "text": text, "armed_at": None, "fired": False}

    def start(self) -> None:
        self._t0 = time.time()
        self._reader.start()
        for cue in self.cues:
            t = threading.Thread(target=self._watch, args=(cue,), daemon=True)
            self._threads.append(t)
            t.start()

    def stop(self) -> None:
        self._stop.set()

    def pending(self) -> int:
        return sum(1 for c in self.cues if not c["fired"])

    def _read_loop(self) -> None:
        """The only thread that talks to the robot about state.

        Every cue watches this cached snapshot instead of polling itself: one
        reader keeps the request rate sane, and a cue that is busy saying
        something cannot stop the others from seeing the next question."""
        last = None
        while not self._stop.wait(self.period):
            try:
                self._state = _cue_state(self.tourlog.read())
            except (Exception, SystemExit) as err:  # noqa: BLE001
                if not self._read_warned:
                    self._read_warned = True
                    print(f"[clip]   ! could not read the visit ({err}) -- retrying")
                continue
            if DEBUG_CUES:
                key = (self._state.get("pending"), self._state.get("status"),
                       self._state.get("leg_index"), self._state.get("turns"))
                if key != last:
                    last = key
                    print(f"[clip]   . state pending={key[0]} run={key[1]} leg={key[2]} turns={key[3]}")

    def _ready(self, cue: dict, st: dict, now: float) -> bool:
        """Is the cue's trigger true right now? (the delay is applied by _watch)"""
        if cue["kind"] == "at":
            return now - self._t0 >= cue["at"]
        if cue["kind"] in ("offer", "continue"):
            # One cue per question: a pending window another cue already took is
            # not offered to this one. Claimed under the lock, because every cue
            # watches on its own thread.
            if st.get("pending") != cue["kind"]:
                return False
            with self._lock:
                if st.get("pending_at") in self._answered:
                    return False
                self._answered.add(st.get("pending_at"))
                return True
        if cue["kind"] == "stop":
            ref = cue["ref"]
            if ref.isdigit():
                return st.get("leg_index") == int(ref) - 1
            return st.get("leg") == ref
        if cue["kind"] == "said":
            return int((st.get("spoken") or {}).get("said") or 0) >= int(cue["ref"])
        return False

    def _watch(self, cue: dict) -> None:
        """One cue, one thread: wait for its trigger, wait out its delay, speak.

        A thread per cue because saying something is SLOW -- `POST /command`
        does not answer until the robot has answered the visitor (an Ollama call
        plus the utterance, 20-40 s). One shared loop meant the "shall we go on?"
        that landed inside that window went unanswered, and the visit was
        recorded as "nobody answered -- the visitor had left" about somebody who
        was standing right there, mid-sentence."""
        armed_at = None
        while not self._stop.wait(self.period):
            st = self._state
            now = time.time()
            if armed_at is None:
                if not self._ready(cue, st, now):
                    continue
                armed_at = now
                cue["armed_at"] = armed_at
                print(f"[clip]   (cue armed: {cue['kind']}"
                      f"{'/' + cue['ref'] if cue['ref'] else ''} +{cue['delay']:g}s"
                      f" -> {cue['text'][:40]})")
            if now - armed_at >= cue["delay"]:
                self._fire(cue)
                return

    def _fire(self, cue: dict) -> None:
        cue["fired"] = True
        if self.on_fire is not None:
            self.on_fire(cue)
            return
        t0 = time.time()
        try:
            res = http("POST", f"{self.agent}/command", {"text": cue["text"], "spoken": True}, timeout=90)
        except (Exception, SystemExit) as err:  # noqa: BLE001
            res = {"error": str(err)}
        self.said.append({"t": t0, "text": cue["text"], "response": res})
        print(f"[clip]   visitor: {cue['text']}  -> "
              f"{res.get('outcome') or res.get('message') or res.get('accepted')}"
              f" ({time.time() - t0:.0f}s)")


class PersonFollower:
    """Walks the sim's mocap `person` along with the robot -- a visitor who
    follows the tour instead of standing at the door.

    Kept behind AND to one side: further back than `TOUR_MIN_PERSON_M` so a
    safety stop is never the reason a take ends, and off the centre line
    because the chase camera sits directly behind the robot -- a visitor
    exactly behind it fills the lens instead of appearing in the shot."""

    def __init__(self, sim_url: str, agent_url: str, distance: float = 1.5,
                 side: float = 1.2, period: float = 0.4, body: str = "person",
                 gate=None) -> None:
        self.sim_url, self.agent_url = sim_url, agent_url
        self.distance, self.side, self.period, self.body = distance, side, period, body
        # Following is only right once the visit is under way. Before that the
        # visitor has to stand where the robot can SEE them -- a follower that
        # starts at t=0 parks them behind the robot's back and the greeting the
        # take is about never happens.
        self.gate = gate
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True)

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    def place(self, ahead: float | None = None) -> None:
        """Put the visitor `ahead` metres in FRONT of the robot (default: behind
        and to the side, where the camera can see them)."""
        import math
        odom = http_soft("GET", f"{self.sim_url}/loco/odom", timeout=2)
        if odom is None:
            return
        p = odom.get("pose") or odom
        x, y = float(p.get("x", 0.0)), float(p.get("y", 0.0))
        yaw = float(p.get("yaw", p.get("yawDeg", 0.0)))
        if abs(yaw) > 6.3:  # degrees, not radians
            yaw = math.radians(yaw)
        d = ahead if ahead is not None else -self.distance
        side = 0.0 if ahead is not None else self.side
        px = x + d * math.cos(yaw) - side * math.sin(yaw)
        py = y + d * math.sin(yaw) + side * math.cos(yaw)
        http_soft("POST", f"{self.sim_url}/sim/reset-pose",
                  {"body": self.body, "x": px, "y": py,
                   "yaw": yaw + (0.0 if d < 0 else math.pi)}, timeout=3)

    def _run(self) -> None:
        while not self._stop.wait(self.period):
            if self.gate is not None and not self.gate():
                continue
            self.place()


def _fetch_jpeg(url: str) -> "bytes | None":
    try:
        with urllib.request.urlopen(urllib.request.Request(url), timeout=3) as r:
            return r.read()
    except Exception:  # noqa: BLE001
        return None


def render_patrol_pane_frames(samples: list[tuple[float, dict]], video_t, seconds: float, fps: int,
                              size: tuple[int, int], workdir: pathlib.Path,
                              agent_mode_url: str) -> pathlib.Path | None:
    """PNG sequence of the patrol pane (TASK-212): the run's legs as one line
    each, and — once a finding with a stored photo exists — the baseline and
    current control photos side by side under the finding's summary."""
    import io
    from PIL import Image, ImageDraw
    if not samples:
        return None
    W, H = size
    fs, fs_small = 27, 22
    lh = int(fs * 1.3)
    font, small = _font(fs), _font(fs_small)
    pdir = workdir / "patrol"
    pdir.mkdir(parents=True, exist_ok=True)
    stamped = [(video_t(w), m) for w, m in samples]
    stamped = [(t, m) for t, m in stamped if t is not None]
    if not stamped:
        return None
    photos: dict[str, "Image.Image | None"] = {}

    def photo(url: str) -> "Image.Image | None":
        if url not in photos:
            raw = _fetch_jpeg(url)
            photos[url] = Image.open(io.BytesIO(raw)).convert("RGB") if raw else None
        return photos[url]

    def fit(d, text: str, width: int, f) -> str:
        if d.textlength(text, font=f) <= width:
            return text
        while text and d.textlength(text + "…", font=f) > width:
            text = text[:-1]
        return text.rstrip() + "…"

    pad = 30
    n = int(seconds * fps) + 1
    j = 0
    last_key, last_img = None, None
    col_txt, col_dim, col_ok, col_bad, col_run = (236, 238, 242, 255), (150, 158, 172, 255), (124, 255, 178, 255), (255, 107, 107, 255), (255, 209, 102, 255)
    for fi in range(n):
        t = fi / fps
        while j + 1 < len(stamped) and stamped[j + 1][0] <= t:
            j += 1
        m = stamped[j][1]
        key = id(m)
        if key == last_key and last_img is not None:
            last_img.save(pdir / f"{fi:05d}.png")
            continue
        img = Image.new("RGBA", (W, H), (14, 17, 23, 255))
        d = ImageDraw.Draw(img, "RGBA")
        d.line([(0, 0), (W, 0)], fill=(60, 66, 78, 255), width=2)
        run = m.get("run") or {}
        findings = m.get("findings") or []
        head = f"patrol · {run.get('routeName', '')} · {run.get('mode', '')} · {run.get('status', '')}"
        d.text((pad, 10), head, font=small, fill=(140, 150, 165, 255))
        right = f"{len(findings)} finding{'s' if len(findings) != 1 else ''}"
        d.text((W - pad - d.textlength(right, font=small), 10), right, font=small, fill=col_bad if findings else col_dim)
        y = 10 + fs_small + 14
        # Legs: one line each (index, name, status, inspection).
        for leg in (run.get("legs") or [])[:6]:
            st = leg.get("status", "pending")
            col = col_ok if st == "done" else col_bad if st == "failed" else col_run if st == "running" else col_dim
            insp = leg.get("inspection") or ""
            line = f"{leg.get('index', 0) + 1}. {leg.get('name', '')}  {st}" + (f"  · {insp}" if insp else "")
            if leg.get("photoDropped") == "person":
                line += "  · photo not stored (person)"
            d.text((pad, y), fit(d, line, W - 2 * pad, font), font=font, fill=col)
            y += lh
        # The photo pair for the first finding that has a stored current photo.
        shown = next((f for f in findings if (f.get("evidence") or {}).get("currentPhotoKey")), None)
        if shown:
            ev = shown["evidence"]
            y += 6
            d.text((pad, y), fit(d, f"finding: {shown.get('summary', '')}", W - 2 * pad, font), font=font, fill=col_bad)
            y += lh
            cur_key = ev["currentPhotoKey"].split("/")[-1]
            base_key = ev.get("baselinePhotoKey")
            cur = photo(f"{agent_mode_url}/patrol/runs/{shown['runId']}/photos/{cur_key}")
            base = None
            if base_key:
                base_run, _, base_name = base_key.rpartition("/")
                if base_run:
                    base = photo(f"{agent_mode_url}/patrol/runs/{base_run}/photos/{base_name}")
                if base is None and run.get("routeId"):
                    base = photo(f"{agent_mode_url}/patrol/baseline/{run['routeId']}/{run.get('window') or 'default'}/{base_name or cur_key}")
            th = max(60, H - y - 12 - fs_small - 8)
            tw = (W - 3 * pad) // 2
            for k, (im, lab) in enumerate(((base, "baseline"), (cur, "now"))):
                x0 = pad + k * (tw + pad)
                d.text((x0, y), lab, font=small, fill=col_dim)
                box = [x0, y + fs_small + 6, x0 + tw, y + fs_small + 6 + th]
                if im is not None:
                    fitted = im.copy()
                    fitted.thumbnail((tw, th))
                    img.paste(fitted, (box[0], box[1]))
                else:
                    d.rectangle(box, outline=(60, 66, 78, 255), width=2)
                    d.text((x0 + 12, box[1] + 12), "no photo", font=small, fill=col_dim)
        elif findings:
            d.text((pad, y + 6), fit(d, f"finding: {findings[0].get('summary', '')} (no stored image)", W - 2 * pad, font), font=font, fill=col_bad)
        else:
            d.text((pad, y + 6), "no findings so far", font=font, fill=col_dim)
        img.save(pdir / f"{fi:05d}.png")
        last_key, last_img = key, img
    return pdir / "%05d.png"


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


def burn_patrol_layout(raw: pathlib.Path, out: pathlib.Path, meta: dict, cam_size: tuple[int, int],
                       title: str | None, map_samples: list[tuple[float, dict]],
                       patrol_samples: list[tuple[float, dict]], video_t,
                       map_window: "tuple[float, float, float, float] | None" = None,
                       places: "list[dict] | None" = None) -> None:
    """`--layout patrol` (TASK-212): the robot's camera on top, its map with the
    route's numbered checkpoints and red finding pins in the middle, the run's
    legs and the baseline/current photo pair at the bottom. Same geometry as
    the memory layout, so multi-clip videos line up."""
    cw, ch = cam_size
    W, H = 1080, 1920
    cam_h = int(ch * W / cw)
    band = 96
    pane_h = 520
    map_h = H - cam_h - band - pane_h
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
    blocks = [b for b in meta["blocks"] if b.get("t0") is not None and b["kind"] != "patrol"]
    for i, b in enumerate(blocks):
        t0 = b["t0"]
        t1 = blocks[i + 1]["t0"] if i + 1 < len(blocks) else meta["end_t"]
        color = "#ff6b6b" if b.get("status") == "failed" else "#7CFFB2"
        t1 = min(max(t1, t0 + 0.05), meta["end_t"] - 0.05)
        if t1 <= t0:
            continue
        sheet.add(f"› {wrap(b['caption'], 46)}", fontsize=fs_blk, color=color, y=band_y, t0=t0, t1=t1)
    closing = None
    patrol_block = next((b for b in meta["blocks"] if b["kind"] == "patrol"), None)
    if patrol_block and (patrol_block.get("result") or patrol_block.get("error")):
        closing = patrol_block.get("result") or patrol_block.get("error")
    if closing:
        col = "#7CFFB2" if meta["status"] == "done" else "#ff6b6b"
        sheet.add(wrap(closing, 52), fontsize=32, color=col, y=str(cam_h + 22), t0=meta["end_t"])
    seconds = float(meta["recorder"].get("seconds") or 0) + 1.0
    seqs = []
    rendered = render_map_frames(map_samples, video_t, seconds, 5, (map_w, map_h - 8), workdir,
                                 window=map_window, places=places, patrol_samples=patrol_samples) if map_samples else None
    if rendered:
        seqs.append((rendered[0], 5, (W - map_w) // 2, cam_h + band))
    pane = render_patrol_pane_frames(patrol_samples, video_t, seconds, 5, (W, pane_h), workdir,
                                     f"{AGENT_URL}/api/v1/robots/{ROBOT_ID}/agent-mode") if patrol_samples else None
    if pane:
        seqs.append((pane, 5, 0, H - pane_h))
    subprocess.run(sheet.ffmpeg_args(raw, out, stack=(W, cam_h), extra_seqs=seqs), check=True)
    shutil.rmtree(workdir, ignore_errors=True)


def _draw_tour_overlay(d, px, scale: float, tour: dict, places: list[dict]) -> None:
    """The visit over the map inset (TASK-213): one numbered disc per stop of
    the route -- grey until the robot gets there, amber while it is talking,
    green when the stop is done -- plus a dot where the visitor is standing."""
    run = tour.get("run") or {}
    route = tour.get("route") or {}
    legs = {l.get("stopId"): l for l in run.get("legs") or []}
    COL = {"done": (124, 255, 178, 255), "failed": (255, 107, 107, 255),
           "running": (255, 209, 102, 255), "skipped": (150, 158, 172, 255)}
    fnt = _font(24)
    for i, stop in enumerate(route.get("stops") or []):
        leg = legs.get(stop.get("id")) or {}
        c = (leg["pose"]["x"], leg["pose"]["y"]) if leg.get("pose") else _place_centroid(stop.get("placeId", ""), places)
        if not c:
            continue
        X, Y = px(*c)
        col = COL.get(leg.get("status"), (150, 158, 172, 200))
        d.ellipse([X - 16, Y - 16, X + 16, Y + 16], fill=(18, 21, 27, 230), outline=col, width=3)
        lab = str(i + 1)
        d.text((X - d.textlength(lab, font=fnt) / 2, Y - 14), lab, font=fnt, fill=col)


def _wrap_px(d, text: str, font, width: int, max_lines: int = 3) -> list[str]:
    """Word-wrap to a pixel width; the last line is ellipsised rather than dropped."""
    words, lines, cur = text.split(), [], ""
    for w in words:
        trial = f"{cur} {w}".strip()
        if d.textlength(trial, font=font) <= width or not cur:
            cur = trial
        else:
            lines.append(cur)
            cur = w
            if len(lines) == max_lines:
                break
    if len(lines) < max_lines and cur:
        lines.append(cur)
    if len(lines) == max_lines and (len(" ".join(lines)) < len(text.strip())):
        last = lines[-1]
        while last and d.textlength(last + "…", font=font) > width:
            last = last[:-1]
        lines[-1] = last.rstrip() + "…"
    return lines


# What the run says about a turn -> what the pane shows the viewer. The wording
# is the honest one: `declined` is the robot saying it does not know, which is a
# feature and is labelled as one.
TURN_LABEL = {
    "grounded": ("answered from the operator's facts", (124, 255, 178, 255)),
    "from_camera": ("answered from what it sees", (120, 210, 255, 255)),
    "declined": ("said it does not know", (255, 209, 102, 255)),
    "unanswered": ("not answered", (150, 158, 172, 255)),
}


def render_tour_pane_frames(samples: list[tuple[float, dict]], video_t, seconds: float, fps: int,
                            size: tuple[int, int], workdir: pathlib.Path) -> pathlib.Path | None:
    """PNG sequence of the visit pane (TASK-213): the route's stops with the
    live state of each leg, the Art. 50 disclosure flag, and the visitor's
    questions with what the robot answered and where the answer came from."""
    from PIL import Image, ImageDraw
    if not samples:
        return None
    W, H = size
    stamped = [(video_t(w), m) for w, m in samples]
    stamped = [(t, m) for t, m in stamped if t is not None]
    if not stamped:
        return None
    pdir = workdir / "tour"
    pdir.mkdir(parents=True, exist_ok=True)
    f_head, f_stop, f_small, f_q = _font(21), _font(26), _font(19), _font(22)
    pad = 26
    inner = W - 2 * pad
    col_txt, col_dim = (236, 238, 242, 255), (150, 158, 172, 255)
    col_ok, col_warn, col_bad = (124, 255, 178, 255), (255, 209, 102, 255), (255, 107, 107, 255)
    STATUS = {"done": col_ok, "running": col_warn, "failed": col_bad, "aborted": col_bad,
              "declined": col_dim, "abandoned": col_dim, "skipped": col_dim}
    n = int(seconds * fps) + 1
    j = 0
    last_key, last_img = None, None
    for fi in range(n):
        t = fi / fps
        while j + 1 < len(stamped) and stamped[j + 1][0] <= t:
            j += 1
        m = stamped[j][1]
        key = id(m)
        if key == last_key and last_img is not None:
            last_img.save(pdir / f"{fi:05d}.png")
            continue
        img = Image.new("RGBA", (W, H), (12, 15, 20, 224))
        d = ImageDraw.Draw(img, "RGBA")
        d.line([(0, 0), (0, H)], fill=(60, 66, 78, 255), width=2)
        run = m.get("run") or {}
        route = m.get("route") or {}
        pending = (m.get("pending") or {}).get("kind")
        y = pad
        d.text((pad, y), "HOST MODE — the visit", font=f_head, fill=(90, 150, 255, 255))
        y += 30
        d.text((pad, y), _wrap_px(d, route.get("name") or "no route bound", f_stop, inner, 1)[0],
               font=f_stop, fill=col_txt)
        y += 36
        origin = {"visitor": "started by the visitor", "operator": "started by an operator",
                  "schedule": "started on a schedule", "self": "started by the robot"}.get(run.get("origin"), "")
        state = run.get("status") or ("offer open — waiting for an answer" if pending == "offer" else "idle")
        d.text((pad, y), f"{state}   {origin}".strip(), font=f_small,
               fill=STATUS.get(run.get("status"), col_dim))
        y += 28
        if run:
            disclosed = run.get("disclosureSpoken") is True
            col = col_ok if disclosed else col_dim
            if disclosed:
                # Drawn, not typed: the stock UI fonts here have no U+2713 and a
                # tofu box next to a compliance claim reads worse than no mark.
                d.line([(pad + 2, y + 12), (pad + 7, y + 18), (pad + 17, y + 5)], fill=col, width=3)
            else:
                d.ellipse([pad + 5, y + 9, pad + 11, y + 15], outline=col, width=2)
            d.text((pad + 26, y), ("told the visitor it is an AI" if disclosed
                                   else "disclosure not spoken (no voice service)"),
                   font=f_small, fill=col)
        y += 30
        d.line([(pad, y), (W - pad, y)], fill=(48, 54, 64, 255), width=1)
        y += 14

        legs = {l.get("stopId"): l for l in run.get("legs") or []}
        for i, stop in enumerate(route.get("stops") or []):
            leg = legs.get(stop.get("id")) or {}
            st = leg.get("status", "pending")
            col = STATUS.get(st, col_dim)
            d.ellipse([pad, y + 3, pad + 22, y + 25], outline=col, width=2)
            d.text((pad + 8, y + 4), str(i + 1), font=f_small, fill=col)
            d.text((pad + 34, y), _wrap_px(d, stop.get("headline") or "", f_q, inner - 34, 1)[0],
                   font=f_q, fill=col_txt if st != "pending" else col_dim)
            y += 28
            bits = []
            spoken = leg.get("spoken") or {}
            if spoken.get("of"):
                bits.append(f"said {spoken.get('said', 0)} of {spoken['of']}")
            demo = leg.get("demo") or stop.get("demo")
            if demo:
                mode = (leg.get("demo") or {}).get("mode") or "narrate"
                dstat = (leg.get("demo") or {}).get("status")
                bits.append(f"demo: {demo.get('skillName') or demo.get('skillId')}"
                            + (" — described only" if mode == "narrate" else "")
                            + (f" ({dstat})" if dstat and mode != "narrate" else ""))
            if st == "pending":
                bits = bits or ["not there yet"]
            line = " · ".join(bits)
            if line:
                for ln in _wrap_px(d, line, f_small, inner - 34, 2):
                    d.text((pad + 34, y), ln, font=f_small, fill=col_dim)
                    y += 22
            y += 8
        y += 6
        d.line([(pad, y), (W - pad, y)], fill=(48, 54, 64, 255), width=1)
        y += 14
        turns = run.get("turns") or []
        head = f"the visitor asked  ({len(turns)})" if turns else "the visitor asked"
        d.text((pad, y), head, font=f_head, fill=col_dim)
        y += 30
        if not turns:
            d.text((pad, y), "— nothing yet —", font=f_small, fill=(90, 98, 112, 255))
        # Newest last, oldest dropped when the pane runs out of room.
        budget = H - pad - y
        drawn: list = []
        for turn in reversed(turns):
            q = _wrap_px(d, "„" + (turn.get("question") or "…") + "“", f_q, inner, 2)
            a = _wrap_px(d, turn.get("answer") or "", f_small, inner - 14, 4)
            label, col = TURN_LABEL.get(turn.get("answered"), ("", col_dim))
            need = len(q) * 26 + len(a) * 22 + 24 + 14
            if need > budget:
                break
            budget -= need
            drawn.insert(0, (q, a, label, col))
        for q, a, label, col in drawn:
            for ln in q:
                d.text((pad, y), ln, font=f_q, fill=col_txt)
                y += 26
            for ln in a:
                d.text((pad + 14, y), ln, font=f_small, fill=col)
                y += 22
            d.text((pad + 14, y), label, font=f_small, fill=col)
            y += 24 + 14
        img.save(pdir / f"{fi:05d}.png")
        last_key, last_img = key, img
    return pdir / "%05d.png"


def burn_tour_layout(raw: pathlib.Path, out: pathlib.Path, meta: dict, cam_size: tuple[int, int],
                     title: str | None, map_samples: list[tuple[float, dict]],
                     tour_samples: list[tuple[float, dict]], video_t,
                     map_window: "tuple[float, float, float, float] | None" = None,
                     places: "list[dict] | None" = None) -> None:
    """`--layout tour` (TASK-213): the scene camera as the canvas, the visit
    pane down the right-hand side, the robot's map bottom-left, and what the
    robot SAYS as subtitles -- the talk track and the answers are the feature,
    so they are read off the blocks' own params rather than paraphrased."""
    W, H = cam_size
    pane_w = int(W * 0.35)
    workdir = out.parent / f".{out.stem}-captions"
    workdir.mkdir(parents=True, exist_ok=True)
    sheet = CaptionSheet((W, H), workdir)
    sheet.pad = 28
    seconds = float(meta["recorder"].get("seconds") or 0) + 1.0
    fs_title, fs_sub = int(W * 0.021), int(W * 0.024)
    wrap_w = int((W - pane_w) / (fs_sub * 0.52))
    if title:
        sheet.add(title, fontsize=fs_title, color="#ffffffd9", y="top")

    # Subtitles: every utterance the robot actually handed to the voice service,
    # for as long as the block that said it ran.
    SPEECH = ("greet", "speak", "present", "ask")
    # `t0_wall < 0` is a block from the plan that was already on the status
    # endpoint when the take started -- the PREVIOUS visit. It maps to video
    # second 0 and would open the clip with someone else's sentence.
    said = [b for b in meta["blocks"]
            if b["kind"] in SPEECH and b.get("t0") is not None
            and (b.get("t0_wall") is None or b["t0_wall"] >= 0)
            and (b.get("params") or {}).get("text")]
    for i, b in enumerate(said):
        text = str(b["params"]["text"])
        # The caption follows the SENTENCE, not the block. The voice client
        # gives up on a long utterance after 10 s and the block finishes while
        # the visitor is still being spoken to; a caption that ends there leaves
        # the robot talking to an empty screen. ~14 chars/s is the same rate the
        # runner chunks talk tracks with.
        spoken_until = b["t0"] + max(2.5, len(text) / 14.0)
        t1 = max(b.get("t1") or 0.0, spoken_until)
        nxt = said[i + 1]["t0"] if i + 1 < len(said) else None
        if nxt is not None:
            t1 = min(t1, max(nxt - 0.1, b["t0"] + 1.2))
        colour = "#8ec9ff" if (b.get("params") or {}).get("disclosure") else "#ffffff"
        t1 = max(t1, b["t0"] + 1.2)
        # A greeting is three sentences long, and dropping the tail would drop
        # the OFFER -- so a long line is paged four lines at a time, each page
        # holding for its share of the utterance.
        lines = wrap_lines(text, wrap_w)
        pages = [lines[i:i + 4] for i in range(0, len(lines), 4)]
        span, cursor = t1 - b["t0"], b["t0"]
        weight = sum(len(" ".join(pg)) for pg in pages) or 1
        for pg in pages:
            share = span * len(" ".join(pg)) / weight
            sheet.add("\n".join(pg), fontsize=fs_sub, color=colour, y="bottom",
                      t0=cursor, t1=cursor + share)
            cursor += share

    seqs = []
    # Top-right of the camera area: the bottom-left corner is where the robot's
    # own words go, and a subtitle over the map hides both.
    map_h = int(H * 0.34)
    rendered = render_map_frames(map_samples, video_t, seconds, 5, (map_h, map_h), workdir,
                                 window=map_window, places=places,
                                 tour_samples=tour_samples) if map_samples else None
    if rendered:
        seqs.append((rendered[0], 5, W - pane_w - map_h - 24, 24))
    pane = render_tour_pane_frames(tour_samples, video_t, seconds, 5, (pane_w, H), workdir)
    if pane:
        seqs.append((pane, 5, W - pane_w, 0))
    subprocess.run(sheet.ffmpeg_args(raw, out, extra_seqs=seqs), check=True)
    shutil.rmtree(workdir, ignore_errors=True)


def burn_captions(raw: pathlib.Path, out: pathlib.Path, meta: dict, size: tuple[int, int],
                  title: str | None, pip: pathlib.Path | None = None,
                  map_samples: list[tuple[float, dict]] | None = None, clock: "SimClock | None" = None,
                  layout: str = "inset", mem_samples: list[tuple[float, dict]] | None = None,
                  map_window: "tuple[float, float, float, float] | None" = None,
                  places: "list[dict] | None" = None,
                  patrol_samples: "list[tuple[float, dict]] | None" = None,
                  tour_samples: "list[tuple[float, dict]] | None" = None) -> None:
    video_t = clock.video_t if clock else (lambda w: w)
    if layout == "stack":
        burn_stacked(raw, out, meta, size, title, map_samples or [], video_t)
        return
    if layout == "patrol":
        burn_patrol_layout(raw, out, meta, size, title, map_samples or [], patrol_samples or [], video_t,
                           map_window=map_window, places=places)
        return
    if layout == "tour":
        burn_tour_layout(raw, out, meta, size, title, map_samples or [], tour_samples or [], video_t,
                         map_window=map_window, places=places)
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

    # Closing caption: the one line that says what happened. A `goto`'s own
    # report outranks everything else -- "Arrived in Dock 1 after 12 stages and
    # 18.17 m" IS the result of "go to dock 1", while the look it ran on arrival
    # only describes the wall in front of it. Then what the robot SAID last, for
    # a plan that was a question. `outcome` is the last resort and is skipped
    # when it is the bare word "done": a caption that says "done" over a frame
    # of a robot standing still tells the viewer nothing. `burn_stacked` has
    # ranked these the same way since the stack layout existed; the inset layout
    # closing on "done" after an 18 m walk is what showed the difference.
    last_goto = next((b for b in reversed(meta["blocks"])
                      if b["kind"] == "goto" and (b.get("result") or "").strip()), None)
    last_said = next((spoken_text(b.get("result")) for b in reversed(meta["blocks"])
                      if spoken_text(b.get("result"))), None)
    closing, col = None, "#7CFFB2" if meta["status"] == "done" else "#ff6b6b"
    if last_goto:
        closing = last_goto["result"].split(" — ")[0].strip()
    elif meta["status"] == "done" and last_said:
        closing, col = f'"{last_said}"', "#ffffff"
    elif (meta.get("outcome") or "").strip().lower() not in ("", "done"):
        closing = meta["outcome"]
    if closing:
        sheet.add(wrap(closing, wrap_w), fontsize=fs_blk, color=col, y="bottom",
                  t0=meta["end_t"])

    # ── The inset band ──────────────────────────────────────────────────────
    # The eye view (4:3) and the map (square) hang from ONE label row, and that
    # row has to clear the command box above it. Letting each inset place its
    # own label just above its own top edge does not work: the square map
    # starts higher than the 4:3 pip, so with a --title set "the robot's map"
    # landed straight ON the command line. Measured at 1600x900 with a 35 px
    # title: command plate 143-230, map label plate 172-239 -- a full overlap,
    # and both are left aligned at the same pad, so neither was readable.
    #
    # So: one label row, placed under whatever the command block actually
    # occupies (it wraps, so this is measured, not assumed), both insets hung
    # below it, and the map shrunk if that would push it into the caption band
    # at the bottom. The map is the one that gives way because it is square and
    # scales down without losing its subject; the eye view is real footage.
    bx, plate = 18, 6                       # CaptionSheet's own plate padding
    base_inset = int(w * (0.42 if vertical else 0.24))
    pip_h = int(base_inset * 3 / 4)
    label_fs = int(fs_title * 0.9)
    label_h = label_fs + 2 * bx + plate
    cmd_lines = len(wrap(f"> {meta['command']}", wrap_w).split("\n"))
    cmd_y0 = sheet.pad + (fs_title + 46 if title else 0)
    cmd_bottom = cmd_y0 + (fs_cmd + int(fs_cmd * 0.35)) * cmd_lines - int(fs_cmd * 0.35) + bx
    label_y = max(h - sheet.pad - pip_h - int(h * 0.21) - label_h, cmd_bottom + 14)
    inset_y = label_y + label_h
    # Lowest an inset may reach before it fouls the block caption at the bottom.
    # The caption's plate starts one bx above its text, so that padding counts
    # twice here -- once for the caption, once to leave a visible gap.
    band_top = h - sheet.pad - fs_blk - 3 * bx - int(h * 0.06) - 10

    pip_w = 0
    if pip is not None and pip.exists():
        # "what the robot sees", on the right. Both streams started within a few
        # ms of each other but drop frames independently -- so the pip is re-cut
        # onto the main timeline when the clock saw both recorders.
        if clock is not None and clock.has("pip") and clock.has("main"):
            pip = retime_pip(pip, clock, 15, float(meta["recorder"].get("seconds") or 0) + 1.0, workdir)
        pip_w = min(base_inset, max(160, int((band_top - inset_y) * 4 / 3)))
        sheet.pip_y = inset_y
        sheet.add("robot's eye view", fontsize=label_fs, color="#ffffffcc",
                  y=str(label_y), x_right=True)
    map_seq = None
    if map_samples:
        # "the robot's map" inset, on the left -- grid, keepouts (amber), peers
        # (orange), the planned route (cobalt).
        inset = min(base_inset, max(160, band_top - inset_y))
        sheet.add("the robot's map", fontsize=label_fs, color="#ffffffcc", y=str(label_y))
        rendered = render_map_frames(map_samples, video_t, float(meta["recorder"].get("seconds") or 0) + 1.0,
                                     5, inset, workdir)
        if rendered:
            map_seq = (rendered[0], 5, sheet.pad, inset_y)
    subprocess.run(sheet.ffmpeg_args(raw, out, pip=pip, pip_w=pip_w,
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


def mix_voice(out: pathlib.Path, voicelog: pathlib.Path, rec_t0: float, wall_seconds: float,
              clock: "SimClock | None" = None) -> int:
    """Lay the utterances the voice service actually spoke onto the clip's audio
    track, each at the moment it was said.

    The sim recorder writes video only and the robot's speech happens in a
    different process -- but `say_service.py` logs every line with its wall
    clock and its duration, so the two go back together exactly rather than
    being lip-synced by hand. The clip is a time-COMPRESSED rendering of the
    wall clock whenever the sim falls behind 30 fps (see SimClock), so each
    utterance is placed in VIDEO seconds and stretched by the same factor the
    picture was -- otherwise the voice drifts ahead of the robot saying it.

    Returns how many utterances landed in the clip."""
    if not voicelog.exists():
        return 0
    recs = [json.loads(ln) for ln in voicelog.read_text().splitlines() if ln.strip()]
    recs = [r for r in recs if rec_t0 - 0.5 <= r["wall"] <= rec_t0 + wall_seconds]
    if not recs:
        return 0
    vdir = voicelog.parent
    args = [shutil.which("ffmpeg") or "ffmpeg", "-loglevel", "error", "-y", "-i", str(out)]
    chain = []
    for i, r in enumerate(recs):
        args += ["-i", str(vdir / r["file"])]
        dur = float(r.get("seconds") or 0.0)
        if clock is not None:
            t0 = clock.video_t(r["wall"]) or 0.0
            t1 = clock.video_t(r["wall"] + dur) if dur else None
        else:
            t0, t1 = r["wall"] - rec_t0, (r["wall"] - rec_t0 + dur if dur else None)
        tempo = dur / (t1 - t0) if (dur and t1 is not None and t1 - t0 > 0.05) else 1.0
        tempo = max(0.5, min(2.0, tempo))
        f = f"[{i + 1}:a]"
        if abs(tempo - 1.0) > 0.03:
            f += f"atempo={tempo:.3f},"
        delay = int(max(0.0, t0) * 1000)
        f += (f"adelay={delay}|{delay},"
              f"aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[a{i}]")
        chain.append(f)
    chain.append("".join(f"[a{i}]" for i in range(len(recs)))
                 + f"amix=inputs={len(recs)}:normalize=0:dropout_transition=0[aout]")
    tmp = out.with_suffix(".voiced.mp4")
    args += ["-filter_complex", ";".join(chain), "-map", "0:v", "-map", "[aout]",
             "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-shortest",
             "-movflags", "+faststart", str(tmp)]
    subprocess.run(args, check=True)
    tmp.replace(out)
    return len(recs)


def poll_tour(agent: str, tourlog: "TourLog", scripts: list, timeout: float,
              grace: float = 8.0, min_seconds: float = 0.0,
              ignore_plan: "str | None" = None) -> list[dict]:
    """Record a whole visit rather than one plan (TASK-213).

    Host mode is not a single plan: the greeting is one, the tour another, and
    every question the visitor asks runs a third. So the take ends when the
    CONVERSATION does -- every cue played, nothing planning or running, and the
    run (if one started) in a terminal state -- and every plan seen on the way
    is kept, in order, because the subtitles are read off their blocks."""
    plans: dict[str, dict] = {}
    order: list[str] = []
    started = time.time()
    deadline = started + timeout
    quiet_since: float | None = None
    TERMINAL = ("done", "declined", "abandoned", "aborted", "failed", "skipped")
    while time.time() < deadline:
        st = http_soft("GET", agent, timeout=5)
        if st is None:
            time.sleep(0.3)
            continue
        plan = st.get("plan")
        if plan and plan.get("id") == ignore_plan:
            plan = None  # the plan that was already there when we started rolling
        if plan and plan.get("id"):
            if plan["id"] not in plans:
                order.append(plan["id"])
                print(f"[clip]   plan: {plan.get('command')}")
            plans[plan["id"]] = plan
        busy = bool(plan and plan.get("status") in ("planning", "running"))
        tour = tourlog.latest()
        run = tour.get("run") or {}
        cues_left = sum(sc.pending() for sc in scripts)
        # `min_seconds` is why a listening take does not end before the robot
        # has had a chance to notice anybody: nothing running and nothing
        # pending is also what "it has not looked yet" looks like.
        settled = (time.time() - started >= min_seconds
                   and not busy and not tour.get("pending") and cues_left == 0
                   and (not run or run.get("status") in TERMINAL))
        if settled:
            quiet_since = quiet_since if quiet_since is not None else time.time()
            if time.time() - quiet_since >= grace:
                break
        else:
            quiet_since = None
        time.sleep(0.3)
    else:
        print("[clip] timed out waiting for the visit", file=sys.stderr)
    return [plans[i] for i in order]


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
    pl = out.with_suffix(".patrollog.json")
    patrol_samples = [(t, m) for t, m in json.loads(pl.read_text())] if pl.exists() else None
    tl = out.with_suffix(".tourlog.json")
    tour_samples = [(t, m) for t, m in json.loads(tl.read_text())] if tl.exists() else None
    burn_captions(raw, out, meta, (w, h), args.title, pip=pip if pip.exists() else None,
                  map_samples=map_samples, clock=clock, layout=args.layout, mem_samples=mem_samples,
                  map_window=parse_window(args.map_window), places=load_places(args.places),
                  patrol_samples=patrol_samples, tour_samples=tour_samples)
    if args.voice_log and meta.get("rec_t0_wall"):
        n = mix_voice(out, pathlib.Path(args.voice_log), float(meta["rec_t0_wall"]),
                      float(meta.get("end_t_wall") or 0) + 12.0, clock=clock)
        print(f"[clip] voice: mixed {n} utterance(s) into {out}")
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
    ap.add_argument("--layout", choices=("inset", "stack", "memory", "patrol", "tour"), default="inset",
                    help="inset: the scene camera with small insets (default). stack: the robot's "
                         "own camera full-width on top, its map below, minimal text -- implies "
                         "--map, and --cam defaults to head_camera at 1080x810. memory: like stack "
                         "with a third pane at the bottom showing the robot's durable memory (place "
                         "notes, MEMORY.md, journal tail) sampled while recording. patrol: camera / "
                         "map with numbered checkpoints + finding pins / baseline-vs-now photo pair "
                         "(TASK-212, needs --patrol-route). tour: the scene camera with the visit "
                         "pane (stops, disclosure, the visitor\'s questions and where each answer "
                         "came from) down the right side and what the robot says as subtitles "
                         "(TASK-213, use with --tour / --tour-listen)")
    ap.add_argument("--patrol-route", default=None, metavar="ROUTE.json",
                    help="start a PATROL run of this route (PatrolRoute JSON: id, name, checkpoints "
                         "[{id, placeId, name, headingDeg?, actions, dwellMs?}], homePlaceId?, timeWindows?) "
                         "instead of a command; the command positional is then optional")
    ap.add_argument("--patrol-mode", choices=("baseline", "patrol"), default="patrol",
                    help="mode of the run started by --patrol-route (default patrol)")
    ap.add_argument("--tour", default=None, metavar="ROUTE_ID|ROUTE.json",
                    help="start a host-mode TOUR (TASK-213) instead of a command: a route id the "
                         "robot can fetch, or a TourRoute JSON file sent inline")
    ap.add_argument("--tour-listen", action="store_true",
                    help="start nothing and record what the robot does by itself -- the greeting "
                         "it gives a visitor who walks up, and the tour if the visitor says yes")
    ap.add_argument("--say", action="append", default=[], metavar="WHEN:TEXT",
                    help="the visitor says TEXT (as speech, so it can answer the robot\'s question). "
                         "WHEN is seconds, `offer+N`, `continue+N`, `stop:<n|id>+N` or "
                         "`said:<n>+N`. Repeatable; two `continue+N` cues answer two different "
                         "\"shall we go on?\"s")
    ap.add_argument("--person", action="append", default=[], metavar="WHEN:X,Y[,YAWDEG]",
                    help="teleport the sim\'s mocap `person` to X,Y at WHEN (same grammar as --say); "
                         "`WHEN:ahead` places them 1.8 m in front of the robot. Repeatable")
    ap.add_argument("--person-follow", action="store_true",
                    help="once the visit is running, keep the visitor walking behind the robot")
    ap.add_argument("--voice-log", default=None, metavar="voicelog.jsonl",
                    help="mix the utterances logged by hardware/voice_sim/say_service.py into the "
                         "clip\'s audio track, each at the moment it was spoken")
    ap.add_argument("--min-seconds", type=float, default=25.0, dest="min_seconds",
                    help="a --tour take never ends before this (default 25) -- the robot needs a "
                         "look or two before it has noticed the visitor at all")
    ap.add_argument("--grace", type=float, default=8.0,
                    help="seconds of nothing-happening that end a --tour take (default 8)")
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
    patrol_route = None
    if args.patrol_route:
        patrol_route = json.loads(pathlib.Path(args.patrol_route).read_text())
        if not patrol_route.get("id") or not patrol_route.get("checkpoints"):
            ap.error("--patrol-route needs a PatrolRoute JSON with id and checkpoints")
        patrol_route.setdefault("name", patrol_route["id"])
        # The plan the runner creates is named after the route; poll_plan matches on it.
        args.command = f"patrol: {patrol_route['name']}"
    elif args.layout == "patrol":
        ap.error("--layout patrol needs --patrol-route ROUTE.json")
    tour_route = None
    tour_mode = bool(args.tour or args.tour_listen)
    if args.tour and args.tour_listen:
        ap.error("--tour starts a tour, --tour-listen waits for the visitor to start one -- pick one")
    if tour_mode:
        if args.layout == "inset":
            args.layout = "tour"
        args.map = True
        src = pathlib.Path(args.tour) if args.tour else None
        if src is not None and src.exists():
            tour_route = json.loads(src.read_text())
            if not tour_route.get("id") or not tour_route.get("stops"):
                ap.error("--tour ROUTE.json needs a TourRoute with id and stops")
        args.command = args.command or ("(idle) a visitor appeared" if args.tour_listen else "tour")
    elif args.layout == "tour":
        ap.error("--layout tour needs --tour ROUTE or --tour-listen")
    if not args.command:
        ap.error("command is required (or use --card / --concat / --recaption / --patrol-route)")
    if args.layout in ("stack", "memory", "patrol"):
        args.map = True
        if args.cam == "follow":
            args.cam = "head_camera"
        if args.size == "1080x1920":
            # The memory layout renders the head camera wider (5:3): the MJCF
            # camera keeps its vertical FOV, so a wider frame simply sees more
            # to the sides -- and leaves room for the map and the memory pane.
            args.size = "1080x648" if args.layout in ("memory", "patrol") else "1080x810"
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
    patrollog = PatrolLog(agent) if patrol_route else None
    if patrollog:
        patrollog.start()
    tourlog = TourLog(agent) if tour_mode else None
    if tourlog:
        tourlog.start()
    rec_t0 = clock.wall0 or time.time()
    time.sleep(args.lead)

    print(f"[clip] > {args.command}")
    cmd_t = time.time()
    if tour_mode:
        def _may_follow() -> bool:
            st_now = tourlog.latest()
            # Not before the visit starts (the greeting needs them in FRONT of
            # the robot), and not while the robot is waiting for an answer --
            # teleporting the person mid-question is how a take ends up with a
            # safety refusal instead of a conversation.
            return ((st_now.get("run") or {}).get("status") == "running"
                    and not st_now.get("pending"))

        follower = PersonFollower(SIM_URL, AGENT_URL, gate=_may_follow) if args.person_follow else None
        scripts = []
        if args.person:
            mover = PersonFollower(SIM_URL, AGENT_URL)

            def move_visitor(cue: dict) -> None:
                where = cue["text"].strip()
                if where in ("ahead", "front"):
                    mover.place(ahead=1.8)
                    print("[clip]   visitor steps in front of the robot")
                    return
                parts = [float(v) for v in where.split(",")]
                body = {"body": "person", "x": parts[0], "y": parts[1],
                        "yaw": (parts[2] * 3.141592653589793 / 180) if len(parts) > 2 else 0.0}
                http("POST", f"{SIM_URL}/sim/reset-pose", body)
                print(f"[clip]   visitor moves to {parts[0]}, {parts[1]}")

            scripts.append(VisitorScript(args.person, tourlog, agent, on_fire=move_visitor))
        if args.say:
            scripts.append(VisitorScript(args.say, tourlog, agent))
        if args.tour:
            body = {"routeId": (tour_route or {}).get("id") or args.tour, "origin": "operator"}
            if tour_route:
                body["route"] = tour_route
            res = http("POST", f"{agent}/tour", body)
            print(f"[clip]   tour: {res.get('message')}")
            if res.get("accepted") is False:
                http("POST", f"{SIM_URL}/record/stop")
                raise SystemExit(f"tour refused: {res}")
        else:
            print("[clip]   listening -- the robot starts this one by itself")
        for sc in scripts:
            sc.start()
        if follower:
            follower.start()
        plans = poll_tour(agent, tourlog, scripts, args.timeout, grace=args.grace,
                          min_seconds=args.min_seconds, ignore_plan=(st.get("plan") or {}).get("id"))
        for sc in scripts:
            sc.stop()
        if follower:
            follower.stop()
        plan = plans[-1] if plans else None
    elif patrol_route:
        res = http("POST", f"{agent}/patrol", {"routeId": patrol_route["id"], "mode": args.patrol_mode,
                                              "origin": "operator", "route": patrol_route})
        if res.get("accepted") is False:
            http("POST", f"{SIM_URL}/record/stop")
            raise SystemExit(f"patrol refused: {res}")
        plan = poll_plan(agent, args.command, args.timeout)
    else:
        res = http("POST", f"{agent}/command", {"text": args.command})
        if res.get("accepted") is False:
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
    if patrollog:
        patrollog.stop()
    if tourlog:
        tourlog.stop()
    stop = http("POST", f"{SIM_URL}/record/stop", timeout=60)
    rec = stop.get("current") or stop.get("last") or {}
    print(f"[clip] recorder: {rec.get('frames')} frames, {rec.get('seconds')} s"
          + (f", ERROR {rec['error']}" if rec.get("error") else ""))

    # A visit runs as several plans (greeting, tour, one per answered
    # question); everything else is one. Both end up as one flat block list in
    # the order the robot actually did them.
    source_plans = (plans if tour_mode else ([plan] if plan else []))
    blocks_meta = []
    for src_plan in source_plans:
        for b in src_plan.get("blocks", []):
            w0 = iso_to_s(b["startedAt"]) if b.get("startedAt") else None
            w1 = iso_to_s(b["finishedAt"]) if b.get("finishedAt") else None
            blocks_meta.append({"kind": b["kind"], "params": b.get("params"), "status": b.get("status"),
                                "caption": block_caption(b), "reasoning": b.get("reasoning"),
                                "result": b.get("result"), "error": b.get("error"),
                                # video seconds (what the overlays are timed in) ...
                                "t0": clock.video_t(w0), "t1": clock.video_t(w1),
                                # ... and wall seconds since recording started, for the record
                                "t0_wall": (w0 - rec_t0) if w0 else None,
                                "t1_wall": (w1 - rec_t0) if w1 else None,
                                "plan": src_plan.get("id"), "command": src_plan.get("command")})
    blocks_meta.sort(key=lambda b: (b["t0_wall"] is None, b["t0_wall"] or 0.0))
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
    tour_run = (tourlog.latest().get("run") or {}) if tourlog else {}
    if tour_mode:
        # The run is the outcome of a visit, not the last plan: a visitor who
        # says goodbye at stop 2 leaves a `done` plan and an ended visit, and a
        # visitor who never answers leaves no plan at all.
        status = tour_run.get("status") or ("abandoned" if tourlog else status)
        outcome = tour_run.get("reason") or (
            f"{sum(1 for l in tour_run.get('legs') or [] if l.get('status') == 'done')}"
            f" of {len(tour_run.get('legs') or [])} stops, "
            f"{len(tour_run.get('turns') or [])} question(s)" if tour_run else outcome)
    meta = {"command": args.command, "status": status, "outcome": outcome,
            "command_t": clock.video_t(cmd_t), "end_t": clock.video_t(end_t),
            "command_t_wall": cmd_t - rec_t0, "end_t_wall": end_t - rec_t0,
            "rec_t0_wall": rec_t0, "sim_clock": clock.samples, "blocks": blocks_meta,
            "plan": plan, "recorder": rec, "cam": args.cam, "size": args.size, "fps": args.fps}
    if tour_mode:
        meta["plans"] = source_plans
        meta["tour"] = {"run": tour_run, "route": (tourlog.latest().get("route") or {}) if tourlog else {},
                        "said": [c for sc in scripts for c in sc.said]}
    # Wall seconds the recorder was open for -- the window mix_voice pulls
    # utterances from (video seconds would miss the tail of a compressed clip).
    end_t_wall_span = (end_t - rec_t0) + args.tail + 5.0
    meta_path = out.with_suffix(".json")
    meta_path.write_text(json.dumps(meta, indent=2))
    if maplog:
        # Big (the grid rides along in every sample) but it is what makes
        # `--recaption` possible without driving the robot again.
        out.with_suffix(".maplog.json").write_text(json.dumps(maplog.samples))
    if memlog:
        out.with_suffix(".memlog.json").write_text(json.dumps(memlog.samples))
    if tourlog:
        out.with_suffix(".tourlog.json").write_text(json.dumps(tourlog.samples))
        legs = tour_run.get("legs") or []
        print(f"[clip] visit {tour_run.get('runId')} {tour_run.get('status')}: "
              f"{sum(1 for l in legs if l.get('status') == 'done')}/{len(legs)} stops, "
              f"{len(tour_run.get('turns') or [])} question(s), "
              f"disclosure {'spoken' if tour_run.get('disclosureSpoken') else 'NOT spoken'}")
    if patrollog:
        out.with_suffix(".patrollog.json").write_text(json.dumps(patrollog.samples))
        last = patrollog.samples[-1][1] if patrollog.samples else {}
        run = last.get("run") or {}
        print(f"[clip] patrol run {run.get('runId')} {run.get('status')}: {len(last.get('findings') or [])} finding(s)")
    print(f"[clip] plan {status}; wrote {meta_path}")

    if not args.no_captions:
        burn_captions(raw, out, meta, (w, h), args.title, pip=pip_raw,
                      map_samples=maplog.samples if maplog else None, clock=clock, layout=args.layout,
                      mem_samples=memlog.samples if memlog else None,
                      map_window=parse_window(args.map_window), places=load_places(args.places),
                      patrol_samples=patrollog.samples if patrollog else None,
                      tour_samples=tourlog.samples if tourlog else None)
        print(f"[clip] captioned -> {out}")
    if args.voice_log:
        n = mix_voice(out, pathlib.Path(args.voice_log), rec_t0, end_t_wall_span, clock=clock)
        print(f"[clip] voice: mixed {n} utterance(s) into {out}")
    return 0 if status == "done" else 1


if __name__ == "__main__":
    sys.exit(main())
