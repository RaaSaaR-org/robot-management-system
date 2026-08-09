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

@status new -- capture rig for demo footage; not part of the shipped robot software
"""
from __future__ import annotations

import argparse
import ast
import json
import math
import os
import threading
import time

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

# Chase camera offset in the ROBOT's frame: behind, and offset to the WALL side so the racking and
# the DGX pallets end up behind the robot rather than a blank wall. Three-quarter rather than dead
# astern — it reads better, and a dead-astern camera in a room this size spends half the run outside
# the building. Positive CHASE_SIDE is the robot's left.
CHASE_BACK, CHASE_SIDE, CHASE_UP = 2.9, 1.5, 1.9

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

    meta: list[dict] = []
    smooth_eye = smooth_tgt = None
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

        # Chase cam, low-passed so it does not snap when yaw does, and clamped inside the walls —
        # an unclamped follow cam reverses through the building the moment the robot turns.
        c, s = math.cos(wyaw), math.sin(wyaw)
        ex = wx - CHASE_BACK * c - CHASE_SIDE * s
        ey = wy - CHASE_BACK * s + CHASE_SIDE * c
        ex = min(max(ex, ROOM_X[0] + CAM_MARGIN), ROOM_X[1] - CAM_MARGIN)
        ey = min(max(ey, ROOM_Y[0] + CAM_MARGIN), ROOM_Y[1] - CAM_MARGIN)
        eye = torch.tensor([[ex, ey, CHASE_UP]], device=sim.device)
        tgt = torch.tensor([[wx, wy, 1.0]], device=sim.device)
        if smooth_eye is None:
            smooth_eye, smooth_tgt = eye.clone(), tgt.clone()
        else:
            a = min(1.0, dt / 0.2)
            smooth_eye = smooth_eye + a * (eye - smooth_eye)
            smooth_tgt = smooth_tgt + a * (tgt - smooth_tgt)
        chase.set_world_poses_from_view(smooth_eye, smooth_tgt)

        sim.step()
        chase.update(dt=sim.get_physics_dt())
        room.update(dt=sim.get_physics_dt())

        odom.publish(wx, wy, wyaw, now)

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

    simulation_app.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
