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
  GET  /state         → {"joints": [...], "timestamp": ..., "simulated": false}
  GET  /state/fast    → joint read that keeps motors enabled (closed loop)
  POST /action        → {"<joint>": value, ...} → sends to the robot
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

robot = None
robot_lock = threading.Lock()
connected = False


def _connect_unlocked() -> bool:
    """Connect to the G1 over DDS. Must hold robot_lock.

    Uses lerobot's UnitreeG1 driver. Import is lazy so the sidecar can boot
    (and answer /health) even where the Unitree SDK isn't installed.
    """
    global robot, connected
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


def get_state(keep_alive: bool = False) -> dict:
    """Read joint positions. `keep_alive` keeps motors enabled for closed loop."""
    with robot_lock:
        if not connected and not _connect_unlocked():
            return {"joints": [], "connected": False, "simulated": False, "timestamp": time.time()}
        try:
            obs = robot.get_observation()  # lerobot driver returns a flat obs dict
            joints = []
            for name in JOINT_NAMES:
                key = f"{name}.pos"
                joints.append({"name": name, "position": float(obs.get(key, 0.0))})
            return {"joints": joints, "connected": True, "simulated": False, "timestamp": time.time()}
        except Exception as e:  # noqa: BLE001
            return {"joints": [], "connected": False, "error": str(e), "timestamp": time.time()}


def send_action(action: dict) -> dict:
    """Send a joint-position action ({"<joint>": value, ...})."""
    with robot_lock:
        if not connected and not _connect_unlocked():
            return {"ok": False, "error": "not connected"}
        try:
            cmd = {f"{k}.pos": float(v) for k, v in action.items() if k in JOINT_NAMES}
            robot.send_action(cmd)
            return {"ok": True, "applied": len(cmd)}
        except Exception as e:  # noqa: BLE001
            return {"ok": False, "error": str(e)}


def get_point_cloud(name: str) -> dict:
    """Read one point-cloud frame from a depth / LiDAR sensor.

    Two paths:
      1. REPLAY (runnable now): when G1_POINTCLOUD_REPLAY points to a real
         recording (KITTI .bin or PCD), parse + normalize it via
         pointcloud_replay.load_frame — genuine sensor data, no robot needed.
      2. LIVE hardware (@status hardware-pending): on a real G1 the data comes
         from the Livox MID-360 via the Livox SDK2 (UDP) / livox_ros_driver2
         (`sensor_msgs/PointCloud2` on `/livox/lidar`) or the RealSense D435i
         ROS2 wrapper (`/camera/depth/color/points`). Subscribe to the topic and
         copy the latest frame into the same flat contract below.

    Flat contract (matches the Node HardwareClient / PointCloudFrame):
      positions   = [x0,y0,z0, x1,y1,z1, ...]  (meters, base frame, x-fwd/y-left/z-up)
      intensities = [i0, i1, ...]              (normalized 0..1)
    """
    if name not in DEPTH_SENSORS:
        return {"ok": False, "error": f"no depth sensor '{name}'"}

    sensor_type = "lidar" if name == "mid360_lidar" else "depth_camera"

    # --- Path 1: real recorded replay -------------------------------------
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
            return {"ok": False, "error": f"replay failed: {e}"}

    # --- Path 2: live hardware (needs a physical sensor) ------------------
    with robot_lock:
        if not connected and not _connect_unlocked():
            return {"ok": False, "error": "not connected"}
        try:
            # TODO(hardware): subscribe to the Livox/RealSense topic and copy the
            # latest frame here. Until a driver is present, return an empty frame
            # so the contract is exercised without crashing.
            return {
                "ok": True,
                "sensor": name,
                "sensor_type": sensor_type,
                "has_intensity": sensor_type == "lidar",
                "positions": [],
                "intensities": [],
            }
        except Exception as e:  # noqa: BLE001
            return {"ok": False, "error": str(e)}


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
            self._send(200, send_action(body))
        elif self.path == "/record/start":
            self._send(200, start_record(body))
        elif self.path == "/record/stop":
            self._send(200, recorder.stop())
        else:
            self._send(404, {"error": "not found"})

    def _snapshot(self, name: str) -> dict:
        with robot_lock:
            if not connected and not _connect_unlocked():
                return {"ok": False, "error": "not connected"}
            try:
                obs = robot.get_observation()
                frame = obs.get(name)
                if frame is None:
                    return {"ok": False, "error": f"no camera '{name}'"}
                import cv2  # type: ignore
                ok, buf = cv2.imencode(".jpg", frame)
                if not ok:
                    return {"ok": False, "error": "encode failed"}
                return {"ok": True, "camera": name, "jpeg_base64": base64.b64encode(buf).decode()}
            except Exception as e:  # noqa: BLE001
                return {"ok": False, "error": str(e)}


def main() -> None:
    print(f"[G1 Sidecar] starting on :{PORT} (robot {ROBOT_ID} @ {ROBOT_IP}/{NET_INTERFACE})", flush=True)
    print(f"[G1 Sidecar] {len(JOINT_NAMES)} joints ({len(BODY_JOINTS)} body + {len(HAND_JOINTS)} Dex3)", flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
