"""
g1_sidecar.py — Hardware bridge between a Unitree G1 EDU (Dex3-1 hands) and the
Node.js Robot Agent. Mirrors the SO-101 sidecar's HTTP contract so the existing
TeleoperationService / HardwareClient / SkillExecutor work unchanged — only the
underlying driver differs (Unitree DDS via lerobot's `unitree_g1`, instead of
serial).

⚠️ HARDWARE-PENDING / UNTESTED
  This sidecar is written to spec against lerobot's `unitree_g1` robot +
  teleoperator and the Unitree SDK2 (DDS). It cannot be exercised without a
  physical G1 on the network, so it has NOT been run. Verify joint names, the
  DDS network interface, and the lerobot `--robot.type/--teleop.type` flags
  against your unit before relying on it. See:
    temp/lerobot/src/lerobot/robots/unitree_g1/
    temp/lerobot/src/lerobot/teleoperators/unitree_g1/

Exposes a lightweight HTTP API on port 8767 (G1 EDU profile: HARDWARE_SIDECAR_URL):
  GET  /health        → {"status": "ok", "connected": true/false}
  GET  /state         → {"joints": [...], "imu": {...}|null, "timestamp": ...}
  GET  /state/fast    → joint read that keeps motors enabled (closed loop)
  POST /action        → {"<joint>": value, ...} → RAMPED + CLAMPED, then sent
  POST /estop         → clears the action-ramp state (soft stop, see caveat)
  GET  /cameras       → list available camera names
  GET  /cameras/<name>/snapshot → one-shot base64 JPEG
  GET  /pointcloud/sensors → list available depth/LiDAR sensor names
  GET  /pointcloud/<name>/snapshot → one-shot point cloud (flat XYZ + intensity)
  POST /record/start  → spawn lerobot-record (G1 teleop + dataset)
  POST /record/stop   → SIGINT the recording subprocess
  GET  /record/status → recording progress / dataset path

Run via:
  uv run python robot-agent/hardware/g1_sidecar.py

@status hardware-pending
"""

import base64
import json
import os
import struct
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from recorder import recorder
from pointcloud_replay import load_frame, resolve_replay_path

PORT = int(os.environ.get("G1_SIDECAR_PORT", "8767"))
ROBOT_ID = os.environ.get("G1_ROBOT_ID", "my_g1_edu")
# Unitree G1 talks over DDS on a network interface (see config_unitree_g1.py).
ROBOT_IP = os.environ.get("G1_ROBOT_IP", "192.168.123.164")
NET_INTERFACE = os.environ.get("G1_NET_INTERFACE", "eth0")

# ---------------------------------------------------------------------------
# READ-ONLY MODE (stage 1: telemetry only) — DEFAULT ON
# ---------------------------------------------------------------------------
# While G1_READ_ONLY != "0" this process has NO write path to the robot:
#   • the lerobot UnitreeG1 driver is never loaded (its connect() initializes a
#     rt/lowcmd DDS publisher — a command path must not even exist);
#   • POST /action and POST /record/start return 403;
#   • state comes from a ZMQ SUB to the read-only bridge on the robot's PC2
#     (g1_state_bridge_readonly.py, port 6001) — subscribe-only by design.
# Set G1_READ_ONLY=0 explicitly and deliberately to enable the command path.
READ_ONLY = os.environ.get("G1_READ_ONLY", "1").strip() != "0"
LOWSTATE_ENDPOINT = os.environ.get("G1_LOWSTATE_ENDPOINT", f"tcp://{ROBOT_IP}:6001")

# Depth / LiDAR sensors on the G1. Names must match
# robot-agent/src/embodiment/configs/g1*.yaml `depth_sensors`.
DEPTH_SENSORS = ["mid360_lidar", "d435i_depth"]

# 43 DOF: 29 G1 body + 14 Dex3-1 (7 per hand). Must match
# robot-agent/src/embodiment/configs/g1_edu.yaml and g1-edu.config.ts.
BODY_JOINTS = [
    "left_hip_pitch_joint", "left_hip_roll_joint", "left_hip_yaw_joint",
    "left_knee_joint", "left_ankle_pitch_joint", "left_ankle_roll_joint",
    "right_hip_pitch_joint", "right_hip_roll_joint", "right_hip_yaw_joint",
    "right_knee_joint", "right_ankle_pitch_joint", "right_ankle_roll_joint",
    "waist_yaw_joint", "waist_roll_joint", "waist_pitch_joint",
    "left_shoulder_pitch_joint", "left_shoulder_roll_joint", "left_shoulder_yaw_joint",
    "left_elbow_joint", "left_wrist_roll_joint", "left_wrist_pitch_joint", "left_wrist_yaw_joint",
    "right_shoulder_pitch_joint", "right_shoulder_roll_joint", "right_shoulder_yaw_joint",
    "right_elbow_joint", "right_wrist_roll_joint", "right_wrist_pitch_joint", "right_wrist_yaw_joint",
]
HAND_JOINTS = [
    f"{side}_hand_{finger}_joint"
    for side in ("left", "right")
    for finger in ("thumb_0", "thumb_1", "thumb_2", "index_0", "index_1", "middle_0", "middle_1")
]
JOINT_NAMES = BODY_JOINTS + HAND_JOINTS

# ---------------------------------------------------------------------------
# BLOCKER #2 — action ramping / rate-limiting (TASK-169)
# ---------------------------------------------------------------------------
# Per-joint position limits (rad) as ASYMMETRIC (lower, upper) tuples, taken from
# the real URDF-derived limits in src/robot/joint-configs/g1-edu.config.ts — the
# single source of truth the rest of the system uses. This is the hard clamp that
# protects against garbage VLA targets, so it MUST use the true asymmetric stops:
# the previous symmetric ±half-range allowed e.g. ~1.4 rad of knee hyperextension
# past the real -0.087 rad lower stop. (Dex3-1 hand limits are the config's
# placeholders — tune against the official Dex3-1 URDF before real hand control.)
# Keep in sync with g1-edu.config.ts (JOINT_NAMES order, by name).
_DEFAULT_LIMIT = 3.1416  # fallback half-range (rad) for any unmapped joint
POS_LIMITS: dict[str, tuple[float, float]] = {
    # Left Leg
    "left_hip_pitch_joint": (-2.5307, 2.8798),
    "left_hip_roll_joint": (-0.5236, 2.9671),
    "left_hip_yaw_joint": (-2.7576, 2.7576),
    "left_knee_joint": (-0.087267, 2.8798),
    "left_ankle_pitch_joint": (-0.87267, 0.5236),
    "left_ankle_roll_joint": (-0.2618, 0.2618),
    # Right Leg
    "right_hip_pitch_joint": (-2.5307, 2.8798),
    "right_hip_roll_joint": (-2.9671, 0.5236),
    "right_hip_yaw_joint": (-2.7576, 2.7576),
    "right_knee_joint": (-0.087267, 2.8798),
    "right_ankle_pitch_joint": (-0.87267, 0.5236),
    "right_ankle_roll_joint": (-0.2618, 0.2618),
    # Waist
    "waist_yaw_joint": (-2.618, 2.618),
    "waist_roll_joint": (-0.52, 0.52),
    "waist_pitch_joint": (-0.52, 0.52),
    # Left Arm
    "left_shoulder_pitch_joint": (-3.0892, 2.6704),
    "left_shoulder_roll_joint": (-1.5882, 2.2515),
    "left_shoulder_yaw_joint": (-2.618, 2.618),
    "left_elbow_joint": (-1.0472, 2.0944),
    "left_wrist_roll_joint": (-1.972222, 1.972222),
    "left_wrist_pitch_joint": (-1.61443, 1.61443),
    "left_wrist_yaw_joint": (-1.61443, 1.61443),
    # Right Arm
    "right_shoulder_pitch_joint": (-3.0892, 2.6704),
    "right_shoulder_roll_joint": (-2.2515, 1.5882),
    "right_shoulder_yaw_joint": (-2.618, 2.618),
    "right_elbow_joint": (-1.0472, 2.0944),
    "right_wrist_roll_joint": (-1.972222, 1.972222),
    "right_wrist_pitch_joint": (-1.61443, 1.61443),
    "right_wrist_yaw_joint": (-1.61443, 1.61443),
    # Left Hand / Dex3-1 (placeholders — see note above)
    "left_hand_thumb_0_joint": (-1.0472, 1.0472),
    "left_hand_thumb_1_joint": (0.0, 1.5708),
    "left_hand_thumb_2_joint": (0.0, 1.7453),
    "left_hand_index_0_joint": (-0.5236, 0.5236),
    "left_hand_index_1_joint": (0.0, 1.7453),
    "left_hand_middle_0_joint": (-0.5236, 0.5236),
    "left_hand_middle_1_joint": (0.0, 1.7453),
    # Right Hand / Dex3-1 (placeholders — see note above)
    "right_hand_thumb_0_joint": (-1.0472, 1.0472),
    "right_hand_thumb_1_joint": (0.0, 1.5708),
    "right_hand_thumb_2_joint": (0.0, 1.7453),
    "right_hand_index_0_joint": (-0.5236, 0.5236),
    "right_hand_index_1_joint": (0.0, 1.7453),
    "right_hand_middle_0_joint": (-0.5236, 0.5236),
    "right_hand_middle_1_joint": (0.0, 1.7453),
}

# Slew-rate config (overridable via env). max per-tick step = vel / control_hz.
def _pos_float(name: str, default: float) -> float:
    """Parse a strictly-positive float env var; fall back to default on
    missing/empty/non-numeric/non-positive (a 0 or garbage value would otherwise
    disable slew limiting or crash the sidecar at import)."""
    raw = os.environ.get(name)
    if raw is None or raw == "":
        return default
    try:
        val = float(raw)
    except ValueError:
        print(f"[G1 Sidecar] {name}={raw!r} not numeric; using {default}", flush=True)
        return default
    if val <= 0:
        print(f"[G1 Sidecar] {name}={val} must be > 0; using {default}", flush=True)
        return default
    return val


CONTROL_HZ = _pos_float("G1_CONTROL_HZ", 50.0)
MAX_JOINT_VEL = _pos_float("G1_MAX_JOINT_VEL", 1.0)  # rad/s, conservative
_MAX_STEP = MAX_JOINT_VEL / CONTROL_HZ  # rad per /action (both guaranteed > 0)

# Last position we actually COMMANDED per joint. Ramp state; the ramp advances
# this toward the requested target by at most _MAX_STEP each /action call.
_commanded_pos: dict[str, float] = {}

robot = None
robot_lock = threading.Lock()
connected = False


def _connect_unlocked() -> bool:
    """Connect to the G1 over DDS. Must hold robot_lock.

    Uses lerobot's UnitreeG1 driver. Import is lazy so the sidecar can boot
    (and answer /health) even where the Unitree SDK isn't installed.
    """
    global robot, connected
    if READ_ONLY:
        # NEVER load the lerobot driver in read-only mode — UnitreeG1.connect()
        # initializes a rt/lowcmd DDS publisher, i.e. a command path.
        return False
    try:
        from lerobot.robots.unitree_g1 import UnitreeG1, UnitreeG1Config  # type: ignore

        config = UnitreeG1Config(
            id=ROBOT_ID,
            robot_ip=ROBOT_IP,
            net_interface=NET_INTERFACE,
        )
        r = UnitreeG1(config)
        r.connect()
        robot = r
        connected = True
        print(f"[G1 Sidecar] ✅ Connected to G1 at {ROBOT_IP} via {NET_INTERFACE}", flush=True)
        return True
    except Exception as e:  # noqa: BLE001
        robot = None
        connected = False
        print(f"[G1 Sidecar] ⚠️  Could not connect ({e})", flush=True)
        return False


# ---------------------------------------------------------------------------
# IMU extraction (shared contract — feeds the humanoid fall-detection net)
# ---------------------------------------------------------------------------


def _coerce3(v):
    """Coerce a 3-sequence to [float,float,float], else None."""
    if isinstance(v, (list, tuple)) and len(v) >= 3:
        try:
            return [float(v[0]), float(v[1]), float(v[2])]
        except (TypeError, ValueError):
            return None
    return None


def _axes3(d, kx, ky, kz):
    """Pull a 3-vector from three scalar keys of a dict, else None."""
    if not isinstance(d, dict) or not (kx in d and ky in d and kz in d):
        return None
    try:
        return [float(d[kx]), float(d[ky]), float(d[kz])]
    except (TypeError, ValueError):
        return None


def _extract_imu(obs):
    """Best-effort IMU pull from a lerobot observation dict.

    @status hardware-pending — the EXACT lerobot/Unitree low-state key names
    are unverified without a physical G1, so we probe several conventions
    (nested `imu` object, flat dotted keys, per-axis keys). We NEVER fabricate:
    if nothing is found we return None and the caller OMITS the field.

    Returns {"rpy":[r,p,y], "gyro":[gx,gy,gz], "accel":[ax,ay,az]} with any
    sub-field that couldn't be sourced set to null.
    """
    if not isinstance(obs, dict):
        return None
    rpy = gyro = accel = None

    imu = obs.get("imu")
    if isinstance(imu, dict):
        rpy = _coerce3(imu.get("rpy")) or _axes3(imu, "roll", "pitch", "yaw")
        gyro = (
            _coerce3(imu.get("gyro"))
            or _coerce3(imu.get("angular_velocity"))
            or _axes3(imu, "gyro_x", "gyro_y", "gyro_z")
        )
        accel = (
            _coerce3(imu.get("accel"))
            or _coerce3(imu.get("acc"))
            or _coerce3(imu.get("linear_acceleration"))
            or _axes3(imu, "accel_x", "accel_y", "accel_z")
        )

    # Flat dotted-key fallbacks (lerobot frequently flattens observations).
    if rpy is None:
        rpy = _coerce3(obs.get("imu.rpy")) or _axes3(obs, "imu.roll", "imu.pitch", "imu.yaw")
    if gyro is None:
        gyro = (
            _coerce3(obs.get("imu.gyro"))
            or _axes3(obs, "imu.gyro.x", "imu.gyro.y", "imu.gyro.z")
            or _axes3(obs, "imu.angular_velocity.x", "imu.angular_velocity.y", "imu.angular_velocity.z")
        )
    if accel is None:
        accel = (
            _coerce3(obs.get("imu.accel"))
            or _axes3(obs, "imu.accel.x", "imu.accel.y", "imu.accel.z")
            or _axes3(obs, "imu.linear_acceleration.x", "imu.linear_acceleration.y", "imu.linear_acceleration.z")
        )

    if rpy is None and gyro is None and accel is None:
        return None
    return {"rpy": rpy, "gyro": gyro, "accel": accel}


# ---------------------------------------------------------------------------
# Read-only state path (ZMQ SUB → g1_state_bridge_readonly.py on PC2)
# ---------------------------------------------------------------------------


class _LowStateReader:
    """Subscribe-only LowState client for READ_ONLY mode.

    Holds the newest LowState dict published by the read-only bridge. No
    command socket exists in this process while READ_ONLY is active — port
    6000 (lowcmd) is never opened anywhere.
    """

    def __init__(self, endpoint: str) -> None:
        self.endpoint = endpoint
        self._latest: dict | None = None
        self._latest_ts = 0.0
        self._lock = threading.Lock()
        self._started = False

    def start(self) -> bool:
        if self._started:
            return True
        try:
            import zmq  # lazy — the only dependency of the read-only path
        except ImportError:
            print("[G1 Sidecar] pyzmq missing — read-only state unavailable", flush=True)
            return False
        ctx = zmq.Context.instance()
        sock = ctx.socket(zmq.SUB)
        sock.setsockopt_string(zmq.SUBSCRIBE, "")
        sock.setsockopt(zmq.CONFLATE, 1)  # keep only the newest sample
        sock.connect(self.endpoint)
        self._started = True
        threading.Thread(target=self._spin, args=(sock,), daemon=True).start()
        print(f"[G1 Sidecar] read-only LowState subscriber → {self.endpoint}", flush=True)
        return True

    def _spin(self, sock) -> None:
        while True:
            try:
                payload = sock.recv()
                msg = json.loads(payload.decode("utf-8"))
                data = msg.get("data") if isinstance(msg, dict) else None
                if isinstance(data, dict):
                    with self._lock:
                        self._latest = data
                        self._latest_ts = time.time()
            except Exception as e:  # noqa: BLE001
                print(f"[G1 Sidecar] lowstate recv error: {e}", flush=True)
                time.sleep(1.0)

    def latest(self, max_age_s: float = 2.0) -> dict | None:
        """Newest LowState dict, or None if nothing fresh arrived."""
        with self._lock:
            if self._latest is None or time.time() - self._latest_ts > max_age_s:
                return None
            return self._latest


_lowstate_reader = _LowStateReader(LOWSTATE_ENDPOINT)


def _get_state_readonly() -> dict:
    """Build the /state response from the read-only bridge feed.

    DDS motor index i ↔ BODY_JOINTS[i] — verified against lerobot's
    G1_29_JointIndex enum (0-5 left leg, 6-11 right leg, 12-14 waist,
    15-21 left arm, 22-28 right arm). Dex3-1 hands live on separate DDS
    topics, not in rt/lowstate, so hand joints are OMITTED here (never
    fabricated as 0.0).
    """
    if not _lowstate_reader.start():
        return {"joints": [], "connected": False, "simulated": False, "timestamp": time.time()}
    data = _lowstate_reader.latest()
    if data is None:
        return {"joints": [], "connected": False, "simulated": False, "timestamp": time.time()}
    motors = data.get("motor_state") or []
    joints = []
    for i, name in enumerate(BODY_JOINTS):
        if i < len(motors) and isinstance(motors[i], dict):
            joints.append({"name": name, "position": float(motors[i].get("q", 0.0))})
    result = {"joints": joints, "connected": True, "simulated": False, "timestamp": time.time()}
    imu_state = data.get("imu_state")
    if isinstance(imu_state, dict):
        rpy = _coerce3(imu_state.get("rpy"))
        gyro = _coerce3(imu_state.get("gyroscope"))
        accel = _coerce3(imu_state.get("accelerometer"))
        if rpy is not None or gyro is not None or accel is not None:
            result["imu"] = {"rpy": rpy, "gyro": gyro, "accel": accel}
    return result


def get_state(keep_alive: bool = False) -> dict:
    """Read joint positions. `keep_alive` keeps motors enabled for closed loop.

    Adds an `imu` field (radians / rad·s⁻¹ / m·s⁻²) when the driver exposes one;
    omitted otherwise (see _extract_imu — no fabricated values).
    """
    if READ_ONLY:
        return _get_state_readonly()
    with robot_lock:
        if not connected and not _connect_unlocked():
            return {"joints": [], "connected": False, "simulated": False, "timestamp": time.time()}
        try:
            obs = robot.get_observation()  # lerobot driver returns a flat obs dict
            joints = []
            for name in JOINT_NAMES:
                key = f"{name}.pos"
                joints.append({"name": name, "position": float(obs.get(key, 0.0))})
            result = {"joints": joints, "connected": True, "simulated": False, "timestamp": time.time()}
            imu = _extract_imu(obs)
            if imu is not None:
                result["imu"] = imu
            return result
        except Exception as e:  # noqa: BLE001
            return {"joints": [], "connected": False, "error": str(e), "timestamp": time.time()}


def _seed_commanded_unlocked() -> None:
    """Seed the ramp state from the live joint positions (once). Hold robot_lock.

    Seeding from the real current pose means the first /action ramps FROM where
    the robot actually is, not from 0 — avoiding a large initial jump. If the
    pose can't be read we let the exception propagate so the caller REFUSES the
    action: ramping from a false 0.0 would command a large jump away from the
    true pose on the very first tick (the opposite of slew limiting). Built into
    a local dict first so a mid-read failure never leaves _commanded_pos partial.
    """
    if _commanded_pos:
        return
    obs = robot.get_observation()  # may raise — caller treats it as action failure
    _commanded_pos.update(
        {name: float(obs.get(f"{name}.pos", 0.0)) for name in JOINT_NAMES}
    )


def send_action(action: dict) -> dict:
    """Send a joint-position action ({"<joint>": value, ...}), RAMPED + CLAMPED.

    BLOCKER #2 fix — slew-rate limiting:
      1. Every requested target is CLAMPED to the joint's real asymmetric
         position limits (POS_LIMITS, from g1-edu.config.ts).
      2. The commanded value moves toward the target by at most _MAX_STEP rad
         per call, where _MAX_STEP = G1_MAX_JOINT_VEL / G1_CONTROL_HZ. Large
         targets therefore RAMP across multiple /action calls instead of
         jumping in one tick.

    Approach: non-blocking, state-based. We hold the last commanded position per
    joint in `_commanded_pos` and advance it one bounded step per call. This
    fits the request/response endpoint model and does NOT hold robot_lock across
    any sleep, so /state (and thus IMU fall-detection) is never starved. The
    physical slew rate is correct when the caller drives /action at ~G1_CONTROL_HZ
    (the normal closed-loop case). If a single setpoint is sent once and not
    repeated, the robot stops part-way through the ramp — the SAFE failure mode;
    re-send the same target to keep converging.

    ⚠️ HONEST CAVEAT: this is RATE-LIMITING, not balance control. It removes
    jerky raw position jumps but does NOT keep a bipedal humanoid upright. True
    balance needs Unitree's whole-body / locomotion control mode (or a learned
    locomotion policy). Stage-4 closed-loop on real hardware still requires a
    balance controller + a safety gantry. See @status hardware-pending.
    """
    if READ_ONLY:
        return {"ok": False, "error": "G1_READ_ONLY — command path disabled (stage 1: telemetry only)"}
    with robot_lock:
        if not connected and not _connect_unlocked():
            return {"ok": False, "error": "not connected"}
        try:
            _seed_commanded_unlocked()
            ramped: dict[str, float] = {}
            converged = True
            for k, v in action.items():
                if k not in JOINT_NAMES:
                    continue
                lo, hi = POS_LIMITS.get(k, (-_DEFAULT_LIMIT, _DEFAULT_LIMIT))
                target = min(hi, max(lo, float(v)))  # clamp to joint limits
                cur = _commanded_pos.get(k, 0.0)
                delta = target - cur
                if delta > _MAX_STEP:
                    step = _MAX_STEP
                    converged = False
                elif delta < -_MAX_STEP:
                    step = -_MAX_STEP
                    converged = False
                else:
                    step = delta
                new_pos = cur + step
                _commanded_pos[k] = new_pos
                ramped[k] = new_pos
            cmd = {f"{k}.pos": float(p) for k, p in ramped.items()}
            robot.send_action(cmd)
            return {
                "ok": True,
                "applied": len(cmd),
                "converged": converged,
                "max_step_rad": _MAX_STEP,
            }
        except Exception as e:  # noqa: BLE001
            return {"ok": False, "error": str(e)}


def reset_ramp_state() -> dict:
    """Soft e-stop: clear the action-ramp state.

    Clearing `_commanded_pos` means the next /action re-seeds from the live joint
    positions, so we never ramp from a stale setpoint after a manual move or an
    estop. This does NOT physically stop the robot.

    ⚠️ HONEST CAVEAT: a true hardware e-stop requires Unitree's low-level
    emergency/damping mode (or cutting motor power) — that is @status
    hardware-pending and must be wired before any untethered Stage-4 run.
    """
    with robot_lock:
        _commanded_pos.clear()
    return {"ok": True, "message": "ramp state cleared; next /action re-seeds from live state"}


# ---------------------------------------------------------------------------
# BLOCKER #3 — REAL sensor ingest (RealSense / Livox / camera) + fallbacks
# ---------------------------------------------------------------------------
# All driver imports below are OPTIONAL (try/except ImportError) so this file
# imports — and the HTTP contract is exercised — on a machine with no drivers.
# Live sensor ingest is INDEPENDENT of the G1 DDS connection (USB / ROS2), so
# these paths do NOT require the robot to be `connected`.

_PC2_FMT = {1: "b", 2: "B", 3: "h", 4: "H", 5: "i", 6: "I", 7: "f", 8: "d"}  # PointField datatype → struct char

# Shared RealSense pipeline (depth + color), lazily started, reused by both the
# point-cloud and camera paths. RLock so init can nest under a frame grab.
_rs_pipeline = None
_rs_lock = threading.RLock()


def _ensure_realsense():
    """Lazily start a shared RealSense pipeline (depth + color). None if absent.

    Requires the `pyrealsense2` package AND a connected RealSense device.
    """
    global _rs_pipeline
    with _rs_lock:
        if _rs_pipeline is not None:
            return _rs_pipeline
        try:
            import pyrealsense2 as rs  # type: ignore  # optional
        except ImportError:
            return None
        try:
            w = int(os.environ.get("G1_REALSENSE_WIDTH", "640"))
            h = int(os.environ.get("G1_REALSENSE_HEIGHT", "480"))
            fps = int(os.environ.get("G1_REALSENSE_FPS", "30"))
            pipe = rs.pipeline()
            cfg = rs.config()
            cfg.enable_stream(rs.stream.depth, w, h, rs.format.z16, fps)
            cfg.enable_stream(rs.stream.color, w, h, rs.format.bgr8, fps)
            pipe.start(cfg)
            _rs_pipeline = pipe
            print(f"[G1 Sidecar] ✅ RealSense pipeline started ({w}x{h}@{fps})", flush=True)
            return pipe
        except Exception as e:  # noqa: BLE001
            print(f"[G1 Sidecar] RealSense unavailable ({e})", flush=True)
            return None


def _realsense_pointcloud(target_count: int):
    """Grab one RealSense depth frame, deproject to an XYZ cloud (base frame).

    Returns (positions_flat, intensities, has_intensity, "realsense") or None.
    Requires pyrealsense2 + numpy. RealSense optical axes (x-right, y-down,
    z-forward) are remapped to the contract base frame (x-forward, y-left,
    z-up) — APPROXIMATE: no extrinsic calibration to the torso is applied.
    """
    try:
        import pyrealsense2 as rs  # type: ignore  # optional
        import numpy as np  # type: ignore  # optional (required for this path)
    except ImportError:
        return None
    pipe = _ensure_realsense()
    if pipe is None:
        return None
    try:
        with _rs_lock:
            frames = pipe.wait_for_frames(timeout_ms=2000)
            depth = frames.get_depth_frame()
            if not depth:
                return None
            pc = rs.pointcloud()
            pts = pc.calculate(depth)
            verts = np.asanyarray(pts.get_vertices()).view(np.float32).reshape(-1, 3)
        verts = verts[verts[:, 2] > 0.0]  # drop invalid (zero-depth) points
        n = verts.shape[0]
        if target_count and n > target_count:
            verts = verts[:: max(1, n // target_count)]
        positions = []
        for x, y, z in verts:
            # optical (x-right, y-down, z-fwd) → base (x-fwd, y-left, z-up)
            positions.extend((float(z), float(-x), float(-y)))
        return positions, [], False, "realsense"
    except Exception as e:  # noqa: BLE001
        print(f"[G1 Sidecar] RealSense point cloud failed ({e})", flush=True)
        return None


def _realsense_color_jpeg():
    """One RealSense color frame as a base64 JPEG, or None. Needs cv2 + numpy."""
    try:
        import numpy as np  # type: ignore
        import cv2  # type: ignore
    except ImportError:
        return None
    pipe = _ensure_realsense()
    if pipe is None:
        return None
    try:
        with _rs_lock:
            frames = pipe.wait_for_frames(timeout_ms=2000)
            color = frames.get_color_frame()
            if not color:
                return None
            img = np.asanyarray(color.get_data())  # BGR8 → ready for cv2
        ok, buf = cv2.imencode(".jpg", img)
        if not ok:
            return None
        return base64.b64encode(buf).decode()
    except Exception as e:  # noqa: BLE001
        print(f"[G1 Sidecar] RealSense color frame failed ({e})", flush=True)
        return None


# --- Livox MID-360 via ROS2 (livox_ros_driver2 → sensor_msgs/PointCloud2) ----
_livox_source = None
_livox_lock = threading.Lock()


class _LivoxRos2Source:
    """Caches the latest PointCloud2 from `/livox/lidar` via a background spin.

    Requires `rclpy` + `sensor_msgs` (a sourced ROS2 env) and a running
    livox_ros_driver2. Best-effort sensor QoS to match the publisher.
    """

    def __init__(self, topic: str):
        self.topic = topic
        self._latest = None
        self._lock = threading.Lock()
        self._node = None

    def start(self) -> None:
        import rclpy  # type: ignore  # optional
        from sensor_msgs.msg import PointCloud2  # type: ignore

        if not rclpy.ok():
            rclpy.init(args=None)
        self._node = rclpy.create_node("g1_sidecar_livox")
        try:
            from rclpy.qos import QoSProfile, ReliabilityPolicy  # type: ignore

            qos = QoSProfile(depth=5)
            qos.reliability = ReliabilityPolicy.BEST_EFFORT
        except Exception:  # noqa: BLE001
            qos = 5  # depth-only fallback
        self._node.create_subscription(PointCloud2, self.topic, self._cb, qos)
        threading.Thread(target=self._spin, daemon=True).start()
        print(f"[G1 Sidecar] ✅ Livox ROS2 subscriber on {self.topic}", flush=True)

    def _spin(self) -> None:
        import rclpy  # type: ignore

        try:
            rclpy.spin(self._node)
        except Exception:  # noqa: BLE001
            pass

    def _cb(self, msg) -> None:
        with self._lock:
            self._latest = msg

    def latest(self, timeout_s: float):
        end = time.time() + timeout_s
        while time.time() < end:
            with self._lock:
                if self._latest is not None:
                    return self._latest
            time.sleep(0.02)
        with self._lock:
            return self._latest


def _parse_pointcloud2(msg, target_count: int):
    """Parse sensor_msgs/PointCloud2 → (positions_flat, intensities). numpy-free.

    Livox publishes points already in the sensor base frame (x-forward, y-left,
    z-up), so coordinates pass through unchanged.
    """
    fields = {f.name: f for f in msg.fields}
    if not {"x", "y", "z"}.issubset(fields):
        return [], []
    endian = ">" if msg.is_bigendian else "<"

    def acc(name):
        f = fields[name]
        return f.offset, endian + _PC2_FMT.get(f.datatype, "f")

    ox, fx = acc("x")
    oy, fy = acc("y")
    oz, fz = acc("z")
    iname = "intensity" if "intensity" in fields else ("reflectivity" if "reflectivity" in fields else None)
    if iname:
        oi, fi = acc(iname)

    data = bytes(msg.data)
    step = msg.point_step or 0
    n = (msg.width * msg.height) if msg.height else msg.width
    if step:
        n = min(n, len(data) // step)
    else:
        n = 0
    stride = max(1, n // target_count) if (target_count and n > target_count) else 1

    positions, intensities = [], []
    for i in range(0, n, stride):
        base = i * step
        positions.append(struct.unpack_from(fx, data, base + ox)[0])
        positions.append(struct.unpack_from(fy, data, base + oy)[0])
        positions.append(struct.unpack_from(fz, data, base + oz)[0])
        if iname:
            intensities.append(float(struct.unpack_from(fi, data, base + oi)[0]))
    if intensities:
        mx = max(intensities) or 1.0
        inv = 1.0 / mx if mx > 0 else 1.0
        intensities = [max(0.0, min(1.0, v * inv)) for v in intensities]
    return positions, intensities


def _livox_pointcloud(target_count: int):
    """Latest Livox MID-360 frame via ROS2. Returns (positions, intensities,
    has_intensity, "livox") or None when rclpy / the driver are unavailable."""
    global _livox_source
    try:
        import rclpy  # type: ignore  # noqa: F401  (availability check only)
        from sensor_msgs.msg import PointCloud2  # type: ignore  # noqa: F401
    except ImportError:
        return None
    try:
        with _livox_lock:
            if _livox_source is None:
                _livox_source = _LivoxRos2Source(os.environ.get("G1_LIVOX_TOPIC", "/livox/lidar"))
                _livox_source.start()
        msg = _livox_source.latest(float(os.environ.get("G1_LIVOX_TIMEOUT_S", "2.0")))
        if msg is None:
            return None
        positions, intensities = _parse_pointcloud2(msg, target_count)
        if not positions:
            return None
        return positions, intensities, bool(intensities), "livox"
    except Exception as e:  # noqa: BLE001
        print(f"[G1 Sidecar] Livox ingest failed ({e})", flush=True)
        return None


def get_point_cloud(name: str) -> dict:
    """Read one point-cloud frame from a depth / LiDAR sensor.

    Source is chosen by G1_LIDAR_SOURCE ∈ {auto|livox|realsense|replay}
    (default auto). Fallback chain — never crashes, always returns the flat
    contract below:

      • replay  : decode a real recording (KITTI .bin / PCD) via
                  pointcloud_replay when G1_POINTCLOUD_REPLAY is set.
      • livox   : latest /livox/lidar PointCloud2 over ROS2 (MID-360).
      • realsense: deproject a RealSense depth frame (pyrealsense2 + numpy).
      • empty   : last resort — empty frame so the seam stays alive.

    auto order:  replay (if configured) → [lidar: livox → realsense] /
                 [depth: realsense] → empty.
    Explicit selectors force a single live source (then fall back to empty).

    Flat contract (matches the Node HardwareClient / PointCloudFrame):
      positions   = [x0,y0,z0, x1,y1,z1, ...]  (meters, base frame, x-fwd/y-left/z-up)
      intensities = [i0, i1, ...]              (normalized 0..1)
    """
    if name not in DEPTH_SENSORS:
        return {"ok": False, "error": f"no depth sensor '{name}'"}

    sensor_type = "lidar" if name == "mid360_lidar" else "depth_camera"
    target = int(os.environ.get("G1_POINTCLOUD_MAX_POINTS", "20000"))
    source = os.environ.get("G1_LIDAR_SOURCE", "auto").lower()
    replay_configured = bool(os.environ.get("G1_POINTCLOUD_REPLAY", "").strip())

    # --- replay (explicit, or auto when a recording is configured) -----------
    if source == "replay" or (source == "auto" and replay_configured):
        replay_path = resolve_replay_path(name)
        if replay_path:
            try:
                frame = load_frame(replay_path, name)
                return {
                    "ok": True,
                    "sensor": name,
                    "sensor_type": frame["sensor_type"],
                    "has_intensity": frame["has_intensity"],
                    "positions": frame["positions"],
                    "intensities": frame["intensities"],
                    "source": "replay",
                    "source_label": os.path.basename(replay_path),
                }
            except Exception as e:  # noqa: BLE001
                if source == "replay":
                    return {"ok": False, "error": f"replay failed: {e}"}
                # auto: fall through to live below
        elif source == "replay":
            return _empty_cloud(name, sensor_type)

    # --- live hardware -------------------------------------------------------
    live = None
    if name == "mid360_lidar":
        if source == "realsense":
            live = _realsense_pointcloud(target)
        elif source == "livox":
            live = _livox_pointcloud(target)
        else:  # auto
            live = _livox_pointcloud(target) or _realsense_pointcloud(target)
    else:  # d435i_depth → RealSense
        live = _realsense_pointcloud(target)

    if live:
        positions, intensities, has_i, label = live
        return {
            "ok": True,
            "sensor": name,
            "sensor_type": sensor_type,
            "has_intensity": has_i,
            "positions": positions,
            "intensities": intensities,
            "source": label,
        }

    # --- last resort: empty frame (contract exercised, no crash) -------------
    return _empty_cloud(name, sensor_type)


def _empty_cloud(name: str, sensor_type: str) -> dict:
    return {
        "ok": True,
        "sensor": name,
        "sensor_type": sensor_type,
        "has_intensity": sensor_type == "lidar",
        "positions": [],
        "intensities": [],
        "source": "empty",
    }


def start_record(body: dict) -> dict:
    """Spawn lerobot-record for the G1 with its native teleoperator.

    Teleop options for the G1 (set via G1_TELEOP env or body.teleop):
      unitree_g1   — wireless remote + exoskeleton joystick (lerobot native)
      keyboard / gamepad — generic lerobot teleops (already supported by the agent)
    """
    teleop = body.get("teleop") or os.environ.get("G1_TELEOP", "unitree_g1")
    robot_cli = [
        "--robot.type=unitree_g1",
        f"--robot.id={ROBOT_ID}",
        f"--robot.robot_ip={ROBOT_IP}",
        f"--robot.net_interface={NET_INTERFACE}",
    ]
    teleop_cli = [f"--teleop.type={teleop}"]
    return recorder.start(
        repo_id=body["repo_id"],
        task=body.get("task", ""),
        num_episodes=int(body.get("num_episodes", 1)),
        episode_time_s=float(body.get("episode_time_s", 30.0)),
        fps=int(body.get("fps", 30)),
        cameras=body.get("cameras", {}),
        dataset_root=body.get("dataset_root"),
        robot_cli=robot_cli,
        teleop_cli=teleop_cli,
    )


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, payload: dict) -> None:
        data = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args) -> None:  # silence default logging
        pass

    def do_GET(self) -> None:
        if self.path == "/health":
            # Point-cloud replay mode reports "connected" so the Node hardware
            # seam pulls real recorded clouds without a physical robot attached.
            replay = bool(os.environ.get("G1_POINTCLOUD_REPLAY", "").strip())
            if READ_ONLY:
                live = _lowstate_reader.start() and _lowstate_reader.latest() is not None
                self._send(200, {"status": "ok", "connected": live or replay, "read_only": True})
                return
            self._send(200, {"status": "ok", "connected": connected or replay})
        elif self.path == "/state":
            self._send(200, get_state())
        elif self.path == "/state/fast":
            self._send(200, get_state(keep_alive=True))
        elif self.path == "/cameras":
            self._send(200, {"cameras": ["head_camera", "left_wrist_camera", "right_wrist_camera"]})
        elif self.path.startswith("/cameras/") and self.path.endswith("/snapshot"):
            name = self.path[len("/cameras/"):-len("/snapshot")]
            self._send(200, self._snapshot(name))
        elif self.path == "/pointcloud/sensors":
            self._send(200, {"sensors": DEPTH_SENSORS})
        elif self.path.startswith("/pointcloud/") and self.path.endswith("/snapshot"):
            name = self.path[len("/pointcloud/"):-len("/snapshot")]
            self._send(200, get_point_cloud(name))
        elif self.path == "/record/status":
            self._send(200, recorder.status())
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self) -> None:
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length) or b"{}") if length else {}
        if self.path == "/action":
            if READ_ONLY:
                self._send(403, {"ok": False, "error": "G1_READ_ONLY — command path disabled (stage 1: telemetry only)"})
                return
            self._send(200, send_action(body))
        elif self.path == "/estop":
            self._send(200, reset_ramp_state())
        elif self.path == "/record/start":
            if READ_ONLY:
                # lerobot-record spawns a G1 teleoperator — that DRIVES the robot.
                self._send(403, {"ok": False, "error": "G1_READ_ONLY — recording (teleop) disabled (stage 1: telemetry only)"})
                return
            self._send(200, start_record(body))
        elif self.path == "/record/stop":
            self._send(200, recorder.stop())
        else:
            self._send(404, {"error": "not found"})

    def _snapshot(self, name: str) -> dict:
        """One-shot camera frame as base64 JPEG.

        Source via G1_CAMERA_SOURCE ∈ {auto|lerobot|realsense} (default auto):
          • lerobot  : the named camera from the G1 driver's observation.
          • realsense: a RealSense color frame (pyrealsense2 + cv2 + numpy).
        Falls back along that chain, preserving the existing response shape
        ({"ok","camera","jpeg_base64"}).
        """
        cam_source = os.environ.get("G1_CAMERA_SOURCE", "auto").lower()

        # --- lerobot observation camera (primary / prior contract) -----------
        if cam_source in ("auto", "lerobot"):
            with robot_lock:
                if connected or _connect_unlocked():
                    try:
                        obs = robot.get_observation()
                        frame = obs.get(name)
                        if frame is not None:
                            import cv2  # type: ignore
                            ok, buf = cv2.imencode(".jpg", frame)
                            if ok:
                                return {
                                    "ok": True,
                                    "camera": name,
                                    "jpeg_base64": base64.b64encode(buf).decode(),
                                    "source": "lerobot",
                                }
                    except Exception as e:  # noqa: BLE001
                        if cam_source == "lerobot":
                            return {"ok": False, "error": str(e)}

        # --- RealSense color frame -------------------------------------------
        if cam_source in ("auto", "realsense"):
            b64 = _realsense_color_jpeg()
            if b64:
                return {"ok": True, "camera": name, "jpeg_base64": b64, "source": "realsense"}

        return {"ok": False, "error": f"no camera frame for '{name}'"}


def main() -> None:
    print(f"[G1 Sidecar] starting on :{PORT} (robot {ROBOT_ID} @ {ROBOT_IP}/{NET_INTERFACE})", flush=True)
    print(f"[G1 Sidecar] {len(JOINT_NAMES)} joints ({len(BODY_JOINTS)} body + {len(HAND_JOINTS)} Dex3)", flush=True)
    if READ_ONLY:
        print(
            "[G1 Sidecar] READ-ONLY MODE (G1_READ_ONLY) - telemetry only. "
            f"State source: {LOWSTATE_ENDPOINT}. POST /action and /record/start are BLOCKED; "
            "the lerobot driver (rt/lowcmd publisher) is never loaded.",
            flush=True,
        )
    else:
        print(
            f"[G1 Sidecar] action ramp: max_vel={MAX_JOINT_VEL} rad/s @ {CONTROL_HZ} Hz "
            f"→ {_MAX_STEP:.4f} rad/tick (NOT balance control)",
            flush=True,
        )
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
