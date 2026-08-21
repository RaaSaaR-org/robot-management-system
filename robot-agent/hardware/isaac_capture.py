#!/usr/bin/env python3
"""Render the G1 moving through an Isaac Sim warehouse under Agent Mode's HIGH-LEVEL commands.

What this is
------------
Agent Mode drives robots through exactly one API: `LocoClient.SetVelocity(vx, vy, omega, duration)`,
an RPC over DDS. On a real G1 that hands off to Unitree's ONBOARD controller, which produces the
gait. This process stands in for that controller's *effect* on the base, and nothing more:

    Agent Mode -> LocoClient -> rt/api/sport/request -> [isaac_loco_bridge.py]
                             -> rt/run_command/cmd   -> [this process]
                             -> integrate velocity   -> write the articulation root pose
                             -> render two cameras

**There is no locomotion policy anywhere in this loop.** No `policy.onnx`, no action provider, no
observation manager, no `sim_main.py`. The legs are held at a fixed standing pose and the base is
translated kinematically -- exactly what `sim_g1_dds` already does in MuJoCo, with a far better
looking room around it. That means the robot GLIDES. It does not step, and any footage from here
must say so; see `isaac_capture_notes.md` and the AMBER chip the video build draws.

Why bother, then: the thing under test is the command contract, which is real. An unmodified
`LocoClient` reaches this scene, `SetStandHeight` genuinely changes the stance height because
height is the 4th float on the wire, and `walk` blocks close their measurement loop against odometry
we publish back on `rt/odommodestate`.

Sim time vs wall time
---------------------
The bridge expires `SetVelocity(duration)` against a MONOTONIC WALL clock, so this integrates on
wall dt too. Integrating on `sim.get_physics_dt()` while the renderer runs slower than real time
would silently shorten every walk -- honest, but it would make the measured distance disagree with
the commanded one for a reason that has nothing to do with the robot. Frames therefore arrive at a
variable rate; `telemetry.json` records a wall timestamp per frame so the encoder can use the
measured median.

Isaac Lab 3.0 quaternions are XYZW
----------------------------------
Identity is `(0, 0, 0, 1)`, not `(1, 0, 0, 0)`, and `convert_quat` has been removed. Unitree's
checkout is 2.x-era code and writes WXYZ throughout -- copying a `rot=` value from it yields a room
rotated 180 degrees about X. Every quaternion in this file is XYZW.

Run it on the SAME DDS domain as `isaac_loco_bridge.py`, and NOT while `sim_g1_dds/sim_node.py` or
Unitree's `sim_main.py` is up: two `sport` services on one domain race, and the loser's commands are
accepted and dropped.

The sensor facade (--serve)
---------------------------
With `--serve PORT` this also answers the sidecar contract the robot-agent already speaks, so Agent
Mode's PERCEPTION blocks -- `look`, `scan_room`, `goto` -- run against Isaac exactly as they run
against MuJoCo, with no branch in the TypeScript:

    GET  /health, /state                      -- liveness + the integrated pose
    GET  /cameras, /cameras/<name>/snapshot   -- head_camera, rendered in this scene
    GET  /pointcloud/sensors                  -- ["mid360_lidar"]
    GET  /pointcloud/mid360_lidar/snapshot    -- a real ray cast, see WarehouseRaycaster
    POST /pointcloud/lidar/switch             -- accepted no-op, same shape as the sidecar's
    *    /loco/*                              -- PROXIED, untouched, to --sidecar-url

`/loco/*` is proxied rather than reimplemented on purpose: motion must keep traversing DDS through
g1_sidecar.py, so nothing about the command path changes when the sensors move to Isaac. Only the
two things this scene can answer better than a headless sidecar -- pixels and ranges -- are served
here.

What the LiDAR is, and is not
-----------------------------
It is a real ray cast against the warehouse's own triangles (see WarehouseRaycaster): a surface
that is not in the USD produces no return, and no range is ever synthesised. It is NOT the robot's
MID-360: the fan geometry is copied from `sim_g1_dds`, but the cast sees only the STATIC warehouse
mesh, so the robot's own body produces no self-returns (nothing to filter -- it is not in the mesh)
and neither would a second robot or a moving pallet. In this scene nothing moves except the robot,
which is the only reason that omission is honest here.

@status new -- capture rig for demo footage; not part of the shipped robot software
"""
from __future__ import annotations

import argparse
import ast
import base64
import io
import json
import math
import os
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

_HERE = os.path.dirname(os.path.abspath(__file__))

# Unitree's checkout is used for its ASSETS ONLY (the dressed warehouse and the Dex3 G1 USD).
# `robots/unitree.py` reads PROJECT_ROOT at module scope, so it must be set before any import of it
# -- though we deliberately do not import their task cfgs at all: `tasks/__init__.py` gym-registers
# everything and drags in pinocchio via `pink.tasks`.
CHECKOUT = os.environ.get(
    "UNITREE_SIM_CHECKOUT",
    "/home/humanoid/Dokumente/Unitree/g1_quest_teleop/third_party/checkouts/unitree_sim_isaaclab",
)
os.environ.setdefault("PROJECT_ROOT", CHECKOUT)
os.environ.setdefault("OMNI_KIT_ACCEPT_EULA", "YES")

WAREHOUSE_USD = f"{CHECKOUT}/assets/objects/small_warehouse_digital_twin/small_warehouse_digital_twin.usd"
ROBOT_USD = f"{CHECKOUT}/assets/robots/g1-29dof_wholebody_dex3/g1_29dof_with_dex3_rev_1_0.usd"

RUN_COMMAND_TOPIC = "rt/run_command/cmd"
ODOM_TOPIC = "rt/odommodestate"

# If the newest command frame is older than this, treat it as zero. The bridge publishes explicit
# zeros on expiry, so this only fires when the bridge DIES -- and a dead bridge must stop the robot,
# not leave it coasting across the warehouse.
COMMAND_STALE_S = 0.5

# RTX frames are accumulated; the first ones are flat grey no matter what the camera sees. Discard
# this many before capturing, or the opening shot of the video is a grey card.
WARMUP_FRAMES = 40

# The base pose the stand-height field is measured against. LocoState carries 0.75 as its neutral,
# and the Unitree cfg spawns the G1 with its pelvis at 0.80.
NEUTRAL_STAND_HEIGHT = 0.75
BASE_PELVIS_Z = 0.80

# Room geometry, MEASURED from the USD rather than guessed (`UsdGeom.BBoxCache` over `/Lab/Assets`):
# the dressed interior is x in [-5.7, 1.2], y in [-6.6, 5.5], ceiling lights at z = 3.0. Note
# `/Lab/Structure` also carries a huge outdoor terrain out to x = -242 — do not size anything from
# the stage-wide bounding box, or both cameras end up behind a wall looking at grey.
ROOM_X = (-5.7, 1.2)
ROOM_Y = (-6.6, 5.5)

# Keep cameras this far inside the walls. A camera exactly on the boundary renders the wall itself.
CAM_MARGIN = 0.5

# The long axis is y (~12 m). The robot runs the open aisle between the west wall (x = -5.7) and the
# red racking (x ~ -2), starting at the south end facing +y — about 7.5 m of clear travel.
START_X, START_Y = -3.4, -4.6
START_YAW = math.pi / 2

# Chase camera placement, expressed in the frame of the camera's OWN azimuth `cam_yaw` — which is
# deliberately NOT the robot's yaw. A camera rigidly offset in the ROBOT's frame orbits with it, so
# an in-place turn pins the robot's silhouette to the same screen angle and sweeps the whole room
# past behind it: the rotation becomes invisible ("the robot doesn't turn"), and the swept
# background strobes at any time-lapse rate. Positive CHASE_FWD puts the camera AHEAD of the robot,
# positive CHASE_SIDE to its left — a front-quarter view, so a turn shows the chest and head coming
# round rather than the back of a jacket.
# The distance is set by the legs, not by taste, and it is set by the OUTPUT ASPECT. Isaac fixes the
# HORIZONTAL aperture at 20.955 mm, so the vertical one is 20.955 * height/width: landscape 16:9 sees
# 1.23 m of height at 2.5 m, portrait 9:16 sees 3.9 m at the same distance. Hence two defaults rather
# than one number — 3.4 m keeps a 1.3 m robot's feet in a 1280x720 frame (1.85 m of coverage), and
# 1.5 m fills a 1080x1920 one to about 55% of frame height. Both are `--chase` overridable: framing
# is a flag here, like --room-eye, so a look tweak is never a diff.
CHASE_FWD, CHASE_SIDE, CHASE_UP = 3.4, 1.6, 1.5
CHASE_PORTRAIT = (1.5, 0.7, 1.15)
# Aimed below the pelvis, which tilts the camera down and lifts the robot off the bottom edge —
# aiming at 1.0 m puts the feet on the frame border, where a single step of drift would clip them.
CHASE_TARGET_Z = 0.75

# `cam_yaw` chases the robot's heading only while the robot is TRANSLATING, and slowly. Standing
# still and spinning — which is every `scan_room` step — therefore leaves the camera exactly where
# it was, and the turn is rendered as the robot turning. Over a walk the camera drifts back behind
# the new heading gently enough not to read as motion of its own.
CHASE_YAW_TAU = 4.0          # s, time constant of that chase
CHASE_MOVE_EPS = 0.05        # m/s, below which the camera does not re-aim at all

# Standing pose, lifted from G129_CFG_WITH_DEX3_WHOLEBODY (robots/unitree.py:718-749). Regex keys,
# applied by name -- joint ORDER differs between USD load and any list we might write down, so
# never index these positionally.
STAND_JOINT_POS = {
    r".*_hip_pitch_joint": -0.20,
    r".*_knee_joint": 0.42,
    r".*_ankle_pitch_joint": -0.23,
    r".*_elbow_joint": 0.87,
    r"left_shoulder_roll_joint": 0.18,
    r"left_shoulder_pitch_joint": 0.35,
    r"right_shoulder_roll_joint": -0.18,
    r"right_shoulder_pitch_joint": 0.35,
}

# ---------------------------------------------------------------------------------- head sensors
# Head mount, in the base frame, taken verbatim from `sim_g1_dds/sim_node.py::LIDAR_FALLBACK_OFFSET`
# so a bearing measured here and a bearing measured in MuJoCo refer to the same point on the robot.
# `z` is height above the FLOOR, not above the pelvis -- the contract in `robot/types.ts` puts the
# floor at z = 0, and both the camera and the cast follow the stand height from there.
HEAD_OFFSET_X, HEAD_OFFSET_Y, HEAD_OFFSET_Z = 0.076, 0.0, 1.271

# Must match `AGENT_CAMERA_HFOV_DEG` (config.ts default 105.3): vision.ts converts a pixel column to
# a bearing with it, and a camera whose real HFOV disagrees makes every bearing wrong by a factor,
# which then steers the navigator into a wall while every log line still looks reasonable.
HEAD_CAM_HFOV_DEG = 105.3
# Resolution is free of the bearing maths and may be raised at will: `head_focal` below is derived
# from HEAD_CAM_HFOV_DEG and the aperture alone, and vision.ts converts a pixel column to a bearing
# as a FRACTION of the width. Keep the 4:3 so the vertical field does not move either. 1280x960
# because this is also the most visually interesting camera in the rig -- it is the one that sees
# the shelving and the containers, and 640 px is too few to show it at any size in a 1080-wide film.
HEAD_CAM_W, HEAD_CAM_H = 1280, 960
# Isaac's PinholeCameraCfg is specified by aperture and focal length, not by FOV.
USD_HORIZONTAL_APERTURE = 20.955

# MID-360-shaped fan, same numbers as sim_node.py. See `_ray_fan_directions` there for why the fan
# is levelled rather than tilted with the torso.
LIDAR_SENSOR = "mid360_lidar"
LIDAR_AZIMUTH_RAYS = 180
LIDAR_ELEVATION_RINGS = 32
LIDAR_ELEV_MIN_DEG = -52.0
LIDAR_ELEV_MAX_DEG = 7.0
LIDAR_MIN_RANGE = 0.35
LIDAR_MAX_RANGE = 25.0
LIDAR_MAX_POINTS = 20000

# ------------------------------------------------------------------------- keeping the room lit
# Both cameras returning FLAT GREY, permanently, mid-run. Seen twice: once after 8469 frames, once
# after 809 — the second within a second of Ollama loading a 9 GB model onto the same card. The
# give-away is `RTX streaming completed in 0.0X s` in the log immediately before the first grey
# frame, and the startup warning that geometry streaming and
# `/rtx/hydra/readTransformsFromFabricInRenderDelegate` together break transform updates.
#
# The cause is the default budget: the geometry streamer is told it may use 64000 MB on a card that
# has 32768. It therefore never plans to evict, and when a NEIGHBOURING process takes its share the
# memory budget manager evicts the warehouse out from under the render delegate, which — with
# transforms coming from Fabric — never streams it back. It is not our own VRAM exhaustion: the card
# still had 10 GB free both times.
#
# So: give it a budget that fits beside a local LLM, and load geometry synchronously so a frame is
# never rendered against a half-streamed scene. Do NOT "fix" this by disabling texture streaming
# instead — `/rtx-transient/resourcemanager/enableTextureStreaming: False` turns off the service
# while the renderer still asks for it, and every frame from the very first one is grey.
RENDER_CARB_SETTINGS = {
    "/rtx/hydra/geometrystreaming/gpuBudgetMB": 6000,
    "/rtx/hydra/geometrySyncLoads": True,
}


def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser(description="Render Agent Mode driving the G1 base in Isaac Sim")
    ap.add_argument("--out", required=True, help="output directory for frames + telemetry.json")
    ap.add_argument("--domain", type=int, default=1, help="DDS domain; must match the bridge")
    ap.add_argument("--iface", default="lo")
    ap.add_argument("--seconds", type=float, default=180.0, help="wall-clock capture length")
    ap.add_argument("--quality", default="performance",
                    choices=["performance", "balanced", "quality"])
    ap.add_argument("--width", type=int, default=1280)
    ap.add_argument("--height", type=int, default=720)
    ap.add_argument("--still", action="store_true",
                    help="render ONE frame of each camera and exit — the framing/upside-down check")
    # Framing and light are iterated from stills, not derived. Flags, so a look tweak is not a diff.
    ap.add_argument("--room-eye", default="0.6,-6.0,2.4", help="static camera position x,y,z")
    ap.add_argument("--room-target", default="-3.0,2.0,1.0", help="static camera aim point x,y,z")
    ap.add_argument("--dome", type=float, default=1500.0, help="dome light intensity")
    ap.add_argument("--start", default=f"{START_X},{START_Y},{math.degrees(START_YAW)}",
                    help="robot start pose x,y,yaw_deg")
    ap.add_argument("--chase", default="",
                    help="chase camera offset fwd,side,up in metres; default follows the aspect — "
                         f"{CHASE_FWD},{CHASE_SIDE},{CHASE_UP} landscape, "
                         f"{CHASE_PORTRAIT[0]},{CHASE_PORTRAIT[1]},{CHASE_PORTRAIT[2]} portrait")
    ap.add_argument("--chase-target-z", type=float, default=CHASE_TARGET_Z,
                    help="height the chase camera aims at, metres above the floor")
    ap.add_argument("--serve", type=int, default=0,
                    help="serve the sidecar sensor contract on this port (0 = off)")
    ap.add_argument("--sidecar-url", default="http://localhost:8767",
                    help="where /loco/* is proxied — the DDS-speaking g1_sidecar.py")
    ap.add_argument("--lidar-probe", action="store_true",
                    help="cast once from the start pose, print ranges at 8 bearings, and exit")
    return ap


def xyz(s: str) -> list[float]:
    parts = [float(v) for v in s.split(",")]
    if len(parts) != 3:
        raise ValueError(f"expected x,y,z — got {s!r}")
    return parts


# --------------------------------------------------------------------------------------------
# DDS side. Imported here rather than at Isaac time: cyclonedds has no interaction with Kit, and
# keeping it above the AppLauncher line means a DDS misconfiguration fails in two seconds instead of
# after a two-minute scene load.
# --------------------------------------------------------------------------------------------
from unitree_sdk2py.core.channel import (  # noqa: E402
    ChannelFactoryInitialize, ChannelPublisher, ChannelSubscriber,
)
from unitree_sdk2py.idl.default import unitree_go_msg_dds__SportModeState_  # noqa: E402
from unitree_sdk2py.idl.std_msgs.msg.dds_ import String_  # noqa: E402
from unitree_sdk2py.idl.unitree_go.msg.dds_ import SportModeState_  # noqa: E402


class CommandFeed:
    """Latest [vx, vy, omega, height] published by the bridge."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._cmd = (0.0, 0.0, 0.0, NEUTRAL_STAND_HEIGHT)
        self._at = 0.0
        self.count = 0
        sub = ChannelSubscriber(RUN_COMMAND_TOPIC, String_)
        sub.Init(self._on_msg, 10)
        self._sub = sub

    def _on_msg(self, msg: String_) -> None:
        try:
            parsed = ast.literal_eval(msg.data)
        except (ValueError, SyntaxError):
            return
        if not isinstance(parsed, (list, tuple)) or len(parsed) < 4:
            return
        with self._lock:
            self._cmd = tuple(float(v) for v in parsed[:4])
            self._at = time.monotonic()
            self.count += 1

    def latest(self, now: float) -> tuple[float, float, float, float]:
        with self._lock:
            vx, vy, omega, height = self._cmd
            age = now - self._at
        if age > COMMAND_STALE_S:
            # Hold the last stand height — that is a posture, not a motion — but stop moving.
            return 0.0, 0.0, 0.0, height
        return vx, vy, omega, height


class OdomPublisher:
    """Publish the integrated pose so Agent Mode's `walk` blocks can measure what happened.

    Without this, `block-executor.ts` reports "distance travelled is unverified". With a STUCK pose
    it reports an outright failure ("the robot did not move"), which is worse than silence — so this
    publishes the real integrated pose or nothing at all.
    """

    def __init__(self) -> None:
        self._pub = ChannelPublisher(ODOM_TOPIC, SportModeState_)
        self._pub.Init()
        self._last = 0.0

    def publish(self, x: float, y: float, yaw: float, now: float, rate_hz: float = 20.0) -> None:
        if now - self._last < 1.0 / rate_hz:
            return
        self._last = now
        msg = unitree_go_msg_dds__SportModeState_()
        msg.stamp.sec = int(now)
        msg.stamp.nanosec = int((now % 1.0) * 1e9)
        msg.position = [float(x), float(y), 0.0]
        msg.imu_state.rpy = [0.0, 0.0, float(yaw)]
        self._pub.Write(msg)


class KinematicBase:
    """Integrate body-frame velocity into a world pose.

    The mid-point-heading formula is taken from `sim_g1_dds/loco_state.py` so the trajectory here
    and in the MuJoCo sim agree for the same command stream. Yaw is deliberately NOT wrapped: the
    caller differences it, and wrapping would turn a 359 -> 1 degree step into a -358 degree one.
    """

    def __init__(self, x0: float, y0: float, yaw0: float) -> None:
        self.x0, self.y0, self.yaw0 = x0, y0, yaw0
        self.x = self.y = self.yaw = 0.0     # robot frame, relative to the start pose

    def step(self, vx: float, vy: float, omega: float, dt: float) -> None:
        if dt <= 0.0:
            return
        yaw_mid = self.yaw + 0.5 * omega * dt
        self.x += (vx * math.cos(yaw_mid) - vy * math.sin(yaw_mid)) * dt
        self.y += (vx * math.sin(yaw_mid) + vy * math.cos(yaw_mid)) * dt
        self.yaw += omega * dt

    @property
    def world(self) -> tuple[float, float, float]:
        """Start pose composed with the travelled pose. One frame, used everywhere."""
        c, s = math.cos(self.yaw0), math.sin(self.yaw0)
        return (self.x0 + self.x * c - self.y * s,
                self.y0 + self.x * s + self.y * c,
                self.yaw0 + self.yaw)


# ------------------------------------------------------------------------------- sensors + facade


def _ray_fan_directions(n_azimuth: int, n_elevation: int, elev_min_deg: float,
                        elev_max_deg: float, yaw: float):
    """Unit ray directions in WORLD coordinates, shape (n_azimuth*n_elevation, 3).

    Line-for-line the same fan as `sim_g1_dds/sim_node.py::_ray_fan_directions`, including the
    decision to rotate by the base YAW only. The torso's pitch and roll are not applied: the real
    pipeline gravity-aligns the cloud before any consumer sees it, so a level fan is closer to what
    the robot actually delivers than a tilted one. Divergence here would make ranges measured in
    Isaac and in MuJoCo quietly incomparable, which is the whole point of copying it.
    """
    import numpy as np

    az = np.arange(n_azimuth, dtype=np.float64) * (2.0 * math.pi / n_azimuth)
    if n_elevation == 1:
        el = np.array([math.radians(0.5 * (elev_min_deg + elev_max_deg))])
    else:
        el = np.radians(np.linspace(elev_min_deg, elev_max_deg, n_elevation))
    a, e = np.meshgrid(az + yaw, el, indexing="ij")
    a, e = a.ravel(), e.ravel()
    ce = np.cos(e)
    return np.stack([ce * np.cos(a), ce * np.sin(a), np.sin(e)], axis=1)


class WarehouseRaycaster:
    """A ray cast against the warehouse's own triangles, via warp on the CPU.

    Why the USD triangles and not PhysX scene queries: a dressed digital twin is mostly VISUAL
    geometry, and only some of it carries colliders. A PhysX raycast would report the racking as
    open air wherever the artist authored no collider — a range sensor that cannot see a shelf is
    worse than no range sensor, because it answers "clear". The triangles are what the camera sees,
    so they are what gets cast, and camera and LiDAR then agree about the same room.

    CPU on purpose. This is called from an HTTP worker while the render loop owns the CUDA context,
    and a static BVH over a room-sized asset answers the whole 5760-ray fan in a few milliseconds.
    Nothing here reads the stage after construction, so — unlike MuJoCo's `mj_ray`, which forced
    `sim_node.py` to hand casts to the physics thread — a cast cannot observe a half-stepped state.

    The mesh is STATIC and contains only what lives under `root_path`. The robot is not in it, so
    there are no self-returns to filter out; equally, a second robot or a moving pallet would be
    invisible. In this scene the robot is the only thing that moves.
    """

    def __init__(self, root_path: str) -> None:
        import numpy as np
        import omni.usd
        import warp as wp
        from pxr import Usd, UsdGeom

        wp.init()
        self._wp = wp
        self._np = np
        self._lock = threading.Lock()

        stage = omni.usd.get_context().get_stage()
        root = stage.GetPrimAtPath(root_path)
        if not root or not root.IsValid():
            raise RuntimeError(f"no prim at {root_path} to cast against")

        verts: list = []
        tris: list = []
        base = 0
        n_mesh = 0
        # TraverseInstanceProxies matters: the warehouse references its shelving as instances, and
        # the default traversal walks straight past them — leaving a cast that only ever hits the
        # floor and the outer walls, which looks like a working sensor in an empty building.
        for prim in Usd.PrimRange(root, Usd.TraverseInstanceProxies()):
            if not prim.IsA(UsdGeom.Mesh):
                continue
            imageable = UsdGeom.Imageable(prim)
            if imageable.ComputeVisibility(Usd.TimeCode.Default()) == UsdGeom.Tokens.invisible:
                continue
            # `guide` geometry is authoring scaffolding — never rendered, must never be ranged.
            if imageable.ComputePurpose() == UsdGeom.Tokens.guide:
                continue
            mesh = UsdGeom.Mesh(prim)
            pts = mesh.GetPointsAttr().Get()
            counts = mesh.GetFaceVertexCountsAttr().Get()
            idx = mesh.GetFaceVertexIndicesAttr().Get()
            if not pts or not counts or not idx:
                continue
            xf = np.array(
                UsdGeom.Xformable(prim).ComputeLocalToWorldTransform(Usd.TimeCode.Default()),
                dtype=np.float64,
            ).reshape(4, 4)
            p = np.asarray(pts, dtype=np.float64)
            # USD is row-vector: p_world = [p 1] @ M. Transposing this silently mirrors the room.
            p = np.concatenate([p, np.ones((len(p), 1))], axis=1) @ xf
            verts.append(p[:, :3])

            counts = np.asarray(counts, dtype=np.int64)
            idx = np.asarray(idx, dtype=np.int64)
            starts = np.concatenate([[0], np.cumsum(counts)[:-1]])
            # Fan-triangulate, vectorised per polygon size. A per-face Python loop over an asset
            # this size takes minutes; this takes milliseconds.
            for size in np.unique(counts):
                sel = counts == size
                face = idx[starts[sel][:, None] + np.arange(size)]
                for k in range(1, int(size) - 1):
                    tris.append(np.stack([face[:, 0], face[:, k], face[:, k + 1]], axis=1) + base)
            base += len(p)
            n_mesh += 1

        if not verts:
            raise RuntimeError(f"{root_path} contains no visible UsdGeom.Mesh — nothing to cast at")

        points = np.concatenate(verts).astype(np.float32)
        indices = np.concatenate(tris).astype(np.int32).reshape(-1)
        self.n_meshes = n_mesh
        self.n_triangles = len(indices) // 3
        self._mesh = wp.Mesh(
            points=wp.array(points, dtype=wp.vec3, device="cpu"),
            indices=wp.array(indices, dtype=wp.int32, device="cpu"),
        )

        @wp.kernel
        def _cast(mesh: wp.uint64, origin: wp.vec3, dirs: wp.array(dtype=wp.vec3),
                  max_t: float, out_t: wp.array(dtype=wp.float32)):
            i = wp.tid()
            hit = wp.mesh_query_ray(mesh, origin, dirs[i], max_t)
            # -1 is "no intersection", and it stays a MISSING point rather than becoming a
            # max-range one. A ray that leaves through the roll-up door and never comes back means
            # UNKNOWN; turning it into a return at 25 m would invent a wall out there.
            out_t[i] = wp.where(hit.result, hit.t, -1.0)

        self._kernel = _cast

    def cast(self, x: float, y: float, yaw: float, sensor_z: float,
             n_azimuth: int = LIDAR_AZIMUTH_RAYS, n_elevation: int = LIDAR_ELEVATION_RINGS,
             elev_min_deg: float = LIDAR_ELEV_MIN_DEG, elev_max_deg: float = LIDAR_ELEV_MAX_DEG,
             min_range: float = LIDAR_MIN_RANGE, max_range: float = LIDAR_MAX_RANGE,
             max_points: int = LIDAR_MAX_POINTS) -> dict:
        """One sweep, returned in the `PointCloudFrame` base_link contract.

        x forward, y left, z metres above the floor — the same convention `_cast_ray_fan` emits in
        MuJoCo, so `range.ts` needs no knowledge of which simulator produced the frame.
        """
        np, wp = self._np, self._wp
        dirs = _ray_fan_directions(n_azimuth, n_elevation, elev_min_deg, elev_max_deg, yaw)
        n_ray = dirs.shape[0]
        c, s = math.cos(yaw), math.sin(yaw)
        ox = x + HEAD_OFFSET_X * c - HEAD_OFFSET_Y * s
        oy = y + HEAD_OFFSET_X * s + HEAD_OFFSET_Y * c

        with self._lock:
            d_dirs = wp.array(dirs.astype(np.float32), dtype=wp.vec3, device="cpu")
            d_t = wp.zeros(n_ray, dtype=wp.float32, device="cpu")
            wp.launch(self._kernel, dim=n_ray, device="cpu",
                      inputs=[self._mesh.id, wp.vec3(float(ox), float(oy), float(sensor_z)),
                              d_dirs, float(max_range), d_t])
            dist = d_t.numpy().astype(np.float64)

        hit = dist >= 0.0
        near = hit & (dist < min_range)
        far = hit & (dist > max_range)
        keep = hit & (dist >= min_range) & (dist <= max_range)

        origin_world = np.array([ox, oy, sensor_z])
        pts_world = origin_world[None, :] + dist[keep][:, None] * dirs[keep]
        dx = pts_world[:, 0] - x
        dy = pts_world[:, 1] - y
        pts = np.empty_like(pts_world)
        pts[:, 0] = dx * c + dy * s          # rotate by -yaw into base_link
        pts[:, 1] = -dx * s + dy * c
        pts[:, 2] = pts_world[:, 2]          # already metres above the floor

        decimated = False
        if pts.shape[0] > max_points:
            pts = pts[:: int(math.ceil(pts.shape[0] / max_points))]
            decimated = True

        return {
            "positions": [round(float(v), 4) for v in pts.reshape(-1)],
            "origin": [round(HEAD_OFFSET_X, 4), round(HEAD_OFFSET_Y, 4), round(sensor_z, 4)],
            "point_count": int(pts.shape[0]),
            "rays": n_ray,
            "returns": int(hit.sum()),
            "dropped_near": int(near.sum()),
            "dropped_far": int(far.sum()),
            "decimated": decimated,
            "method": "warp.mesh_query_ray",
            "fan": {
                "azimuth_rays": n_azimuth,
                "elevation_rings": n_elevation,
                "elevation_deg": [elev_min_deg, elev_max_deg],
                "min_range_m": min_range,
                "max_range_m": max_range,
            },
        }


class SensorState:
    """The single hand-off between the render loop and the HTTP workers.

    Everything the facade answers is a SNAPSHOT taken under this lock — never a live read of a
    buffer the render loop is mid-write on.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._pose = (0.0, 0.0, 0.0, NEUTRAL_STAND_HEIGHT)
        self._head_rgb = None
        self._frames = 0

    def publish(self, x: float, y: float, yaw: float, height: float, head_rgb) -> None:
        with self._lock:
            self._pose = (x, y, yaw, height)
            self._head_rgb = head_rgb
            self._frames += 1

    def pose(self) -> tuple[float, float, float, float]:
        with self._lock:
            return self._pose

    def head_rgb(self):
        with self._lock:
            return self._head_rgb, self._frames


def _sidecar_facade(state: SensorState, raycaster, sidecar_url: str, scene_label: str):
    """The sidecar contract, answered from Isaac. See the module docstring for the route list."""

    def proxy(method: str, path: str, body: bytes | None) -> tuple[int, dict]:
        """Forward /loco/* verbatim. A failure here is reported AS a failure, never softened.

        The robot-agent decides whether a walk happened from this answer; turning a dead sidecar
        into `{"ok": true}` would make Agent Mode measure a walk that never left the DDS bus.
        """
        req = urllib.request.Request(
            sidecar_url.rstrip("/") + path, method=method, data=body,
            headers={"Content-Type": "application/json"} if body else {})
        try:
            with urllib.request.urlopen(req, timeout=30) as res:
                return res.status, json.loads(res.read() or b"{}")
        except urllib.error.HTTPError as exc:
            try:
                return exc.code, json.loads(exc.read() or b"{}")
            except json.JSONDecodeError:
                return exc.code, {"ok": False, "error": f"sidecar HTTP {exc.code}"}
        except Exception as exc:  # noqa: BLE001
            return 503, {"ok": False, "error": f"sidecar {sidecar_url} unreachable: {exc}"}

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def _send(self, code: int, payload: dict) -> None:
            body = json.dumps(payload).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args) -> None:  # the capture log is noisy enough
            pass

        def do_GET(self) -> None:
            if self.path.startswith("/loco/"):
                self._send(*proxy("GET", self.path, None))
                return
            if self.path == "/health":
                self._send(200, {"status": "ok", "connected": True, "sim": True,
                                 "scene": scene_label})
            elif self.path == "/state" or self.path == "/state/fast":
                x, y, yaw, _h = state.pose()
                # No `joints`: this rig hard-writes a fixed standing pose and never reads the
                # articulation back, so reporting joint angles would be reporting the command, not
                # a measurement. The key is absent rather than zero-filled.
                self._send(200, {"ok": True, "sim": True,
                                 "odometry": {"x": x, "y": y, "yaw": yaw}})
            elif self.path == "/cameras":
                self._send(200, {"cameras": ["head_camera"]})
            elif self.path.startswith("/cameras/") and self.path.endswith("/snapshot"):
                name = self.path[len("/cameras/"):-len("/snapshot")]
                if name != "head_camera":
                    self._send(200, {"ok": False, "error": f"no camera '{name}'"})
                    return
                rgb, frames = state.head_rgb()
                if rgb is None:
                    self._send(503, {"ok": False, "error": "no head frame rendered yet"})
                    return
                import imageio.v3 as iio
                buf = io.BytesIO()
                iio.imwrite(buf, rgb, extension=".jpg", quality=88)
                b64 = base64.b64encode(buf.getvalue()).decode()
                # Both keys, for the same reason sim_node.py emits both: g1_sidecar.py answers
                # `jpeg_base64` and HardwareClient historically read `image_b64`.
                self._send(200, {"ok": True, "camera": name, "source": "isaac",
                                 "jpeg_base64": b64, "image_b64": b64, "frame": frames})
            elif self.path == "/pointcloud/sensors":
                self._send(200, {"sensors": [LIDAR_SENSOR]})
            elif self.path.startswith("/pointcloud/") and self.path.endswith("/snapshot"):
                name = self.path[len("/pointcloud/"):-len("/snapshot")]
                if name != LIDAR_SENSOR:
                    self._send(200, {"ok": False, "error": f"no depth sensor '{name}'"})
                    return
                if raycaster is None:
                    self._send(503, {"ok": False, "error": "raycaster failed to build"})
                    return
                x, y, yaw, height = state.pose()
                try:
                    cloud = raycaster.cast(x, y, yaw,
                                           HEAD_OFFSET_Z + (height - NEUTRAL_STAND_HEIGHT))
                except Exception as exc:  # noqa: BLE001
                    # 503, never an empty cloud: `positions: []` is indistinguishable from "the
                    # sweep found nothing", i.e. from "the way ahead is clear".
                    self._send(503, {"ok": False, "error": f"cast failed: {exc}"})
                    return
                self._send(200, {
                    "ok": True, "sensor": name, "sensor_type": "lidar",
                    # The cast measures geometry, not reflectivity. A constant-filled intensity
                    # channel would be a fabricated measurement.
                    "has_intensity": False, "intensities": [],
                    "source": "isaac-ray", "scene": scene_label, **cloud,
                })
            else:
                self._send(404, {"error": "not found"})

        def do_POST(self) -> None:
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length) if length else b""
            if self.path.startswith("/loco/"):
                self._send(*proxy("POST", self.path, raw or b"{}"))
                return
            if self.path == "/pointcloud/lidar/switch":
                # Accepted no-op, verbatim the sidecar's success shape, so one unchanged enable
                # sequence works against the robot, MuJoCo and this. Nothing is claimed to have
                # been switched — the rays are always available.
                try:
                    on = json.loads(raw or b"{}").get("on")
                except json.JSONDecodeError as exc:
                    self._send(400, {"ok": False, "error": f"invalid JSON: {exc}"})
                    return
                if not isinstance(on, bool):
                    self._send(400, {"ok": False, "error": 'body must be {"on": true|false}'})
                    return
                self._send(200, {"ok": True, "lidar": "ON" if on else "OFF", "sim": True,
                                 "note": "isaac ray cast is always on — switch accepted, ignored"})
                return
            self._send(404, {"error": "not found"})

    return Handler


def main() -> int:
    args = parse_args().parse_args()

    ChannelFactoryInitialize(args.domain, args.iface) if args.iface else \
        ChannelFactoryInitialize(args.domain)
    feed = CommandFeed()
    odom = OdomPublisher()
    sx, sy, syaw_deg = xyz(args.start)
    syaw = math.radians(syaw_deg)
    base = KinematicBase(sx, sy, syaw)
    print(f"[capture] DDS up on domain {args.domain}, subscribed {RUN_COMMAND_TOPIC}", flush=True)

    # ---- Isaac must be launched before ANY isaaclab/omni import ----------------------------
    from isaaclab.app import AppLauncher
    app_launcher = AppLauncher({
        "headless": True,
        "enable_cameras": True,     # the cameras below refuse to spawn without it
        "device": "cuda:0",
    })
    simulation_app = app_launcher.app

    import torch
    import imageio.v3 as iio
    import isaaclab.sim as sim_utils
    from isaaclab.actuators import ImplicitActuatorCfg
    from isaaclab.assets import Articulation, ArticulationCfg, AssetBaseCfg
    from isaaclab.sensors import Camera, CameraCfg
    from isaaclab.utils.math import quat_from_euler_xyz

    os.makedirs(args.out, exist_ok=True)

    sim_cfg = sim_utils.SimulationCfg(
        device="cuda:0",
        dt=1.0 / 60.0,
        render=sim_utils.RenderCfg(
            rendering_mode=args.quality,
            antialiasing_mode="DLAA",
            enable_shadows=True,
            enable_reflections=True,
            carb_settings=RENDER_CARB_SETTINGS,
        ),
    )
    sim = sim_utils.SimulationContext(sim_cfg)

    # ---- scene ----------------------------------------------------------------------------
    # The dressed warehouse brings its own floor collider and eight ceiling RectLights; that is what
    # makes it read as a room rather than a grey plane, so no GroundPlaneCfg is added.
    # rot is XYZW identity — Unitree's own cfgs say (1,0,0,0) here, which under Isaac Lab 3.0 would
    # stand the warehouse on its head.
    warehouse_cfg = AssetBaseCfg(
        prim_path="/World/Warehouse",
        init_state=AssetBaseCfg.InitialStateCfg(pos=(0.0, 0.0, 0.0), rot=(0.0, 0.0, 0.0, 1.0)),
        spawn=sim_utils.UsdFileCfg(usd_path=WAREHOUSE_USD),
    )
    warehouse_cfg.spawn.func("/World/Warehouse", warehouse_cfg.spawn,
                             translation=warehouse_cfg.init_state.pos,
                             orientation=warehouse_cfg.init_state.rot)

    dome = sim_utils.DomeLightCfg(color=(0.75, 0.75, 0.75), intensity=args.dome)
    dome.func("/World/DomeLight", dome)

    robot_cfg = ArticulationCfg(
        prim_path="/World/Robot",
        spawn=sim_utils.UsdFileCfg(
            usd_path=ROBOT_USD,
            # Gravity off, because we own the root pose. With gravity on, PhysX fights every write
            # and the robot sags between frames. fix_root_link would be the other way to do it, but
            # it welds the root to the origin — which is precisely the thing we need to move.
            rigid_props=sim_utils.RigidBodyPropertiesCfg(
                disable_gravity=True,
                max_depenetration_velocity=1.0,
            ),
            articulation_props=sim_utils.ArticulationRootPropertiesCfg(
                enabled_self_collisions=False,
                solver_position_iteration_count=4,
                solver_velocity_iteration_count=1,
            ),
        ),
        init_state=ArticulationCfg.InitialStateCfg(
            pos=(sx, sy, BASE_PELVIS_Z),
            rot=(0.0, 0.0, math.sin(syaw / 2), math.cos(syaw / 2)),   # XYZW
            joint_pos=dict(STAND_JOINT_POS),
            joint_vel={".*": 0.0},
        ),
        # `actuators` is a required field even though we never issue a joint TARGET -- every joint
        # is hard-written each frame. One stiff implicit group over all 43 joints keeps the pose
        # from relaxing between writes; the exact gains are not load-bearing here.
        actuators={
            "all": ImplicitActuatorCfg(
                joint_names_expr=[".*"], stiffness=200.0, damping=10.0,
            ),
        },
    )
    robot = Articulation(robot_cfg)

    cam_cfg = CameraCfg(
        prim_path="/World/ChaseCam",
        update_period=0.0,
        width=args.width,
        height=args.height,
        data_types=["rgb"],
        spawn=sim_utils.PinholeCameraCfg(focal_length=24.0, clipping_range=(0.1, 60.0)),
    )
    chase = Camera(cam_cfg)
    room = Camera(cam_cfg.replace(prim_path="/World/RoomCam"))

    # The robot's own eye — what `look` / `scan_room` reason over. Its focal length is DERIVED from
    # the HFOV the robot-agent is configured with, not chosen: vision.ts turns a pixel column into a
    # bearing using that angle, so a mismatch here bends every bearing by a constant factor and the
    # navigator walks confidently past its target.
    head_focal = USD_HORIZONTAL_APERTURE / (2.0 * math.tan(math.radians(HEAD_CAM_HFOV_DEG) / 2.0))
    head = Camera(CameraCfg(
        prim_path="/World/HeadCam",
        update_period=0.0,
        width=HEAD_CAM_W,
        height=HEAD_CAM_H,
        data_types=["rgb"],
        spawn=sim_utils.PinholeCameraCfg(
            focal_length=head_focal,
            horizontal_aperture=USD_HORIZONTAL_APERTURE,
            clipping_range=(0.05, 60.0),
        ),
    ))

    sim.reset()   # nothing above has a physics handle until this runs

    # `default_joint_pos` is a live view onto the buffer we are about to write. Clone it, or the
    # "standing pose" silently becomes whatever the last frame left behind.
    stand_pose = robot.data.default_joint_pos.torch.clone()
    zero_joint_vel = torch.zeros_like(stand_pose)
    zero_root_vel = torch.zeros((1, 6), device=sim.device)
    zeros1 = torch.zeros(1, device=sim.device)
    print(f"[capture] {len(robot.joint_names)} joints: {robot.joint_names[:6]} ...", flush=True)

    # Static wide shot from the south-east corner, INSIDE the room, looking up the long axis.
    room.set_world_poses_from_view(
        torch.tensor([xyz(args.room_eye)], device=sim.device),
        torch.tensor([xyz(args.room_target)], device=sim.device),
    )

    # ---- sensors ---------------------------------------------------------------------------
    # Built AFTER sim.reset(): the warehouse's referenced payloads are not composed onto the stage
    # before that, so an earlier traversal finds a handful of Xforms and no triangles at all.
    raycaster = None
    try:
        t_mesh = time.monotonic()
        raycaster = WarehouseRaycaster("/World/Warehouse")
        print(f"[capture] raycaster: {raycaster.n_triangles} triangles from "
              f"{raycaster.n_meshes} meshes in {time.monotonic() - t_mesh:.1f}s", flush=True)
    except Exception as exc:  # noqa: BLE001
        # Not fatal — footage is still worth capturing without ranges. But say so loudly, because
        # `scan_room` will then report every bearing as an unknown distance and that looks like a
        # model failure rather than a missing sensor.
        print(f"[capture] WARNING no LiDAR: {exc}", flush=True)

    if args.lidar_probe:
        if raycaster is None:
            return 1
        cloud = raycaster.cast(sx, sy, syaw, HEAD_OFFSET_Z)
        import numpy as np
        pts = np.array(cloud["positions"]).reshape(-1, 3)
        print(f"[probe] pose=({sx:+.2f},{sy:+.2f}) yaw={math.degrees(syaw):+.0f}deg  "
              f"{cloud['returns']}/{cloud['rays']} returns, {cloud['point_count']} points")
        # Nearest surface per cardinal bearing, in the same 0.15-1.80 m band range.ts uses — so a
        # number printed here is a number the robot would actually act on.
        band = (pts[:, 2] >= 0.15) & (pts[:, 2] <= 1.80)
        bearings = np.degrees(np.arctan2(pts[:, 1], pts[:, 0]))
        rng = np.hypot(pts[:, 0], pts[:, 1])
        for want in range(-180, 180, 45):
            sel = band & (np.abs((bearings - want + 180) % 360 - 180) <= 8)
            near = f"{rng[sel].min():5.2f} m" if sel.any() else "  no return"
            print(f"[probe]  bearing {want:+4d} deg -> {near}  ({int(sel.sum())} pts)")
        simulation_app.close()
        return 0

    state = SensorState()
    httpd = None
    if args.serve:
        httpd = ThreadingHTTPServer(
            ("0.0.0.0", args.serve),
            _sidecar_facade(state, raycaster, args.sidecar_url, "isaac_small_warehouse"))
        httpd.daemon_threads = True
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        print(f"[capture] sensor facade on :{args.serve} "
              f"(/loco/* -> {args.sidecar_url})", flush=True)

    meta: list[dict] = []
    # Aspect picks the default standoff, because the vertical field is aspect-dependent while the
    # horizontal one is fixed — see CHASE_FWD. An explicit --chase always wins.
    chase_fwd, chase_side, chase_up = (
        xyz(args.chase) if args.chase else
        CHASE_PORTRAIT if args.height > args.width else
        (CHASE_FWD, CHASE_SIDE, CHASE_UP))
    print(f"[capture] chase fwd={chase_fwd} side={chase_side} up={chase_up} "
          f"target_z={args.chase_target_z} for {args.width}x{args.height}", flush=True)
    smooth_eye = smooth_tgt = None
    cam_yaw = syaw               # the camera's own azimuth, seeded from the robot's start heading
    t0 = t_prev = time.monotonic()
    i = 0
    warm = 0

    while simulation_app.is_running():
        now = time.monotonic()
        dt = now - t_prev
        t_prev = now
        if now - t0 > args.seconds:
            break

        vx, vy, omega, height = feed.latest(now)
        base.step(vx, vy, omega, dt)
        wx, wy, wyaw = base.world

        root_pose = torch.zeros((1, 7), device=sim.device)
        root_pose[0, 0] = wx
        root_pose[0, 1] = wy
        root_pose[0, 2] = BASE_PELVIS_Z + (height - NEUTRAL_STAND_HEIGHT)
        root_pose[0, 3:] = quat_from_euler_xyz(
            zeros1, zeros1, torch.tensor([wyaw], device=sim.device))[0]

        robot.write_root_pose_to_sim_index(root_pose=root_pose)
        robot.write_root_velocity_to_sim_index(root_velocity=zero_root_vel)
        robot.write_joint_position_to_sim_index(position=stand_pose)
        robot.write_joint_velocity_to_sim_index(velocity=zero_joint_vel)

        # Chase cam, low-passed so it does not snap, and clamped inside the walls — an unclamped
        # follow cam reverses through the building the moment the robot turns. Its azimuth is its
        # own state and does NOT track `wyaw`; see CHASE_FWD for why that matters more than the
        # framing does.
        c, s = math.cos(wyaw), math.sin(wyaw)
        if math.hypot(vx, vy) > CHASE_MOVE_EPS:
            err = math.atan2(math.sin(wyaw - cam_yaw), math.cos(wyaw - cam_yaw))
            cam_yaw += err * min(1.0, dt / CHASE_YAW_TAU)
        cc, cs = math.cos(cam_yaw), math.sin(cam_yaw)
        ex = wx + chase_fwd * cc - chase_side * cs
        ey = wy + chase_fwd * cs + chase_side * cc
        ex = min(max(ex, ROOM_X[0] + CAM_MARGIN), ROOM_X[1] - CAM_MARGIN)
        ey = min(max(ey, ROOM_Y[0] + CAM_MARGIN), ROOM_Y[1] - CAM_MARGIN)
        eye = torch.tensor([[ex, ey, chase_up]], device=sim.device)
        tgt = torch.tensor([[wx, wy, args.chase_target_z]], device=sim.device)
        if smooth_eye is None:
            smooth_eye, smooth_tgt = eye.clone(), tgt.clone()
        else:
            a = min(1.0, dt / 0.2)
            smooth_eye = smooth_eye + a * (eye - smooth_eye)
            smooth_tgt = smooth_tgt + a * (tgt - smooth_tgt)
        chase.set_world_poses_from_view(smooth_eye, smooth_tgt)

        # Head camera: rigidly on the base, NOT smoothed. The chase cam is cinematography and may
        # lag; this one is the robot's eye, and a filtered eye would hand the VLM a bearing taken
        # from a pose the robot is not in.
        head_z = HEAD_OFFSET_Z + (height - NEUTRAL_STAND_HEIGHT)
        hx = wx + HEAD_OFFSET_X * c - HEAD_OFFSET_Y * s
        hy = wy + HEAD_OFFSET_X * s + HEAD_OFFSET_Y * c
        head.set_world_poses_from_view(
            torch.tensor([[hx, hy, head_z]], device=sim.device),
            torch.tensor([[hx + c, hy + s, head_z]], device=sim.device))

        sim.step()
        chase.update(dt=sim.get_physics_dt())
        room.update(dt=sim.get_physics_dt())
        head.update(dt=sim.get_physics_dt())

        odom.publish(wx, wy, wyaw, now)
        # `.clone()` is load-bearing: the camera's output buffer is reused next frame, so handing
        # the HTTP thread a view of it would let a snapshot change under the encoder mid-request.
        state.publish(wx, wy, wyaw, height,
                      head.data.output["rgb"].torch[0, ..., :3].clone().cpu().numpy())

        # The RTX renderer accumulates: the first frames come back flat grey regardless of what is
        # in front of the camera. Step through WARMUP_FRAMES before believing anything, and do not
        # let them into the frame numbering or the fps median.
        warm += 1
        if warm <= WARMUP_FRAMES:
            if warm == 1:
                print(f"[capture] warming the renderer ({WARMUP_FRAMES} frames)...", flush=True)
            t0 = now       # keep the capture clock starting at the first REAL frame
            continue

        iio.imwrite(f"{args.out}/chase_{i:04d}.jpg",
                    chase.data.output["rgb"].torch[0, ..., :3].cpu().numpy(), quality=92)
        iio.imwrite(f"{args.out}/room_{i:04d}.jpg",
                    room.data.output["rgb"].torch[0, ..., :3].cpu().numpy(), quality=92)
        # The robot's own view, saved alongside: a video about what the robot perceived is not
        # honest if the only thing on screen is a camera the robot does not have.
        iio.imwrite(f"{args.out}/head_{i:04d}.jpg",
                    head.data.output["rgb"].torch[0, ..., :3].cpu().numpy(), quality=90)
        meta.append({"i": i, "t": now - t0, "wall": now, "x": wx, "y": wy, "yaw": wyaw,
                     "cmd_vx": vx, "cmd_vy": vy, "cmd_omega": omega, "height": height,
                     "cmds_seen": feed.count})
        if i % 60 == 0:
            print(f"[capture] frame {i:4d}  t={now - t0:6.1f}s  pos=({wx:+.2f},{wy:+.2f}) "
                  f"yaw={math.degrees(wyaw):+7.1f}deg  cmd=({vx:+.2f},{vy:+.2f},{omega:+.2f})",
                  flush=True)
        i += 1
        if args.still and i >= 2:
            break

    dts = [b["wall"] - a["wall"] for a, b in zip(meta, meta[1:])] or [1 / 24]
    dts.sort()
    median_dt = dts[len(dts) // 2]
    with open(f"{args.out}/telemetry.json", "w") as fh:
        json.dump({"dt": median_dt, "fps": 1.0 / median_dt if median_dt else 24.0,
                   "frames": len(meta), "meta": meta}, fh)
    print(f"[capture] wrote {len(meta)} frames at ~{1.0 / median_dt:.1f} fps -> {args.out}",
          flush=True)

    if httpd is not None:
        httpd.shutdown()
    simulation_app.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
