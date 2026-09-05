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
  GET  /state         → {"joints": [...], "imu": {...}, "touch": {...},
                         "battery": {...}, "odometry": {...}, "timestamp": ...}
                        (TASK-184 contract §2 — every group is OMITTED when its
                        source DDS topic has no fresh data; never zero-filled)
  GET  /state/fast    → joint read that keeps motors enabled (closed loop)
  POST /action        → {"<joint>": value, ...} → RAMPED + CLAMPED, then sent
  POST /estop         → clears the action-ramp state (soft stop, see caveat)
  GET  /cameras       → {"cameras": [...],
                         "source": "lerobot"|"teleimager"|"pc2cam"|"realsense"|null}
                        The names the ACTIVE source can serve, not a fixed list:
                        a lone RealSense D435 is ONE camera (G1_CAMERA_NAME,
                        default head_camera), not three aliases for one frame.
  GET  /cameras/<name>/snapshot → one-shot base64 JPEG
  GET  /cameras/<name>/stream   → live MJPEG (multipart/x-mixed-replace), the
                        route app/ + robot-agent's camera proxy expect (TASK-233).
                        Capped by G1_CAMERA_STREAM_FPS (default 15) per stream.
                        404 = no such camera on this source, 503 = no frame.
  GET  /pointcloud/sensors → list available depth/LiDAR sensor names
  GET  /pointcloud/<name>/snapshot → one-shot point cloud (flat XYZ + intensity)
                        Optional `X-Scan-Session: <id>` scopes the MID-360
                        frame convention to one scan session (TASK-190)
  POST /pointcloud/lidar/switch → {"on": true|false} → rt/utlidar/switch
                        (sensor enable — the single authorized write, no motion)
  POST /record/start  → spawn lerobot-record (G1 teleop + dataset)
  POST /record/stop   → SIGINT the recording subprocess
  GET  /record/status → recording progress / dataset path

  --- Agent Mode locomotion (TASK-194), behind G1_LOCO_ENABLED=1 (default OFF) ---
  POST /loco/move     → {"vx","vy","omega","duration_s"} → LocoClient.SetVelocity
  POST /loco/action   → {"name": "wave"|"shake"|"stop", "args": {...}}
                        → WaveHand / ShakeHand / StopMove
  POST /loco/fsm      → {"id": int} → LocoClient.SetFsmId (0 zero-torque, 1 damp,
                        3 sit, 500 start, 706 squat↔stand)
  GET  /loco/odom     → {"ok","x","y","yaw","source","provenance","errorCode"}
                        from rt/odommodestate. "source" is the TRANSPORT we read
                        it over ("zmq" = read-only bridge, "dds" = direct DDS);
                        "provenance" is where the POSE itself came from —
                        "ground-truth" | "dead-reckoned" | "unknown" — decoded
                        from the publisher's SportModeState_.error_code marker
                        (TASK-231). 503 + error when nothing fresh — NEVER zeros.
                        These four are 403 while the gate is off and 503 when the
                        Unitree SDK is missing or DDS is down. They are NOT behind
                        G1_READ_ONLY — see the gate's rationale at LOCO_ENABLED.

Run via:
  uv run python robot-agent/hardware/g1_sidecar.py

@status hardware-pending
"""

import base64
import json
import math
import os
import socket
import struct
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from recorder import recorder
from pointcloud_replay import load_frame, resolve_replay_path

PORT = int(os.environ.get("G1_SIDECAR_PORT", "8767"))
ROBOT_ID = os.environ.get("G1_ROBOT_ID", "my_g1_edu")
# Unitree G1 talks over DDS on a network interface (see config_unitree_g1.py).
ROBOT_IP = os.environ.get("G1_ROBOT_IP", "192.168.123.164")
NET_INTERFACE = os.environ.get("G1_NET_INTERFACE", "eth0")

# One id per process, reported on /health. Odometry re-zeroes when this sidecar
# (or the robot's loco service behind it) restarts, so anything the agent built
# in the odometry frame -- notably the persisted occupancy map (TASK-206) -- is
# only valid within one boot; the agent keys its stored map on this id and
# discards a map whose boot_id no longer matches.
BOOT_ID = uuid.uuid4().hex

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

# ---------------------------------------------------------------------------
# AGENT-MODE LOCOMOTION GATE (TASK-194) — DEFAULT OFF
# ---------------------------------------------------------------------------
# Enables the /loco/* endpoints (high-level Unitree `sport` RPC via LocoClient).
#
# ⚠️ This is NOT a safety factor for the agent. Agent Mode ships with
# manual-E-Stop-only by an explicit product decision (TASK-194), a recorded
# deviation from hardware/real_g1_bridge/README.md — there is no arming gate,
# no dry-run default, no watchdog and no velocity cap between the planner and
# the robot. Once G1_LOCO_ENABLED=1, an agent command moves the robot.
#
# What this flag IS: a per-process off switch. The overwhelmingly common way to
# run this sidecar is telemetry-only (G1_READ_ONLY defaults to 1), and such a
# process must not be turnable into a motion path by a stray HTTP call from a
# mis-pointed component or a stale config. With the gate off, /loco/* answers
# 403 and no LocoClient is ever constructed.
#
# Deliberately SEPARATE from G1_READ_ONLY: that flag governs the rt/lowcmd
# joint-position path (the lerobot driver), while /loco/* is the rt/api/sport
# request/response path. Different wires, different risk profiles — one must not
# silently imply the other. Telemetry-only + locomotion-enabled (READ_ONLY=1,
# LOCO_ENABLED=1) is a legitimate, intended configuration: it is exactly what
# Agent Mode uses against the simulated loco service in sim_g1_dds/.
LOCO_ENABLED = os.environ.get("G1_LOCO_ENABLED", "0").strip() == "1"

# TASK-184: extra READ-ONLY telemetry topics forwarded by the bridge over the
# same ZMQ PUB socket. Names must match the bridge's DDS topic strings.
TOPIC_LOWSTATE = "rt/lowstate"
TOPIC_LEFT_HAND = "rt/dex3/left/state"
TOPIC_RIGHT_HAND = "rt/dex3/right/state"
TOPIC_BMS = os.environ.get("G1_BMS_TOPIC", "rt/lf/bmsstate")
TOPIC_ODOM = os.environ.get("G1_ODOM_TOPIC", "rt/odommodestate")

# Depth / LiDAR sensors on the G1. Names must match
# robot-agent/src/embodiment/configs/g1*.yaml `depth_sensors`.
DEPTH_SENSORS = ["mid360_lidar", "d435i_depth"]

# Scan-session id on /pointcloud/<name>/snapshot, set by the Node HardwareClient
# from RobotStateManager's active ScanSession (TASK-190). A HEADER rather than a
# query parameter on purpose: an older sidecar already deployed to a robot
# ignores it silently, where an unknown query string would 404 every frame.
SCAN_SESSION_HEADER = "X-Scan-Session"

# The head MID-360 is mounted INVERTED (looking down — a walking robot needs
# ground vision; effective FOV −52°…+7°, sensor ~1.3 m above the floor on a
# standing G1). The raw cloud on rt/utlidar/cloud_livox_mid360 (frame_id
# 'livox_frame') is sensor-centric with +z pointing physically DOWN: the
# floor appears as a dense plane ABOVE the origin at z≈+1.3, and near-range
# returns cut off exactly at sensor height + 7°. Established empirically
# 2026-07-18 across the 2026-07-07 capture and fresh frames (a first
# 2026-07-17 reading called that plane a "ceiling at 2.66 m room height" —
# wrong; an upright mount could never see the floor densely at 1–6 m as the
# frames do once the blob below is removed). Additionally ~50 % of every raw
# frame is a SELF-RETURN blob at the origin (the sensor seeing its own
# housing, 3D range < 0.3 m) that must be filtered before any geometry.
# `_normalize_mid360_frame` drops the blob, detects the frame convention ONCE
# PER SCAN SESSION (robust in case a robot-side utlidar/SLAM mode ever
# publishes already-gravity-aligned clouds — but a walked scan must not switch
# convention mid-sweep, see TASK-190), and brings frames into the NeoDEM
# contract frame (z-up, floor at z=0, matching the sim generator). Replay
# recordings and RealSense frames stay untouched.

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
# The Dex3-1 DDS WIRE order — NOT the same list as HAND_JOINTS above.
# ---------------------------------------------------------------------------
# HAND_JOINTS is the g1-edu.config.ts order (thumb -> index -> middle on BOTH
# sides), which is a set of names: every consumer of it looks joints up BY NAME
# (JOINT_NAMES membership in send_action, f"{name}.pos" in get_state and
# _seed_commanded_unlocked). It is NOT a motor index table, and using it as one
# is wrong on the left hand.
#
# `rt/dex3/{left,right}/state` and `/cmd` enumerate motor i as LHAND[i] /
# RHAND[i], and the LEFT hand lists MIDDLE before INDEX while the right lists
# index before middle. That asymmetry is real hardware, not a transcription
# slip — see hardware/sim_g1_dds/joints.py:25-27, which is the shared source for
# sim_node.py and anything else translating the wire protocol.
#
# Labelling motor states with HAND_JOINTS positionally therefore transposed the
# left hand's index and middle fingers BY NAME before anything downstream saw
# them: /state reported the middle finger's angle as the index finger's and vice
# versa, four columns of every episode recorded off a real G1 were mislabelled,
# and the 43-dim observation handed to a VLA policy was wrong in exactly the two
# fingers doing the grasping (TASK-229 defect #3, which the TypeScript side
# fixed on the assumption that this side was already right).
LEFT_HAND_WIRE = [
    "left_hand_thumb_0_joint", "left_hand_thumb_1_joint", "left_hand_thumb_2_joint",
    "left_hand_middle_0_joint", "left_hand_middle_1_joint",
    "left_hand_index_0_joint", "left_hand_index_1_joint",
]
RIGHT_HAND_WIRE = [
    "right_hand_thumb_0_joint", "right_hand_thumb_1_joint", "right_hand_thumb_2_joint",
    "right_hand_index_0_joint", "right_hand_index_1_joint",
    "right_hand_middle_0_joint", "right_hand_middle_1_joint",
]
# Same 14 joints as HAND_JOINTS, only reordered — assert it, because a name that
# exists in one list and not the other is a joint that silently stops being
# commandable or readable.
assert sorted(LEFT_HAND_WIRE + RIGHT_HAND_WIRE) == sorted(HAND_JOINTS)

# ---------------------------------------------------------------------------
# BLOCKER #2 — action ramping / rate-limiting (TASK-169)
# ---------------------------------------------------------------------------
# Per-joint position limits (rad) as ASYMMETRIC (lower, upper) tuples, taken from
# the real URDF-derived limits in src/robot/joint-configs/g1-edu.config.ts — the
# single source of truth the rest of the system uses. This is the hard clamp that
# protects against garbage VLA targets, so it MUST use the true asymmetric stops:
# the previous symmetric ±half-range allowed e.g. ~1.4 rad of knee hyperextension
# past the real -0.087 rad lower stop.
#
# The fourteen Dex3-1 entries used to be the config's OLD hand-written
# placeholders, and they had drifted: g1-edu.config.ts now reads its hand limits
# out of G1_FINGER_CHAINS (generated from the MJCF, cross-checked against
# MuJoCo's jnt_range), and the placeholders here were SIGN-FLIPPED against them.
# left_hand_index_1_joint was declared (0.0, 1.7453) where the model says
# (-1.74533, 0.0) — two ranges meeting at the single point 0 — so the clamp
# below turned every flexion command into 0.0 and delivered an OPEN hand. That
# reproduced the exact failure the TASK-229 grip decoder exists to remove, one
# layer further down and after every TypeScript test had passed: a commanded
# closed hand that is very nearly an open hand (measured 0/15 transports).
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
    # Left Hand / Dex3-1 — from G1_FINGER_CHAINS (teleop/g1-chains.generated.ts),
    # which is read out of the MJCF the simulator loads and cross-checked against
    # MuJoCo's jnt_range by sim_g1_dds/test_teleop_chains.py. See the note above.
    "left_hand_thumb_0_joint": (-1.0472, 1.0472),
    "left_hand_thumb_1_joint": (-0.724312, 1.0472),
    "left_hand_thumb_2_joint": (0.0, 1.74533),
    "left_hand_index_0_joint": (-1.5708, 0.0),
    "left_hand_index_1_joint": (-1.74533, 0.0),
    "left_hand_middle_0_joint": (-1.5708, 0.0),
    "left_hand_middle_1_joint": (-1.74533, 0.0),
    # Right Hand / Dex3-1 — same source. NOT a mirror of the left with the signs
    # copied: the hands flex toward opposite signs, which is the whole point.
    "right_hand_thumb_0_joint": (-1.0472, 1.0472),
    "right_hand_thumb_1_joint": (-1.0472, 0.724312),
    "right_hand_thumb_2_joint": (-1.74533, 0.0),
    "right_hand_index_0_joint": (0.0, 1.5708),
    "right_hand_index_1_joint": (0.0, 1.74533),
    "right_hand_middle_0_joint": (0.0, 1.5708),
    "right_hand_middle_1_joint": (0.0, 1.74533),
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
    """Subscribe-only multi-topic state client for READ_ONLY mode.

    Caches the newest `{"topic": ..., "data": {...}}` message PER TOPIC as
    published by the read-only bridge (rt/lowstate, rt/dex3/*/state, BMS,
    odometry — all on one ZMQ PUB socket). Deliberately NO zmq.CONFLATE:
    CONFLATE keeps only the newest message across ALL topics on the socket,
    so a 50 Hz lowstate stream would starve the low-rate BMS/odom feeds.
    Freshness is judged per topic (default 2 s window) — stale topics read
    as None and their field groups are OMITTED, never fabricated.

    No command socket exists in this process while READ_ONLY is active —
    port 6000 (lowcmd) is never opened anywhere.
    """

    def __init__(self, endpoint: str) -> None:
        self.endpoint = endpoint
        self._cache: dict[str, tuple[dict, float]] = {}  # topic → (data, recv ts)
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
        sock.connect(self.endpoint)
        self._started = True
        threading.Thread(target=self._spin, args=(sock,), daemon=True).start()
        print(f"[G1 Sidecar] read-only multi-topic subscriber → {self.endpoint}", flush=True)
        return True

    def _spin(self, sock) -> None:
        while True:
            try:
                payload = sock.recv()
                msg = json.loads(payload.decode("utf-8"))
                if not isinstance(msg, dict):
                    continue
                topic = msg.get("topic")
                data = msg.get("data")
                if isinstance(topic, str) and isinstance(data, dict):
                    with self._lock:
                        self._cache[topic] = (data, time.time())
            except Exception as e:  # noqa: BLE001
                print(f"[G1 Sidecar] telemetry recv error: {e}", flush=True)
                time.sleep(1.0)

    def latest(self, topic: str = TOPIC_LOWSTATE, max_age_s: float = 2.0) -> dict | None:
        """Newest dict for `topic`, or None if nothing fresh arrived."""
        with self._lock:
            entry = self._cache.get(topic)
            if entry is None or time.time() - entry[1] > max_age_s:
                return None
            return entry[0]


_lowstate_reader = _LowStateReader(LOWSTATE_ENDPOINT)


def _opt_float(v):
    """float(v) or None — for optional fields that must be OMITTED, not zeroed."""
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _motor_to_joint(name: str, motor: dict) -> dict:
    """Bridge motor dict → contract joint entry. Only q is required; dq /
    tau_est / temperature map to velocity / effort / temperature and are
    included only when present (never zero-filled)."""
    joint = {"name": name, "position": float(motor.get("q", 0.0))}
    for src, dst in (("dq", "velocity"), ("tau_est", "effort"), ("temperature", "temperature")):
        v = _opt_float(motor.get(src))
        if v is not None:
            joint[dst] = v
    return joint


def _touch_pads(hand_data: dict) -> list | None:
    """press_sensor_state → contract touch pad list, or None when absent."""
    pads_in = hand_data.get("press_sensor_state")
    if not isinstance(pads_in, list):
        return None
    pads = []
    for p in pads_in:
        if not isinstance(p, dict):
            continue
        pad = {}
        if isinstance(p.get("pressure"), list):
            pad["pressure"] = p["pressure"]
        if isinstance(p.get("temperature"), list):
            pad["temperature"] = p["temperature"]
        if pad:
            pads.append(pad)
    return pads or None


def _get_state_readonly() -> dict:
    """Build the /state response from the read-only bridge feed (contract §2).

    DDS motor index i ↔ BODY_JOINTS[i] — verified against lerobot's
    G1_29_JointIndex enum (0-5 left leg, 6-11 right leg, 12-14 waist,
    15-21 left arm, 22-28 right arm). Dex3-1 hands live on separate DDS
    topics (rt/dex3/*/state): motor_state index i ↔ LEFT_HAND_WIRE[i] /
    RIGHT_HAND_WIRE[i], which are the DDS order and NOT HAND_JOINTS — the
    left hand enumerates middle before index. Hand entries are appended ONLY
    while the matching topic is fresh — never fabricated as 0.0. Likewise
    touch / battery / odometry are whole-group omitted when their source
    topic is stale.
    """
    if not _lowstate_reader.start():
        return {"joints": [], "connected": False, "simulated": False, "timestamp": time.time()}
    data = _lowstate_reader.latest(TOPIC_LOWSTATE)
    if data is None:
        return {"joints": [], "connected": False, "simulated": False, "timestamp": time.time()}

    # --- 29 body joints from rt/lowstate --------------------------------------
    motors = data.get("motor_state") or []
    joints = []
    for i, name in enumerate(BODY_JOINTS):
        if i < len(motors) and isinstance(motors[i], dict):
            joints.append(_motor_to_joint(name, motors[i]))

    # --- 14 hand joints + touch from rt/dex3/{left,right}/state ---------------
    touch = {}
    for side, topic, wire in (
        ("left", TOPIC_LEFT_HAND, LEFT_HAND_WIRE),
        ("right", TOPIC_RIGHT_HAND, RIGHT_HAND_WIRE),
    ):
        hand = _lowstate_reader.latest(topic)
        if hand is None:
            continue  # stale side → its 7 joints and touch pads are omitted
        hand_motors = hand.get("motor_state") or []
        for i in range(min(len(wire), len(hand_motors))):
            if isinstance(hand_motors[i], dict):
                joints.append(_motor_to_joint(wire[i], hand_motors[i]))
        pads = _touch_pads(hand)
        if pads:
            touch[side] = pads

    result = {"joints": joints, "connected": True, "simulated": False, "timestamp": time.time()}
    if touch:
        result["touch"] = touch

    # --- imu from rt/lowstate --------------------------------------------------
    imu_state = data.get("imu_state")
    if isinstance(imu_state, dict):
        rpy = _coerce3(imu_state.get("rpy"))
        gyro = _coerce3(imu_state.get("gyroscope"))
        accel = _coerce3(imu_state.get("accelerometer"))
        if rpy is not None or gyro is not None or accel is not None:
            imu = {"rpy": rpy, "gyro": gyro, "accel": accel}
            temp = _opt_float(imu_state.get("temperature"))
            if temp is not None:
                imu["temperature"] = temp
            result["imu"] = imu

    # --- battery from the BMS topic (soc required, rest optional) --------------
    bms = _lowstate_reader.latest(TOPIC_BMS)
    if isinstance(bms, dict):
        soc = _opt_float(bms.get("soc"))
        if soc is not None:
            battery = {"soc": soc}
            for key in ("voltage", "current", "temperature", "soh"):
                v = _opt_float(bms.get(key))
                if v is not None:
                    battery[key] = v
            if bms.get("cycle") is not None:
                battery["cycles"] = int(bms["cycle"])
            if isinstance(bms.get("cell_vol"), list):
                battery["cellVoltages"] = bms["cell_vol"]
            result["battery"] = battery

    # --- odometry (position required, rest optional) ---------------------------
    odom = _lowstate_reader.latest(TOPIC_ODOM)
    if isinstance(odom, dict):
        position = _coerce3(odom.get("position"))
        if position is not None:
            odometry = {"position": position}
            rpy = _coerce3(odom.get("rpy"))
            if rpy is not None:
                odometry["rpy"] = rpy
            velocity = _coerce3(odom.get("velocity"))
            if velocity is not None:
                odometry["velocity"] = velocity
            yaw_speed = _opt_float(odom.get("yaw_speed"))
            if yaw_speed is not None:
                odometry["yawSpeed"] = yaw_speed
            # Provenance of the WHOLE group, not just position: the marker is
            # message-level, and `velocity`/`yawSpeed` are the fields that carry
            # the commanded velocity back on a dead-reckoned frame (TASK-231).
            # Always present, unlike the optional fields above — "unknown" is an
            # answer, not a fabricated value, and its presence also tells a
            # caller this sidecar is new enough to decode the marker at all.
            (odometry["provenance"],
             odometry["errorCode"]) = _odom_provenance(odom.get("error_code"))
            result["odometry"] = odometry

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

#: How long a MISSING (or unstartable) RealSense is remembered before we try
#: again. Sized to be invisible to a person plugging the camera in, while
#: keeping a 15 fps stream from re-enumerating USB on every single frame.
_RS_ABSENT_COOLDOWN_S = 2.0
_rs_absent_until = 0.0


def _ensure_realsense():
    """Lazily start a shared RealSense pipeline (depth + color). None if absent.

    Requires the `pyrealsense2` package AND a connected RealSense device.

    Absence is CHEAP and CACHED, which it has to be. `pipe.start()` does not
    fail fast when no device is attached — it blocks while librealsense
    enumerates, and it blocks holding `_rs_lock`, so a single hung start stalls
    every later camera request behind that lock. Observed for real: with
    pyrealsense2 installed and the D435 not yet plugged in, Agent Mode's idle
    watcher (one camera read every 3 s) piled up 28 connections and filled the
    listen backlog until /health itself stopped being accepted. Enumerating the
    context first is instant and answers the same question, and a negative
    result is remembered for `_RS_ABSENT_COOLDOWN_S` so nothing retries at
    frame rate.
    """
    global _rs_pipeline, _rs_absent_until
    with _rs_lock:
        if _rs_pipeline is not None:
            return _rs_pipeline
        if time.time() < _rs_absent_until:
            return None
        try:
            import pyrealsense2 as rs  # type: ignore  # optional
        except ImportError:
            return None
        try:
            if not list(rs.context().devices):
                _rs_absent_until = time.time() + _RS_ABSENT_COOLDOWN_S
                return None
        except Exception as e:  # noqa: BLE001
            _rs_absent_until = time.time() + _RS_ABSENT_COOLDOWN_S
            print(f"[G1 Sidecar] RealSense enumeration failed ({e})", flush=True)
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
            # A device that enumerates but will not start (busy, wrong profile,
            # USB2 link) must not be retried at frame rate either.
            _rs_absent_until = time.time() + _RS_ABSENT_COOLDOWN_S
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


def _realsense_color_jpeg_bytes():
    """One RealSense color frame as raw JPEG bytes, or None. Needs cv2 + numpy.

    `_rs_lock` is held for the GRAB ONLY and released before `imencode`. That
    was already true and is now load-bearing: a 15 fps MJPEG stream (TASK-233)
    calls this in a loop, and the same lock serialises
    /pointcloud/<n>/snapshot, which waits up to 2000 ms for frames. On this
    robot the LiDAR feeds Agent Mode's `goto` arrival test, so encoding inside
    the lock would starve navigation to feed a video preview.
    """
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
        return bytes(buf)
    except Exception as e:  # noqa: BLE001
        print(f"[G1 Sidecar] RealSense color frame failed ({e})", flush=True)
        return None


def _realsense_color_jpeg():
    """One RealSense color frame as a base64 JPEG, or None — /snapshot's shape."""
    jpeg = _realsense_color_jpeg_bytes()
    return base64.b64encode(jpeg).decode() if jpeg else None


def _lerobot_color_jpeg_bytes(name: str):
    """One lerobot observation camera as raw JPEG bytes, or None. Needs cv2.

    Always None in read-only mode: `_connect_unlocked` refuses to load the
    driver there, so there is no observation to read.
    """
    try:
        import cv2  # type: ignore
    except ImportError:
        return None
    with robot_lock:
        if not (connected or _connect_unlocked()):
            return None
        try:
            frame = (robot.get_observation() or {}).get(name)
        except Exception as e:  # noqa: BLE001
            print(f"[G1 Sidecar] lerobot observation failed ({e})", flush=True)
            return None
    if frame is None:
        return None
    ok, buf = cv2.imencode(".jpg", frame)
    return bytes(buf) if ok else None


# ---------------------------------------------------------------------------
# CAMERAS (TASK-233) — one source of truth for which cameras exist
# ---------------------------------------------------------------------------
# /cameras used to answer a hardcoded three-name list while the RealSense grab
# IGNORED the name it was handed, so head_camera, left_wrist_camera and
# right_wrist_camera all returned the same D435 frame and an operator could not
# tell which view was live. Every camera route now asks the ACTIVE SOURCE what
# it can serve, so the advertised list and what a stream accepts cannot drift.
#
# The env is read at CALL time, not at import: this process is long-lived and
# the rest of the camera code has always read its env that way.

#: Name for the single RealSense colour stream. The G1 EDU embodiment config
#: (src/embodiment/configs/g1_edu.yaml) enables exactly `head_camera` and ships
#: both wrist cameras disabled, so this is the name the cockpit asks for.
_REALSENSE_DEFAULT_NAME = "head_camera"

#: Cached lerobot observation camera keys — discovery costs a live observation
#: and /cameras has to stay cheap enough to poll.
_lerobot_cam_names: "tuple[str, ...] | None" = None

#: How long a lerobot driver with no cameras is remembered, for the same reason
#: the other three sources have a cooldown. This one guards more than a camera
#: read: the probe takes `robot_lock`, which is also the lock `send_action`
#: holds to command motors, and with G1_READ_ONLY=0 and the driver not yet up,
#: `_connect_unlocked()` is a real blocking connect. Retrying that on every
#: /cameras poll and every snapshot would serialise robot control behind a
#: question about a camera.
_LEROBOT_ABSENT_COOLDOWN_S = 2.0
_lerobot_absent_until = 0.0


def _lerobot_camera_names() -> "tuple[str, ...]":
    """Camera keys the lerobot observation actually carries (image-shaped only).

    Empty in read-only mode by construction. A positive answer is remembered
    for good; a miss only for `_LEROBOT_ABSENT_COOLDOWN_S`, so a driver that
    connects later is still found without re-probing at request rate.
    """
    global _lerobot_cam_names, _lerobot_absent_until
    if _lerobot_cam_names is not None:
        return _lerobot_cam_names
    if time.time() < _lerobot_absent_until:
        return ()
    try:
        import numpy as np  # type: ignore
    except ImportError:
        _lerobot_absent_until = time.time() + _LEROBOT_ABSENT_COOLDOWN_S
        return ()
    with robot_lock:
        if not (connected or _connect_unlocked()):
            _lerobot_absent_until = time.time() + _LEROBOT_ABSENT_COOLDOWN_S
            return ()
        try:
            obs = robot.get_observation() or {}
        except Exception as e:  # noqa: BLE001
            print(f"[G1 Sidecar] lerobot observation failed ({e})", flush=True)
            _lerobot_absent_until = time.time() + _LEROBOT_ABSENT_COOLDOWN_S
            return ()
    # An observation carries joint vectors next to frames; only a 3-D array is
    # an image. Guessing by key name would break on the first driver rename.
    names = tuple(k for k, v in obs.items() if isinstance(v, np.ndarray) and v.ndim == 3)
    if names:
        _lerobot_cam_names = names
    else:
        _lerobot_absent_until = time.time() + _LEROBOT_ABSENT_COOLDOWN_S
    return names


# --- teleimager image server (the robot's OWN cameras, over ZMQ) -------------
#
# This is the path Unitree's own teleoperation uses, and on a real G1 it is the
# ONLY way to reach the head camera: the robot's `video_hub_pc4` service serves
# `rt/api/videohub/request` over DDS and is frequently dead (status=-1), while
# `image_server.py` on PC2 publishes plain JPEG over ZMQ and does not care.
#
# The protocol, from `teleimager/image_client.py`:
#   • REQ b"GET_DATA" to tcp://<host>:60000 → a JSON camera config, one entry
#     per camera with `zmq_port`, `enable_zmq`, `image_shape`, `binocular`
#   • SUB tcp://<host>:<zmq_port>, subscribe "" → each message is raw JPEG
#
# Read-only in the strictest sense: a SUB socket and one config request. No DDS
# participant, no `rt/lowcmd`, nothing that reaches a motor. The image server
# has to be running on the robot; when it is not, every call here must fail
# CHEAPLY, hence the same negative cooldown the RealSense probe uses.
_TELEIMAGER_ABSENT_COOLDOWN_S = 5.0
_teleimager_absent_until = 0.0
_teleimager_config = None
_teleimager_subs = {}
_teleimager_lock = threading.RLock()


def _teleimager_host_port() -> "tuple[str, int]":
    return (
        os.environ.get("G1_IMAGE_SERVER_HOST", ROBOT_IP),
        int(os.environ.get("G1_IMAGE_SERVER_PORT", "60000")),
    )


def _teleimager_cam_config():
    """The image server's camera config, cached. None when it is not running.

    A REQ socket is single-shot by protocol — one send must be followed by one
    recv — so a timed-out request poisons the socket. It is therefore created
    and closed per attempt rather than kept, which costs nothing at the once-per
    -cooldown rate this runs at.
    """
    global _teleimager_config, _teleimager_absent_until
    with _teleimager_lock:
        if _teleimager_config is not None:
            return _teleimager_config
        if time.time() < _teleimager_absent_until:
            return None
        try:
            import zmq  # type: ignore  # optional
        except ImportError:
            _teleimager_absent_until = time.time() + _TELEIMAGER_ABSENT_COOLDOWN_S
            return None

        host, port = _teleimager_host_port()
        timeout_ms = int(os.environ.get("G1_IMAGE_SERVER_TIMEOUT_MS", "1000"))
        ctx = zmq.Context.instance()
        sock = ctx.socket(zmq.REQ)
        sock.setsockopt(zmq.LINGER, 0)
        try:
            sock.connect(f"tcp://{host}:{port}")
            sock.send(b"GET_DATA")
            if sock.poll(timeout_ms) & zmq.POLLIN:
                cfg = sock.recv_json()
            else:
                cfg = None
        except Exception as e:  # noqa: BLE001
            print(f"[G1 Sidecar] image server config request failed ({e})", flush=True)
            cfg = None
        finally:
            sock.close()

        if not isinstance(cfg, dict) or not cfg:
            _teleimager_absent_until = time.time() + _TELEIMAGER_ABSENT_COOLDOWN_S
            return None
        _teleimager_config = cfg
        names = ", ".join(sorted(_teleimager_camera_ports(cfg)))
        print(f"[G1 Sidecar] ✅ image server at {host}:{port} — cameras: {names}", flush=True)
        return cfg


def _teleimager_camera_ports(cfg) -> "dict[str, int]":
    """{camera name: zmq port} for the cameras actually publishing JPEG.

    `enable_zmq: false` means the vendor config routes that camera to WebRTC
    instead, which this sidecar does not speak — advertising it would be a name
    whose stream can never open.
    """
    ports = {}
    for name, entry in (cfg or {}).items():
        if not isinstance(entry, dict):
            continue
        port = entry.get("zmq_port")
        if entry.get("enable_zmq") and isinstance(port, int):
            ports[str(name)] = port
    return ports


class _TeleimagerSubscriber:
    """Keeps the newest JPEG from one image-server camera.

    A background thread owns the socket. The alternative — receiving inside the
    HTTP handler — would hand whatever frame happened to be queued rather than
    the newest one, and would block a request whenever the publisher paused.
    RCVHWM 1 plus CONFLATE means ZMQ itself drops stale frames.
    """

    def __init__(self, host: str, port: int):
        self.host = host
        self.port = port
        self._jpeg = None
        self._lock = threading.Lock()
        self._stop = threading.Event()
        threading.Thread(target=self._run, daemon=True).start()

    def _run(self) -> None:
        import zmq  # type: ignore

        ctx = zmq.Context.instance()
        sock = ctx.socket(zmq.SUB)
        sock.setsockopt(zmq.RCVHWM, 1)
        sock.setsockopt(zmq.CONFLATE, 1)
        sock.setsockopt(zmq.LINGER, 0)
        sock.setsockopt_string(zmq.SUBSCRIBE, "")
        sock.connect(f"tcp://{self.host}:{self.port}")
        try:
            while not self._stop.is_set():
                try:
                    if sock.poll(200) & zmq.POLLIN:
                        data = sock.recv()
                        if data:
                            with self._lock:
                                self._jpeg = bytes(data)
                except Exception as e:  # noqa: BLE001
                    print(f"[G1 Sidecar] image server SUB {self.port} error ({e})", flush=True)
                    break
        finally:
            sock.close()

    def latest(self):
        with self._lock:
            return self._jpeg


def _teleimager_jpeg_bytes(name: str):
    """Newest JPEG for one image-server camera, or None.

    First call for a camera only starts the subscriber; ZMQ connect plus the
    publisher's next frame take a moment, so it waits briefly rather than
    reporting a dead camera on the very request that woke it up.
    """
    cfg = _teleimager_cam_config()
    if cfg is None:
        return None
    ports = _teleimager_camera_ports(cfg)
    if name not in ports:
        return None
    host, _ = _teleimager_host_port()
    with _teleimager_lock:
        sub = _teleimager_subs.get(name)
        if sub is None:
            sub = _TeleimagerSubscriber(host, ports[name])
            _teleimager_subs[name] = sub
            fresh = True
        else:
            fresh = False
    jpeg = sub.latest()
    if jpeg is None and fresh:
        deadline = time.time() + float(os.environ.get("G1_IMAGE_SERVER_FIRST_FRAME_S", "2.0"))
        while jpeg is None and time.time() < deadline:
            time.sleep(0.05)
            jpeg = sub.latest()
    return jpeg


# --- PC2 head-camera publisher (this lab's G1: g1_cam_pub.py on :5600) ------
#
# The G1 EDU's head RealSense D435i hangs off PC2's USB, not this workstation's,
# and PC2 runs `g1_cam_pub.py` under the `g1-head-cam` systemd unit to serve it.
# That script exists because PC2's ROS 2 Foxy install segfaults, so it skips ROS
# entirely and speaks a two-field wire format over plain TCP:
#
#     uint32 be length | uint64 be ns timestamp | <length> bytes of JPEG
#
# It encodes ONLY while a client is connected ("nobody watching: idle"), so the
# reader below holds the socket open rather than reconnecting per frame — a
# connect-per-frame client would spend its life waiting for the first encode.
#
# Read-only: one outbound TCP connection that never sends a byte. Nothing here
# joins DDS or can reach a motor.
_PC2CAM_ABSENT_COOLDOWN_S = 5.0
_pc2cam_absent_until = 0.0
_pc2cam_reader = None
_pc2cam_lock = threading.RLock()
_PC2CAM_HDR = struct.Struct("!IQ")
#: Refuse absurd frame lengths rather than trusting the header and allocating
#: whatever it claims. 640x480 JPEG at q80 is ~40 KB; 32 MB is far past any
#: real frame and well short of hurting this process.
_PC2CAM_MAX_FRAME = 32 * 1024 * 1024


def _pc2cam_endpoint() -> "tuple[str, int]":
    return (
        os.environ.get("G1_PC2_CAMERA_HOST", ROBOT_IP),
        int(os.environ.get("G1_PC2_CAMERA_PORT", "5600")),
    )


class _Pc2CameraReader:
    """Holds the TCP stream from g1_cam_pub.py and keeps the newest JPEG.

    Reconnects on its own: PC2's publisher drops every client when the RealSense
    re-enumerates on the USB bus (observed 2026-09-04 00:44), and a sidecar that
    gave up there would need a restart to see the camera come back.
    """

    def __init__(self, host: str, port: int):
        self.host = host
        self.port = port
        self._jpeg = None
        self._connected = False
        self._lock = threading.Lock()
        self._stop = threading.Event()
        threading.Thread(target=self._run, daemon=True).start()

    def _read_exactly(self, sock, n: int):
        buf = bytearray()
        while len(buf) < n:
            chunk = sock.recv(n - len(buf))
            if not chunk:
                return None
            buf += chunk
        return bytes(buf)

    def _run(self) -> None:
        backoff = 1.0
        while not self._stop.is_set():
            sock = None
            try:
                sock = socket.create_connection((self.host, self.port), timeout=5.0)
                sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
                sock.settimeout(10.0)
                with self._lock:
                    self._connected = True
                backoff = 1.0
                print(f"[G1 Sidecar] ✅ PC2 head camera stream {self.host}:{self.port}", flush=True)
                while not self._stop.is_set():
                    header = self._read_exactly(sock, _PC2CAM_HDR.size)
                    if header is None:
                        break
                    length, _ts_ns = _PC2CAM_HDR.unpack(header)
                    if not 0 < length <= _PC2CAM_MAX_FRAME:
                        print(f"[G1 Sidecar] PC2 camera sent an implausible frame length "
                              f"({length}); resynchronising", flush=True)
                        break
                    payload = self._read_exactly(sock, length)
                    if payload is None:
                        break
                    with self._lock:
                        self._jpeg = payload
            except Exception as e:  # noqa: BLE001
                print(f"[G1 Sidecar] PC2 camera stream lost ({e})", flush=True)
            finally:
                with self._lock:
                    self._connected = False
                if sock is not None:
                    try:
                        sock.close()
                    except Exception:  # noqa: BLE001
                        pass
            # Stale frames must not outlive the connection: a frozen picture
            # labelled LIVE is worse than an honest empty panel.
            with self._lock:
                self._jpeg = None
            if self._stop.wait(backoff):
                break
            backoff = min(backoff * 2, 10.0)

    def latest(self):
        with self._lock:
            return self._jpeg

    @property
    def connected(self) -> bool:
        with self._lock:
            return self._connected


def _pc2cam_available() -> "tuple[bool, bool]":
    """`(reachable, reader_was_just_started)`. Cheap, and caches absence.

    A plain TCP connect, not a frame read: the publisher idles until someone
    connects, so "can I open the socket" is the only fast question there is.

    The second flag is what tells a caller whether waiting for a frame can be
    justified — see `_pc2cam_jpeg_bytes`.
    """
    global _pc2cam_reader, _pc2cam_absent_until
    with _pc2cam_lock:
        if _pc2cam_reader is not None:
            if _pc2cam_reader.connected or _pc2cam_reader.latest() is not None:
                return True, False
            if time.time() < _pc2cam_absent_until:
                return False, False
        elif time.time() < _pc2cam_absent_until:
            return False, False

        host, port = _pc2cam_endpoint()
        try:
            with socket.create_connection((host, port), timeout=1.0):
                pass
        except OSError:
            _pc2cam_absent_until = time.time() + _PC2CAM_ABSENT_COOLDOWN_S
            return False, False

        if _pc2cam_reader is None:
            _pc2cam_reader = _Pc2CameraReader(host, port)
            return True, True
        return True, False


def _pc2cam_jpeg_bytes():
    """Newest JPEG from PC2's head camera, or None.

    Only the request that STARTS the reader waits for a frame, the same gate
    `_teleimager_jpeg_bytes` uses. Waiting unconditionally would mean that every
    caller blocks for `G1_PC2_CAMERA_FIRST_FRAME_S` throughout a reconnect —
    and the reader drops its cached frame on every disconnect by design, while
    its backoff reaches 10 s. With one thread per request and Agent Mode's idle
    watcher reading a camera every 3 s, those blocked handlers pile up exactly
    the way the RealSense ones did before the cooldown above was added.
    """
    reachable, fresh = _pc2cam_available()
    if not reachable:
        return None
    reader = _pc2cam_reader
    if reader is None:
        return None
    jpeg = reader.latest()
    if jpeg is None and fresh:
        # The reader has only just connected, and the publisher encodes nothing
        # until it has a client — so the first frame is always a moment behind
        # the request that woke it up.
        deadline = time.time() + float(os.environ.get("G1_PC2_CAMERA_FIRST_FRAME_S", "3.0"))
        while jpeg is None and time.time() < deadline:
            time.sleep(0.05)
            jpeg = reader.latest()
    return jpeg


# Why no frame source was found, in the operator's words rather than a stack
# trace. It reaches the cockpit through /cameras and through the stream's 503
# body, because "the camera panel is empty" is useless on its own: the operator
# needs to know whether to plug in a camera or to look at the robot's services.
def _no_camera_source_detail() -> str:
    """Why no frame source was found, in the operator's words.

    Built from the endpoints actually configured rather than the ones this lab
    happens to use: `G1_PC2_CAMERA_HOST`/`_PORT` and `G1_IMAGE_SERVER_HOST`/
    `_PORT` are overridable, and a message that names a machine nobody is
    running sends the operator to the wrong box.
    """
    pc2_host, pc2_port = _pc2cam_endpoint()
    img_host, img_port = _teleimager_host_port()
    return (
        "no camera source available. The robot's head camera is served by PC2 — "
        f"check `systemctl status g1-head-cam` on {pc2_host} (it publishes on "
        f"port {pc2_port}), or start the teleimager image server on {img_host} "
        f"(port {img_port}). Otherwise: no RealSense on this machine's USB, and "
        "the lerobot driver has no frames (read-only mode never loads it)."
    )


def _camera_source_and_names() -> "tuple[str | None, tuple[str, ...]]":
    """(active frame source, camera names it can serve).

    Source comes from G1_CAMERA_SOURCE ∈
    {auto|lerobot|teleimager|pc2cam|realsense}, the same knob
    /cameras/<n>/snapshot has always used. The `auto` order is lerobot (richest,
    but never loaded in read-only mode), then the two ways to reach the ROBOT's
    own head camera — the vendor's teleimager image server, then this lab's
    `g1_cam_pub.py` on PC2 — and only then a RealSense on this machine's USB.
    That last place is deliberate: the first three are what the robot sees,
    while a D435 plugged into the workstation sees whatever the desk faces.
    """
    cam_source = os.environ.get("G1_CAMERA_SOURCE", "auto").lower()
    if cam_source in ("auto", "lerobot"):
        names = _lerobot_camera_names()
        if names:
            return "lerobot", names
        if cam_source == "lerobot":
            return None, ()
    if cam_source in ("auto", "teleimager"):
        cfg = _teleimager_cam_config()
        ports = _teleimager_camera_ports(cfg) if cfg else {}
        if ports:
            # Sorted so /cameras is stable across restarts; the chip order in
            # the cockpit should not depend on dict insertion.
            return "teleimager", tuple(sorted(ports))
        if cam_source == "teleimager":
            return None, ()
    if cam_source in ("auto", "pc2cam"):
        if _pc2cam_available()[0]:
            return "pc2cam", (os.environ.get("G1_PC2_CAMERA_NAME", _REALSENSE_DEFAULT_NAME),)
        if cam_source == "pc2cam":
            return None, ()
    if cam_source in ("auto", "realsense"):
        if _ensure_realsense() is not None:
            return "realsense", (os.environ.get("G1_CAMERA_NAME", _REALSENSE_DEFAULT_NAME),)
    return None, ()


def _grab_camera_jpeg(name: str, resolved=None):
    """One frame for `name` as `(jpeg_bytes, source, error, kind)`.

    Exactly one of `jpeg` / `error` is set. `kind` is None on success and
    otherwise one of `no_source`, `unknown_name`, `no_frame` — the stream route
    maps it to an HTTP status, /snapshot ignores it. Shared by both so a name
    /cameras advertises is a name a stream will serve.

    `resolved` is an already-known `(source, names)` from
    `_camera_source_and_names()`, and a caller that grabs in a LOOP must pass
    it. Resolution is not free: in `auto` order every source ahead of the live
    one gets probed, and a probe that fails only fails cheaply for the length
    of its cooldown. Measured on this lab's rig — pc2cam serving, pyzmq
    installed, no teleimager image server — re-resolving per frame stalled the
    15 fps stream for a full 1.0 s every 5 s, which is a visible freeze in what
    the panel labels LIVE.
    """
    source, names = resolved if resolved is not None else _camera_source_and_names()
    if source is None:
        return None, None, _no_camera_source_detail(), "no_source"
    if name not in names:
        return None, source, (
            f"camera '{name}' is not served by source '{source}' "
            f"(have: {', '.join(names)})"
        ), "unknown_name"
    if source == "realsense":
        jpeg = _realsense_color_jpeg_bytes()
    elif source == "pc2cam":
        jpeg = _pc2cam_jpeg_bytes()
    elif source == "teleimager":
        jpeg = _teleimager_jpeg_bytes(name)
    else:
        jpeg = _lerobot_color_jpeg_bytes(name)
    if jpeg is None:
        return None, source, f"source '{source}' returned no frame for '{name}'", "no_frame"
    return jpeg, source, None, None


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


# --- Livox MID-360 via Unitree DDS (rt/utlidar/cloud_livox_mid360) -----------
# The G1's onboard bridge republishes the MID-360 as a sensor_msgs/PointCloud2
# over Unitree DDS — no ROS2 needed (the proven path of the 2026-07-07 real
# capture, see $UNITREE_ROOT/_data/g1_lidar/g1_lidar_capture.py). The cloud path
# is subscribe-only; the ONE write this file performs is the LiDAR enable
# switch below (set_lidar_switch) — see its docstring for the authorization.
_dds_lidar_source = None
_dds_lidar_lock = threading.Lock()
_dds_lidar_failed = False

_dds_factory_ready = False
_dds_factory_lock = threading.Lock()


def _ensure_dds_factory() -> None:
    """Process-global CycloneDDS factory init, shared by the LiDAR cloud
    subscriber and the switch publisher — ChannelFactoryInitialize can only run
    once per process, so both paths funnel through here. Raises on failure."""
    global _dds_factory_ready
    from unitree_sdk2py.core.channel import ChannelFactoryInitialize  # type: ignore

    with _dds_factory_lock:
        if _dds_factory_ready:
            return
        domain = int(os.environ.get("G1_LIDAR_DDS_DOMAIN", "0"))  # 0 = real robot
        iface = os.environ.get("G1_LIDAR_DDS_IFACE", os.environ.get("G1_NET_INTERFACE", "")).strip()
        if iface:
            ChannelFactoryInitialize(domain, iface)
        else:
            ChannelFactoryInitialize(domain)
        _dds_factory_ready = True


class _UnitreeDdsLidarSource:
    """Caches the latest PointCloud2_ from Unitree DDS via a subscriber callback.

    The unitree_sdk2py IDL mirrors sensor_msgs/PointCloud2 attribute-for-
    attribute (fields/offset/datatype, point_step, data, ...), so the cached
    message goes through the same `_parse_pointcloud2` as the ROS2 source.
    """

    def __init__(self, topic: str, domain: int, iface: str):
        self.topic = topic
        self.domain = domain
        self.iface = iface
        self._latest = None
        self._lock = threading.Lock()

    def start(self) -> None:
        from unitree_sdk2py.core.channel import ChannelSubscriber  # type: ignore
        from unitree_sdk2py.idl.sensor_msgs.msg.dds_ import PointCloud2_  # type: ignore

        _ensure_dds_factory()
        sub = ChannelSubscriber(self.topic, PointCloud2_)
        sub.Init(self._cb, 8)
        print(
            f"[G1 Sidecar] ✅ Unitree-DDS LiDAR subscriber on {self.topic} "
            f"(domain {self.domain}, iface '{self.iface or 'default'}')",
            flush=True,
        )

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


def _dds_pointcloud(target_count: int):
    """Latest MID-360 frame via Unitree DDS. Returns (positions, intensities,
    has_intensity, "dds") or None when unitree_sdk2py is unavailable, DDS
    init failed once before, or no cloud arrives within the timeout."""
    global _dds_lidar_source, _dds_lidar_failed
    if _dds_lidar_failed:
        return None
    try:
        import unitree_sdk2py  # type: ignore  # noqa: F401  (availability check only)
    except ImportError:
        return None
    try:
        with _dds_lidar_lock:
            if _dds_lidar_source is None:
                _dds_lidar_source = _UnitreeDdsLidarSource(
                    topic=os.environ.get("G1_LIDAR_DDS_TOPIC", "rt/utlidar/cloud_livox_mid360"),
                    domain=int(os.environ.get("G1_LIDAR_DDS_DOMAIN", "0")),
                    iface=os.environ.get("G1_LIDAR_DDS_IFACE", os.environ.get("G1_NET_INTERFACE", "")).strip(),
                )
                _dds_lidar_source.start()
        msg = _dds_lidar_source.latest(float(os.environ.get("G1_LIDAR_DDS_TIMEOUT_S", "2.0")))
        if msg is None:
            return None
        positions, intensities = _parse_pointcloud2(msg, target_count)
        if not positions:
            return None
        return positions, intensities, bool(intensities), "dds"
    except Exception as e:  # noqa: BLE001
        # DDS init is process-global and not retryable — remember the failure
        # so auto mode doesn't pay the init cost on every snapshot.
        _dds_lidar_failed = True
        print(f"[G1 Sidecar] Unitree-DDS LiDAR ingest failed ({e})", flush=True)
        return None


# --- LiDAR power switch (rt/utlidar/switch) ----------------------------------
# THE single authorized write while stage 1 (read-only) is active — explicitly
# user-authorized 2026-07-07 and re-used by g1_lidar_capture.py: publishing
# "ON"/"OFF" to rt/utlidar/switch is a sensor enable. It commands NO robot
# motion and opens no rt/lowcmd / MotionSwitcher path. It is therefore allowed
# even when G1_READ_ONLY is set; set G1_ALLOW_LIDAR_SWITCH=0 to remove this
# write path entirely.
LIDAR_SWITCH_ALLOWED = os.environ.get("G1_ALLOW_LIDAR_SWITCH", "1").strip() != "0"

_lidar_switch_lock = threading.Lock()


def set_lidar_switch(on: bool) -> dict:
    """Publish ON/OFF to rt/utlidar/switch (see authorization note above).

    The write is repeated 15× over ~3 s — the proven pattern from
    g1_lidar_capture.py. A shorter burst (5×/1 s) was observed to get lost on a
    freshly created publisher: DDS discovery to the robot's utlidar node had
    not completed and every write was dropped (2026-07-17 live test).

    A FRESH publisher is created for every request and closed afterwards:
    a publisher cached across requests went stale after the robot restarted
    its utlidar node — 6 bursts published into the void while a fresh
    publisher (capture script) switched the sensor instantly (2026-07-18
    live test). The 3 s discovery burst already dominates the cost, so a
    per-request publisher loses nothing.
    Returns {"ok": True, "lidar": "ON"|"OFF"} or {"ok": False, "error": ...};
    never raises.
    """
    if not LIDAR_SWITCH_ALLOWED:
        return {"ok": False, "error": "G1_ALLOW_LIDAR_SWITCH=0 — LiDAR switch write disabled"}
    try:
        from unitree_sdk2py.core.channel import ChannelPublisher  # type: ignore
        from unitree_sdk2py.idl.std_msgs.msg.dds_ import String_  # type: ignore
        from unitree_sdk2py.idl.default import std_msgs_msg_dds__String_  # type: ignore
    except ImportError:
        return {"ok": False, "error": "unitree_sdk2py not installed — cannot reach rt/utlidar/switch"}
    try:
        with _lidar_switch_lock:
            _ensure_dds_factory()
            pub = ChannelPublisher("rt/utlidar/switch", String_)
            pub.Init()
            try:
                cmd = std_msgs_msg_dds__String_()
                cmd.data = "ON" if on else "OFF"
                for _ in range(15):
                    pub.Write(cmd)
                    time.sleep(0.2)
            finally:
                try:
                    pub.Close()
                except Exception:  # noqa: BLE001
                    pass  # never let cleanup mask the write result
        print(
            f"[G1 Sidecar] LiDAR switch → {cmd.data} (rt/utlidar/switch — sensor enable, no motion)",
            flush=True,
        )
        return {"ok": True, "lidar": cmd.data}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": f"LiDAR switch failed: {e}"}


# ---------------------------------------------------------------------------
# MID-360 frame convention — locked ONCE PER SCAN SESSION (TASK-190)
# ---------------------------------------------------------------------------
# Deciding invert/anchor/leave-raw independently for every frame is wrong on a
# WALKED scan: a frame aimed at an open doorway finds no dominant floor plane
# and was left raw (+z DOWN) while its neighbours were flipped, so that slice
# stitched into the accumulated twin mirrored. The mount cannot change between
# two consecutive frames, so the convention is a property of the SESSION, not
# of the frame: lock it from the first `_MID360_LOCK_AFTER` frames that DO
# carry a confident floor plane, then apply it to every later frame regardless
# of that frame's own floor content. The per-frame heuristic survives only as
# the fallback for frames seen BEFORE a convention could be established — and
# `_MID360_LOCK_AFTER` frames IN A ROW that disagree re-lock the session, so a
# source that genuinely switches convention (a robot-side SLAM mode publishing
# gravity-aligned clouds) is still followed. Same evidence bar in both
# directions: one odd frame can neither set nor overturn the convention.
_MID360_LOCK_AFTER = 3
# How far a frame's own floor plane may sit from the session anchor before it is
# distrusted (a table top or a wall mistaken for the dominant plane). Within the
# tolerance the frame anchors on its OWN floor — the sensor bobs while walking,
# so per-frame anchoring stays more accurate than a fixed session height; the
# session anchor then follows the floor across ramps and steps.
_MID360_ANCHOR_TOLERANCE = 0.6
# Frames that arrive with no scan session are still one continuous live view, so
# they share a convention under this key rather than re-deciding per frame.
_MID360_LIVE_SESSION = "(live)"
# Sessions are sequential; a couple of spares cover an overlapping stop/start.
_MID360_SESSION_CACHE = 4


class _Mid360Orientation:
    """The MID-360 frame convention held for one scan session's lifetime.

    Not thread-safe on its own — every entry point goes through
    `_mid360_plan`, which holds `_mid360_orientation_lock`.
    """

    def __init__(self, session: str) -> None:
        self.session = session
        self.inverted: bool | None = None  # None until locked
        self.anchor: float | None = None  # raw-frame height of the floor (m)
        self._samples: list[float] = []
        self._contradicting: list[float] = []
        self._note: str | None = None

    @property
    def locked(self) -> bool:
        return self.inverted is not None

    def plan(self, plane_z: float | None) -> tuple[bool | None, float, str]:
        """Decide how to transform one frame.

        `plane_z` is this frame's confident floor plane in the raw frame, or
        None when it has none. Returns `(inverted, anchor, note)`; `inverted`
        is None only when no convention exists yet AND this frame cannot
        supply one, in which case the frame is left raw as before.
        """
        if not self.locked:
            if plane_z is not None:
                self._observe(plane_z)
            if not self.locked:
                if plane_z is None:
                    return None, 0.0, "raw (no convention yet, no floor in frame)"
                # Pre-lock frame with a floor: the old per-frame heuristic.
                inverted = plane_z > 0.5
                return inverted, plane_z, f"learning ({'inverted' if inverted else 'upright'} from own floor {plane_z:+.2f})"
        elif plane_z is not None:
            self._check_for_a_changed_publisher(plane_z)

        assert self.anchor is not None  # set together with `inverted`
        if plane_z is not None and abs(plane_z - self.anchor) <= _MID360_ANCHOR_TOLERANCE:
            self.anchor = plane_z  # track the floor as the robot walks
            return self.inverted, plane_z, self._locked_note("own floor")
        if plane_z is None:
            return self.inverted, self.anchor, self._locked_note("session anchor — no floor in frame")
        return self.inverted, self.anchor, self._locked_note(f"session anchor — own plane {plane_z:+.2f} implausible")

    def _observe(self, plane_z: float) -> None:
        self._samples.append(plane_z)
        if len(self._samples) >= _MID360_LOCK_AFTER:
            self._decide_from(self._samples, "LOCKED")

    def _check_for_a_changed_publisher(self, plane_z: float) -> None:
        """Re-lock if the SOURCE really did switch convention mid-session.

        Locking must not cost the robustness the per-frame detection had: if a
        robot-side utlidar/SLAM mode starts publishing already-gravity-aligned
        clouds, the floor moves to the other side of the origin and stays
        there. That needs the same weight of evidence as the original lock —
        `_MID360_LOCK_AFTER` frames IN A ROW disagreeing — so a lone odd frame
        (a table top read as the dominant plane) can never trip it.
        """
        if (plane_z > 0.5) == self.inverted:
            self._contradicting.clear()
            return
        self._contradicting.append(plane_z)
        if len(self._contradicting) >= _MID360_LOCK_AFTER:
            self._decide_from(self._contradicting, "RE-LOCKED (source changed convention)")
            self._contradicting.clear()
            self._samples = []

    def _decide_from(self, samples: list[float], why: str) -> None:
        # Majority vote so one spurious frame cannot set the convention, and
        # anchor on the median of the frames that agree with the winner.
        inverted = sum(1 for z in samples if z > 0.5) * 2 > len(samples)
        agreeing = sorted(z for z in samples if (z > 0.5) == inverted)
        self.inverted = inverted
        self.anchor = agreeing[len(agreeing) // 2]
        print(
            f"[G1 Sidecar] MID-360 convention {why} for session {self.session}: "
            f"{'inverted raw' if inverted else 'upright'}, floor at {self.anchor:+.2f} "
            f"(from {len(samples)} frame(s) with a floor)",
            flush=True,
        )

    def _locked_note(self, how: str) -> str:
        return f"{'inverted raw' if self.inverted else 'upright'}, anchored on {how}"

    def announce(self, note: str) -> None:
        """Log the note once per change, not once per frame."""
        if note != self._note:
            self._note = note
            print(f"[G1 Sidecar] MID-360 frame convention [{self.session}]: {note}", flush=True)


_mid360_orientations: dict[str, _Mid360Orientation] = {}
_mid360_orientation_lock = threading.Lock()


def _mid360_plan(session: str | None, plane_z: float | None) -> tuple[bool | None, float]:
    """Session-scoped orientation decision for one frame (see `_Mid360Orientation`)."""
    key = (session or "").strip() or _MID360_LIVE_SESSION
    with _mid360_orientation_lock:
        orient = _mid360_orientations.get(key)
        if orient is None:
            orient = _Mid360Orientation(key)
            _mid360_orientations[key] = orient
            while len(_mid360_orientations) > _MID360_SESSION_CACHE:
                del _mid360_orientations[next(iter(_mid360_orientations))]
        inverted, anchor, note = orient.plan(plane_z)
        orient.announce(note)
        return inverted, anchor


def _mid360_floor_plane(a, np) -> float | None:
    """Height of the dominant horizontal plane within 8 m, or None if there is none.

    Purely a measurement — it says where the floor looks to be in THIS frame's
    raw coordinates and never decides what to do about it.
    """
    r = np.hypot(a[:, 0], a[:, 1])
    near_z = a[(r < 8.0), 2]
    if len(near_z) < 200 or float(near_z.max() - near_z.min()) <= 0.3:
        return None
    hist, edges = np.histogram(near_z, bins=np.arange(near_z.min(), near_z.max() + 0.1, 0.1))
    k = int(hist.argmax())
    if hist[k] < max(150, 0.06 * len(near_z)):
        return None
    return float(edges[k]) + 0.05


def _normalize_mid360_frame(
    positions: list,
    intensities: list,
    session: str | None = None,
) -> tuple[list, list]:
    """Bring a live MID-360 frame into the contract frame (z-up, floor z=0).

    See the frame-convention note above DEPTH_SENSORS. Steps:
      1. Drop the self-return blob (3D range < 0.3 m — the sensor seeing its
         own housing, ~50 % of a raw frame); intensities are filtered in
         lockstep so per-point data stays aligned.
      2. Measure the dominant horizontal plane within 8 m — the floor, when
         the frame contains one. A frame too sparse to measure anything (a
         truncated DDS message, a direction with almost no returns) simply has
         no plane; it is still PLACED by step 3 like any other floorless
         frame, because returning it raw mid-sweep would stitch exactly the
         mirrored slice TASK-190 is about into the twin.
      3. Ask the SESSION for the convention (TASK-190), not this frame:
         • session locked, inverted → the raw frame of the inverted head
           MID-360 (+z physically down): flip (y, z) — 180° about x, keeping
           x=forward and right-handedness — and anchor the floor at 0. (Which
           horizontal axis mirrors is an assumption; only left/right in the
           viewer depends on it.)
         • session locked, upright → the frame is already gravity-aligned;
           snap the floor to exactly 0.
         • either way a frame with NO floor of its own is anchored on the
           session's remembered floor height, so it lands in the same frame as
           its neighbours instead of being stitched in mirrored.
         • no convention yet AND no floor in this frame → orientation kept,
           the pre-TASK-190 behaviour, now only reachable at session start.

    `session` is the scan-session id from the X-Scan-Session request header;
    frames without one share a single live-view convention.
    """
    n = len(positions) // 3
    if n == 0:
        return positions, intensities  # heartbeat — no points to place
    try:
        import numpy as np
    except ImportError:
        return positions, intensities
    a = np.asarray(positions, dtype=np.float32).reshape(-1, 3)

    keep = np.linalg.norm(a, axis=1) >= 0.3
    if not bool(keep.any()):
        return positions, intensities  # entirely self-return — nothing to place
    a = a[keep]
    if len(intensities) == n:
        intensities = [v for v, k in zip(intensities, keep.tolist()) if k]

    # Sparseness gates the MEASUREMENT, never the PLACEMENT: `_mid360_floor_plane`
    # answers None for a frame with too few near points, and a locked session
    # then anchors it on its remembered floor exactly like any other floorless
    # frame. Bailing out early here instead — as this did before TASK-190 — is
    # what let a truncated frame arrive raw (+z down) between two flipped ones.
    inverted, anchor = _mid360_plan(session, _mid360_floor_plane(a, np))
    if inverted is True:
        a[:, 1] = -a[:, 1]
        a[:, 2] = anchor - a[:, 2]
    elif inverted is False:
        a[:, 2] -= anchor
    return a.reshape(-1).tolist(), intensities


def get_point_cloud(name: str, session: str | None = None) -> dict:
    """Read one point-cloud frame from a depth / LiDAR sensor.

    Source is chosen by G1_LIDAR_SOURCE ∈ {auto|dds|livox|realsense|replay}
    (default auto). Fallback chain — never crashes, always returns the flat
    contract below:

      • replay  : decode a real recording (KITTI .bin / PCD) via
                  pointcloud_replay when G1_POINTCLOUD_REPLAY is set.
      • dds     : latest rt/utlidar/cloud_livox_mid360 PointCloud2 over
                  Unitree DDS (MID-360, no ROS2 — the native-Windows path).
      • livox   : latest /livox/lidar PointCloud2 over ROS2 (MID-360).
      • realsense: deproject a RealSense depth frame (pyrealsense2 + numpy).
      • empty   : last resort — empty frame so the seam stays alive.

    auto order:  replay (if configured) → [lidar: dds → livox → realsense] /
                 [depth: realsense] → empty.
    Explicit selectors force a single live source (then fall back to empty).

    Flat contract (matches the Node HardwareClient / PointCloudFrame):
      positions   = [x0,y0,z0, x1,y1,z1, ...]  (meters, base frame, x-fwd/y-left/z-up)
      intensities = [i0, i1, ...]              (normalized 0..1)

    `session` is the caller's scan-session id (X-Scan-Session). It scopes the
    MID-360 frame convention so every frame of one walked scan is brought into
    the same frame — see `_normalize_mid360_frame`.
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
        elif source == "dds":
            live = _dds_pointcloud(target)
        else:  # auto
            live = _dds_pointcloud(target) or _livox_pointcloud(target) or _realsense_pointcloud(target)
    else:  # d435i_depth → RealSense
        live = _realsense_pointcloud(target)

    if live:
        positions, intensities, has_i, label = live
        # Bring live MID-360 frames into the contract frame (floor at z=0) so
        # the robot model stands correctly inside its own scan — under ONE
        # convention for the whole scan session (TASK-190).
        if name == "mid360_lidar" and label in ("dds", "livox"):
            positions, intensities = _normalize_mid360_frame(positions, intensities, session)
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


# ---------------------------------------------------------------------------
# AGENT MODE — high-level locomotion via LocoClient (/loco/*, TASK-194)
# ---------------------------------------------------------------------------
# Despite living in the SDK's `high_level/` folder, LocoClient is plain DDS RPC
# on rt/api/sport/{request,response}. The identical client code therefore drives
# the real G1's onboard FSM and the simulated service in
# sim_g1_dds/loco_service.py — only the DDS peer changes. Keep the semantics
# here in sync with sim_g1_dds/loco_state.py (nothing is imported from it: that
# module runs in the simulator's Python, this file in the sidecar's).
#
# Gate: G1_LOCO_ENABLED (see its rationale at the top of this file). Gate off →
# 403; SDK missing / DDS down / RPC unanswered → 503 with the real reason.
#
# DDS domain + interface come from _ensure_dds_factory(), i.e. from
# G1_LIDAR_DDS_DOMAIN / G1_LIDAR_DDS_IFACE. The names are historical (the LiDAR
# path got there first) but the value is process-global: CycloneDDS'
# ChannelFactoryInitialize can only run once per process, so LiDAR, odometry and
# loco RPC necessarily share one domain. Against the simulator set
# G1_LIDAR_DDS_DOMAIN=1 (0 = real robot, 1 = sim, 9 = mock/tests).

LOCO_RPC_TIMEOUT_S = _pos_float("G1_LOCO_RPC_TIMEOUT_S", 3.0)
ODOM_MAX_AGE_S = _pos_float("G1_ODOM_MAX_AGE_S", 2.0)

# FSM ids used by LocoClient's convenience wrappers — echoed back so a caller
# (and the audit log) can read what was commanded, not just a bare number.
LOCO_FSM_NAMES = {
    0: "zero_torque",
    1: "damp",
    3: "sit",
    500: "start",
    702: "lie_to_stand",
    706: "squat_stand",
}

# unitree_sdk2py/rpc/internal.py — surfaced verbatim so a 503 says WHY.
_RPC_CODE_NAMES = {
    3001: "unknown error",
    3102: "client send failed (no DDS peer?)",
    3103: "api not registered on the client",
    3104: "api call timed out — no response from the sport service",
    3105: "api id mismatch in the response",
    3106: "bad response data",
    3202: "server internal error",
    3203: "api not implemented by the service",
    3204: "bad parameter",
}

_loco_client = None
_loco_lock = threading.Lock()       # guards construction of the singleton
_loco_rpc_lock = threading.Lock()   # serialises RPC calls (ThreadingHTTPServer)


def _loco_gate_error() -> dict:
    return {
        "ok": False,
        "error": (
            "G1_LOCO_ENABLED != 1 — /loco/* disabled on this sidecar "
            "(telemetry-only process). Set G1_LOCO_ENABLED=1 to allow locomotion."
        ),
    }


def _get_loco_client():
    """(client, None) on success, (None, error_dict) on failure. Never raises.

    ONE LocoClient per process, built lazily and cached: its RPC stub owns DDS
    readers/writers, so re-creating it per request would re-run discovery every
    time. Failures are deliberately NOT cached — "SDK missing" is permanent but
    "DDS peer not up yet" is not, and the honest thing is to retry and report
    the current reason rather than remember a stale one.
    """
    global _loco_client
    with _loco_lock:
        if _loco_client is not None:
            return _loco_client, None
        try:
            from unitree_sdk2py.g1.loco.g1_loco_client import LocoClient  # type: ignore
        except ImportError as e:  # noqa: BLE001
            return None, {
                "ok": False,
                "error": f"unitree_sdk2py not installed — LocoClient unavailable ({e})",
            }
        domain = os.environ.get("G1_LIDAR_DDS_DOMAIN", "0")
        iface = os.environ.get("G1_LIDAR_DDS_IFACE", os.environ.get("G1_NET_INTERFACE", "")).strip()
        try:
            _ensure_dds_factory()
        except Exception as e:  # noqa: BLE001
            return None, {
                "ok": False,
                "error": (
                    f"DDS init failed (domain {domain}, iface '{iface or 'default'}'): {e}"
                ),
            }
        try:
            client = LocoClient()
            set_timeout = getattr(client, "SetTimeout", None)
            if callable(set_timeout):
                set_timeout(LOCO_RPC_TIMEOUT_S)
            client.Init()
        except Exception as e:  # noqa: BLE001
            return None, {"ok": False, "error": f"LocoClient init failed: {e}"}
        _loco_client = client
        print(
            f"[G1 Sidecar] ✅ LocoClient ready (sport service, domain {domain}, "
            f"iface '{iface or 'default'}', timeout {LOCO_RPC_TIMEOUT_S}s)",
            flush=True,
        )
        return client, None


def _rpc_failed(what: str, code: int) -> dict:
    return {
        "ok": False,
        "error": f"{what} rejected by the sport service: rpc code {code} "
                 f"({_RPC_CODE_NAMES.get(code, 'see unitree_sdk2py/rpc/internal.py')})",
        "rpc_code": code,
    }


def _finite_number(value):
    """float(value) when it is a real, finite number — else None.

    bool is rejected explicitly: in Python `True` is an int, and a JSON `true`
    slipping through as vx=1.0 m/s is exactly the kind of thing that must be a
    400, not a step forward.
    """
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    v = float(value)
    return v if math.isfinite(v) else None


def loco_move(body: dict) -> tuple[int, dict]:
    """POST /loco/move — {"vx","vy","omega","duration_s"} → SetVelocity.

    All four are required and must be finite numbers. duration_s is not
    optional on purpose: the real robot expires a velocity command after its
    duration (that is why LocoClient.Move() has to be called in a loop), so a
    silently defaulted duration would mean a silently different distance
    travelled.
    """
    if not LOCO_ENABLED:
        return 403, _loco_gate_error()

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

    client, err = _get_loco_client()
    if client is None:
        return 503, err
    try:
        with _loco_rpc_lock:
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

    ⚠️ We deliberately do NOT call LocoClient.WaveHand / StopMove /
    ShakeHand(0|1), even though those are the documented wrappers: each of them
    DISCARDS the status code of the SetTaskId / SetVelocity call it makes (see
    unitree_sdk2py/g1/loco/g1_loco_client.py), so a request that never reached
    the robot would read back as a successful wave. Observed live, not
    theoretical: on a domain with no sport service the same wire error surfaced
    as rpc code 3102 through ShakeHand() and as silence through WaveHand().

    What goes on the wire is IDENTICAL to the wrapper — same api id, same JSON
    parameter — so "sim and hardware speak one API" still holds:
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


def loco_action(body: dict) -> tuple[int, dict]:
    """POST /loco/action — {"name": "wave"|"shake"|"stop", "args": {...}}.

    args: wave → {"turn": bool} (turn the torso toward the greeted person),
    shake → {"stage": -1 toggle | 0 reach | 1 return}, stop → none.
    """
    if not LOCO_ENABLED:
        return 403, _loco_gate_error()

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
        return 400, {"ok": False, "error": f"unknown action '{name}' — expected 'wave', 'shake' or 'stop'"}

    client, err = _get_loco_client()
    if client is None:
        return 503, err
    try:
        with _loco_rpc_lock:
            code = _dispatch_action(client, name, detail)
    except Exception as e:  # noqa: BLE001
        return 503, {"ok": False, "error": f"{name} failed: {e}"}
    if code != 0:
        return 503, _rpc_failed(name, code)
    return 200, {"ok": True, "action": name, "rpc_code": 0, **detail}


def loco_fsm(body: dict) -> tuple[int, dict]:
    """POST /loco/fsm — {"id": int} → SetFsmId.

    Known ids: 0 zero-torque, 1 damp, 3 sit, 500 start/main, 702 lie→stand,
    706 squat↔stand. Unknown ids are passed through: the FSM table belongs to
    the robot's firmware, and refusing an id this file has not heard of would
    make the sidecar the bottleneck on a firmware update. The id is echoed back
    with its name (or null) so the caller sees what it actually sent.
    """
    if not LOCO_ENABLED:
        return 403, _loco_gate_error()

    fsm_id = body.get("id")
    if isinstance(fsm_id, bool) or not isinstance(fsm_id, int):
        return 400, {"ok": False, "error": f"'id' must be an integer FSM id, got {fsm_id!r}"}

    client, err = _get_loco_client()
    if client is None:
        return 503, err
    try:
        with _loco_rpc_lock:
            code = client.SetFsmId(fsm_id)
    except Exception as e:  # noqa: BLE001
        return 503, {"ok": False, "error": f"SetFsmId({fsm_id}) failed: {e}"}
    if code != 0:
        return 503, _rpc_failed(f"SetFsmId({fsm_id})", code)
    return 200, {"ok": True, "rpc_code": 0, "id": fsm_id, "fsm": LOCO_FSM_NAMES.get(fsm_id)}


# Sentinels LocoClient.HighStand()/LowStand() send through SetStandHeight.
_UINT32_MAX = (1 << 32) - 1


def loco_stand_height(body: dict) -> tuple[int, dict]:
    """POST /loco/stand-height — {"preset": "high"|"low"} or {"metres": float}.

    Standing height is NOT an FSM id — there is no high-stand/low-stand entry in
    the FSM table. It is its own RPC (SetStandHeight, api 7106's neighbour 7104),
    and LocoClient.HighStand()/LowStand() are thin wrappers that send UINT32_MAX
    and 0 as sentinels. Agent Mode's `posture: high|low` blocks route here;
    without this endpoint they had no way to work at all.
    """
    if not LOCO_ENABLED:
        return 403, _loco_gate_error()

    preset = body.get("preset")
    metres = body.get("metres")
    if preset is not None:
        if preset == "high":
            value = float(_UINT32_MAX)
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

    client, err = _get_loco_client()
    if client is None:
        return 503, err
    try:
        with _loco_rpc_lock:
            code = client.SetStandHeight(value)
    except Exception as e:  # noqa: BLE001
        return 503, {"ok": False, "error": f"SetStandHeight({value}) failed: {e}"}
    if code != 0:
        return 503, _rpc_failed(f"SetStandHeight({value})", code)
    return 200, {"ok": True, "rpc_code": 0, "preset": preset, "metres": metres}


# --- odometry (rt/odommodestate) ---------------------------------------------
# Two possible sources, both reporting the SAME SportModeState_ content:
#   • "zmq" — the read-only bridge on the robot's PC2 forwards the topic over
#     the existing ZMQ PUB socket (this is how /state gets odometry while
#     G1_READ_ONLY is on; no DDS init needed here).
#   • "dds" — a direct CycloneDDS subscriber, used when the ZMQ bridge is not
#     the state source (e.g. against the simulator, which publishes the topic
#     itself).
# If neither has anything fresh we return 503 and say so. Returning (0,0,0)
# would be a fabricated pose, and the navigator would happily integrate it.
#
# NEITHER of those two names says whether the POSE is measured or guessed — they
# name the wire we read it off. That distinction lives one field over, in
# SportModeState_.error_code, which the Isaac bridge stamps as a PROVENANCE
# MARKER (isaac_odom.py): 0x600D = x/y came verbatim off the sim's true root
# pose, 0xDEAD = x/y were dead reckoned from the velocity we ourselves commanded
# and are therefore a guess that reports ~100% of the command no matter what the
# base did (TASK-231). The marker is message-level: it describes the whole frame.
# Until now the sidecar dropped it, so Agent Mode could not tell an exact pose
# from a reckoned one. We decode it into a SEPARATE "provenance" field rather
# than folding it into "source": callers already read "source" as the transport
# and the two answers are independent (a DDS frame can be either).
ODOM_ERROR_CODE_GROUND_TRUTH = 0x600D
ODOM_ERROR_CODE_DEAD_RECKONED = 0xDEAD
ODOM_PROVENANCE_BY_ERROR_CODE = {
    ODOM_ERROR_CODE_GROUND_TRUTH: "ground-truth",
    ODOM_ERROR_CODE_DEAD_RECKONED: "dead-reckoned",
}
# Anything else — a real G1's 0, a real G1 fault code, a publisher that predates
# the marker, a bridge that never stamps one. "unknown" is the only honest answer
# there: calling an unstamped frame "ground-truth" is exactly the lie this task
# exists to kill, and calling it "dead-reckoned" would libel a real robot's own
# state estimator. A caller that needs certainty must treat "unknown" as "not
# certain", not as "probably fine".
ODOM_PROVENANCE_UNKNOWN = "unknown"

_dds_odom_source = None
_dds_odom_lock = threading.Lock()


class _UnitreeDdsOdomSource:
    """Caches the latest SportModeState_ from rt/odommodestate, with its
    arrival time so staleness is judged the same way _LowStateReader does."""

    def __init__(self, topic: str) -> None:
        self.topic = topic
        self._latest = None  # (msg, recv ts)
        self._lock = threading.Lock()

    def start(self) -> None:
        from unitree_sdk2py.core.channel import ChannelSubscriber  # type: ignore
        from unitree_sdk2py.idl.unitree_go.msg.dds_ import SportModeState_  # type: ignore

        _ensure_dds_factory()
        sub = ChannelSubscriber(self.topic, SportModeState_)
        sub.Init(self._cb, 8)
        print(f"[G1 Sidecar] ✅ DDS odometry subscriber on {self.topic}", flush=True)

    def _cb(self, msg) -> None:
        with self._lock:
            self._latest = (msg, time.time())

    def latest(self, max_age_s: float):
        with self._lock:
            entry = self._latest
        if entry is None or time.time() - entry[1] > max_age_s:
            return None
        return entry[0]


def _odom_provenance(error_code):
    """(provenance, error_code) decoded from a SportModeState_.error_code.

    `error_code` is whatever the message carried — an int, None on a feed that
    omits the field, or junk off a JSON bridge. Both halves come back JSON-safe:
    the code is echoed only when it really was an integer, so a caller reading
    `errorCode: null` knows the frame carried no marker rather than one it
    could not parse.
    """
    try:
        code = int(error_code)
    except (TypeError, ValueError):
        return ODOM_PROVENANCE_UNKNOWN, None
    return ODOM_PROVENANCE_BY_ERROR_CODE.get(code, ODOM_PROVENANCE_UNKNOWN), code


def _pose_from(position, rpy, error_code=None):
    """(x, y, yaw, provenance, error_code) from a SportModeState_, or None.

    yaw is rpy[2]; a message without a usable position is not a pose, so we
    refuse it rather than defaulting anything to 0. `error_code` is the
    publisher's provenance marker and is OPTIONAL — a feed that omits it yields
    "unknown", which never blocks a pose: an undated pose is still a pose, it is
    just one the caller must not call exact.
    """
    pos = _coerce3(position)
    if pos is None:
        return None
    ang = _coerce3(rpy)
    if ang is None:
        return None
    provenance, code = _odom_provenance(error_code)
    return pos[0], pos[1], ang[2], provenance, code


def _odom_from_zmq():
    """Pose from the read-only bridge feed, or None when nothing fresh."""
    if not _lowstate_reader.start():
        return None
    data = _lowstate_reader.latest(TOPIC_ODOM, max_age_s=ODOM_MAX_AGE_S)
    if not isinstance(data, dict):
        return None
    # The bridge flattens SportModeState_; accept both a top-level "rpy" (what
    # _get_state_readonly consumes) and the nested imu_state.rpy of the IDL.
    rpy = data.get("rpy")
    if rpy is None and isinstance(data.get("imu_state"), dict):
        rpy = data["imu_state"].get("rpy")
    return _pose_from(data.get("position"), rpy, data.get("error_code"))


def _odom_from_dds():
    """Pose from a direct DDS subscriber, or None. Never raises."""
    global _dds_odom_source
    try:
        import unitree_sdk2py  # type: ignore  # noqa: F401  (availability check only)
    except ImportError:
        return None
    try:
        with _dds_odom_lock:
            if _dds_odom_source is None:
                source = _UnitreeDdsOdomSource(TOPIC_ODOM)
                source.start()
                _dds_odom_source = source
        msg = _dds_odom_source.latest(ODOM_MAX_AGE_S)
        if msg is None:
            return None
        return _pose_from(getattr(msg, "position", None),
                          getattr(getattr(msg, "imu_state", None), "rpy", None),
                          getattr(msg, "error_code", None))
    except Exception as e:  # noqa: BLE001
        print(f"[G1 Sidecar] DDS odometry unavailable ({e})", flush=True)
        return None


def loco_odom() -> tuple[int, dict]:
    """GET /loco/odom — the base pose in the world frame, with its provenance.

    {"ok","x","y","yaw","source","provenance","errorCode","topic"}. "source" is
    the TRANSPORT ("zmq"/"dds") and keeps the meaning callers already read;
    "provenance" answers the different question of whether the pose was MEASURED
    ("ground-truth") or GUESSED from our own command ("dead-reckoned"), or
    whether the publisher said nothing ("unknown") — see the two error-code
    constants above.

    Read-only, but gated with the rest of /loco/* per the Agent Mode contract:
    a sidecar that refuses to move should not advertise a navigation feed
    either, and one flag is easier to reason about than two.
    """
    if not LOCO_ENABLED:
        return 403, _loco_gate_error()

    # ZMQ first while READ_ONLY: that bridge is the state source in that mode
    # and is already running, so it costs nothing. Otherwise DDS leads.
    order = (("zmq", _odom_from_zmq), ("dds", _odom_from_dds))
    if not READ_ONLY:
        order = tuple(reversed(order))
    for source, fetch in order:
        pose = fetch()
        if pose is not None:
            x, y, yaw, provenance, error_code = pose
            return 200, {"ok": True, "x": x, "y": y, "yaw": yaw,
                         "source": source, "provenance": provenance,
                         "errorCode": error_code, "topic": TOPIC_ODOM}
    return 503, {
        "ok": False,
        "error": (
            f"no odometry newer than {ODOM_MAX_AGE_S}s on '{TOPIC_ODOM}' "
            f"(tried: {', '.join(s for s, _ in order)}). The read-only bridge or "
            "the DDS publisher is not running — refusing to report a pose."
        ),
    }


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

    def _stream_mjpeg(self, name: str) -> None:
        """Serve `name` as multipart MJPEG until the client goes away (TASK-233).

        Mirrors sim_g1_dds/sim_node.py's streamer so the cockpit behaves the
        same against the robot as against the sim — the app has been asking for
        this route all along (`/robots/:id/camera/:name/stream` in
        src/api/rest-routes.ts proxies straight to it) and got a 404.

        The first frame is grabbed BEFORE the 200. Once the multipart header is
        on the wire there is no longer any way to say "no such camera" that a
        browser will show — it would just wait forever on an empty stream. So
        an unknown name answers 404 and a source with no frame 503, both as
        JSON, and the agent's proxy turns either into CAMERA_UNAVAILABLE.

        This is the SECOND reply path in a handler where `_send` is otherwise
        the only one. A stream has no Content-Length — it is not supposed to
        end — so the connection is closed by hand instead of kept alive: leave
        keep-alive on and the next request on this socket is read as more image
        data, which does not fail, it desynchronises.

        Each open stream grabs its own frames; two viewers are two grabs, not a
        shared one. G1_CAMERA_STREAM_FPS bounds a single stream, not their sum.

        The SOURCE is resolved once, before the 200, and then pinned for the
        life of the stream. Re-resolving per frame re-probes every source ahead
        of the live one in `auto` order, and each of those only fails cheaply
        for the length of its cooldown: with pc2cam serving and no teleimager
        image server running, that cost a measured 1.0 s freeze every 5 s. A
        camera appearing or vanishing mid-stream is /cameras' business — the
        cockpit polls it — not something to pay for on every frame.
        """
        resolved = _camera_source_and_names()
        jpeg, source, error, kind = _grab_camera_jpeg(name, resolved)
        if jpeg is None:
            self._send(404 if kind == "unknown_name" else 503,
                       {"ok": False, "camera": name, "source": source, "error": error})
            return

        self.close_connection = True
        self.send_response(200)
        self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=FRAME")
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Connection", "close")
        self.end_headers()

        # A viewer that vanishes without closing the socket — a sleeping laptop,
        # WiFi dropping, a NAT dropping the flow — leaves `write` blocking with
        # nothing to raise. This is the file's only long-lived response, and
        # ThreadingHTTPServer gives each one a thread and no cap, so without a
        # deadline every such viewer leaks one thread until the sidecar restarts.
        try:
            self.connection.settimeout(
                float(os.environ.get("G1_CAMERA_STREAM_WRITE_TIMEOUT_S", "20"))
            )
        except OSError:  # pragma: no cover — a socket that cannot be configured
            pass

        min_dt = 1.0 / max(1.0, float(os.environ.get("G1_CAMERA_STREAM_FPS", "15")))
        try:
            while True:
                started = time.time()
                self.wfile.write(b"--FRAME\r\nContent-Type: image/jpeg\r\nContent-Length: "
                                 + str(len(jpeg)).encode() + b"\r\n\r\n" + jpeg + b"\r\n")
                self.wfile.flush()
                jpeg, _, _, _ = _grab_camera_jpeg(name, resolved)
                if jpeg is None:
                    break  # camera unplugged, driver dropped, source changed
                slack = min_dt - (time.time() - started)
                if slack > 0:
                    time.sleep(slack)
        except (BrokenPipeError, ConnectionResetError, socket.timeout):
            # `socket.timeout` rather than `TimeoutError`: they are only the same
            # class from Python 3.10 on, and this file also has to run under the
            # 3.8 that ships with the Ubuntu 20.04 on the robot's PC2.
            pass  # the viewer closed the tab, or stopped reading — how these end

    def do_GET(self) -> None:
        if self.path == "/health":
            # Point-cloud replay mode reports "connected" so the Node hardware
            # seam pulls real recorded clouds without a physical robot attached.
            replay = bool(os.environ.get("G1_POINTCLOUD_REPLAY", "").strip())
            if READ_ONLY:
                live = _lowstate_reader.start() and _lowstate_reader.latest() is not None
                self._send(200, {"status": "ok", "connected": live or replay, "read_only": True,
                                 "boot_id": BOOT_ID})
                return
            self._send(200, {"status": "ok", "connected": connected or replay,
                             "boot_id": BOOT_ID})
        elif self.path == "/state":
            self._send(200, get_state())
        elif self.path == "/state/fast":
            self._send(200, get_state(keep_alive=True))
        elif self.path == "/cameras":
            # What the ACTIVE SOURCE can serve, not a fixed list (TASK-233):
            # with a lone D435 attached that is one name, and the two wrist
            # names are gone rather than aliases for the same frame.
            source, names = _camera_source_and_names()
            body = {"cameras": list(names), "source": source}
            if source is None:
                body["detail"] = _no_camera_source_detail()
            self._send(200, body)
        elif self.path.startswith("/cameras/") and self.path.endswith("/stream"):
            self._stream_mjpeg(self.path[len("/cameras/"):-len("/stream")])
        elif self.path.startswith("/cameras/") and self.path.endswith("/snapshot"):
            name = self.path[len("/cameras/"):-len("/snapshot")]
            self._send(200, self._snapshot(name))
        elif self.path == "/pointcloud/sensors":
            self._send(200, {"sensors": DEPTH_SENSORS})
        elif self.path.startswith("/pointcloud/") and self.path.endswith("/snapshot"):
            name = self.path[len("/pointcloud/"):-len("/snapshot")]
            self._send(200, get_point_cloud(name, self.headers.get(SCAN_SESSION_HEADER)))
        elif self.path == "/record/status":
            self._send(200, recorder.status())
        elif self.path == "/loco/odom":
            self._send(*loco_odom())
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
        elif self.path == "/pointcloud/lidar/switch":
            # Deliberately NOT behind the READ_ONLY guard — the LiDAR enable is
            # the single authorized write (sensor only, no motion). See the
            # authorization note above set_lidar_switch.
            on = body.get("on")
            if not isinstance(on, bool):
                self._send(400, {"ok": False, "error": 'body must be {"on": true|false}'})
                return
            self._send(200, set_lidar_switch(on))
        elif self.path == "/record/start":
            if READ_ONLY:
                # lerobot-record spawns a G1 teleoperator — that DRIVES the robot.
                self._send(403, {"ok": False, "error": "G1_READ_ONLY — recording (teleop) disabled (stage 1: telemetry only)"})
                return
            self._send(200, start_record(body))
        elif self.path == "/record/stop":
            self._send(200, recorder.stop())
        # --- Agent Mode locomotion (TASK-194) --------------------------------
        # Behind G1_LOCO_ENABLED, NOT G1_READ_ONLY: /loco/* is the high-level
        # rt/api/sport RPC path, a different wire from the rt/lowcmd path
        # READ_ONLY protects. See the LOCO_ENABLED rationale at the top.
        elif self.path == "/loco/move":
            self._send(*loco_move(body))
        elif self.path == "/loco/action":
            self._send(*loco_action(body))
        elif self.path == "/loco/fsm":
            self._send(*loco_fsm(body))
        elif self.path == "/loco/stand-height":
            self._send(*loco_stand_height(body))
        else:
            self._send(404, {"error": "not found"})

    def _snapshot(self, name: str) -> dict:
        """One-shot camera frame as base64 JPEG.

        Source and name resolution now live in `_grab_camera_jpeg` (TASK-233),
        so this route, /cameras and /cameras/<n>/stream cannot disagree about
        which cameras exist. G1_CAMERA_SOURCE gained two values
        (∈ {auto|lerobot|teleimager|pc2cam|realsense}) and `auto` gained the two
        ways to reach the ROBOT's own head camera ahead of a RealSense on this
        machine's USB — see `_camera_source_and_names`. The response SHAPE is
        unchanged ({"ok","camera","jpeg_base64","source"} / {"ok": false,"error"}).

        The 200 is deliberately kept even for a name that does not exist: the
        Node hardware seam has always read failure out of the `ok` field here,
        and a status change would be a silent contract break for a route that
        already had callers. `/stream` is new, so it answers with real codes.
        """
        jpeg, source, error, _ = _grab_camera_jpeg(name)
        if jpeg is None:
            return {"ok": False, "error": error or f"no camera frame for '{name}'"}
        return {"ok": True, "camera": name,
                "jpeg_base64": base64.b64encode(jpeg).decode(), "source": source}


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
    if LOCO_ENABLED:
        print(
            "[G1 Sidecar] ⚠️  LOCOMOTION ENABLED (G1_LOCO_ENABLED=1) — /loco/* will move "
            f"the robot via the sport service on DDS domain "
            f"{os.environ.get('G1_LIDAR_DDS_DOMAIN', '0')} (0 = real robot, 1 = sim). "
            "Agent Mode has manual E-Stop only: no arming gate, no watchdog, no speed cap.",
            flush=True,
        )
    else:
        print(
            "[G1 Sidecar] /loco/* disabled (G1_LOCO_ENABLED=0) — locomotion endpoints answer 403",
            flush=True,
        )
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
