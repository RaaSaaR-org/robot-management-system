"""MuJoCo sim node speaking the real Unitree G1 wire protocol.

Two jobs:

1. **DDS peer.** Subscribes `rt/arm_sdk` and `rt/dex3/{left,right}/cmd`, publishes
   `rt/lowstate`, `rt/dex3/{left,right}/state` and `rt/odommodestate`, and hosts
   the `sport` loco service (see loco_service.py). Any unmodified
   `unitree_sdk2py` script -- including Unitree's own
   `g1_arm5_sdk_dds_example.py` and `g1_loco_client_example.py` -- drives this
   process exactly as it drives the robot.

2. **Sidecar-compatible HTTP facade** (`--http-port`). Serves the subset of
   `g1_sidecar.py` that Agent Mode needs -- `/health`, `/cameras`,
   `/cameras/<n>/snapshot`, `/state`, `/loco/*` -- so the whole Collect→Act loop
   can be exercised with no hardware attached. The `/loco/*` routes deliberately
   do NOT poke LocoState directly: they go out through a real `LocoClient` over
   DDS and come back in through our own service, so the demo exercises the
   actual wire rather than a shortcut. Request validation and RPC status-code
   handling mirror the sidecar's, so a plan cannot come to depend on a
   sim-only leniency the robot will not grant.

Usage:

    export CYCLONEDDS_HOME=<...>            # see README.md
    python sim_node.py --domain 1 --http-port 8777
    mjpython sim_node.py --domain 1 --viewer          # macOS, live window

DDS domains: 0 = real robot, 1 = sim, 9 = mock/tests.
"""
from __future__ import annotations

import argparse
import base64
import io
import json
import math
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import mujoco
import numpy as np

from unitree_sdk2py.core.channel import (
    ChannelFactoryInitialize, ChannelPublisher, ChannelSubscriber,
)
from unitree_sdk2py.idl.default import (
    unitree_go_msg_dds__SportModeState_, unitree_hg_msg_dds__HandState_,
    unitree_hg_msg_dds__LowState_,
)
from unitree_sdk2py.idl.unitree_go.msg.dds_ import SportModeState_
from unitree_sdk2py.idl.unitree_hg.msg.dds_ import (
    HandCmd_, HandState_, LowCmd_, LowState_,
)
from unitree_sdk2py.utils.crc import CRC

try:
    from .joints import BASE_JOINTS, BODY, LHAND, N_BODY, N_HAND, RHAND, WEIGHT_IDX
    from .loco_service import LocoSimService
    from .loco_state import UINT32_MAX, LocoState, wrap_angle
except ImportError:  # plain-script invocation
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from joints import BASE_JOINTS, BODY, LHAND, N_BODY, N_HAND, RHAND, WEIGHT_IDX
    from loco_service import LocoSimService
    from loco_state import UINT32_MAX, LocoState, wrap_angle

DEFAULT_SCENE = (
    Path(__file__).resolve().parents[1]
    / "sim_evaluator" / "mjcf" / "g1_dex3_room_scene.xml"
)
TOPIC_ARM_SDK = "rt/arm_sdk"
TOPIC_LOWSTATE = "rt/lowstate"
TOPIC_ODOM = "rt/odommodestate"
TOPIC_HAND_CMD = "rt/dex3/{}/cmd"
TOPIC_HAND_STATE = "rt/dex3/{}/state"

ODOM_PUBLISH_HZ = 50.0
STATE_PUBLISH_HZ = 100.0

# Ceiling on physics ticks made up in one loop iteration. At dt=2 ms this is
# 0.5 s of sim time, enough to absorb an offscreen render, while keeping a host
# that genuinely cannot keep up from trying to catch up forever and locking the
# HTTP facade out. Falling behind is then visible as slow motion rather than as
# a frozen sim.
MAX_CATCHUP_STEPS = 250


class RenderRequest:
    """One pending offscreen render, fulfilled by the physics thread.

    MuJoCo's Renderer owns a GL context with thread affinity, and on macOS it
    does not survive being driven from an HTTP worker thread (and fights the
    passive viewer if both run). So HTTP handlers post a request here and block;
    the physics loop renders between steps and hands the JPEG back.
    """

    def __init__(self, camera: str) -> None:
        self.camera = camera
        self.done = threading.Event()
        self.jpeg: bytes | None = None
        self.error: str | None = None


class PoseResetRequest:
    """One pending base teleport, applied by the physics thread.

    Same reason as RenderRequest: mjData belongs to the loop that steps it, and
    an HTTP handler writing qpos mid-step corrupts the state rather than moving
    the robot.
    """

    def __init__(self, x: float, y: float, yaw: float) -> None:
        self.x, self.y, self.yaw = x, y, yaw
        self.done = threading.Event()
        self.error: str | None = None


class SimNode:
    def __init__(self, scene: Path, domain: int, verbose: bool = True) -> None:
        self.model = mujoco.MjModel.from_xml_path(str(scene))
        self.data = mujoco.MjData(self.model)
        mujoco.mj_forward(self.model, self.data)
        self.verbose = verbose
        self.scene = scene

        self.lock = threading.Lock()
        self.loco = LocoState()
        self._render_queue: list[RenderRequest] = []
        self._reset_queue: list[PoseResetRequest] = []
        self._renderer: mujoco.Renderer | None = None
        self.crc = CRC()

        # MuJoCo's own instability handling (mj_checkAcc -> mj_resetData) zeroes
        # data.time behind our back. Everything timed off that clock has to be
        # told; see _detect_clock_reset.
        self._last_time = float(self.data.time)
        self._last_bad_qacc = int(self.data.warning[mujoco.mjtWarning.mjWARN_BADQACC].number)
        self.reset_count = 0

        self._resolve_indices()
        self._init_dds()

        # The loco service shares our lock and reads simulation time, so RPC
        # handlers and the physics loop can never interleave mid-update.
        self.loco_service = LocoSimService(
            self.loco, self.lock, lambda: self.data.time, verbose=verbose
        )
        print(f"[SimNode] scene {scene.name}, DDS domain {domain}")
        print(f"[SimNode]   sub  {TOPIC_ARM_SDK}, rt/dex3/{{left,right}}/cmd")
        print(f"[SimNode]   pub  {TOPIC_LOWSTATE}, {TOPIC_ODOM}, rt/dex3/*/state")
        print("[SimNode]   rpc  rt/api/sport/{request,response}")
        if not self.has_base:
            print("[SimNode]   NOTE scene has no planar base -- loco velocity is a no-op")

    # ------------------------------------------------------------------ set-up

    def _resolve_indices(self) -> None:
        m = self.model

        def act(name: str) -> int:
            return mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_ACTUATOR, name)

        def qadr(name: str) -> int:
            jid = mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_JOINT, name)
            if jid < 0:
                raise KeyError(f"joint '{name}' not in {self.scene.name}")
            return int(m.jnt_qposadr[jid])

        self.act = {
            "body": [act(n) for n in BODY],
            "lh": [act(n) for n in LHAND],
            "rh": [act(n) for n in RHAND],
        }
        self.qadr = {
            "body": [qadr(n) for n in BODY],
            "lh": [qadr(n) for n in LHAND],
            "rh": [qadr(n) for n in RHAND],
        }
        for key, ids in self.act.items():
            missing = [n for n, i in zip({"body": BODY, "lh": LHAND, "rh": RHAND}[key], ids) if i < 0]
            if missing:
                raise KeyError(f"actuators missing from {self.scene.name}: {missing}")

        # The planar base only exists in the room scene; pick-place scenes are
        # fixed-base and simply ignore locomotion.
        def dofadr(name: str) -> int:
            jid = mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_JOINT, name)
            if jid < 0:
                raise KeyError(f"joint '{name}' not in {self.scene.name}")
            return int(m.jnt_dofadr[jid])

        self.base_act = [act(n) for n in BASE_JOINTS]
        self.has_base = all(i >= 0 for i in self.base_act)
        self.base_qadr = [qadr(n) for n in BASE_JOINTS] if self.has_base else []
        # Needed to zero base velocity on a pose reset. The base joints are all
        # 1-DOF (2 slide + 1 hinge), so qpos and qvel addresses run in parallel
        # here -- but only here, which is why this is looked up, not derived.
        self.base_dofadr = [dofadr(n) for n in BASE_JOINTS] if self.has_base else []

        self.head_cam = mujoco.mj_name2id(self.model, mujoco.mjtObj.mjOBJ_CAMERA, "head_camera")

    def _init_dds(self) -> None:
        self.tgt = {"body": np.zeros(N_BODY), "lh": np.zeros(N_HAND), "rh": np.zeros(N_HAND)}
        self.weight = 0.0
        self.arm_cmd_count = 0
        # Latched fall-back pose for the (1 - weight) share of the arm_sdk blend,
        # plus the weight it was latched at. See _hold_pose.
        self._hold: dict[str, np.ndarray] | None = None
        self._hold_weight = 0.0

        ChannelSubscriber(TOPIC_ARM_SDK, LowCmd_).Init(self._on_arm_sdk, 10)
        ChannelSubscriber(TOPIC_HAND_CMD.format("left"), HandCmd_).Init(
            lambda m: self._on_hand("lh", m), 10)
        ChannelSubscriber(TOPIC_HAND_CMD.format("right"), HandCmd_).Init(
            lambda m: self._on_hand("rh", m), 10)

        self.pub_low = ChannelPublisher(TOPIC_LOWSTATE, LowState_); self.pub_low.Init()
        self.pub_odom = ChannelPublisher(TOPIC_ODOM, SportModeState_); self.pub_odom.Init()
        self.pub_hand = {}
        for side, key in (("left", "lh"), ("right", "rh")):
            p = ChannelPublisher(TOPIC_HAND_STATE.format(side), HandState_); p.Init()
            self.pub_hand[key] = p

        self.msg_low = unitree_hg_msg_dds__LowState_()
        self.msg_odom = unitree_go_msg_dds__SportModeState_()
        self.msg_hand = {"lh": unitree_hg_msg_dds__HandState_(),
                         "rh": unitree_hg_msg_dds__HandState_()}

    # --------------------------------------------------------------- callbacks

    def _on_arm_sdk(self, msg: LowCmd_) -> None:
        with self.lock:
            self.weight = float(msg.motor_cmd[WEIGHT_IDX].q)
            self.tgt["body"] = np.array([msg.motor_cmd[i].q for i in range(N_BODY)])
            self.arm_cmd_count += 1

    def _on_hand(self, side: str, msg: HandCmd_) -> None:
        with self.lock:
            self.tgt[side] = np.array([msg.motor_cmd[i].q for i in range(N_HAND)])

    # -------------------------------------------------------------- physics

    def step(self, dt: float) -> None:
        with self.lock:
            weight = self.weight
            tgt = {k: v.copy() for k, v in self.tgt.items()}
            self.loco.step(dt, self.data.time)
            # pose.yaw is CONTINUOUS on purpose (loco_state.py): base_yaw is a
            # kp=20000 position actuator on a +-100 rad hinge, so a setpoint
            # wrapped to (-pi, pi] would step by 2*pi in one 2 ms tick the first
            # time the robot turned past 180 deg and blow the solver up. Wrapping
            # happens in measured_pose(), where a heading is reported.
            pose = (self.loco.pose.x, self.loco.pose.y, self.loco.pose.yaw)
            gesture = self.loco.arm_targets(self.data.time)
            hold = self._hold_pose(weight)

        for key in ("body", "lh", "rh"):
            # arm_sdk blend semantics: weight 1 gives the joints fully to the
            # publisher, weight 0 hands them back to the robot's own controller.
            # "Hold" is a LATCHED pose, captured when the publisher last let go
            # -- reading live qpos here would make ctrl[a] == qpos[a], i.e. zero
            # elastic torque, and the upper body would sag to its joint limits
            # under gravity (waist_pitch pins in ~2 s, tilting the head camera).
            blended = weight * tgt[key] + (1.0 - weight) * hold[key]
            for k, a in enumerate(self.act[key]):
                self.data.ctrl[a] = blended[k]

        if gesture:
            # A loco arm task (WaveHand/ShakeHand) claims only the joints it
            # actually drives, and only while it is playing -- so an arm_sdk
            # publisher keeps the rest, and gets everything back afterwards.
            for body_idx, q in gesture.items():
                self.data.ctrl[self.act["body"][body_idx]] = q

        if self.has_base:
            for a, q in zip(self.base_act, pose):
                self.data.ctrl[a] = q

        mujoco.mj_step(self.model, self.data)
        self._detect_clock_reset()

    def _hold_pose(self, weight: float) -> dict[str, np.ndarray]:
        """The pose the joints fall back to for the (1 - weight) share.

        Latched, not live: re-captured only when the blend weight *changes* --
        i.e. when authority moves between the arm_sdk publisher and the robot's
        own controller -- and held constant in between. That is what gives the
        position actuators something to pull against; see the comment in step().
        A publisher that releases at weight 0 therefore leaves the joints exactly
        where it put them, which is the semantics the SDK documents.

        Caller holds the lock.
        """
        if self._hold is None or weight != self._hold_weight:
            self._hold = {k: self.data.qpos[self.qadr[k]].copy()
                          for k in ("body", "lh", "rh")}
            self._hold_weight = weight
        return self._hold

    def _detect_clock_reset(self) -> None:
        """Notice MuJoCo auto-resetting mjData and re-sync everything timed.

        mj_checkAcc resets the whole of mjData -- including data.time -> 0 --
        when QACC goes bad. Nothing else in this process would notice: LocoState
        would re-arm every unexpired command against the new epoch (a 6 s command
        became 13.3 s of motion, and a long enough one became self-sustaining),
        the commanded base pose would teleport the robot back to where the state
        machine thought it was, and run_loop would free-run without sleeping.

        This is defence in depth. With the continuous-yaw fix the usual trigger
        is gone, but a reset is always possible (a scene change, a wild arm_sdk
        target), and failing loudly beats failing silently. Called from step()
        with the lock released, so it takes the lock itself for the LocoState
        mutation -- an RPC handler must not observe a half-recovered state.
        """
        now = float(self.data.time)
        bad_qacc = int(self.data.warning[mujoco.mjtWarning.mjWARN_BADQACC].number)
        if now >= self._last_time:
            self._last_time = now
            if bad_qacc != self._last_bad_qacc:
                print(f"[SimNode] WARNING MuJoCo flagged bad QACC "
                      f"({bad_qacc - self._last_bad_qacc} new) at t={now:.4f}")
                self._last_bad_qacc = bad_qacc
            return

        self.reset_count += 1
        with self.lock:
            x, y, yaw = self.measured_pose(wrap_yaw=False)
            self.loco.on_clock_reset()
            self.loco.sync_pose(x, y, yaw)
            # The reset restored the model's reference configuration, so that --
            # not the pose we had latched, and not whatever transient the stale
            # ctrl of this last tick produced -- is what the robot is holding now.
            self._hold = {k: self.model.qpos0[self.qadr[k]].copy()
                          for k in ("body", "lh", "rh")}
            self._hold_weight = self.weight
        print(f"[SimNode] WARNING MuJoCo auto-reset mjData "
              f"(t {self._last_time:.4f} -> {now:.4f}, bad-QACC count {bad_qacc}, "
              f"reset #{self.reset_count}). Dropped the active loco command and "
              f"adopted the measured pose ({x:.3f}, {y:.3f}, {yaw:.3f} rad) -- "
              f"the pose before the reset is LOST, not recoverable.")
        self._last_time = now
        self._last_bad_qacc = bad_qacc

    def publish_state(self) -> None:
        with self.lock:
            for i in range(N_BODY):
                self.msg_low.motor_state[i].q = float(self.data.qpos[self.qadr["body"][i]])
            self.msg_low.crc = self.crc.Crc(self.msg_low)
            self.pub_low.Write(self.msg_low)
            for key in ("lh", "rh"):
                msg = self.msg_hand[key]
                for i in range(N_HAND):
                    msg.motor_state[i].q = float(self.data.qpos[self.qadr[key][i]])
                self.pub_hand[key].Write(msg)

    def publish_odom(self) -> None:
        """Publish the MEASURED base pose, not the commanded one.

        They coincide while the position actuators track, but publishing what
        the simulator actually holds is the honest signal -- if the base ever
        stops tracking, the agent's navigation must see that.
        """
        with self.lock:
            x, y, yaw = self.measured_pose()
            self.msg_odom.position[0] = float(x)
            self.msg_odom.position[1] = float(y)
            self.msg_odom.position[2] = 0.0
            self.msg_odom.imu_state.rpy[2] = float(yaw)
            self.msg_odom.stamp.sec = int(self.data.time)
            self.msg_odom.stamp.nanosec = int((self.data.time % 1.0) * 1e9)
            self.pub_odom.Write(self.msg_odom)

    def measured_pose(self, wrap_yaw: bool = True) -> tuple[float, float, float]:
        """Base pose straight out of qpos.

        The base_yaw hinge accumulates without limit (that is what keeps the
        actuator setpoint continuous), so the reported heading is wrapped to
        (-pi, pi] -- which is also what a real G1 reports, its rpy coming out of
        a quaternion. Pass `wrap_yaw=False` for the raw carrier angle, which is
        what has to be fed back into LocoState.
        """
        if not self.has_base:
            return (0.0, 0.0, 0.0)
        q = self.data.qpos
        yaw = float(q[self.base_qadr[2]])
        return (float(q[self.base_qadr[0]]), float(q[self.base_qadr[1]]),
                wrap_angle(yaw) if wrap_yaw else yaw)

    # ------------------------------------------------------------ pose reset

    def request_pose_reset(self, x: float, y: float, yaw: float,
                           timeout: float = 5.0) -> str | None:
        """Teleport the base back to a known pose. SIM ONLY -- no real robot can.

        Queued for the physics loop rather than applied here: this runs on an
        HTTP thread, and writing qpos underneath mj_step is how you get a
        corrupted state instead of a moved robot.

        Returns None on success, an error string otherwise.
        """
        if not self.has_base:
            return "scene has no planar base to reset"
        req = PoseResetRequest(x, y, yaw)
        with self.lock:
            self._reset_queue.append(req)
        if not req.done.wait(timeout):
            return "pose reset timed out (is the physics loop running?)"
        return req.error

    def drain_pose_resets(self) -> None:
        with self.lock:
            pending, self._reset_queue = self._reset_queue, []
        for req in pending:
            try:
                self._apply_pose_reset(req.x, req.y, req.yaw)
            except Exception as exc:  # noqa: BLE001
                req.error = str(exc)
            finally:
                req.done.set()

    def _apply_pose_reset(self, x: float, y: float, yaw: float) -> None:
        # Under the lock: LocoState is shared with the DDS callback threads that
        # deliver SetVelocity, and it is guarded by this lock everywhere else.
        # Without it a command arriving mid-reset could be half-applied.
        with self.lock:
            # Drop whatever the robot was told to do. Resetting the pose under a
            # live velocity command would have it walk away from the pose it was
            # just put in, for however long the command still had to run.
            self.loco.stop()
            for adr, value in zip(self.base_qadr, (x, y, yaw)):
                self.data.qpos[adr] = value
            for adr in self.base_dofadr:
                self.data.qvel[adr] = 0.0
            # The actuator setpoints have to move with the base, or the very
            # next step drags the robot straight back to where it was standing.
            for a, value in zip(self.base_act, (x, y, yaw)):
                self.data.ctrl[a] = value
            mujoco.mj_forward(self.model, self.data)
            # LocoState integrates from its own idea of the pose, and base_yaw
            # is the continuous carrier -- feed back the raw angle, not a
            # wrapped one, or the next command starts from a heading the robot
            # is not at. `step()` derives the base setpoint from this pose, so
            # this line is what actually makes the reset stick.
            q = self.data.qpos
            self.loco.sync_pose(
                float(q[self.base_qadr[0]]), float(q[self.base_qadr[1]]), float(q[self.base_qadr[2]])
            )

    # -------------------------------------------------------------- rendering

    def request_render(self, camera: str, timeout: float = 5.0) -> RenderRequest:
        req = RenderRequest(camera)
        with self.lock:
            self._render_queue.append(req)
        if not req.done.wait(timeout):
            req.error = "render timed out (is the physics loop running?)"
        return req

    def drain_renders(self) -> None:
        with self.lock:
            pending, self._render_queue = self._render_queue, []
        for req in pending:
            try:
                req.jpeg = self._render_jpeg(req.camera)
            except Exception as exc:  # noqa: BLE001
                req.error = str(exc)
            finally:
                req.done.set()

    def _render_jpeg(self, camera: str) -> bytes:
        from PIL import Image  # lazy: only the HTTP facade needs it

        if self._renderer is None:
            self._renderer = mujoco.Renderer(self.model, 480, 640)
        cam_id = mujoco.mj_name2id(self.model, mujoco.mjtObj.mjOBJ_CAMERA, camera)
        if cam_id < 0:
            raise KeyError(f"no camera '{camera}' in {self.scene.name}")
        self._renderer.update_scene(self.data, camera=camera)
        buf = io.BytesIO()
        Image.fromarray(self._renderer.render()).save(buf, format="JPEG", quality=85)
        return buf.getvalue()

    def camera_names(self) -> list[str]:
        names = []
        for i in range(self.model.ncam):
            n = mujoco.mj_id2name(self.model, mujoco.mjtObj.mjOBJ_CAMERA, i)
            if n:
                names.append(n)
        return names


# ---------------------------------------------------------------- HTTP facade


class _LocoBridge:
    """Real LocoClient, used by the HTTP facade so /loco/* traverses DDS.

    Constructing it means the facade's own requests go out on
    rt/api/sport/request and come back through LocoSimService -- the same round
    trip the robot-agent's sidecar makes against a physical G1. If we called
    LocoState directly the demo would prove nothing about the wire.

    One client per process, built lazily and cached. A FAILED build is
    deliberately NOT cached (mirrors g1_sidecar.py's _get_loco_client): "SDK
    missing" is permanent, but "loco service not discovered yet" is not, and
    the honest thing is to retry on the next request and report the current
    reason rather than a stale one until the process is restarted.
    """

    def __init__(self) -> None:
        self._client = None
        self._lock = threading.Lock()
        # Serialises the RPC calls themselves: ThreadingHTTPServer gives every
        # request its own thread, and LocoClient's stub is one shared
        # request/response pair, not written for concurrent use.
        self.rpc_lock = threading.Lock()

    def client(self):
        with self._lock:
            if self._client is not None:
                return self._client
            try:
                from unitree_sdk2py.g1.loco.g1_loco_client import LocoClient
                c = LocoClient()
                c.SetTimeout(3.0)
                c.Init()
            except Exception as exc:  # noqa: BLE001
                raise RuntimeError(f"LocoClient init failed: {exc}") from exc
            self._client = c
            return c


# --- /loco/* validation + dispatch -------------------------------------------
# g1_sidecar.py is the reference implementation for these routes; the shapes
# below -- required fields, 400s, rpc_code echoes -- are kept in sync with it.
# In particular the LocoClient convenience wrappers WaveHand / ShakeHand(0|1) /
# StopMove are NOT called: each of them discards the status code of the
# SetTaskId / SetVelocity request it makes, so a request that never reached the
# service would read back as a successful wave. What goes on the wire is
# identical to the wrappers (same api id, same JSON parameter).

# unitree_sdk2py/rpc/internal.py -- surfaced verbatim so a 503 says WHY.
_RPC_CODE_NAMES = {
    3001: "unknown error",
    3102: "client send failed (no DDS peer?)",
    3103: "api not registered on the client",
    3104: "api call timed out -- no response from the sport service",
    3105: "api id mismatch in the response",
    3106: "bad response data",
    3202: "server internal error",
    3203: "api not implemented by the service",
    3204: "bad parameter",
}


def _rpc_failed(what: str, code: int) -> dict:
    return {
        "ok": False,
        "error": f"{what} rejected by the sport service: rpc code {code} "
                 f"({_RPC_CODE_NAMES.get(code, 'see unitree_sdk2py/rpc/internal.py')})",
        "rpc_code": code,
    }


def _finite_number(value):
    """float(value) when it is a real, finite number -- else None.

    bool is rejected explicitly: in Python `True` is an int, and a JSON `true`
    slipping through as vx=1.0 m/s is exactly the kind of thing that must be a
    400, not a step forward.
    """
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    v = float(value)
    return v if math.isfinite(v) else None


def _loco_move(client, rpc_lock, body: dict) -> tuple[int, dict]:
    """POST /loco/move -- {"vx","vy","omega","duration_s"} -> SetVelocity.

    All four are required and must be finite numbers. duration_s is not
    optional on purpose: a velocity command expires after its duration, so a
    silently defaulted one would mean a silently different distance travelled.
    """
    values = {}
    for key in ("vx", "vy", "omega", "duration_s"):
        if key not in body:
            return 400, {"ok": False, "error": f"missing '{key}' (all of vx, vy, omega, duration_s are required)"}
        v = _finite_number(body[key])
        if v is None:
            return 400, {"ok": False, "error": f"'{key}' must be a finite number, got {body[key]!r}"}
        values[key] = v
    if values["duration_s"] < 0:
        return 400, {"ok": False, "error": f"'duration_s' must be >= 0, got {values['duration_s']}"}
    try:
        with rpc_lock:
            code = client.SetVelocity(
                values["vx"], values["vy"], values["omega"], values["duration_s"]
            )
    except Exception as e:  # noqa: BLE001
        return 503, {"ok": False, "error": f"SetVelocity failed: {e}"}
    if code != 0:
        return 503, _rpc_failed("SetVelocity", code)
    return 200, {"ok": True, "rpc_code": 0, **values}


def _dispatch_action(client, name: str, detail: dict) -> int:
    """Issue one gesture/stop request and return its RPC status code.

    Same api ids and JSON parameters as the LocoClient wrappers, without the
    wrappers' discarded status codes (see the section comment above):
        WaveHand(turn)  ==  SetTaskId(1 if turn else 0)
        ShakeHand(0)    ==  SetTaskId(2), first_shake_hand_stage_ = False
        ShakeHand(1)    ==  SetTaskId(3), first_shake_hand_stage_ = True
        ShakeHand(-1)   ==  the toggling wrapper, which DOES return the code
        StopMove()      ==  SetVelocity(0, 0, 0)   [SDK default duration 1.0 s]
    """
    if name == "wave":
        return client.SetTaskId(1 if detail["turn"] else 0)
    if name == "shake":
        stage = detail["stage"]
        if stage == 0:
            client.first_shake_hand_stage_ = False
            return client.SetTaskId(2)
        if stage == 1:
            client.first_shake_hand_stage_ = True
            return client.SetTaskId(3)
        return client.ShakeHand(stage)
    return client.SetVelocity(0.0, 0.0, 0.0)


def _loco_action(client, rpc_lock, body: dict) -> tuple[int, dict]:
    """POST /loco/action -- {"name": "wave"|"shake"|"stop", "args": {...}}.

    args: wave -> {"turn": bool}, shake -> {"stage": -1 toggle | 0 reach |
    1 return}, stop -> none.
    """
    name = body.get("name")
    if not isinstance(name, str) or not name.strip():
        return 400, {"ok": False, "error": 'body must be {"name": "wave"|"shake"|"stop", "args": {...}}'}
    name = name.strip().lower()
    args = body.get("args")
    if args is None:
        args = {}
    if not isinstance(args, dict):
        return 400, {"ok": False, "error": f"'args' must be an object, got {type(args).__name__}"}

    if name == "wave":
        turn = args.get("turn", False)
        if not isinstance(turn, bool):
            return 400, {"ok": False, "error": f"'args.turn' must be a boolean, got {turn!r}"}
        detail = {"turn": turn}
    elif name == "shake":
        stage = args.get("stage", -1)
        if isinstance(stage, bool) or not isinstance(stage, int):
            return 400, {"ok": False, "error": f"'args.stage' must be an integer (-1 toggle, 0 reach, 1 return), got {stage!r}"}
        detail = {"stage": stage}
    elif name == "stop":
        detail = {}
    else:
        return 400, {"ok": False, "error": f"unknown action '{name}' -- expected 'wave', 'shake' or 'stop'"}

    try:
        with rpc_lock:
            code = _dispatch_action(client, name, detail)
    except Exception as e:  # noqa: BLE001
        return 503, {"ok": False, "error": f"{name} failed: {e}"}
    if code != 0:
        return 503, _rpc_failed(name, code)
    return 200, {"ok": True, "action": name, "rpc_code": 0, **detail}


def _loco_fsm(client, rpc_lock, body: dict) -> tuple[int, dict]:
    """POST /loco/fsm -- {"id": int} -> SetFsmId.

    The id is required: defaulting a missing one (to FSM_DAMP, as this facade
    once did) means a typo'd body silently damps the robot instead of being
    told apart from a real request by a 400.
    """
    fsm_id = body.get("id")
    if isinstance(fsm_id, bool) or not isinstance(fsm_id, int):
        return 400, {"ok": False, "error": f"'id' must be an integer FSM id, got {fsm_id!r}"}
    try:
        with rpc_lock:
            code = client.SetFsmId(fsm_id)
    except Exception as e:  # noqa: BLE001
        return 503, {"ok": False, "error": f"SetFsmId({fsm_id}) failed: {e}"}
    if code != 0:
        return 503, _rpc_failed(f"SetFsmId({fsm_id})", code)
    return 200, {"ok": True, "rpc_code": 0, "id": fsm_id}


def _loco_stand_height(client, rpc_lock, body: dict) -> tuple[int, dict]:
    """POST /loco/stand-height -- {"preset": "high"|"low"} or {"metres": float}.

    Standing height is its own RPC (7104), not an FSM id. HighStand()/LowStand()
    are thin wrappers sending UINT32_MAX / 0 as sentinels through
    SetStandHeight -- sent directly here so the status code comes back.
    """
    preset = body.get("preset")
    metres = body.get("metres")
    if preset is not None:
        if preset == "high":
            value = float(UINT32_MAX)
        elif preset == "low":
            value = 0.0
        else:
            return 400, {"ok": False, "error": f"'preset' must be 'high' or 'low', got {preset!r}"}
    elif metres is not None:
        value = _finite_number(metres)
        if value is None or value <= 0.0:
            return 400, {"ok": False, "error": f"'metres' must be a positive finite number, got {metres!r}"}
    else:
        return 400, {"ok": False, "error": "body must carry 'preset' ('high'|'low') or 'metres'"}
    try:
        with rpc_lock:
            code = client.SetStandHeight(value)
    except Exception as e:  # noqa: BLE001
        return 503, {"ok": False, "error": f"SetStandHeight({value}) failed: {e}"}
    if code != 0:
        return 503, _rpc_failed(f"SetStandHeight({value})", code)
    return 200, {"ok": True, "rpc_code": 0, "preset": preset, "metres": metres}


def make_handler(node: SimNode, bridge: _LocoBridge):
    class Handler(BaseHTTPRequestHandler):
        def _send(self, code: int, payload: dict) -> None:
            body = json.dumps(payload).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args) -> None:  # keep the sim output readable
            pass

        # ---- GET ----
        def do_GET(self) -> None:
            if self.path == "/health":
                self._send(200, {"status": "ok", "connected": True, "sim": True,
                                 "scene": node.scene.name})
            elif self.path == "/cameras":
                self._send(200, {"cameras": node.camera_names()})
            elif self.path.startswith("/cameras/") and self.path.endswith("/snapshot"):
                name = self.path[len("/cameras/"):-len("/snapshot")]
                req = node.request_render(name)
                if req.error or req.jpeg is None:
                    self._send(503, {"ok": False, "error": req.error or "no frame"})
                    return
                self._send(200, {
                    "ok": True, "camera": name, "source": "mujoco",
                    # Both keys: g1_sidecar.py returns jpeg_base64 while
                    # HardwareClient historically read image_b64. Emitting both
                    # keeps this facade compatible with either reader.
                    "jpeg_base64": base64.b64encode(req.jpeg).decode(),
                    "image_b64": base64.b64encode(req.jpeg).decode(),
                })
            elif self.path == "/state" or self.path == "/state/fast":
                with node.lock:
                    joints = {n: float(node.data.qpos[a])
                              for n, a in zip(BODY, node.qadr["body"])}
                    x, y, yaw = node.measured_pose()
                self._send(200, {"ok": True, "sim": True, "joints": joints,
                                 "odometry": {"x": x, "y": y, "yaw": yaw}})
            elif self.path == "/loco/odom":
                # No planar base (e.g. the fixed-base pickplace scene) means no
                # odometry EXISTS. Answering (0,0,0) with ok:true would be a
                # fabricated pose -- and the navigator would happily integrate
                # it -- which is also why g1_sidecar.py 503s without a fresh
                # rt/odommodestate message.
                if not node.has_base:
                    self._send(503, {
                        "ok": False,
                        "error": (f"scene '{node.scene.name}' has no planar base "
                                  f"-- no odometry to report"),
                    })
                    return
                with node.lock:
                    x, y, yaw = node.measured_pose()
                self._send(200, {"ok": True, "x": x, "y": y, "yaw": yaw, "source": "sim"})
            else:
                self._send(404, {"error": "not found"})

        # ---- POST ----
        def do_POST(self) -> None:
            length = int(self.headers.get("Content-Length", 0))
            try:
                body = json.loads(self.rfile.read(length) or b"{}") if length else {}
            except json.JSONDecodeError as exc:
                self._send(400, {"ok": False, "error": f"invalid JSON: {exc}"})
                return

            # Handled before the DDS client is acquired: this is a simulator
            # affordance, not a robot command, and it must stay usable even
            # when the loco service is not up.
            if self.path == "/sim/reset-pose":
                target = {}
                for key in ("x", "y", "yaw"):
                    v = _finite_number(body.get(key, 0.0))
                    if v is None:
                        self._send(400, {
                            "ok": False,
                            "error": f"'{key}' must be a finite number, got {body.get(key)!r}",
                        })
                        return
                    target[key] = v
                err = node.request_pose_reset(target["x"], target["y"], target["yaw"])
                if err:
                    self._send(503, {"ok": False, "error": err})
                else:
                    x, y, yaw = node.measured_pose()
                    self._send(200, {"ok": True, "x": x, "y": y, "yaw": yaw})
                return

            if self.path not in ("/loco/move", "/loco/action", "/loco/fsm",
                                 "/loco/stand-height"):
                self._send(404, {"error": "not found"})
                return

            try:
                client = bridge.client()
            except RuntimeError as exc:
                self._send(503, {"ok": False, "error": str(exc)})
                return

            if self.path == "/loco/move":
                self._send(*_loco_move(client, bridge.rpc_lock, body))
            elif self.path == "/loco/action":
                self._send(*_loco_action(client, bridge.rpc_lock, body))
            elif self.path == "/loco/fsm":
                self._send(*_loco_fsm(client, bridge.rpc_lock, body))
            else:
                self._send(*_loco_stand_height(client, bridge.rpc_lock, body))

    return Handler


# ---------------------------------------------------------------------- main


def run_loop(node: SimNode, viewer=None) -> None:
    dt = node.model.opt.timestep
    state_every = max(1, int((1.0 / STATE_PUBLISH_HZ) / dt))
    odom_every = max(1, int((1.0 / ODOM_PUBLISH_HZ) / dt))
    wall0, n = time.time(), 0
    last_sync = 0.0
    resets = node.reset_count

    while viewer is None or viewer.is_running():
        # Physics catch-up. One step per iteration meant a slow iteration was
        # never made up: an offscreen render costs ~50 ms while dt is ~2 ms, so
        # while anything renders steadily -- which is exactly what Agent Mode's
        # `look` blocks do -- the sim advanced at a fraction of real time.
        # Callers still wait in WALL seconds, so a 90 deg turn commanded for 2 s
        # came back 5 deg done and then kept turning after the caller had
        # stopped waiting and measured. Bounded so a host that simply cannot
        # keep up degrades instead of spiralling.
        behind = (time.time() - wall0) - node.data.time
        catchup = min(int(behind / dt), MAX_CATCHUP_STEPS) if behind > dt else 1
        for _ in range(max(1, catchup)):
            node.step(dt)
            n += 1
            if n % state_every == 0:
                node.publish_state()
            if n % odom_every == 0:
                node.publish_odom()
            if node.reset_count != resets:
                break  # re-base the clock below before stepping any further
        node.drain_pose_resets()
        node.drain_renders()
        if viewer is not None and node.data.time - last_sync > 1 / 60:
            viewer.sync()
            last_sync = node.data.time
        if node.reset_count != resets:
            # data.time restarted; without re-basing, `lag` stays negative
            # forever and the loop stops sleeping -- the sim free-runs and every
            # remaining motion plays back at many times real time.
            resets = node.reset_count
            wall0, last_sync = time.time() - node.data.time, node.data.time
        lag = node.data.time - (time.time() - wall0)
        if lag > 0:
            time.sleep(min(lag, dt))


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--scene", type=Path, default=DEFAULT_SCENE)
    ap.add_argument("--domain", type=int,
                    default=int(os.environ.get("G1_SIM_DDS_DOMAIN", "1")))
    # lo0, not autodetermine. unitree_sdk2py hands CycloneDDS its own config with
    # NetworkInterface autodetermine="true" (channel_config.py), which overrides
    # CYCLONEDDS_URI. On a Mac with ~20 UP interfaces -- most without an address,
    # plus VPN tunnels -- autodetermine picks one that cannot carry discovery and
    # two local processes never find each other, silently: writes still return
    # True because they only queue locally. Loopback is both correct and fastest
    # for an all-local simulator. Override for a real robot on a LAN.
    ap.add_argument("--iface", default=os.environ.get("G1_SIM_DDS_IFACE", "lo0"))
    ap.add_argument("--http-port", type=int, default=0,
                    help="serve the sidecar-compatible facade on this port (0 = off)")
    ap.add_argument("--viewer", action="store_true",
                    help="open a live MuJoCo window (needs mjpython on macOS)")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args(argv)

    if not args.scene.exists():
        print(f"[SimNode] scene not found: {args.scene}", file=sys.stderr)
        return 2

    if args.iface:
        ChannelFactoryInitialize(args.domain, args.iface)
    else:
        ChannelFactoryInitialize(args.domain)

    node = SimNode(args.scene, args.domain, verbose=not args.quiet)

    httpd = None
    if args.http_port:
        httpd = ThreadingHTTPServer(("0.0.0.0", args.http_port),
                                    make_handler(node, _LocoBridge()))
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        print(f"[SimNode]   http :{args.http_port} "
              f"(/health /cameras /state /loco/*) -- point HARDWARE_SIDECAR_URL here")

    try:
        if args.viewer:
            import mujoco.viewer
            with mujoco.viewer.launch_passive(node.model, node.data) as v:
                v.cam.azimuth, v.cam.elevation, v.cam.distance = 225.0, -20.0, 7.0
                v.cam.lookat[:] = [0.5, 0.0, 0.9]
                run_loop(node, v)
        else:
            run_loop(node)
    except KeyboardInterrupt:
        print("\n[SimNode] stopped")
    finally:
        if httpd is not None:
            httpd.shutdown()
    return 0


if __name__ == "__main__":
    sys.exit(main())
