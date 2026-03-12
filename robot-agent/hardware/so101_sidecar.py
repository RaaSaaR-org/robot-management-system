"""
so101_sidecar.py — Hardware bridge between the SO-101 arm and the Node.js Robot Agent.

Exposes a lightweight HTTP API on port 8765:
  GET  /health  → {"status": "ok", "connected": true/false}
  GET  /state   → {"joints": [...], "timestamp": ..., "simulated": false}
  POST /action  → {"shoulder_pan": deg, ...} → sends to real arm
  POST /vla/start → Start VLA control loop via VLARunner
  POST /vla/stop  → Stop VLA control loop
  GET  /vla/status → VLA runner status

Run via:
  uv run python ~/develop/robot-management-system/robot-agent/hardware/so101_sidecar.py
"""

import json
import os
import time
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

from vla_runner import VLARunner

PORT = 8765
ROBOT_ID = "my_so101"
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
    # While VLA is running, don't attempt to reconnect (it owns the port)
    if vla_runner is not None and vla_runner.is_running:
        return {"joints": last_state or [], "timestamp": time.time(), "simulated": True, "vla_active": True}
    with robot_lock:
        last_request_time = time.time()
        # Reconnect if idle disconnect happened
        if not connected:
            _connect_unlocked()
        if robot and connected:
            try:
                obs = robot.get_observation()
                # Immediately release torque so the arm stays free to move manually.
                # Torque is re-enabled in send_action() when needed.
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


if __name__ == "__main__":
    # Start idle watchdog (auto-disconnect after IDLE_TIMEOUT_S of no /state requests)
    watchdog = threading.Thread(target=_idle_watchdog, daemon=True)
    watchdog.start()
    server = HTTPServer(("0.0.0.0", PORT), Handler)
    print(f"[Sidecar] Listening on port {PORT} | on-demand connection | idle timeout: {IDLE_TIMEOUT_S}s", flush=True)
    server.serve_forever()
