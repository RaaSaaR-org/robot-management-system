"""
g1_sidecar.py — Hardware bridge between a Unitree G1 EDU (Dex3-1 hands) and the
Node.js Robot Agent. Mirrors the SO-101 sidecar's HTTP contract so the existing
TeleoperationService / HardwareClient / SkillExecutor work unchanged — only the
underlying driver differs (Unitree DDS instead of serial).

Two write modes (TASK-391), chosen at start and never switched at runtime:
  read_only (DEFAULT) — telemetry only. State from the read-only ZMQ bridge
                        (g1_state_bridge_readonly.py); no DDS publisher for any
                        joint command exists in the process.
  arm_sdk             — G1_WRITE_MODE=arm_sdk. Arms + Dex3 hands through
                        Unitree's arm-only channel rt/arm_sdk (the legs stay
                        under Unitree's balance controller), and ONLY between
                        POST /arm and the next disarm. See g1_arm_sdk.py.
The old lerobot rt/lowcmd path (G1_READ_ONLY=0) is gone: rt/lowcmd bypasses
the balance controller and a standing robot falls. G1_READ_ONLY=0 without
G1_WRITE_MODE=arm_sdk now refuses to start.

⚠️ The arm_sdk path is unit-tested and checked against the MuJoCo DDS sim, not
yet against the physical G1 — robot day runs it on the gantry first
(docs/g1-edu-lab-bringup.md, "Arm teleop through arm_sdk").

Exposes a lightweight HTTP API on port 8767 (G1 EDU profile: HARDWARE_SIDECAR_URL),
on every interface in read_only mode and on 127.0.0.1 only in arm_sdk mode
(G1_SIDECAR_HOST overrides — see _bind_host):
  GET  /health        → {"status": "ok", "connected": true/false, + WRITE STATUS}
  GET  /state         → {"joints": [...], "imu": {...}, "touch": {...},
                         "battery": {...}, "odometry": {...}, "timestamp": ...,
                         + WRITE STATUS}
                        (TASK-184 contract §2 — every group is OMITTED when its
                        source DDS topic has no fresh data; never zero-filled)
                        WRITE STATUS (TASK-391): "write_mode" ("read_only" |
                        "arm_sdk"), "armed", "arm_weight" (0..1),
                        "estop_latched", "hands": {"left","right"} (Dex3 state
                        within 0.5 s), "teleop_mode" ("arms+hands" |
                        "arms+left_hand" | "arms+right_hand" | "arms_only")
                        FRESHNESS (TASK-404): "lowstate_age_s" (s | null),
                        "hand_health": {"left","right"} -> {present, age_s,
                        error[2], motor_faults[], power_v} (dex3_faults.py)
  GET  /state/fast    → same as /state
  POST /arm           → {"lease_generation": int|null} → weight 0→1 over ~1.5 s,
                        seeded from the MEASURED arm pose. 403 read_only,
                        409 estop_latched, 503 no fresh rt/lowstate
  POST /disarm        → weight 1→0 over ~1 s, then the publisher goes quiet
  POST /action        → {"<joint>": rad, ...} → only while armed (409
                        {"error":"not_armed"} otherwise, 403 in read_only);
                        CLAMPED + SLEW-LIMITED; leg/waist keys ignored + counted.
                        Dead-man: no /action 0.5 s → hold, 1.0 s → disarm
  POST /estop         → disarm ramp now + LATCHED until POST /estop/reset;
                        with G1_LOCO_ENABLED=fsm|1 it then damps (TASK-398)
  POST /estop/reset   → clears the latch (does not re-arm, does not stand up)
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
  POST /record/start  → 403 in BOTH modes since TASK-391: it spawned
                        lerobot-record --robot.type=unitree_g1, i.e. rt/lowcmd.
                        Real-robot recording runs in the robot-agent.
  POST /record/stop   → SIGINT the recording subprocess
  GET  /record/status → recording progress / dataset path

  --- Robot mode without the remote (TASK-398), behind G1_LOCO_ENABLED=fsm|1 ---
  GET  /loco/mode     → {"ok", "fsm_id", "mode", "age_s", "fsm_mode", "odom_mode",
                         "source", "error", "loco": {...}, "in_flight",
                         "estop_latched"} — the MEASURED mode (FSM monitor, 2 Hz)
  POST /loco/mode     → {"mode": "limp"|"stand"|"balance"} → SetFsmId(1 | 4 | 500),
                        confirmed by GetFsmId. Stand only from measured limp,
                        balance only from stand held >= 2 s, neither while the
                        arms are engaged or the E-stop is latched; limp always
                        (it disarms first). Refusals carry a machine "code".
                        See g1_loco_mode.py for the whole table.
  POST /estop         → (with the gate on) latch, disarm ramp, THEN damp:
                        {"latched", "was_armed", "disarmed", "damped",
                         "damp_confirmed", "damp_error"}
  G1_LOCO_ENABLED: 0/unset = off, fsm = mode changes only (the real robot: the
  only RPCs that can leave this process are SetFsmId(limp|stand|balance),
  GetFsmId and GetFsmMode), 1 = full locomotion (the sim). Anything else
  refuses to start, and so does fsm/1 without an explicit G1_DDS_DOMAIN.

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

import g1_loco_mode
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
# WRITE MODE (TASK-391) — read_only by DEFAULT, arm_sdk only on explicit opt-in
# ---------------------------------------------------------------------------
# read_only: this process has NO write path to the robot's joints —
#   • no DDS publisher for rt/arm_sdk, rt/dex3/*/cmd or rt/lowcmd is built;
#   • POST /action, /arm and /record/start return 403;
#   • state comes from a ZMQ SUB to the read-only bridge
#     (g1_state_bridge_readonly.py, port 6001) — subscribe-only by design.
# arm_sdk (G1_WRITE_MODE=arm_sdk): rt/arm_sdk + Dex3 publishers exist, but
#   nothing is published until POST /arm, and every way out ramps the arm_sdk
#   weight back to 0 (g1_arm_sdk.py). The legs are never commanded.
#
# G1_READ_ONLY is kept as a guard, not a switch. It used to mean "0 = load
# lerobot's UnitreeG1 driver", whose rt/lowcmd publisher bypasses the balance
# controller — that path is removed, and a config still asking for it must fail
# loudly instead of quietly starting a different mode. See _write_mode_error().
WRITE_MODE = (
    "arm_sdk" if os.environ.get("G1_WRITE_MODE", "").strip().lower() == "arm_sdk"
    else "read_only"
)
READ_ONLY = WRITE_MODE != "arm_sdk"
LOWSTATE_ENDPOINT = os.environ.get("G1_LOWSTATE_ENDPOINT", f"tcp://{ROBOT_IP}:6001")


def _dds_domain_env(env=None) -> "str | None":
    """The configured DDS domain as a string, or None when nothing sets it.

    G1_DDS_DOMAIN is the name for it; G1_LIDAR_DDS_DOMAIN is historical (the
    LiDAR path got there first) and still honoured — ChannelFactoryInitialize
    runs once per process, so LiDAR, odometry, loco RPC and arm_sdk share one."""
    env = os.environ if env is None else env
    for key in ("G1_DDS_DOMAIN", "G1_LIDAR_DDS_DOMAIN"):
        raw = (env.get(key) or "").strip()
        if raw:
            return raw
    return None


def _dds_iface_env(env=None) -> str:
    env = os.environ if env is None else env
    for key in ("G1_DDS_IFACE", "G1_LIDAR_DDS_IFACE", "G1_NET_INTERFACE"):
        raw = (env.get(key) or "").strip()
        if raw:
            return raw
    return ""


def _bind_host(env=None) -> str:
    """The address the HTTP API listens on.

    G1_SIDECAR_HOST wins when set. Otherwise read_only keeps listening on every
    interface, as before, while arm_sdk listens on loopback only: the routes are
    unauthenticated, and in arm_sdk mode `/arm` + `/action` move the robot's
    arms, so they must not be reachable from the lab Wi-Fi or the robot LAN.
    Every caller (the robot-agent's HARDWARE_SIDECAR_URL) is on this host."""
    env = os.environ if env is None else env
    explicit = (env.get("G1_SIDECAR_HOST") or "").strip()
    if explicit:
        return explicit
    mode = (env.get("G1_WRITE_MODE") or "").strip().lower()
    # TASK-398: /loco/mode stands the robot up and /estop damps it — with the
    # mode gate on, read-only mode listens on loopback too.
    gate, _ = g1_loco_mode.parse_gate(env)
    if mode == "arm_sdk" or gate not in (None, g1_loco_mode.GATE_OFF):
        return "127.0.0.1"
    return "0.0.0.0"


def _loco_config_error(env=None) -> "str | None":
    """Why the mode/locomotion gate configuration must not start, or None.
    Checked by main() next to _write_mode_error (TASK-398)."""
    env = os.environ if env is None else env
    gate, err = g1_loco_mode.parse_gate(env)
    if err:
        return err
    if gate == g1_loco_mode.GATE_OFF:
        return None
    domain = _dds_domain_env(env)
    if domain is None:
        return ("G1_LOCO_ENABLED=%s needs an explicit DDS domain: set G1_DDS_DOMAIN "
                "(0 = the real robot, 1 = the MuJoCo sim). There is no default on "
                "purpose: a mode change aimed at the sim must not land on the robot"
                % ("fsm" if gate == g1_loco_mode.GATE_FSM else "1"))
    try:
        int(domain)
    except ValueError:
        return f"G1_DDS_DOMAIN={domain!r} is not an integer"
    _, err = g1_loco_mode.fsm_config(env)
    return err


def _write_mode_error(env=None) -> "str | None":
    """Why this configuration must not start, or None. Checked by main()."""
    env = os.environ if env is None else env
    mode = (env.get("G1_WRITE_MODE") or "").strip().lower()
    read_only = (env.get("G1_READ_ONLY") or "").strip()
    if mode not in ("", "read_only", "arm_sdk"):
        return (f"G1_WRITE_MODE={mode!r} is not a mode — use 'read_only' (default) "
                "or 'arm_sdk'")
    if mode == "arm_sdk":
        if read_only == "1":
            return ("G1_WRITE_MODE=arm_sdk contradicts G1_READ_ONLY=1 — remove "
                    "G1_READ_ONLY (or set it to 0) to run the arm_sdk write path")
        domain = _dds_domain_env(env)
        if domain is None:
            return ("G1_WRITE_MODE=arm_sdk needs an explicit DDS domain: set "
                    "G1_DDS_DOMAIN (0 = the real robot, 1 = the MuJoCo sim). There "
                    "is no default on purpose: a test aimed at the sim must not "
                    "land on the robot because a variable was missing")
        try:
            int(domain)
        except ValueError:
            return f"G1_DDS_DOMAIN={domain!r} is not an integer"
        return None
    if read_only == "0":
        return ("G1_READ_ONLY=0 used to load lerobot's UnitreeG1 driver, whose "
                "rt/lowcmd publisher bypasses Unitree's balance controller (a "
                "standing robot falls). That path is removed (TASK-391). For arm + "
                "hand control set G1_WRITE_MODE=arm_sdk, which uses rt/arm_sdk "
                "and leaves the legs to the robot")
    return None

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
# run this sidecar is telemetry-only (G1_WRITE_MODE defaults to read_only), and such a
# process must not be turnable into a motion path by a stray HTTP call from a
# mis-pointed component or a stale config. With the gate off, /loco/* answers
# 403 and no LocoClient is ever constructed.
#
# Deliberately SEPARATE from G1_WRITE_MODE: that flag governs the rt/arm_sdk
# joint-position path (arms + hands, TASK-391), while /loco/* is the rt/api/sport
# request/response path. Different wires, different risk profiles — one must not
# silently imply the other. Telemetry-only + locomotion-enabled (READ_ONLY=1,
# LOCO_ENABLED=1) is a legitimate, intended configuration: it is exactly what
# Agent Mode uses against the simulated loco service in sim_g1_dds/.
#
# TASK-398 adds a third value: G1_LOCO_ENABLED=fsm — robot MODE changes only
# (limp / stand / balance through POST /loco/mode, and the E-stop's damp). Under
# fsm, /loco/move, /loco/action (stop included), /loco/stand-height and the raw
# /loco/fsm answer 403 before any client is looked up: walking and turning stay
# impossible on the real robot. "1" keeps its full meaning (the sim). An invalid
# value refuses to start (_loco_config_error).
LOCO_GATE = g1_loco_mode.parse_gate(os.environ)[0] or g1_loco_mode.GATE_OFF
LOCO_ENABLED = LOCO_GATE == g1_loco_mode.GATE_FULL
FSM_IDS = g1_loco_mode.fsm_config(os.environ)[0] or g1_loco_mode.FsmIds()

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


# rt/arm_sdk publish rate and slew limits (arm_sdk mode). The slew is applied
# per publish tick against the clock, so the joint speed does not depend on how
# often the caller sends /action.
CONTROL_HZ = _pos_float("G1_CONTROL_HZ", 50.0)
ARM_SDK_MAX_JOINT_VEL = _pos_float("G1_ARM_SDK_MAX_JOINT_VEL", 3.0)   # rad/s, arms
ARM_SDK_MAX_HAND_VEL = _pos_float("G1_ARM_SDK_MAX_HAND_VEL", 6.0)     # rad/s, fingers
ARM_SDK_LIMIT_MARGIN = _pos_float("G1_ARM_SDK_LIMIT_MARGIN", 0.05)    # rad off each stop

# The lerobot UnitreeG1 driver used to live here. Its connect() opened an
# rt/lowcmd publisher — the debug-mode channel that bypasses Unitree's balance
# controller — so it is gone (TASK-391), not merely switched off. These three
# names stay only because the "lerobot" camera source still asks for them; with
# no driver there is never an observation, exactly as in read-only mode before.
robot = None
robot_lock = threading.Lock()
connected = False


def _connect_unlocked() -> bool:
    """Always False: there is no lerobot driver to connect any more (TASK-391)."""
    return False


# ---------------------------------------------------------------------------
# Small coercion helpers (shared contract — no fabricated values)
# ---------------------------------------------------------------------------


def _coerce3(v):
    """Coerce a 3-sequence to [float,float,float], else None."""
    if isinstance(v, (list, tuple)) and len(v) >= 3:
        try:
            return [float(v[0]), float(v[1]), float(v[2])]
        except (TypeError, ValueError):
            return None
    return None


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

    def entry(self, topic: str):
        """(newest dict, age_s) for `topic` WHATEVER its age, or (None, None)
        when nothing ever arrived — for the TASK-404 freshness fields, which
        must say how stale a feed is rather than just that it is."""
        with self._lock:
            hit = self._cache.get(topic)
            if hit is None:
                return None, None
            return hit[0], time.time() - hit[1]


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


def _state_latest(topic: str, max_age_s: float = 2.0):
    """Newest dict for `topic`: the arm_sdk DDS feed first (when this process
    has one), then the read-only ZMQ bridge. None when neither is fresh."""
    if _dds_state is not None:
        data = _dds_state.latest_dict(topic, max_age_s)
        if data is not None:
            return data
    if not _lowstate_reader.start():
        return None
    return _lowstate_reader.latest(topic, max_age_s)


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

    In arm_sdk mode the controller's own DDS subscription (g1_arm_sdk.
    DdsStateSource) is asked first for rt/lowstate and the Dex3 topics — it is
    the fresher feed and needs no second process; BMS and odometry still come
    from the bridge. In read_only mode only the bridge exists, as before.
    """
    data = _state_latest(TOPIC_LOWSTATE)
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
        hand = _state_latest(topic)
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
    bms = _state_latest(TOPIC_BMS)
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
    odom = _state_latest(TOPIC_ODOM)
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
    """GET /state (and /state/fast — `keep_alive` is kept for the route's
    callers and means nothing since the lerobot driver is gone): the bridge /
    DDS feed of `_get_state_readonly`, plus the write status (TASK-391)."""
    result = _get_state_readonly()
    result.update(write_status())
    return result


# ---------------------------------------------------------------------------
# rt/arm_sdk WRITE PATH (TASK-391) — built only when G1_WRITE_MODE=arm_sdk
# ---------------------------------------------------------------------------
# The controller and its DDS pieces live in g1_arm_sdk.py. Here: wiring them to
# this process's DDS factory and joint tables, and the read-only answers.
_arm_controller = None   # g1_arm_sdk.ArmSdkController
_arm_runner = None       # g1_arm_sdk.ArmSdkRunner (the publish thread)
_dds_state = None        # g1_arm_sdk.DdsStateSource

_READ_ONLY_WRITE_ERROR = (
    "G1_WRITE_MODE is read_only — this sidecar has no joint command path. "
    "Restart it with G1_WRITE_MODE=arm_sdk to drive the arms "
    "(docs/g1-edu-lab-bringup.md)"
)


def _hands_present_zmq() -> dict:
    """Dex3 hands with state within HAND_FRESH_S, from whatever feed we have."""
    from g1_arm_sdk import HAND_FRESH_S

    return {
        side: _state_latest(topic, HAND_FRESH_S) is not None
        for side, topic in (("left", TOPIC_LEFT_HAND), ("right", TOPIC_RIGHT_HAND))
    }


def _state_entry(topic: str):
    """(newest dict, age_s) for `topic` from the read-only bridge, whatever its
    age; (None, None) when nothing arrived. Never STARTS the subscriber: a
    status read must not open a connection of its own — /health and /state
    already started it through _state_latest before this runs."""
    if not _lowstate_reader._started:
        return None, None
    return _lowstate_reader.entry(topic)


def _readonly_health(hands: dict) -> dict:
    """TASK-404 `hand_health` + `lowstate_age_s` from the bridge's messages.
    `hands` is the boolean pair already computed for this reply, so
    `hand_health.<side>.present` and `hands.<side>` can never disagree."""
    import dex3_faults

    health = {}
    for side, topic, wire in (("left", TOPIC_LEFT_HAND, LEFT_HAND_WIRE),
                              ("right", TOPIC_RIGHT_HAND, RIGHT_HAND_WIRE)):
        data, age = _state_entry(topic)
        health[side] = dex3_faults.hand_health(side, data, age, bool(hands.get(side)), wire)
    _, body_age = _state_entry(TOPIC_LOWSTATE)
    return {
        "hand_health": health,
        "lowstate_age_s": None if body_age is None else round(max(0.0, body_age), 3),
    }


def write_status() -> dict:
    """The contract's write fields for /health and /state, plus the TASK-404
    freshness fields (`hand_health`, `lowstate_age_s`)."""
    from g1_arm_sdk import teleop_mode

    if _arm_controller is not None:
        status = _arm_controller.snapshot()
        # Where the frames go, so a sim-only check can refuse a sidecar that
        # is pointed at the robot (domain 0) before it sends a single /arm.
        domain = _dds_domain_env()
        status["dds_domain"] = int(domain) if domain is not None else None
        status["dds_iface"] = _dds_iface_env() or None
        return status
    hands = _hands_present_zmq()
    status = {
        "write_mode": WRITE_MODE,
        "armed": False,
        "arm_weight": 0.0,
        "estop_latched": _base_estop_latched,
        "hands": hands,
        "teleop_mode": teleop_mode(hands["left"], hands["right"]),
    }
    status.update(_readonly_health(hands))
    return status


def start_arm_sdk() -> None:
    """Build the rt/arm_sdk publishers, the DDS state feed, the controller and
    the publish thread. Main thread only, before the HTTP server starts —
    cyclonedds type registration is not thread-safe. Raises on failure: in
    arm_sdk mode a sidecar that cannot write must not pretend it can."""
    global _arm_controller, _arm_runner, _dds_state
    import g1_arm_sdk

    _ensure_dds_factory()
    _dds_state = g1_arm_sdk.DdsStateSource()
    wire = g1_arm_sdk.DdsArmWire()
    _arm_controller = g1_arm_sdk.ArmSdkController(
        BODY_JOINTS,
        {"left": LEFT_HAND_WIRE, "right": RIGHT_HAND_WIRE},
        POS_LIMITS,
        _dds_state,
        max_arm_vel=ARM_SDK_MAX_JOINT_VEL,
        max_hand_vel=ARM_SDK_MAX_HAND_VEL,
        limit_margin=ARM_SDK_LIMIT_MARGIN,
        **_arm_fsm_kwargs(),
    )
    _arm_runner = g1_arm_sdk.ArmSdkRunner(_arm_controller, wire, hz=CONTROL_HZ)
    _arm_runner.start()


def _arm_requires_fsm(env=None) -> bool:
    """Whether /arm must see a MEASURED balance mode (TASK-398): on the real
    robot (domain 0) or whenever this process measures the mode at all.
    G1_ARM_ALLOW_UNKNOWN_FSM=1 is the escape hatch for a session in which a
    person with the remote has put the robot in balance — loud at startup."""
    env = os.environ if env is None else env
    if (env.get("G1_ARM_ALLOW_UNKNOWN_FSM") or "").strip() == "1":
        return False
    gate, _ = g1_loco_mode.parse_gate(env)
    if gate not in (None, g1_loco_mode.GATE_OFF):
        return True
    # Compare the domain as the DDS factory reads it (int, unset = 0), so "00"
    # or "+0" is the real robot too; anything unreadable is treated as it.
    raw = _dds_domain_env(env)
    try:
        return int(raw or "0") == 0
    except ValueError:
        return True


def _fsm_reading():
    """(fsm_id, age_s) for the arm controller's mode guard."""
    if _fsm_monitor is None:
        return None, None
    return _fsm_monitor.reading()


def _arm_fsm_kwargs() -> dict:
    """The arm controller's TASK-398 guards, from env."""
    return {
        "fsm_source": _fsm_reading if LOCO_GATE != g1_loco_mode.GATE_OFF else None,
        "require_fsm": _arm_requires_fsm(),
        "balance_ids": FSM_IDS.balance_reported,
        "track_err_rad": _pos_float("G1_ARM_TRACK_ERR_RAD", 0.35),
        "track_err_hold_s": _pos_float("G1_ARM_TRACK_ERR_HOLD_S", 0.3),
    }


def arm(body: dict) -> "tuple[int, dict]":
    if _arm_controller is None:
        return 403, {"ok": False, "error": "read_only", "detail": _READ_ONLY_WRITE_ERROR}
    if _mode_ctl is not None and _mode_ctl.limp_in_progress:
        return 409, {"ok": False, "error": "mode_change_in_flight",
                     "detail": "the robot is being put into Limp — not arming", **write_status()}
    lease = body.get("lease_generation") if isinstance(body, dict) else None
    if lease is not None and (isinstance(lease, bool) or not isinstance(lease, int)):
        return 400, {"ok": False, "error": '"lease_generation" must be an integer or null'}
    return _arm_controller.arm(lease)


def disarm() -> "tuple[int, dict]":
    if _arm_controller is None:
        return 200, {"ok": True, "was_armed": False, **write_status()}
    return _arm_controller.disarm("request")


# The sidecar's own E-stop latch (TASK-398), in every write mode. Separate from
# the arm controller's latch, but /estop sets both and /estop/reset clears both.
# While it is set, Stand and Balance are refused; Limp is not.
_base_estop_latched = False
_estop_lock = threading.Lock()


def estop(damp: bool = True) -> "tuple[int, dict]":
    """POST /estop: latch, disarm, THEN damp (TASK-398).

    `{"damp": false}` in the body (and only an explicit false) skips step 2:
    the agent's PROTECTIVE stop (server link lost, tilt warning, geofence) is a
    pause that must not drop a balancing robot into the gantry. The sidecar
    decides that here, from the request, so an agent with a stale idea of this
    sidecar's G1_LOCO_ENABLED cannot damp the robot by accident.

    1. Both latches, and the arm controller's disarm ramp starts — synchronous,
       no RPC. We wait for at most two publish ticks (<= 0.1 s) so the first
       falling-weight frame is on the wire before the damp (it does NOT wait out the 1 s ramp:
       in damp the robot ignores arm_sdk, and waiting would keep the arms under
       balance for a second longer during an emergency).
    2. With the mode gate on: SetFsmId(1), confirmed by GetFsmId for up to 2 s.
       The robot sags into the gantry, like the remote's damping.
    Read-only mode damps too when the gate is on; with the gate off there is
    no damp path and the reply says so.
    """
    global _base_estop_latched
    with _estop_lock:
        _base_estop_latched = True
        was_armed = False
        if _arm_controller is not None:
            _, reply = _arm_controller.estop()
            was_armed = bool(reply.get("was_armed"))
            # Two ticks: the runner writes frame N before it calls tick N+1,
            # so the second tick proves the first falling frame left us.
            _arm_controller.wait_frames(2, timeout_s=0.1)
    if not damp:
        damp = {"damped": False, "damp_confirmed": False, "damp_requested": False,
                "damp_error": "not requested (protective stop)"}
    elif _mode_ctl is None:
        damp = {"damped": False, "damp_confirmed": False,
                "damp_error": "mode control disabled (G1_LOCO_ENABLED)"}
    else:
        damp = _mode_ctl.damp_for_estop()
    print(f"[G1 Sidecar] ESTOP: latched, was_armed={was_armed}, damped={damp['damped']}, "
          f"confirmed={damp['damp_confirmed']}"
          + (f" — {damp['damp_error']}" if damp["damp_error"] else ""), flush=True)
    body = {"ok": True, **write_status(), "latched": True, "was_armed": was_armed,
            "disarmed": True, **damp}
    if _arm_controller is None and _mode_ctl is None:
        body["message"] = "read_only: no command path to stop"
    return 200, body


def estop_reset() -> "tuple[int, dict]":
    """POST /estop/reset: clears both latches. Never re-arms, never stands up —
    the robot stays in whatever mode it is in (limp after an E-stop)."""
    global _base_estop_latched
    with _estop_lock:
        was = _base_estop_latched
        _base_estop_latched = False
        if _arm_controller is None:
            if was:
                print("[G1 Sidecar] E-stop latch cleared (robot mode unchanged)", flush=True)
            return 200, {"ok": True, "was_latched": was, **write_status()}
        status, body = _arm_controller.estop_reset()
        body["was_latched"] = bool(body.get("was_latched")) or was
        return status, body


def send_action(action: dict) -> "tuple[int, dict]":
    """POST /action — see g1_arm_sdk.ArmSdkController.action."""
    if _arm_controller is None:
        return 403, {"ok": False, "error": "read_only", "detail": _READ_ONLY_WRITE_ERROR}
    return _arm_controller.action(action)


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

    Always None: the lerobot driver is gone (TASK-391), so there is no
    observation to read.
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
#: the other three sources have a cooldown. Since TASK-391 removed the lerobot
#: driver this source never has a camera; the source name is kept so an
#: existing G1_CAMERA_SOURCE=lerobot answers "no camera" rather than an error.
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
        domain = int(_dds_domain_env() or "0")  # 0 = real robot
        iface = _dds_iface_env()
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
                    domain=int(_dds_domain_env() or "0"),
                    iface=_dds_iface_env(),
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
# G1_DDS_DOMAIN / G1_DDS_IFACE (or the historical G1_LIDAR_DDS_DOMAIN /
# G1_LIDAR_DDS_IFACE, still honoured). The LiDAR names are historical (the LiDAR
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
_loco_client_error = None           # why there is no client (str), or None
_loco_lock = threading.Lock()       # guards construction of the singleton
_loco_rpc_lock = threading.Lock()   # serialises RPC calls (ThreadingHTTPServer)
_fsm_monitor = None                 # g1_loco_mode.FsmMonitor, gate != off
_mode_ctl = None                    # g1_loco_mode.ModeController, gate != off

LOCO_CONFIRM_S = _pos_float("G1_LOCO_CONFIRM_S", g1_loco_mode.CONFIRM_S_DEFAULT)
LOCO_STAND_SETTLE_S = _pos_float("G1_LOCO_STAND_SETTLE_S", g1_loco_mode.STAND_SETTLE_S_DEFAULT)
FSM_POLL_HZ = _pos_float("G1_FSM_POLL_HZ", g1_loco_mode.POLL_HZ_DEFAULT)


def _loco_gate_error() -> dict:
    return {
        "ok": False,
        "code": "loco_disabled",
        "error": (
            "G1_LOCO_ENABLED != 1 — /loco/* disabled on this sidecar "
            "(telemetry-only process). Set G1_LOCO_ENABLED=1 to allow locomotion."
        ),
    }


def _loco_move_refusal(path: str) -> "tuple[int, dict] | None":
    """(403, body) when `path` may not move the base under the current gate,
    else None. Under G1_LOCO_ENABLED=fsm nothing that walks, turns, stops,
    gestures or picks a raw FSM id leaves this process (TASK-398)."""
    if LOCO_GATE == g1_loco_mode.GATE_FULL:
        return None
    if LOCO_GATE == g1_loco_mode.GATE_OFF:
        return 403, _loco_gate_error()
    if path == "/loco/fsm":
        return 403, {"ok": False, "code": "use_loco_mode",
                     "error": "raw FSM ids are disabled under G1_LOCO_ENABLED=fsm — "
                              "POST /loco/mode {\"mode\": \"limp\"|\"stand\"|\"balance\"}"}
    return 403, {"ok": False, "code": "loco_move_disabled",
                 "error": f"{path} is disabled under G1_LOCO_ENABLED=fsm: this sidecar "
                          "changes the robot mode only, it never walks, turns or moves the base"}


def _new_loco_client():
    """A fresh, initialised LocoClient. Raises on failure. Separate so tests
    can see WHO builds the client (the startup path, never a request)."""
    from unitree_sdk2py.g1.loco.g1_loco_client import LocoClient  # type: ignore

    client = LocoClient()
    set_timeout = getattr(client, "SetTimeout", None)
    if callable(set_timeout):
        set_timeout(LOCO_RPC_TIMEOUT_S)
    client.Init()
    return client


def _build_loco_client() -> bool:
    """Build the process's one LocoClient. Called from main() on the MAIN
    thread at startup (cyclonedds type registration is not thread-safe — see
    start_arm_sdk), and retried every 2 s by the FSM monitor while it failed.
    Never raises; the reason is kept for the next request to report."""
    global _loco_client, _loco_client_error
    with _loco_lock:
        if _loco_client is not None:
            return True
        domain = _dds_domain_env()
        iface = _dds_iface_env()
        if domain is None:
            _loco_client_error = ("no DDS domain configured — set G1_DDS_DOMAIN "
                                  "(there is no default for the loco client)")
            return False
        try:
            _ensure_dds_factory()
            client = _new_loco_client()
        except ImportError as e:
            _loco_client_error = f"unitree_sdk2py not installed — LocoClient unavailable ({e})"
            return False
        except Exception as e:  # noqa: BLE001
            _loco_client_error = (f"LocoClient init failed (domain {domain}, "
                                  f"iface '{iface or 'default'}'): {e}")
            return False
        _loco_client = client
        _loco_client_error = None
    print(
        f"[G1 Sidecar] ✅ LocoClient ready (sport service, domain {domain}, "
        f"iface '{iface or 'default'}', timeout {LOCO_RPC_TIMEOUT_S}s)",
        flush=True,
    )
    return True


def _get_loco_client():
    """(client, None) when the startup-built client exists, (None, error_dict)
    otherwise. Never builds one: that happens on the main thread at startup
    (and on the FSM monitor's retry), never on a request thread."""
    with _loco_lock:
        if _loco_client is not None:
            return _loco_client, None
        return None, {"ok": False, "code": "rpc_failed",
                      "error": _loco_client_error or "LocoClient not built (sidecar startup)"}


def _loco_client_for_monitor():
    client, err = _get_loco_client()
    return client, (err or {}).get("error")


def _odom_mode():
    """rt/odommodestate.mode from whatever odometry feed exists — diagnostic
    only (TASK-398 records it so its mapping to the FSM can be learned)."""
    data = _state_latest(TOPIC_ODOM)
    if isinstance(data, dict) and data.get("mode") is not None:
        try:
            return int(data["mode"])
        except (TypeError, ValueError):
            return None
    if _dds_odom_source is not None:
        msg = _dds_odom_source.latest(ODOM_MAX_AGE_S)
        mode = getattr(msg, "mode", None) if msg is not None else None
        if mode is not None:
            return int(mode)
    return None


def _arm_snapshot():
    return None if _arm_controller is None else _arm_controller.snapshot()


def _arm_disarm(reason: str) -> None:
    if _arm_controller is not None:
        _arm_controller.disarm(reason)


def start_loco(clock=time.monotonic, start_thread: bool = True, **ctl_overrides) -> None:
    """Gate on: build the LocoClient (main thread), the FSM monitor and the
    mode controller. Gate off: nothing — no client, no thread, no RPC.
    `clock`, `start_thread` and `ctl_overrides` exist for the tests."""
    global _fsm_monitor, _mode_ctl
    if LOCO_GATE == g1_loco_mode.GATE_OFF:
        return
    _build_loco_client()
    _fsm_monitor = g1_loco_mode.FsmMonitor(
        _loco_client_for_monitor, _loco_rpc_lock, FSM_IDS, clock=clock, poll_hz=FSM_POLL_HZ,
        odom_mode_fn=_odom_mode, retry_fn=_build_loco_client)
    kwargs = dict(arm_snapshot_fn=_arm_snapshot, arm_disarm_fn=_arm_disarm,
                  estop_latched_fn=lambda: _base_estop_latched,
                  settle_s=LOCO_STAND_SETTLE_S, confirm_s=LOCO_CONFIRM_S,
                  rpc_timeout_s=LOCO_RPC_TIMEOUT_S)
    kwargs.update(ctl_overrides)
    _mode_ctl = g1_loco_mode.ModeController(
        _loco_client_for_monitor, _loco_rpc_lock, _fsm_monitor, FSM_IDS, **kwargs)
    if start_thread:
        _fsm_monitor.start()


def loco_capability() -> dict:
    """The `loco` block of /health and /loco/mode."""
    on = LOCO_GATE != g1_loco_mode.GATE_OFF
    return {
        "gate": LOCO_GATE,
        "modes": list(g1_loco_mode.MODES) if on else [],
        "ids": FSM_IDS.as_dict(),
        "ids_verified": g1_loco_mode.FSM_STAND_VERIFIED,
        "move_enabled": LOCO_GATE == g1_loco_mode.GATE_FULL,
    }


def fsm_state() -> dict:
    """The `base` block: the MEASURED mode, or "unknown" with the reason."""
    if _fsm_monitor is None:
        return {"fsm_id": None, "mode": "unknown", "age_s": None, "fsm_mode": None,
                "odom_mode": None, "source": "rpc",
                "error": "mode control disabled (G1_LOCO_ENABLED)"
                if LOCO_GATE == g1_loco_mode.GATE_OFF else "FSM monitor not running"}
    return _fsm_monitor.state()


def loco_mode_get() -> "tuple[int, dict]":
    return 200, {"ok": True, **fsm_state(), "loco": loco_capability(),
                 "in_flight": None if _mode_ctl is None else _mode_ctl.in_flight,
                 "estop_latched": _base_estop_latched}


def loco_mode_post(body: dict) -> "tuple[int, dict]":
    """POST /loco/mode — see g1_loco_mode.ModeController for the table."""
    if LOCO_GATE == g1_loco_mode.GATE_OFF or _mode_ctl is None:
        return 403, {"ok": False, "code": "mode_control_disabled",
                     "error": "mode control is off on this sidecar — restart it with "
                              "G1_LOCO_ENABLED=fsm (docs/g1-edu-lab-bringup.md)"}
    mode = body.get("mode") if isinstance(body, dict) else None
    status, reply = _mode_ctl.request(mode)
    reply.setdefault("base", fsm_state())
    return status, reply


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
    refusal = _loco_move_refusal("/loco/move")
    if refusal is not None:
        return refusal

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
    refusal = _loco_move_refusal("/loco/action")
    if refusal is not None:
        return refusal

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
    refusal = _loco_move_refusal("/loco/fsm")
    if refusal is not None:
        return refusal

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
    refusal = _loco_move_refusal("/loco/stand-height")
    if refusal is not None:
        return refusal

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

    # ZMQ first: the read-only bridge is running in both write modes (it is
    # the BMS/odometry source even next to arm_sdk), so it costs nothing, and a
    # silent bridge fails over to DDS cheaply. (DDS used to lead whenever
    # READ_ONLY was off — that mode had the lerobot driver and no bridge.)
    order = (("zmq", _odom_from_zmq), ("dds", _odom_from_dds))
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


def _with_base(state: dict) -> dict:
    """/state carries the `base` group whenever the mode gate is on — with
    fsm_id null when stale. A deliberate exception to "omit stale groups":
    "unknown" is the answer the operator must see (TASK-398)."""
    if LOCO_GATE != g1_loco_mode.GATE_OFF:
        state["base"] = fsm_state()
    return state


class Handler(BaseHTTPRequestHandler):
    # TCP_NODELAY on every accepted socket (TASK-415). `_send` writes the
    # headers and the body as two segments; with Nagle on, the body waits for
    # the client's ACK of the headers, and a client in delayed-ACK mode holds
    # that ACK ~40 ms. sim_node.py's facade, which keeps connections alive,
    # lost every other `/state/fast` request to exactly that. This handler
    # still answers HTTP/1.0 and closes after each reply, and closing pushes
    # the held segment out at once -- measured offline at 0.6 ms median, which
    # is why the first real-robot recording reached 30.21 fps -- so today this
    # is insurance: it keeps the stall from appearing the day this handler
    # moves to keep-alive. `StreamRequestHandler.setup()` applies it.
    disable_nagle_algorithm = True

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
            live = _state_latest(TOPIC_LOWSTATE) is not None
            body = {"status": "ok", "connected": live or replay, "read_only": READ_ONLY,
                    "boot_id": BOOT_ID}
            body.update(write_status())
            # TASK-398: what this sidecar may do to the base, and the measured mode.
            body["loco"] = loco_capability()
            body["base"] = fsm_state()
            self._send(200, body)
        elif self.path == "/state":
            self._send(200, _with_base(get_state()))
        elif self.path == "/state/fast":
            self._send(200, _with_base(get_state(keep_alive=True)))
        elif self.path == "/loco/mode":
            self._send(*loco_mode_get())
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
        try:
            body = json.loads(self.rfile.read(length) or b"{}") if length else {}
        except ValueError:
            self._send(400, {"ok": False, "error": "body is not JSON"})
            return
        if self.path == "/action":
            self._send(*send_action(body))
        # --- rt/arm_sdk arming (TASK-391) — see g1_arm_sdk.py ---------------
        elif self.path == "/arm":
            self._send(*arm(body))
        elif self.path == "/disarm":
            self._send(*disarm())
        elif self.path == "/estop":
            # Only an explicit false skips the damp; anything else damps.
            self._send(*estop(damp=not (isinstance(body, dict) and body.get("damp") is False)))
        elif self.path == "/estop/reset":
            self._send(*estop_reset())
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
            # Refused in BOTH modes. It spawned `lerobot-record
            # --robot.type=unitree_g1`, whose driver publishes rt/lowcmd — the
            # channel that drops a standing robot. Real-robot episodes are
            # recorded by the robot-agent from /state + the camera instead.
            self._send(403, {"ok": False, "error": (
                "/record/start is disabled: lerobot-record would drive the G1 over "
                "rt/lowcmd. Record through the robot-agent (TASK-391)")})
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
        elif self.path == "/loco/mode":
            self._send(*loco_mode_post(body))
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


def _shutdown_arm_sdk() -> None:
    """Ramp the arm_sdk weight to 0 and leave weight-0 frames behind. Safe to
    call more than once and in read_only mode (then it does nothing)."""
    if _arm_runner is not None:
        _arm_runner.shutdown()


def main() -> None:
    import signal
    import sys

    problem = _write_mode_error() or _loco_config_error()
    if problem:
        print(f"[G1 Sidecar] REFUSING TO START: {problem}", flush=True)
        sys.exit(2)

    print(f"[G1 Sidecar] starting on :{PORT} (robot {ROBOT_ID} @ {ROBOT_IP}/{NET_INTERFACE})", flush=True)
    print(f"[G1 Sidecar] {len(JOINT_NAMES)} joints ({len(BODY_JOINTS)} body + {len(HAND_JOINTS)} Dex3)", flush=True)
    if READ_ONLY:
        print(
            "[G1 Sidecar] READ-ONLY MODE (G1_WRITE_MODE=read_only) - telemetry only. "
            f"State source: {LOWSTATE_ENDPOINT}. POST /action, /arm and /record/start are "
            "BLOCKED; no joint-command publisher exists in this process.",
            flush=True,
        )
    else:
        print(
            f"[G1 Sidecar] ⚠️  ARM_SDK WRITE MODE on DDS domain {_dds_domain_env()} "
            f"(0 = REAL ROBOT, 1 = sim), iface '{_dds_iface_env() or 'default'}'. "
            f"rt/arm_sdk + rt/dex3/*/cmd publish ONLY between POST /arm and the next "
            f"disarm; arms slew <= {ARM_SDK_MAX_JOINT_VEL} rad/s, fingers <= "
            f"{ARM_SDK_MAX_HAND_VEL} rad/s, {CONTROL_HZ:.0f} Hz. Legs are never commanded.",
            flush=True,
        )
        if _arm_requires_fsm():
            print("[G1 Sidecar] /arm needs a MEASURED balance mode (FSM %s, fresh <= %.1fs)"
                  % (list(FSM_IDS.balance_reported), g1_loco_mode.FSM_FRESH_S), flush=True)
        elif (os.environ.get("G1_ARM_ALLOW_UNKNOWN_FSM") or "").strip() == "1":
            print("[G1 Sidecar] ⚠️⚠️  G1_ARM_ALLOW_UNKNOWN_FSM=1 — /arm does NOT check the "
                  "robot mode. Only for a session where a person with the Unitree remote has "
                  "put the robot in balance (R1+X). In damp the robot ignores arm_sdk and the "
                  "arm JUMPS when balance engages.", flush=True)
        try:
            start_arm_sdk()
        except Exception as e:  # noqa: BLE001
            print(f"[G1 Sidecar] REFUSING TO START: arm_sdk DDS setup failed ({e!r})", flush=True)
            sys.exit(3)
    # TASK-398: after start_arm_sdk (same DDS factory), on the main thread.
    start_loco()
    if LOCO_GATE == g1_loco_mode.GATE_FSM:
        ids = FSM_IDS
        print(
            f"[G1 Sidecar] ⚠️  MODE CONTROL (G1_LOCO_ENABLED=fsm) on DDS domain "
            f"{_dds_domain_env()} (0 = REAL ROBOT), iface '{_dds_iface_env() or 'default'}'. "
            f"POST /loco/mode limp={ids.limp} stand={ids.stand}"
            f"{'' if g1_loco_mode.FSM_STAND_VERIFIED else ' (UNVERIFIED on this G1)'} "
            f"balance={ids.balance} (counts as balance: {list(ids.balance_reported)}). "
            "Walking/turning (/loco/move, /loco/action, /loco/stand-height, /loco/fsm) "
            "answer 403. /estop damps.",
            flush=True,
        )
        if _loco_client is None:
            print(f"[G1 Sidecar] LocoClient not ready yet ({_loco_client_error}) — "
                  "retrying every 2 s; the mode reads 'unknown' until then", flush=True)
    elif LOCO_ENABLED:
        print(
            "[G1 Sidecar] ⚠️  LOCOMOTION ENABLED (G1_LOCO_ENABLED=1) — /loco/* will move "
            f"the robot via the sport service on DDS domain "
            f"{_dds_domain_env()} (0 = real robot, 1 = sim). "
            "Agent Mode has manual E-Stop only: no arming gate, no watchdog, no speed cap.",
            flush=True,
        )
    else:
        print(
            "[G1 Sidecar] /loco/* disabled (G1_LOCO_ENABLED=0) — locomotion endpoints answer 403",
            flush=True,
        )
    host = _bind_host()
    if (not READ_ONLY or LOCO_GATE != g1_loco_mode.GATE_OFF) \
            and host not in ("127.0.0.1", "localhost", "::1"):
        print(f"[G1 Sidecar] ⚠️  arm_sdk routes listen on {host} (G1_SIDECAR_HOST) — "
              "/arm and /action are unauthenticated and reachable from that network", flush=True)
    server = ThreadingHTTPServer((host, PORT), Handler)

    # SIGTERM / SIGINT: start the disarm ramp AT ONCE, stop serving, and only
    # let the process go once the weight is 0 (_shutdown_arm_sdk). The ramp is
    # begun here rather than after serve_forever() returns because shutdown()
    # waits out a poll interval first — measured against the sim, that put the
    # weight at 0 only ~1.5 s after the signal. Both run on a helper thread:
    # serve_forever() cannot be stopped from its own thread, and a signal
    # handler should not take locks.
    def _begin_exit():
        if _arm_controller is not None:
            _arm_controller.disarm("shutdown")
        server.shutdown()

    def _on_signal(signum, _frame):
        print(f"[G1 Sidecar] signal {signum} — disarming before exit", flush=True)
        threading.Thread(target=_begin_exit, daemon=True).start()

    signal.signal(signal.SIGTERM, _on_signal)
    signal.signal(signal.SIGINT, _on_signal)
    try:
        server.serve_forever(poll_interval=0.1)
    finally:
        _shutdown_arm_sdk()
        server.server_close()
        print("[G1 Sidecar] stopped", flush=True)


if __name__ == "__main__":
    main()
