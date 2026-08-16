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
import time
import urllib.error
import urllib.request
from datetime import datetime

SIM_URL = os.environ.get("SIM_URL", "http://localhost:8777")
AGENT_URL = os.environ.get("AGENT_URL", "http://localhost:41246")
ROBOT_ID = os.environ.get("ROBOT_ID", "sim-robot-g1-edu")

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
                    pip_w: int = 0, pip_y: int = 0) -> list[str]:
        args = [shutil.which("ffmpeg") or "ffmpeg", "-loglevel", "error", "-y", "-i", str(raw)]
        for path, _, _ in self.items:
            args += ["-i", str(path)]
        n_cap = len(self.items)
        if pip is not None and pip_w:
            args += ["-i", str(pip)]
        chain, prev = [], "[0:v]"
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


def burn_captions(raw: pathlib.Path, out: pathlib.Path, meta: dict, size: tuple[int, int],
                  title: str | None, pip: pathlib.Path | None = None) -> None:
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
        # tiny label. Both streams started within a few ms of each other.
        pip_w = int(w * (0.42 if vertical else 0.24))
        sheet.add("robot's eye view", fontsize=int(fs_title * 0.9), color="#ffffffcc",
                  y="pip-label", x_right=True, pip_w=pip_w)
    subprocess.run(sheet.ffmpeg_args(raw, out, pip=pip, pip_w=pip_w if pip is not None and pip.exists() else 0,
                                     pip_y=sheet.pip_y), check=True)
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


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command")
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
    args = ap.parse_args()

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
    rec_t0 = time.time()
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
    stop = http("POST", f"{SIM_URL}/record/stop", timeout=60)
    rec = stop.get("current") or stop.get("last") or {}
    print(f"[clip] recorder: {rec.get('frames')} frames, {rec.get('seconds')} s"
          + (f", ERROR {rec['error']}" if rec.get("error") else ""))

    blocks_meta = []
    for b in (plan or {}).get("blocks", []):
        t0 = iso_to_s(b["startedAt"]) - rec_t0 if b.get("startedAt") else None
        t1 = iso_to_s(b["finishedAt"]) - rec_t0 if b.get("finishedAt") else None
        blocks_meta.append({"kind": b["kind"], "params": b.get("params"), "status": b.get("status"),
                            "caption": block_caption(b), "reasoning": b.get("reasoning"),
                            "result": b.get("result"), "error": b.get("error"),
                            "t0": t0, "t1": t1})
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
            "command_t": cmd_t - rec_t0, "end_t": end_t - rec_t0, "blocks": blocks_meta,
            "plan": plan, "recorder": rec, "cam": args.cam, "size": args.size}
    meta_path = out.with_suffix(".json")
    meta_path.write_text(json.dumps(meta, indent=2))
    print(f"[clip] plan {status}; wrote {meta_path}")

    if not args.no_captions:
        burn_captions(raw, out, meta, (w, h), args.title, pip=pip_raw)
        print(f"[clip] captioned -> {out}")
    return 0 if status == "done" else 1


if __name__ == "__main__":
    sys.exit(main())
