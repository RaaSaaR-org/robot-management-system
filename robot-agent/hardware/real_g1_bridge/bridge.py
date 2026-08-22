#!/usr/bin/env python3
"""
@file bridge.py
@description Real-robot closed-loop client for the G1 EDU + Dex3-1 apple-to-plate
             use case (NO ROS — replaces NVIDIA's Jetson-Thor/Isaac-ROS deployment
             leg of the GR00T E2E tutorial with our vla-server + RMS stack).
@feature hardware/real_g1_bridge

Reads the real Unitree G1's state over CycloneDDS (unitree_sdk2py):
    rt/lowstate            29 body joints (legs 0..11 | waist 12..14 | arms 15..28)
    rt/dex3/left/state     7 Dex3-1 joints
    rt/dex3/right/state    7 Dex3-1 joints
grabs RealSense D435 RGB frames (640x480 native, head-mounted ego view),
assembles the 43-dim state in the CONTRACT.md layout
    [left_leg 0:6 | right_leg 6:12 | waist 12:15 | left_arm 15:22 |
     right_arm 22:29 | left_hand 29:36 | right_hand 36:43]
and POSTs to vla-server /predict (task "move the apple to the plate").
The server returns a (16, 31) action chunk
    [L-arm 7 | R-arm 7 | L-hand 7 | R-hand 7 | waist 3]
executed with a receding horizon (--exec-horizon, default 8) at 30 Hz.

SAFETY MODEL (Stage 1: the real robot is READ-ONLY)
---------------------------------------------------
DRY-RUN is the default and the ONLY mode reachable without deliberate,
two-factor arming: sensors -> predict -> per-tick logging of the full 31-dim
would-be command. In dry-run **no DDS publisher for any cmd topic is even
constructed** — this process cannot emit a robot command by construction.

The write path exists only when BOTH are present:
    G1_BRIDGE_ARMED=1   (environment variable)
    --arm               (CLI flag)
When armed it publishes:
    rt/arm_sdk           unitree_hg LowCmd_ (35 motor slots): position targets +
                         kp/kd for waist (12..14) and arms (15..28) only;
                         motor_cmd[29].q is the arm-sdk blend weight, ramped
                         0 -> 1 over --ramp-seconds (NVIDIA blend_ratio analog)
                         and ramped back to 0 on ANY exit (normal, exception,
                         Ctrl+C, e-stop) via try/finally.
    rt/dex3/left/cmd     unitree_hg HandCmd_ (7 motors, RIS mode = position)
    rt/dex3/right/cmd

Mandatory rails (always on, dry-run AND armed):
  * per-tick joint delta clamp (--delta-clamp, default 0.06 rad)
  * absolute joint-limit clamp (table from mjcf/g1_dex3/g1_43dof_fixedbase.xml,
    shrunk by --limit-margin)
  * stale-state watchdog: abort + ramp-down if rt/lowstate older than --stale-ms
  * predict-latency watchdog: chunk discarded + pose held if /predict takes
    longer than --predict-watchdog seconds
  * Enter-key e-stop thread (press Enter -> ramp-down exit)
  * legs / locomotion are NEVER commanded. Policy rows longer than 31 dims
    (navigate_command, base_height_command, effort_*) are DISCARDED and logged.

Usage (see README.md in this directory):
    # Stage 1 — read-only sensor check (no predict, no camera needed):
    python bridge.py --no-predict --mock-camera --max-seconds 15

    # Stage 2 — dry-run with live predict (robot state + D435 + vla-server):
    python bridge.py --vla-server http://localhost:8000

    # Stage 3 — ARMED (robot day only, two-person rule, hand on e-stop):
    set G1_BRIDGE_ARMED=1
    python bridge.py --arm --ramp-seconds 3 --exec-horizon 8

    # Mock validation (no robot): driven by mock_loop.py on DDS domain 9.

@status new — loopback-validated on DDS domain 9 via mock_loop.py; the armed
        path against the physical G1 is robot-day gated (see
        docs/real-g1-apple-runbook.md for open verification items).
"""

import argparse
import json
import os
import sys
import threading
import time

import numpy as np

# ---------------------------------------------------------------------------
# Contract constants ($UNITREE_ROOT/_data/apple_pnp/CONTRACT.md)
# ---------------------------------------------------------------------------
TASK_INSTRUCTION = "move the apple to the plate"
STATE_DIM = 43
ACTION_DIM = 31
CHUNK_SIZE = 16
NUM_BODY = 29
NUM_HAND = 7

LOWSTATE_TOPIC = "rt/lowstate"
LEFT_HAND_STATE_TOPIC = "rt/dex3/left/state"
RIGHT_HAND_STATE_TOPIC = "rt/dex3/right/state"
ARM_SDK_TOPIC = "rt/arm_sdk"
LEFT_HAND_CMD_TOPIC = "rt/dex3/left/cmd"
RIGHT_HAND_CMD_TOPIC = "rt/dex3/right/cmd"

# rt/lowstate motor indices (G1 29-DoF SDK order == contract order)
WAIST_IDX = list(range(12, 15))          # yaw, roll, pitch
LEFT_ARM_IDX = list(range(15, 22))
RIGHT_ARM_IDX = list(range(22, 29))
ARM_WAIST_IDX = WAIST_IDX + LEFT_ARM_IDX + RIGHT_ARM_IDX   # all commanded body motors
WEIGHT_MOTOR_IDX = 29                     # kNotUsedJoint0: arm-sdk blend weight channel
LOWCMD_NUM_MOTORS = 35                    # unitree_hg LowCmd_ motor_cmd length

# Action vector layout (31): index -> body-motor index (None = hand joint)
#   action[0:7]   left arm   -> motors 15..21
#   action[7:14]  right arm  -> motors 22..28
#   action[14:21] left hand  -> dex3 left motors 0..6
#   action[21:28] right hand -> dex3 right motors 0..6
#   action[28:31] waist      -> motors 12..14
ACT_LEFT_ARM = slice(0, 7)
ACT_RIGHT_ARM = slice(7, 14)
ACT_LEFT_HAND = slice(14, 21)
ACT_RIGHT_HAND = slice(21, 28)
ACT_WAIST = slice(28, 31)

# Absolute joint limits [rad] in ACTION order, from the repo's own MJCF
# (robot-agent/hardware/sim_evaluator/mjcf/g1_dex3/g1_43dof_fixedbase.xml,
# which mirrors the Unitree URDF). Shrunk at runtime by --limit-margin.
JOINT_LIMITS_31 = [
    # left arm
    ("left_shoulder_pitch", -3.0892, 2.6704),
    ("left_shoulder_roll", -1.5882, 2.2515),
    ("left_shoulder_yaw", -2.618, 2.618),
    ("left_elbow", -1.0472, 2.0944),
    ("left_wrist_roll", -1.97222, 1.97222),
    ("left_wrist_pitch", -1.61443, 1.61443),
    ("left_wrist_yaw", -1.61443, 1.61443),
    # right arm
    ("right_shoulder_pitch", -3.0892, 2.6704),
    ("right_shoulder_roll", -2.2515, 1.5882),
    ("right_shoulder_yaw", -2.618, 2.618),
    ("right_elbow", -1.0472, 2.0944),
    ("right_wrist_roll", -1.97222, 1.97222),
    ("right_wrist_pitch", -1.61443, 1.61443),
    ("right_wrist_yaw", -1.61443, 1.61443),
    # left hand (Dex3-1, DDS state index order)
    ("left_hand_thumb_0", -1.0472, 1.0472),
    ("left_hand_thumb_1", -0.724312, 1.0472),
    ("left_hand_thumb_2", 0.0, 1.74533),
    ("left_hand_middle_0", -1.5708, 0.0),
    ("left_hand_middle_1", -1.74533, 0.0),
    ("left_hand_index_0", -1.5708, 0.0),
    ("left_hand_index_1", -1.74533, 0.0),
    # right hand — Dex3 DDS order is thumb, INDEX, middle (the L/R asymmetry;
    # matches g1_apple_env RIGHT_HAND_JOINT_NAMES / the AppleToPlate dataset).
    # Do NOT reorder to mirror the left hand.
    ("right_hand_thumb_0", -1.0472, 1.0472),
    ("right_hand_thumb_1", -1.0472, 0.724312),
    ("right_hand_thumb_2", -1.74533, 0.0),
    ("right_hand_index_0", 0.0, 1.5708),
    ("right_hand_index_1", 0.0, 1.74533),
    ("right_hand_middle_0", 0.0, 1.5708),
    ("right_hand_middle_1", 0.0, 1.74533),
    # waist
    ("waist_yaw", -2.618, 2.618),
    ("waist_roll", -0.52, 0.52),
    ("waist_pitch", -0.52, 0.52),
]
assert len(JOINT_LIMITS_31) == ACTION_DIM

# Gain config block for the armed write path. Values follow the proven
# xr_teleoperate G1_29_ArmController (shoulders/elbow kp 80 / kd 3, wrists
# kp 40 / kd 1.5, waist locked at kp 300 / kd 3) and the Dex3-1 controller
# (kp 1.5 / kd 0.2). ROBOT-DAY: revisit waist gains — xr_teleoperate only
# LOCKS the waist at 300/3; our policy actively moves it.
GAINS = {
    "shoulder_elbow": {"kp": 80.0, "kd": 3.0},   # motors 15..18, 22..25
    "wrist": {"kp": 40.0, "kd": 1.5},            # motors 19..21, 26..28
    "waist": {"kp": 300.0, "kd": 3.0},           # motors 12..14
    "hand": {"kp": 1.5, "kd": 0.2},              # dex3 motors 0..6
}
WRIST_MOTORS = set(range(19, 22)) | set(range(26, 29))
SHOULDER_ELBOW_MOTORS = set(range(15, 19)) | set(range(22, 26))


def log_json(obj: dict) -> None:
    """Emit one machine-readable JSON line on stdout (mock_loop parses these)."""
    print(json.dumps(obj), flush=True)


def log(msg: str) -> None:
    print(f"[bridge] {msg}", flush=True)


# ---------------------------------------------------------------------------
# DDS state ingestion (read-only; pattern from g1-sensor-toolkit/shadow_common.py)
# ---------------------------------------------------------------------------
class StateBuffer:
    """Thread-safe buffer for the latest robot state from the three topics."""

    def __init__(self):
        self.lock = threading.Lock()
        self.q_body = np.zeros(NUM_BODY, dtype=np.float64)
        self.q_left_hand = np.zeros(NUM_HAND, dtype=np.float64)
        self.q_right_hand = np.zeros(NUM_HAND, dtype=np.float64)
        self.t_lowstate = 0.0
        self.t_left_hand = 0.0
        self.t_right_hand = 0.0
        self.n_lowstate = 0
        self.n_crc_fail = 0
        self.mode_machine = 0

    def state43(self) -> np.ndarray:
        """Assemble the 43-dim CONTRACT state vector."""
        with self.lock:
            return np.concatenate(
                [self.q_body, self.q_left_hand, self.q_right_hand]
            ).astype(np.float32)

    def ages(self, now: float) -> dict:
        with self.lock:
            return {
                "lowstate_ms": (now - self.t_lowstate) * 1000.0 if self.t_lowstate else None,
                "left_hand_ms": (now - self.t_left_hand) * 1000.0 if self.t_left_hand else None,
                "right_hand_ms": (now - self.t_right_hand) * 1000.0 if self.t_right_hand else None,
            }


def create_state_subscribers(buffer: StateBuffer, check_crc: bool = True):
    """Create the three READ-ONLY subscribers. Returns them (hold refs!)."""
    from unitree_sdk2py.core.channel import ChannelSubscriber
    from unitree_sdk2py.idl.unitree_hg.msg.dds_ import LowState_, HandState_

    crc = None
    if check_crc:
        from unitree_sdk2py.utils.crc import CRC
        crc = CRC()

    def on_lowstate(msg):
        if crc is not None and crc.Crc(msg) != msg.crc:
            with buffer.lock:
                buffer.n_crc_fail += 1
            return
        n = min(NUM_BODY, len(msg.motor_state))
        with buffer.lock:
            for i in range(n):
                buffer.q_body[i] = msg.motor_state[i].q
            buffer.mode_machine = msg.mode_machine
            buffer.n_lowstate += 1
            buffer.t_lowstate = time.time()

    def on_left(msg):
        n = min(NUM_HAND, len(msg.motor_state))
        with buffer.lock:
            for i in range(n):
                buffer.q_left_hand[i] = msg.motor_state[i].q
            buffer.t_left_hand = time.time()

    def on_right(msg):
        n = min(NUM_HAND, len(msg.motor_state))
        with buffer.lock:
            for i in range(n):
                buffer.q_right_hand[i] = msg.motor_state[i].q
            buffer.t_right_hand = time.time()

    subs = []
    for topic, idl, cb, queue in (
        (LOWSTATE_TOPIC, LowState_, on_lowstate, 16),
        (LEFT_HAND_STATE_TOPIC, HandState_, on_left, 8),
        (RIGHT_HAND_STATE_TOPIC, HandState_, on_right, 8),
    ):
        s = ChannelSubscriber(topic, idl)
        s.Init(cb, queue)
        subs.append(s)
    return subs


# ---------------------------------------------------------------------------
# Cameras
# ---------------------------------------------------------------------------
class RealSenseCamera:
    """RealSense D435 RGB at native 640x480 @ 30 fps (pyrealsense2).

    NOTE: requires the D435 on a USB port of THIS machine. If robot day ends
    up streaming the head camera through PC2's teleimager image server
    instead, use g1-sensor-toolkit/g1_camera_grab.py as the pattern and feed
    frames via --camera-image (see README.md, "camera source").
    """

    def __init__(self, width=640, height=480, fps=30):
        import pyrealsense2 as rs  # lazy: only needed for the real camera

        self._rs = rs
        self.pipeline = rs.pipeline()
        cfg = rs.config()
        cfg.enable_stream(rs.stream.color, width, height, rs.format.rgb8, fps)
        self.pipeline.start(cfg)
        log(f"RealSense D435 color stream {width}x{height}@{fps} started")

    def get_frame(self) -> np.ndarray:
        frames = self.pipeline.wait_for_frames(timeout_ms=2000)
        color = frames.get_color_frame()
        return np.asanyarray(color.get_data())  # HxWx3 RGB uint8

    def close(self):
        try:
            self.pipeline.stop()
        except Exception:
            pass


class MockCamera:
    """Synthetic 640x480 tabletop frame (red apple + white plate on black cloth)."""

    def __init__(self, image_path: str | None = None):
        self._tick = 0
        self._base = None
        if image_path:
            from PIL import Image
            img = Image.open(image_path).convert("RGB").resize((640, 480))
            self._base = np.asarray(img, dtype=np.uint8).copy()

    def get_frame(self) -> np.ndarray:
        self._tick += 1
        if self._base is not None:
            return self._base
        img = np.zeros((480, 640, 3), dtype=np.uint8)
        img[:, :, :] = 20  # black tablecloth
        yy, xx = np.mgrid[0:480, 0:640]
        plate = (xx - 400) ** 2 + (yy - 300) ** 2 < 70 ** 2
        img[plate] = (230, 230, 225)
        apple = (xx - 220) ** 2 + (yy - 280) ** 2 < 28 ** 2
        img[apple] = (200, 30, 25)
        # tick marker so consecutive frames differ (JPEG-visible)
        img[0:8, 0 : (self._tick * 4) % 640] = (0, 255, 0)
        return img

    def close(self):
        pass


def encode_jpeg_b64(rgb: np.ndarray) -> str:
    """base64 JPEG, mirroring sim_evaluator/backends (vla-server wire format)."""
    import base64
    import io
    from PIL import Image

    buf = io.BytesIO()
    Image.fromarray(rgb).save(buf, format="JPEG", quality=85)
    return base64.b64encode(buf.getvalue()).decode("ascii")


# ---------------------------------------------------------------------------
# vla-server client (contract of sim_evaluator: POST /predict single frame +
# state + task -> {"actions": [[31 floats] * 16]})
# ---------------------------------------------------------------------------
class VLAClient:
    def __init__(self, server_url: str, watchdog_s: float):
        import requests

        self.url = server_url.rstrip("/")
        self.watchdog_s = watchdog_s
        self.session = requests.Session()
        self.http_timeout = max(2.0 * watchdog_s, 5.0)

        r = self.session.get(f"{self.url}/health", timeout=5.0)
        r.raise_for_status()
        try:
            cfg = self.session.get(f"{self.url}/config", timeout=5.0).json()
        except Exception:
            cfg = {}
        self.cameras = cfg.get("cameras", ["ego_view"])
        log(f"vla-server OK at {self.url} — config: action_dim="
            f"{cfg.get('action_dim')}, cameras={self.cameras}, "
            f"chunk_size={cfg.get('chunk_size')}")
        if cfg.get("action_dim") not in (None, ACTION_DIM):
            log(f"WARNING: server action_dim={cfg.get('action_dim')} != {ACTION_DIM} "
                f"(rows will be truncated/rejected accordingly)")

    def reset(self):
        try:
            self.session.post(f"{self.url}/reset", timeout=5.0)
        except Exception:
            pass

    def predict(self, frame_b64: str, state: np.ndarray, task: str):
        """Returns (actions, latency_s). actions is None if the latency
        watchdog tripped (chunk discarded — caller holds pose)."""
        payload = {
            "images": {cam: frame_b64 for cam in self.cameras},
            "state": [float(v) for v in state],
            "task": task,
        }
        t0 = time.time()
        r = self.session.post(f"{self.url}/predict", json=payload,
                              timeout=self.http_timeout)
        latency = time.time() - t0
        r.raise_for_status()
        if latency > self.watchdog_s:
            return None, latency
        return r.json()["actions"], latency


# ---------------------------------------------------------------------------
# Armed write path — ONLY constructed when G1_BRIDGE_ARMED=1 and --arm
# ---------------------------------------------------------------------------
class ArmedWriters:
    """Owns the rt/arm_sdk + rt/dex3/*/cmd publishers and the weight ramp.

    A dedicated 50 Hz publish thread keeps commands flowing while the main
    loop blocks in /predict (the robot's arm-sdk latches the last target).
    motor_cmd[29].q ramps toward `weight_target` at 1/ramp_seconds per
    second — the NVIDIA blend_ratio analog. `ramp_down_and_stop()` is called
    from the main try/finally on every exit path.
    """

    PUB_HZ = 50.0

    def __init__(self, buffer: StateBuffer, ramp_seconds: float, weight_cap: float):
        from unitree_sdk2py.core.channel import ChannelPublisher
        from unitree_sdk2py.idl.unitree_hg.msg.dds_ import LowCmd_, HandCmd_
        from unitree_sdk2py.idl.default import (
            unitree_hg_msg_dds__LowCmd_,
            unitree_hg_msg_dds__HandCmd_,
        )
        from unitree_sdk2py.utils.crc import CRC

        self.buffer = buffer
        self.ramp_seconds = max(ramp_seconds, 0.1)
        self.weight_cap = float(np.clip(weight_cap, 0.0, 1.0))
        self.weight = 0.0            # actual (published) blend weight
        self.weight_target = 0.0
        self.lock = threading.Lock()
        self.targets31 = None        # np.ndarray(31) or None (nothing yet)
        self._stop = threading.Event()
        self._thread_error = None    # set if _publish_loop dies (fail-safe)
        self.crc = CRC()

        self.pub_arm = ChannelPublisher(ARM_SDK_TOPIC, LowCmd_)
        self.pub_arm.Init()
        self.pub_lh = ChannelPublisher(LEFT_HAND_CMD_TOPIC, HandCmd_)
        self.pub_lh.Init()
        self.pub_rh = ChannelPublisher(RIGHT_HAND_CMD_TOPIC, HandCmd_)
        self.pub_rh.Init()

        # --- rt/arm_sdk LowCmd: gains + mode for waist/arms only; legs stay
        # untouched (mode 0, kp/kd 0) — the arm-sdk blender ignores them.
        # ROBOT-DAY VERIFY: zero-gain leg slots being ignored matches the
        # official g1 arm-sdk example, but confirm before first armed run.
        self.low_msg = unitree_hg_msg_dds__LowCmd_()
        self.low_msg.mode_pr = 0
        with buffer.lock:
            self.low_msg.mode_machine = buffer.mode_machine
        for i in ARM_WAIST_IDX:
            mc = self.low_msg.motor_cmd[i]
            mc.mode = 1
            if i in WRIST_MOTORS:
                g = GAINS["wrist"]
            elif i in SHOULDER_ELBOW_MOTORS:
                g = GAINS["shoulder_elbow"]
            else:
                g = GAINS["waist"]
            mc.kp, mc.kd = g["kp"], g["kd"]
            mc.dq = 0.0
            mc.tau = 0.0

        # --- Dex3 HandCmd: RIS mode byte = (id & 0x0F) | (status 0x01 << 4)
        # (position servo), gains from the proven Dex3_1_Controller.
        self.lh_msg = unitree_hg_msg_dds__HandCmd_()
        self.rh_msg = unitree_hg_msg_dds__HandCmd_()
        for msg in (self.lh_msg, self.rh_msg):
            for i in range(NUM_HAND):
                mc = msg.motor_cmd[i]
                mc.mode = (i & 0x0F) | (0x01 << 4)
                mc.kp = GAINS["hand"]["kp"]
                mc.kd = GAINS["hand"]["kd"]
                mc.dq = 0.0
                mc.tau = 0.0

        self.thread = threading.Thread(target=self._publish_loop, daemon=True)
        self.thread.start()
        log(f"ARMED writers up: {ARM_SDK_TOPIC}, {LEFT_HAND_CMD_TOPIC}, "
            f"{RIGHT_HAND_CMD_TOPIC} @ {self.PUB_HZ:.0f} Hz "
            f"(ramp {self.ramp_seconds}s, weight cap {self.weight_cap})")

    def set_targets(self, t31: np.ndarray):
        with self.lock:
            self.targets31 = t31.copy()

    def engage(self):
        with self.lock:
            self.weight_target = self.weight_cap

    def _publish_loop(self):
        dt = 1.0 / self.PUB_HZ
        try:
            while not self._stop.is_set():
                t_next = time.time() + dt
                with self.lock:
                    t31 = None if self.targets31 is None else self.targets31.copy()
                    # slew the blend weight toward its target
                    step = dt / self.ramp_seconds
                    if self.weight < self.weight_target:
                        self.weight = min(self.weight + step, self.weight_target)
                    elif self.weight > self.weight_target:
                        self.weight = max(self.weight - step, self.weight_target)
                    w = self.weight
                if t31 is not None:
                    for k, i in enumerate(LEFT_ARM_IDX):
                        self.low_msg.motor_cmd[i].q = float(t31[ACT_LEFT_ARM][k])
                    for k, i in enumerate(RIGHT_ARM_IDX):
                        self.low_msg.motor_cmd[i].q = float(t31[ACT_RIGHT_ARM][k])
                    for k, i in enumerate(WAIST_IDX):
                        self.low_msg.motor_cmd[i].q = float(t31[ACT_WAIST][k])
                    self.low_msg.motor_cmd[WEIGHT_MOTOR_IDX].q = w
                    self.low_msg.crc = self.crc.Crc(self.low_msg)
                    self.pub_arm.Write(self.low_msg)
                    lh = t31[ACT_LEFT_HAND]
                    rh = t31[ACT_RIGHT_HAND]
                    for i in range(NUM_HAND):
                        self.lh_msg.motor_cmd[i].q = float(lh[i])
                        self.rh_msg.motor_cmd[i].q = float(rh[i])
                    self.pub_lh.Write(self.lh_msg)
                    self.pub_rh.Write(self.rh_msg)
                time.sleep(max(0.0, t_next - time.time()))
        except Exception as e:
            # The publish thread is the ONLY writer of the arm-sdk blend weight.
            # If it dies we must NOT leave the weight latched high: force it to
            # 0 and emit explicit zero-weight commands directly from this thread
            # before it exits, so the robot's own controller reclaims arm
            # authority. (ramp_down_and_stop() alone can't help — it depends on
            # this very thread to slew + publish.)
            with self.lock:
                self._thread_error = e
                self.weight = 0.0
                self.weight_target = 0.0
            log(f"ERROR: arm-sdk publish thread crashed: {e!r} — forcing blend "
                f"weight to 0")
            try:
                self._emit_zero_weight(reps=10)
            except Exception as e2:
                log(f"ERROR: failed to emit zero-weight after crash: {e2!r}")

    def _emit_zero_weight(self, reps: int = 5):
        """Publish `reps` arm-sdk LowCmds with blend weight 0 so the robot's own
        controller reclaims arm authority. This is the ramp-down fail-safe and
        does NOT depend on the publish thread (which may have died). Must only
        be called once the publish loop is stopped or crashing, so there is no
        concurrent writer of self.low_msg / self.pub_arm."""
        self.low_msg.motor_cmd[WEIGHT_MOTOR_IDX].q = 0.0
        for _ in range(max(reps, 1)):
            self.low_msg.crc = self.crc.Crc(self.low_msg)
            self.pub_arm.Write(self.low_msg)
            time.sleep(0.01)

    def ramp_down_and_stop(self):
        """Ramp motor_cmd[29].q back to 0, then stop publishing and emit a few
        EXPLICIT zero-weight commands so the last word on the wire is provably 0
        — even if the publish thread has died. Called from the main try/finally
        on EVERY exit path."""
        with self.lock:
            self.weight_target = 0.0
            w0 = self.weight
        log(f"ramp-down: weight {w0:.2f} -> 0 over <= {self.ramp_seconds}s")
        deadline = time.time() + self.ramp_seconds + 2.0
        while time.time() < deadline:
            if not self.thread.is_alive():
                log("ramp-down: publish thread not alive — emitting zero-weight "
                    "directly")
                break
            with self.lock:
                if self.weight <= 1e-3:
                    break
            time.sleep(0.02)
        # Stop the (possibly still-slewing) publish thread, then emit explicit
        # zero-weight LowCmds ourselves. After join() there is no concurrent
        # writer, so this is the authoritative last word on rt/arm_sdk.
        self._stop.set()
        self.thread.join(timeout=2.0)
        with self.lock:
            self.weight = 0.0
            self.weight_target = 0.0
        try:
            self._emit_zero_weight(reps=5)
        except Exception as e:
            log(f"ERROR: failed to emit final zero-weight: {e!r}")
        with self.lock:
            final_w = self.weight
        log(f"ramp-down complete (final weight {final_w:.3f}); publishers stopped")


# ---------------------------------------------------------------------------
# Safety clamps
# ---------------------------------------------------------------------------
def build_limit_table(margin: float):
    lo = np.empty(ACTION_DIM)
    hi = np.empty(ACTION_DIM)
    for k, (_, a, b) in enumerate(JOINT_LIMITS_31):
        width = b - a
        m = min(margin, 0.4 * width)  # never invert narrow hand ranges
        lo[k], hi[k] = a + m, b - m
    return lo, hi


def clamp_targets(raw31, last31, delta_clamp, lim_lo, lim_hi):
    """Apply per-tick delta clamp (vs last commanded target) then absolute
    joint limits. Returns (clamped, n_delta_saturated, n_limit_clamped)."""
    raw = np.asarray(raw31, dtype=np.float64)
    delta = np.clip(raw - last31, -delta_clamp, delta_clamp)
    n_sat = int(np.sum(np.abs(raw - last31) > delta_clamp + 1e-9))
    stepped = last31 + delta
    clamped = np.clip(stepped, lim_lo, lim_hi)
    n_lim = int(np.sum(np.abs(clamped - stepped) > 1e-9))
    return clamped, n_sat, n_lim


# ---------------------------------------------------------------------------
# E-stop
# ---------------------------------------------------------------------------
def start_estop_thread(stop_event: threading.Event, reason: dict):
    """Enter-key e-stop: any line on stdin triggers the ramp-down exit.
    EOF (closed/absent stdin, e.g. under mock_loop) exits silently."""

    def watch():
        try:
            input()
        except (EOFError, OSError):
            return  # no interactive stdin — never trigger on EOF
        reason["reason"] = "estop_enter_key"
        stop_event.set()

    t = threading.Thread(target=watch, daemon=True)
    t.start()
    return t


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def parse_args(argv=None):
    p = argparse.ArgumentParser(
        description="Real-G1 closed-loop VLA bridge (apple-to-plate). "
                    "DRY-RUN by default; see README.md for the safety model.")
    p.add_argument("--vla-server", default="http://localhost:8000")
    p.add_argument("--task", default=TASK_INSTRUCTION)
    p.add_argument("--domain", type=int, default=0,
                   help="DDS domain: 0=real robot, 1=sim, 9=mock tests")
    p.add_argument("--iface", default="Ethernet 3",
                   help='NIC *name* on the robot LAN (CycloneDDS wants a name, '
                        'not an IP). Ignored with --no-iface.')
    p.add_argument("--no-iface", action="store_true",
                   help="init DDS without an explicit interface (loopback/mock)")
    p.add_argument("--hz", type=float, default=30.0, help="control-loop rate")
    p.add_argument("--exec-horizon", type=int, default=8,
                   help="execute first N of each 16-action chunk, then re-predict")
    p.add_argument("--arm", action="store_true",
                   help="enable the write path. ALSO requires env "
                        "G1_BRIDGE_ARMED=1; refuses to start otherwise.")
    p.add_argument("--ramp-seconds", type=float, default=3.0,
                   help="arm-sdk weight 0->1 ramp time (blend_ratio analog); "
                        "also the ramp-down time on exit")
    p.add_argument("--weight-cap", type=float, default=1.0,
                   help="upper bound for the arm-sdk blend weight (first armed "
                        "runs: start at e.g. 0.3)")
    p.add_argument("--delta-clamp", type=float, default=0.06,
                   help="max per-tick joint move [rad] (mandatory rail)")
    p.add_argument("--limit-margin", type=float, default=0.05,
                   help="shrink absolute joint limits by this margin [rad]")
    p.add_argument("--stale-ms", type=float, default=200.0,
                   help="abort if rt/lowstate is older than this")
    p.add_argument("--predict-watchdog", type=float, default=1.0,
                   help="discard chunk + hold pose if /predict exceeds this [s]")
    p.add_argument("--max-predict-failures", type=int, default=5,
                   help="abort after N consecutive predict errors")
    p.add_argument("--mock-camera", action="store_true",
                   help="synthetic 640x480 frame instead of the D435")
    p.add_argument("--camera-image", default=None,
                   help="use this image file as the (static) camera frame")
    p.add_argument("--no-predict", action="store_true",
                   help="stage-1 sensor check: read + log state only, no VLA")
    p.add_argument("--max-ticks", type=int, default=0,
                   help="stop after N control ticks (0 = unlimited)")
    p.add_argument("--max-seconds", type=float, default=0.0,
                   help="stop after N seconds (0 = unlimited)")
    p.add_argument("--log-every", type=int, default=1,
                   help="emit a cmd_tick JSON line every N ticks")
    p.add_argument("--state-wait", type=float, default=10.0,
                   help="max seconds to wait for the first full robot state")
    return p.parse_args(argv)


def main(argv=None) -> int:
    args = parse_args(argv)

    # ----- two-factor arming gate ------------------------------------------
    env_armed = os.environ.get("G1_BRIDGE_ARMED", "") == "1"
    if args.arm and not env_armed:
        log("REFUSING to start: --arm given but G1_BRIDGE_ARMED=1 is not set. "
            "The write path needs BOTH. Exiting.")
        return 2
    armed = bool(args.arm and env_armed)
    if env_armed and not args.arm:
        log("note: G1_BRIDGE_ARMED=1 is set but --arm was not given -> DRY-RUN.")
    mode = "ARMED" if armed else "DRY-RUN"
    log(f"mode={mode} domain={args.domain} task={args.task!r} "
        f"hz={args.hz} exec_horizon={args.exec_horizon}")
    if armed and args.domain == 0:
        log("*** ARMED ON DOMAIN 0 (REAL ROBOT). Two-person rule, e-stop in "
            "hand, workspace clear. Press Enter at any time to ramp out. ***")

    # ----- DDS init (idempotent factory; toolkit-proven loopback pattern) ---
    from unitree_sdk2py.core.channel import ChannelFactoryInitialize
    if args.no_iface:
        ChannelFactoryInitialize(args.domain)
    else:
        ChannelFactoryInitialize(args.domain, args.iface)

    buffer = StateBuffer()
    subs = create_state_subscribers(buffer)  # noqa: F841 — keep refs (GC!)

    # ----- wait for a complete robot state ---------------------------------
    t0 = time.time()
    while time.time() - t0 < args.state_wait:
        with buffer.lock:
            ok = buffer.t_lowstate > 0 and buffer.t_left_hand > 0 and buffer.t_right_hand > 0
        if ok:
            break
        time.sleep(0.05)
    else:
        ages = buffer.ages(time.time())
        log(f"ERROR: no complete robot state within {args.state_wait}s "
            f"(ages={ages}, crc_fails={buffer.n_crc_fail}). Is the robot / "
            f"mock publisher up on domain {args.domain}?")
        return 3
    log(f"robot state live (lowstate msgs={buffer.n_lowstate}, "
        f"crc_fails={buffer.n_crc_fail})")

    # ----- camera ----------------------------------------------------------
    if args.mock_camera or args.camera_image:
        camera = MockCamera(args.camera_image)
        log("camera: MOCK" + (f" ({args.camera_image})" if args.camera_image else ""))
    elif args.no_predict:
        camera = MockCamera(None)  # not used, but keeps the loop uniform
        log("camera: none needed (--no-predict)")
    else:
        camera = RealSenseCamera()

    # ----- vla-server ------------------------------------------------------
    client = None
    if not args.no_predict:
        client = VLAClient(args.vla_server, args.predict_watchdog)
        client.reset()

    # ----- armed write path (publishers exist ONLY here) -------------------
    writers = None
    if armed:
        writers = ArmedWriters(buffer, args.ramp_seconds, args.weight_cap)

    # ----- control loop ----------------------------------------------------
    lim_lo, lim_hi = build_limit_table(args.limit_margin)
    stop_event = threading.Event()
    stop_reason = {"reason": "max_ticks_or_time"}
    start_estop_thread(stop_event, stop_reason)

    state = buffer.state43().astype(np.float64)
    # last commanded target = current measured pose (delta clamp anchor)
    last31 = np.concatenate([
        state[15:29],   # L-arm + R-arm
        state[29:43],   # L-hand + R-hand
        state[12:15],   # waist
    ])
    if writers is not None:
        writers.set_targets(last31)
        writers.engage()  # start the 0->1 weight ramp

    action_queue: list = []
    tick = 0
    predict_failures = 0
    exit_code = 0
    loop_dt = 1.0 / args.hz
    t_start = time.time()
    discarded_logged_chunk = -1
    chunk_no = 0

    try:
        while not stop_event.is_set():
            t_tick = time.time()
            if args.max_ticks and tick >= args.max_ticks:
                break
            if args.max_seconds and (t_tick - t_start) >= args.max_seconds:
                break

            # --- stale-state watchdog (mandatory) --------------------------
            # Guards ALL THREE state streams: a frozen Dex3 hand-state stream
            # would otherwise feed stale hand values into the 43-dim obs while
            # the loop keeps commanding.
            ages = buffer.ages(t_tick)
            stale = [
                f"{name}={None if a is None else round(a)}ms"
                for name, a in (
                    ("lowstate", ages["lowstate_ms"]),
                    ("left_hand", ages["left_hand_ms"]),
                    ("right_hand", ages["right_hand_ms"]),
                )
                if a is None or a > args.stale_ms
            ]
            if stale:
                stop_reason["reason"] = "stale_state_" + ",".join(stale)
                log(f"WATCHDOG: stale state ({'; '.join(stale)}; limit "
                    f"{args.stale_ms:.0f} ms) — aborting with ramp-down")
                exit_code = 4
                break

            state = buffer.state43().astype(np.float64)

            if args.no_predict:
                if tick % max(args.log_every, 1) == 0:
                    log_json({"type": "state_tick", "tick": tick,
                              "state43": [round(float(v), 5) for v in state],
                              "ages_ms": {k: (round(v, 1) if v else v)
                                          for k, v in ages.items()}})
                tick += 1
                time.sleep(max(0.0, loop_dt - (time.time() - t_tick)))
                continue

            # --- refill action queue (receding horizon) --------------------
            if not action_queue:
                frame = camera.get_frame()
                try:
                    actions, latency = client.predict(
                        encode_jpeg_b64(frame), state, args.task)
                    predict_failures = 0
                except Exception as e:
                    predict_failures += 1
                    log(f"predict error ({predict_failures}/"
                        f"{args.max_predict_failures}): {e} — holding pose")
                    if predict_failures >= args.max_predict_failures:
                        stop_reason["reason"] = "predict_failures"
                        exit_code = 5
                        break
                    actions, latency = None, None
                if actions is None:
                    if latency is not None:
                        log_json({"type": "predict_slow", "tick": tick,
                                  "latency_s": round(latency, 3),
                                  "action": "chunk_discarded_hold_pose"})
                    # hold pose: keep last31, no new actions this tick
                else:
                    chunk_no += 1
                    rows = [list(map(float, r)) for r in actions]
                    # navigate_command / base_height_command / efforts:
                    # DISCARD anything beyond the 31 executed dims, log once.
                    if rows and len(rows[0]) > ACTION_DIM:
                        if discarded_logged_chunk != chunk_no:
                            discarded_logged_chunk = chunk_no
                            extra = rows[0][ACTION_DIM:]
                            log_json({
                                "type": "discarded_dims", "chunk": chunk_no,
                                "n_extra": len(extra),
                                "note": "navigate_command/base_height_command/"
                                        "effort_* are never executed (legs/"
                                        "locomotion forbidden)",
                                "first_row_extra": [round(v, 5) for v in extra],
                            })
                        rows = [r[:ACTION_DIM] for r in rows]
                    if rows and len(rows[0]) != ACTION_DIM:
                        log(f"predict returned {len(rows[0])}-dim rows, "
                            f"expected {ACTION_DIM} — discarding chunk")
                        rows = []
                    action_queue = rows[: max(args.exec_horizon, 1)]
                    if latency is not None:
                        log_json({"type": "predict_ok", "tick": tick,
                                  "chunk": chunk_no,
                                  "latency_s": round(latency, 3),
                                  "rows": len(rows)})

            # --- execute next action (or hold) -----------------------------
            if action_queue:
                raw31 = action_queue.pop(0)
                target31, n_sat, n_lim = clamp_targets(
                    raw31, last31, args.delta_clamp, lim_lo, lim_hi)
                last31 = target31
            else:
                n_sat = n_lim = 0  # holding pose

            if writers is not None:
                writers.set_targets(last31)
                w = writers.weight
            else:
                w = 0.0

            if tick % max(args.log_every, 1) == 0:
                log_json({
                    "type": "cmd_tick", "tick": tick, "armed": armed,
                    "weight": round(w, 4),
                    "delta_saturated": n_sat, "limit_clamped": n_lim,
                    "targets31": [round(float(v), 5) for v in last31],
                })
            tick += 1
            time.sleep(max(0.0, loop_dt - (time.time() - t_tick)))
    except KeyboardInterrupt:
        stop_reason["reason"] = "keyboard_interrupt"
        log("Ctrl+C — ramping down")
    finally:
        # ANY exit path (normal, watchdog, exception, Ctrl+C, e-stop):
        # the arm-sdk weight is ramped back to 0 before we let go.
        if writers is not None:
            writers.ramp_down_and_stop()
        camera.close()
        log_json({"type": "exit", "reason": stop_reason["reason"],
                  "ticks": tick, "exit_code": exit_code})
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
