"""
cine_recorder.py -- cinematic MP4 recording of the sim, for demo/explainer clips.

Renders a free camera that follows or orbits the robot at a fixed frame rate
and pipes raw RGB frames into ffmpeg. Everything here runs on the PHYSICS
thread (sim_node.run_loop -> Recorder.tick): MuJoCo's Renderer owns a GL
context with thread affinity, and on macOS it must be the main thread.

Camera modes
  follow  behind-the-shoulder chase cam, smoothed so turns do not whip
  orbit   slow orbit around the robot (nice for "look what it is" beauty shots)
  wide    fixed establishing shot of the whole room
  <name>  any camera defined in the MJCF (e.g. head_camera = the robot's POV)

Usage from sim_node.py
  --record out.mp4 [--record-fps 30] [--record-size 1080x1920] [--record-cam follow]
or at runtime over the HTTP facade
  POST /record/start {"path": "clip.mp4", "cam": "orbit", "size": "1920x1080"}
  POST /record/stop
  GET  /record  -> status
"""

from __future__ import annotations

import math
import shutil
import subprocess
import threading
import time
from dataclasses import dataclass, field

import mujoco
import numpy as np

CAMERA_MODES = ("follow", "orbit", "wide")


def _lerp_angle(a: float, b: float, t: float) -> float:
    d = (b - a + math.pi) % (2 * math.pi) - math.pi
    return a + d * t


@dataclass
class RecorderConfig:
    path: str
    fps: int = 30
    width: int = 1080
    height: int = 1920
    cam: str = "follow"
    # follow-cam geometry
    distance: float = 3.2
    elevation_deg: float = -18.0
    lookat_z: float = 0.9
    # orbit
    orbit_period_s: float = 24.0
    smoothing: float = 0.06  # per-frame lerp toward the target pose
    # Shadows cost a full extra pass per shadow-casting light; a small
    # picture-in-picture inset can go without.
    shadows: bool = True


@dataclass
class Recorder:
    """One MP4 in flight. Create, then call tick(node) every physics iteration."""

    cfg: RecorderConfig
    started_at: float = field(default_factory=time.time)
    frames: int = 0
    error: str | None = None
    _proc: subprocess.Popen | None = None
    _renderer: mujoco.Renderer | None = None
    _cam: mujoco.MjvCamera | None = None
    _next_frame_t: float | None = None
    _az: float | None = None
    _lookat: np.ndarray | None = None
    _closed: bool = False     # close() entered: no more frames
    _finished: bool = False   # ffmpeg has exited and the file is complete
    _bounds: tuple[float, float, float, float] | None = None  # xmin, xmax, ymin, ymax

    # ------------------------------------------------------------ lifecycle
    def _open(self, model: mujoco.MjModel) -> None:
        ffmpeg = shutil.which("ffmpeg")
        if ffmpeg is None:
            raise RuntimeError("ffmpeg not found on PATH")
        w, h = self.cfg.width, self.cfg.height
        # Offscreen buffer must be at least the requested size.
        vg = model.vis.global_
        if vg.offwidth < w or vg.offheight < h:
            vg.offwidth = max(vg.offwidth, w)
            vg.offheight = max(vg.offheight, h)
        self._renderer = mujoco.Renderer(model, h, w)
        self._bounds = _room_bounds(model)
        self._cam = mujoco.MjvCamera()
        cam_id = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_CAMERA, self.cfg.cam)
        if self.cfg.cam in CAMERA_MODES:
            self._cam.type = mujoco.mjtCamera.mjCAMERA_FREE
        elif cam_id >= 0:
            self._cam.type = mujoco.mjtCamera.mjCAMERA_FIXED
            self._cam.fixedcamid = cam_id
        else:
            raise KeyError(f"unknown camera mode/name '{self.cfg.cam}' "
                           f"(modes: {', '.join(CAMERA_MODES)})")
        self._proc = subprocess.Popen(
            [ffmpeg, "-loglevel", "error", "-y",
             "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{w}x{h}",
             "-r", str(self.cfg.fps), "-i", "-",
             "-an", "-c:v", "libx264", "-preset", "fast", "-crf", "18",
             "-pix_fmt", "yuv420p", "-movflags", "+faststart", self.cfg.path],
            stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
        )

    def close(self) -> dict:
        if self._closed:
            return self.status()
        self._closed = True
        if self._proc is not None and self._proc.stdin is not None:
            try:
                self._proc.stdin.close()
            except BrokenPipeError:
                pass
            try:
                rc = self._proc.wait(timeout=30)
                err = self._proc.stderr.read() if self._proc.stderr else b""
                if rc != 0 and not self.error:
                    self.error = f"ffmpeg exit {rc}: {err.decode(errors='replace')[-400:]}"
            except subprocess.TimeoutExpired:
                self._proc.kill()
                self.error = self.error or "ffmpeg did not finish in 30 s"
        if self._renderer is not None:
            self._renderer.close()
            self._renderer = None
        self._finished = True
        return self.status()

    def status(self) -> dict:
        return {
            "path": self.cfg.path, "cam": self.cfg.cam, "fps": self.cfg.fps,
            "size": f"{self.cfg.width}x{self.cfg.height}", "frames": self.frames,
            "seconds": round(self.frames / self.cfg.fps, 2),
            "recording": not self._finished, "error": self.error,
        }

    # ------------------------------------------------------------ per frame
    def tick(self, node) -> None:
        """Called from the physics thread between steps. Renders when a frame is due."""
        if self._closed or self.error:
            return
        try:
            if self._renderer is None:
                self._open(node.model)
                self._next_frame_t = float(node.data.time)
            t = float(node.data.time)
            if t + 1e-9 < self._next_frame_t:
                return
            # Emit exactly one frame per period even when the sim caught up
            # several periods at once -- dropping frames keeps the clip real-time.
            while self._next_frame_t <= t:
                self._next_frame_t += 1.0 / self.cfg.fps
            self._aim(node)
            self._renderer.update_scene(node.data, camera=self._cam)
            if not self.cfg.shadows:
                self._renderer.scene.flags[mujoco.mjtRndFlag.mjRND_SHADOW] = 0
                self._renderer.scene.flags[mujoco.mjtRndFlag.mjRND_REFLECTION] = 0
            frame = self._renderer.render()
            assert self._proc is not None and self._proc.stdin is not None
            self._proc.stdin.write(np.ascontiguousarray(frame).tobytes())
            self.frames += 1
        except BrokenPipeError:
            err = b""
            if self._proc is not None and self._proc.stderr is not None:
                err = self._proc.stderr.read()
            self.error = f"ffmpeg pipe closed: {err.decode(errors='replace')[-400:]}"
        except Exception as exc:  # noqa: BLE001 -- a broken clip must never stop the sim
            self.error = f"{type(exc).__name__}: {exc}"

    def _aim(self, node) -> None:
        cam = self._cam
        assert cam is not None
        if cam.type != mujoco.mjtCamera.mjCAMERA_FREE:
            return
        x, y, yaw = node.measured_pose()
        target = np.array([x, y, self.cfg.lookat_z])
        if self._lookat is None:
            self._lookat = target.copy()
        mode = self.cfg.cam
        if mode == "wide":
            cam.lookat[:] = [0.3, 0.0, 0.8]
            cam.distance, cam.azimuth, cam.elevation = 8.5, 225.0, -24.0
            return
        # Both follow and orbit look at the (smoothed) robot.
        self._lookat += (target - self._lookat) * min(1.0, self.cfg.smoothing * 2)
        if mode == "follow":
            # MuJoCo azimuth is the direction the camera LOOKS (camera sits at
            # lookat - distance * forward), so a chase cam behind a robot
            # heading `yaw` looks along `yaw`. Slight offset over the right
            # shoulder so the robot does not hide the way ahead.
            want = yaw - math.radians(20.0)
        else:  # orbit
            want = 2 * math.pi * ((time.time() - self.started_at) / self.cfg.orbit_period_s)
        if self._az is None:
            self._az = want
        self._az = _lerp_angle(self._az, want, self.cfg.smoothing) if mode == "follow" else want
        cam.lookat[:] = self._lookat
        cam.azimuth = math.degrees(self._az)
        cam.elevation = self.cfg.elevation_deg
        cam.distance = self._fit_distance(self.cfg.distance)

    def _fit_distance(self, distance: float) -> float:
        """Shrink the camera distance until the eye is inside the room.

        A 3 m chase/orbit cam behind a robot 1 m from a wall sits OUTSIDE the
        room, and MuJoCo renders the wall's back face -- a blank frame. Walk the
        distance down (never below 1.2 m) until the eye clears the walls by a
        margin.
        """
        if self._bounds is None or self._cam is None:
            return distance
        xmin, xmax, ymin, ymax = self._bounds
        margin = 0.15
        az, el = math.radians(self._cam.azimuth), math.radians(self._cam.elevation)
        # MuJoCo: forward = (cos el cos az, cos el sin az, sin el); eye = lookat - d * forward
        fx, fy = math.cos(el) * math.cos(az), math.cos(el) * math.sin(az)
        lx, ly = float(self._cam.lookat[0]), float(self._cam.lookat[1])
        d = distance
        while d > 1.2:
            ex, ey = lx - d * fx, ly - d * fy
            if xmin + margin < ex < xmax - margin and ymin + margin < ey < ymax - margin:
                break
            d -= 0.1
        return max(d, 1.2)


def _room_bounds(model: mujoco.MjModel) -> tuple[float, float, float, float] | None:
    """Inner x/y extent of the axis-aligned box geoms named wall_* (None if absent)."""
    xs, ys = [], []
    for i in range(model.ngeom):
        name = mujoco.mj_id2name(model, mujoco.mjtObj.mjOBJ_GEOM, i) or ""
        if not name.startswith("wall") or model.geom_type[i] != mujoco.mjtGeom.mjGEOM_BOX:
            continue
        px, py = float(model.geom_pos[i][0]), float(model.geom_pos[i][1])
        sx, sy = float(model.geom_size[i][0]), float(model.geom_size[i][1])
        # A wall is thin along one axis; that axis is where it bounds the room.
        if sx < sy:
            xs.append(px - sx if px > 0 else px + sx)
        else:
            ys.append(py - sy if py > 0 else py + sy)
    if not xs or not ys:
        return None
    return min(xs), max(xs), min(ys), max(ys)


class RecorderSlot:
    """Thread-safe holder for named recorders ("main" by default; a second one,
    e.g. "pip" on head_camera, can run at the same time). HTTP threads request
    start/stop, the physics thread services them in tick()."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._current: dict[str, Recorder] = {}
        self._pending_start: list[tuple[str, RecorderConfig]] = []
        self._pending_stop: list[str] = []
        self._last: dict[str, dict] = {}

    # HTTP side --------------------------------------------------------------
    def request_start(self, cfg: RecorderConfig, rid: str = "main") -> tuple[bool, str]:
        with self._lock:
            cur = self._current.get(rid)
            if cur is not None and not cur._closed:
                return False, f"'{rid}' is already recording {cur.cfg.path}"
            if any(r == rid for r, _ in self._pending_start):
                return False, f"'{rid}' is already starting"
            self._pending_start.append((rid, cfg))
            return True, "starting"

    def request_stop(self, rid: str | None = None) -> tuple[bool, str]:
        """Stop one recorder, or all of them when rid is None."""
        with self._lock:
            live = [r for r, c in self._current.items() if not c._closed]
            targets = live if rid is None else [rid] if rid in live else []
            if not targets:
                return False, "not recording" if rid is None else f"'{rid}' is not recording"
            self._pending_stop.extend(targets)
            return True, "stopping"

    def status(self) -> dict:
        with self._lock:
            cur = {r: c.status() for r, c in self._current.items()}
            recording = any(c["recording"] for c in cur.values())
            return {
                "recording": recording,
                # `current` keeps the single-recorder shape callers already read
                "current": cur.get("main") or (next(iter(cur.values())) if cur else None),
                "recorders": cur,
                "last": self._last.get("main") or (next(iter(self._last.values())) if self._last else None),
                "lasts": dict(self._last),
            }

    # physics side -----------------------------------------------------------
    def tick(self, node) -> None:
        with self._lock:
            starts, self._pending_start = self._pending_start, []
            stops, self._pending_stop = self._pending_stop, []
        for rid in stops:
            with self._lock:
                cur = self._current.get(rid)
            if cur is None:
                continue
            last = cur.close()
            print(f"[Recorder:{rid}] wrote {last['path']} "
                  f"({last['frames']} frames, {last['seconds']} s)"
                  + (f" ERROR {last['error']}" if last["error"] else ""))
            with self._lock:
                self._last[rid] = last
                self._current.pop(rid, None)
        for rid, cfg in starts:
            rec = Recorder(cfg)
            with self._lock:
                self._current[rid] = rec
            print(f"[Recorder:{rid}] recording {cfg.path} cam={cfg.cam} "
                  f"{cfg.width}x{cfg.height}@{cfg.fps}")
        with self._lock:
            live = list(self._current.items())
        for _, rec in live:
            rec.tick(node)

    def close(self) -> None:
        with self._lock:
            live = list(self._current.items())
        for rid, rec in live:
            last = rec.close()
            with self._lock:
                self._last[rid] = last
            print(f"[Recorder:{rid}] wrote {last['path']} ({last['frames']} frames)")


def parse_size(text: str) -> tuple[int, int]:
    w, _, h = text.lower().partition("x")
    return int(w), int(h)
