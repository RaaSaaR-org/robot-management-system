"""
so101_sidecar.py — Hardware bridge between the SO-101 arm and the Node.js Robot Agent.

Exposes a lightweight HTTP API on port 8765:
  GET  /health        → {"status": "ok", "connected": true/false}
  GET  /state         → {"joints": [...], "timestamp": ..., "simulated": false}
  POST /action        → {"shoulder_pan": deg, ...} → sends to real arm
  POST /vla/start     → Start VLA control loop via VLARunner
  POST /vla/stop      → Stop VLA control loop
  GET  /vla/status    → VLA runner status
  POST /record/start  → Spawn lerobot-record (leader→follower teleop + dataset)
  POST /record/stop   → SIGINT the recording subprocess
  GET  /record/status → Recording progress / dataset path

Run via:
  uv run python ~/develop/robot-management-system/robot-agent/hardware/so101_sidecar.py
"""

import json
import os
import time
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from http.server import ThreadingHTTPServer
from pathlib import Path

from vla_runner import VLARunner
from recorder import recorder

PORT = 8765
ROBOT_ID = os.environ.get("SO101_FOLLOWER_ID", "my_so101")
# Prefer the stable udev symlink, fall back to raw device for backward compat.
ROBOT_PORT = os.environ.get("SO101_FOLLOWER_PORT", "/dev/so101_follower")
if not os.path.exists(ROBOT_PORT):
    ROBOT_PORT = "/dev/ttyACM0"

JOINT_NAMES = [
    "shoulder_pan", "shoulder_lift", "elbow_flex",
    "wrist_flex", "wrist_roll", "gripper",
]

# --- Robot connection ---
# The sidecar uses on-demand connection with auto-disconnect after IDLE_TIMEOUT_S
# seconds of inactivity. This releases /dev/ttyACM0 so other tools (LeRobot CLI,
# teleoperation scripts) can use the arm when the dashboard isn't polling.
IDLE_TIMEOUT_S = 5.0

robot = None
robot_lock = threading.Lock()
last_state = None
connected = False
last_request_time = 0.0

# --- VLA runner (replaces subprocess.Popen of client_pi.py) ---
VLA_SERVER_URL = os.environ.get("VLA_SERVER_URL", "http://192.168.178.40:8000")
vla_runner: VLARunner | None = None
vla_start_time: float = 0.0

# --- Teleop state ---
# When a keyboard teleop WS client is connected, we must NOT disable torque
# in get_state() — otherwise the motors lose holding force between commands.
_teleop_active = False


def _connect_unlocked() -> bool:
    """Connect to the arm. Must be called with robot_lock held."""
    global robot, connected
    try:
        from lerobot.robots.so_follower import SO101Follower, SO101FollowerConfig
        config = SO101FollowerConfig(
            port=ROBOT_PORT,
            id=ROBOT_ID,
            disable_torque_on_disconnect=True,  # LeRobot v0.5.0: safe cleanup on disconnect
        )
        r = SO101Follower(config)
        # LeRobot v0.5.0: calibrate=False uses existing calibration file without prompting.
        # (v0.4.x required a stdin redirect workaround — no longer needed.)
        r.connect(calibrate=False)
        robot = r
        connected = True
        print(f"[Sidecar] ✅ Connected to SO-101 on {ROBOT_PORT}", flush=True)
        return True
    except Exception as e:
        robot = None
        connected = False
        print(f"[Sidecar] ⚠️  Could not connect ({e})", flush=True)
        return False


def _disconnect_unlocked():
    """Disconnect from the arm. Must be called with robot_lock held."""
    global robot, connected
    if robot:
        try:
            robot.disconnect()
        except Exception:
            pass
        robot = None
        connected = False
        print(f"[Sidecar] 🔌 Disconnected — port {ROBOT_PORT} released", flush=True)


def _idle_watchdog():
    """Background thread: disconnect if no /state request for IDLE_TIMEOUT_S."""
    global vla_runner
    while True:
        time.sleep(1.0)
        with robot_lock:
            # Don't disconnect during teleop — the WS handler needs the arm
            if _teleop_active:
                continue
            if connected and (time.time() - last_request_time) > IDLE_TIMEOUT_S:
                _disconnect_unlocked()
        # Check if VLA runner stopped unexpectedly
        if vla_runner is not None and not vla_runner.is_running:
            elapsed = time.time() - vla_start_time
            err = vla_runner.last_error
            print(f"[Sidecar/VLA] Runner stopped, elapsed={elapsed:.1f}s error={err} — resetting state", flush=True)
            vla_runner = None


def get_state():
    global last_state, last_request_time
    # While VLA or recording is running, don't attempt to reconnect (they own the port)
    if vla_runner is not None and vla_runner.is_running:
        return {"joints": last_state or [], "timestamp": time.time(), "simulated": True, "vla_active": True}
    if recorder.is_running:
        return {"joints": last_state or [], "timestamp": time.time(), "simulated": True, "recording_active": True}
    with robot_lock:
        last_request_time = time.time()
        # Reconnect if idle disconnect happened
        if not connected:
            _connect_unlocked()
        if robot and connected:
            try:
                obs = robot.get_observation()
                # Release torque so the arm stays free to move manually — but NOT
                # during keyboard teleop, where motors must hold position between commands.
                if not _teleop_active:
                    robot.bus.disable_torque()
                joints = []
                for name in JOINT_NAMES:
                    pos = obs.get(f"{name}.pos", 0.0)
                    joints.append({
                        "name": name,
                        "position": round(pos, 4),
                        "velocity": 0.0,
                        "effort": 0.0,
                        "simulated": False,
                    })
                last_state = joints
                return {"joints": joints, "timestamp": time.time(), "simulated": False}
            except Exception as e:
                print(f"[Sidecar] read error: {e}", flush=True)
                _disconnect_unlocked()

    # Fallback simulated state
    joints = [
        {"name": "shoulder_pan",   "position": 0.0,   "velocity": 0.0, "effort": 0.0, "simulated": True},
        {"name": "shoulder_lift",  "position": 17.0,  "velocity": 0.0, "effort": 0.0, "simulated": True},
        {"name": "elbow_flex",     "position": -28.6, "velocity": 0.0, "effort": 0.0, "simulated": True},
        {"name": "wrist_flex",     "position": 0.0,   "velocity": 0.0, "effort": 0.0, "simulated": True},
        {"name": "wrist_roll",     "position": 0.0,   "velocity": 0.0, "effort": 0.0, "simulated": True},
        {"name": "gripper",        "position": 28.6,  "velocity": 0.0, "effort": 0.0, "simulated": True},
    ]
    return {"joints": joints, "timestamp": time.time(), "simulated": True}


def send_action(joint_positions: dict):
    global last_request_time
    with robot_lock:
        last_request_time = time.time()
        if not connected:
            _connect_unlocked()
        if robot and connected:
            try:
                action = {f"{name}.pos": float(joint_positions.get(name, 0.0))
                          for name in JOINT_NAMES if name in joint_positions}
                # Re-enable torque before sending a position command.
                robot.bus.enable_torque()
                robot.send_action(action)
                return True
            except Exception as e:
                print(f"[Sidecar] action error: {e}", flush=True)
    return False


def _vla_status() -> dict:
    """Return accurate VLA status with thread.is_alive() check.

    If the runner's thread has died (crash or normal exit), immediately
    clean up the global reference so /vla/status reflects the true state.
    """
    global vla_runner
    if vla_runner is not None:
        if vla_runner.is_running:
            return vla_runner.status()
        # Runner exists but thread is dead — clean up
        err = vla_runner.last_error
        step = vla_runner._step
        print(f"[Sidecar/VLA] Runner thread dead (step={step} error={err}) — cleaning up", flush=True)
        vla_runner = None
    return {"active": False, "instruction": "", "step": 0, "queue_size": 0, "error": None}


# --- Camera MJPEG streaming ---
# Maps camera name → device path. Shared OpenCV captures with idle auto-release.
CAMERA_MAP = {
    "wrist": os.environ.get("SO101_WRIST_CAM", "/dev/video0"),
    "top": os.environ.get("SO101_TOP_CAM", "/dev/video2"),
}
CAMERA_WIDTH = 320
CAMERA_HEIGHT = 240
CAMERA_FPS = 10
CAMERA_JPEG_QUALITY = 60
CAMERA_IDLE_TIMEOUT = 30.0  # seconds before releasing an idle camera

_cameras: dict = {}  # name → {"cap": cv2.VideoCapture, "lock": Lock, "last_read": float}
_cameras_lock = threading.Lock()


def _get_camera(name: str):
    """Get or open an OpenCV camera. Thread-safe, lazy init."""
    import cv2
    with _cameras_lock:
        if name in _cameras and _cameras[name]["cap"].isOpened():
            _cameras[name]["last_read"] = time.time()
            return _cameras[name]
        dev = CAMERA_MAP.get(name)
        if not dev:
            return None
        cap = cv2.VideoCapture(dev)
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, CAMERA_WIDTH)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, CAMERA_HEIGHT)
        cap.set(cv2.CAP_PROP_FPS, CAMERA_FPS)
        if not cap.isOpened():
            print(f"[Sidecar/Cam] Failed to open {name} at {dev}", flush=True)
            return None
        entry = {"cap": cap, "lock": threading.Lock(), "last_read": time.time()}
        _cameras[name] = entry
        print(f"[Sidecar/Cam] Opened {name} at {dev} ({CAMERA_WIDTH}x{CAMERA_HEIGHT}@{CAMERA_FPS}fps)", flush=True)
        return entry


def _camera_idle_watchdog():
    """Release cameras that haven't been read for CAMERA_IDLE_TIMEOUT."""
    import cv2
    while True:
        time.sleep(5.0)
        now = time.time()
        with _cameras_lock:
            for name in list(_cameras):
                entry = _cameras[name]
                if now - entry["last_read"] > CAMERA_IDLE_TIMEOUT:
                    entry["cap"].release()
                    del _cameras[name]
                    print(f"[Sidecar/Cam] Released idle camera: {name}", flush=True)


def stream_camera_mjpeg(wfile, name: str):
    """Write MJPEG frames to wfile until client disconnects."""
    import cv2
    entry = _get_camera(name)
    if not entry:
        return False
    try:
        while True:
            with entry["lock"]:
                entry["last_read"] = time.time()
                ret, frame = entry["cap"].read()
            if not ret:
                break
            _, jpeg = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, CAMERA_JPEG_QUALITY])
            data = jpeg.tobytes()
            wfile.write(
                b"--FRAME\r\n"
                b"Content-Type: image/jpeg\r\n"
                b"Content-Length: " + str(len(data)).encode() + b"\r\n\r\n"
                + data + b"\r\n"
            )
            time.sleep(1.0 / CAMERA_FPS)
    except (BrokenPipeError, ConnectionResetError, OSError):
        pass
    return True


# --- HTTP Handler ---
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            self._json({"status": "ok", "connected": connected, "port": ROBOT_PORT})
        elif self.path == "/state":
            self._json(get_state())
        elif self.path == "/disconnect":
            # Convenience: release the serial port so other tools can use the arm
            with robot_lock:
                _disconnect_unlocked()
            self._json({"ok": True, "message": f"Port {ROBOT_PORT} released"})
        elif self.path == "/vla/status":
            self._json(_vla_status())
        elif self.path == "/record/status":
            self._json(recorder.status())
        elif self.path.startswith("/camera/"):
            cam_name = self.path.split("/camera/", 1)[1].split("?")[0]
            if cam_name not in CAMERA_MAP:
                self.send_error(404, f"Unknown camera: {cam_name}")
                return
            # During recording, camera is exclusively owned by lerobot-record
            if recorder.is_running:
                self._json({"recording": True, "camera": cam_name,
                            "message": "Camera in use by recorder"})
                return
            self.send_response(200)
            self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=FRAME")
            self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
            self.end_headers()
            stream_camera_mjpeg(self.wfile, cam_name)
        elif self.path == "/safety/status":
            if vla_runner is not None:
                self._json(vla_runner.safety_status())
            else:
                self._json({
                    "validator_enabled": True,
                    "rate_limiter_enabled": True,
                    "watchdog_healthy": True,
                    "last_watchdog_latency_ms": None,
                    "actions_validated": 0,
                    "actions_rejected": 0,
                    "actions_clipped": 0,
                    "rate_limiter_max_delta": 10.0,
                    "watchdog_timeout_ms": 30000.0,
                    "degradation_events": [],
                })
        else:
            self.send_error(404)

    def do_POST(self):
        global vla_runner, vla_start_time
        if self.path == "/action":
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length)) if length else {}
            ok = send_action(body)
            self._json({"ok": ok})
        elif self.path == "/disconnect":
            with robot_lock:
                _disconnect_unlocked()
            self._json({"ok": True, "message": f"Port {ROBOT_PORT} released"})
        elif self.path == "/vla/start":
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length)) if length else {}
            instruction = body.get("instruction", "pick up the object")
            server_url = body.get("serverUrl", VLA_SERVER_URL)
            robot_port = body.get("robotPort", ROBOT_PORT)
            camera_type = body.get("cameraType", "picamera2")
            wrist_camera_index = body.get("wristCameraIndex", 1)
            hz = body.get("hz", 5.0)
            print(f"[Sidecar/VLA] Start requested: instruction='{instruction}' server={server_url} camera={camera_type} wrist_cam={wrist_camera_index}", flush=True)
            # Stop any existing VLA runner
            if vla_runner is not None and vla_runner.is_running:
                vla_runner.stop()
            # Release arm so VLARunner can claim /dev/ttyACM0
            print("[Sidecar/VLA] Releasing arm for VLA", flush=True)
            with robot_lock:
                _disconnect_unlocked()
            vla_start_time = time.time()
            vla_runner = VLARunner(
                server_url=server_url,
                robot_port=robot_port,
                robot_id=ROBOT_ID,
                camera_type=camera_type,
                wrist_camera_index=wrist_camera_index if isinstance(wrist_camera_index, int) else -1,
                hz=hz,
            )
            vla_runner.start(instruction)
            print(f"[Sidecar/VLA] VLARunner started", flush=True)
            self._json({"ok": True})
        elif self.path == "/vla/stop":
            elapsed = time.time() - vla_start_time if vla_start_time else 0
            if vla_runner is not None:
                vla_runner.stop()
            vla_runner = None
            vla_start_time = 0.0
            print(f"[Sidecar/VLA] Stopped (ran for {elapsed:.1f}s)", flush=True)
            self._json({"ok": True})
        elif self.path == "/record/start":
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length)) if length else {}
            # Release the follower arm's serial port so lerobot-record can open it.
            with robot_lock:
                _disconnect_unlocked()
            # Release all cameras so lerobot-record can open them.
            with _cameras_lock:
                for cam_name in list(_cameras):
                    _cameras[cam_name]["cap"].release()
                    del _cameras[cam_name]
                    print(f"[Sidecar/Cam] Released camera for recording: {cam_name}", flush=True)
            # Stop VLA if running — it holds the port too.
            if vla_runner is not None and vla_runner.is_running:
                vla_runner.stop()
                vla_runner = None
                vla_start_time = 0.0
            result = recorder.start(
                repo_id=body.get("repo_id", f"robot0/session-{int(time.time())}"),
                task=body.get("task", "manipulate object"),
                num_episodes=int(body.get("num_episodes", 1)),
                episode_time_s=float(body.get("episode_time_s", 30)),
                fps=int(body.get("fps", 30)),
                cameras=body.get("cameras") or {
                    "wrist": {"type": "opencv", "index_or_path": "/dev/video0",
                              "width": 320, "height": 240, "fps": 10},
                    "top": {"type": "opencv", "index_or_path": "/dev/video2",
                            "width": 320, "height": 240, "fps": 10},
                },
                dataset_root=body.get("dataset_root"),
                reset_time_s=float(body.get("reset_time_s", 5)),
            )
            self._json(result)
        elif self.path == "/record/stop":
            result = recorder.stop()
            self._json(result)
        elif self.path == "/safety/config":
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length)) if length else {}
            if vla_runner is not None:
                vla_runner.update_safety_config(body)
                self._json({"ok": True, "config": {
                    "max_delta_degrees": vla_runner.rate_limiter.max_delta,
                    "watchdog_timeout_ms": vla_runner.watchdog.timeout_ms,
                }})
            else:
                self._json({"ok": False, "error": "VLA runner not active"})
        else:
            self.send_error(404)

    def _json(self, data):
        body = json.dumps(data).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass  # suppress per-request logs


# --- Keyboard Teleop WebSocket server ---
TELEOP_WS_PORT = 8766

# Home position (all joints centered)
HOME_POSITION = {name: 0.0 for name in JOINT_NAMES}

async def _keyboard_teleop_handler(websocket):
    """Handle a single keyboard teleop WebSocket connection."""
    global _teleop_active
    import asyncio
    print("[Sidecar/Teleop] Client connected", flush=True)
    _teleop_active = True

    # Get initial joint state
    state = get_state()
    positions = {j["name"]: j["position"] for j in state.get("joints", [])}

    # Send initial state
    await websocket.send(json.dumps({"type": "state", "positions": positions}))

    try:
        async for raw in websocket:
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue

            if "preset" in msg:
                if msg["preset"] == "home":
                    positions = dict(HOME_POSITION)
                elif msg["preset"] == "stop":
                    pass
            elif "joint" in msg and "delta" in msg:
                joint = msg["joint"]
                delta = float(msg["delta"])
                # Read actual position first, then apply delta from there
                # (avoids target runaway when motor can't keep up)
                state = get_state()
                for j in state.get("joints", []):
                    positions[j["name"]] = j["position"]
                if joint in positions:
                    positions[joint] = positions[joint] + delta

            send_action(positions)

            await asyncio.sleep(0.1)

            await websocket.send(json.dumps({"type": "state", "positions": positions}))
    except Exception as e:
        print(f"[Sidecar/Teleop] Connection error: {e}", flush=True)
    finally:
        _teleop_active = False
        # Disable torque when teleop ends so arm is free to move manually again
        with robot_lock:
            if robot and connected:
                try:
                    robot.bus.disable_torque()
                except Exception:
                    pass
        print("[Sidecar/Teleop] Client disconnected, torque released", flush=True)


def _run_teleop_ws():
    """Run the keyboard teleop WebSocket server in a background thread."""
    import asyncio
    import websockets.server

    async def serve():
        async with websockets.server.serve(_keyboard_teleop_handler, "0.0.0.0", TELEOP_WS_PORT):
            print(f"[Sidecar/Teleop] WebSocket listening on port {TELEOP_WS_PORT}", flush=True)
            await asyncio.Future()  # run forever

    asyncio.run(serve())


if __name__ == "__main__":
    # Start idle watchdogs
    watchdog = threading.Thread(target=_idle_watchdog, daemon=True)
    watchdog.start()
    cam_watchdog = threading.Thread(target=_camera_idle_watchdog, daemon=True)
    cam_watchdog.start()
    # Start keyboard teleop WebSocket server
    teleop_thread = threading.Thread(target=_run_teleop_ws, daemon=True)
    teleop_thread.start()
    # Use ThreadingHTTPServer so MJPEG camera streams don't block other requests
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"[Sidecar] Listening on port {PORT} | on-demand connection | idle timeout: {IDLE_TIMEOUT_S}s", flush=True)
    server.serve_forever()
