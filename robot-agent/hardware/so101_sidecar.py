"""
so101_sidecar.py — Hardware bridge between the SO-101 arm and the Node.js Robot Agent.

Exposes a lightweight HTTP API on port 8765:
  GET  /health  → {"status": "ok", "connected": true/false}
  GET  /state   → {"joints": [...], "timestamp": ..., "simulated": false}
  POST /action  → {"shoulder_pan": deg, ...} → sends to real arm

Run via:
  cd ~/repos/vla-tests/pi05/client
  uv run python ~/develop/robot-management-system/robot-agent/hardware/so101_sidecar.py
"""

import io
import json
import sys
import time
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

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


def _connect_unlocked() -> bool:
    """Connect to the arm. Must be called with robot_lock held."""
    global robot, connected
    try:
        from lerobot.robots.so_follower import SO101Follower, SO101FollowerConfig
        config = SO101FollowerConfig(port=ROBOT_PORT, id=ROBOT_ID)
        r = SO101Follower(config)
        # LeRobot's connect() prompts interactively for calibration.
        # We auto-accept (ENTER) to use the existing calibration file.
        old_stdin = sys.stdin
        sys.stdin = io.StringIO("\n")
        try:
            r.connect()
        finally:
            sys.stdin = old_stdin
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
    while True:
        time.sleep(1.0)
        with robot_lock:
            if connected and (time.time() - last_request_time) > IDLE_TIMEOUT_S:
                _disconnect_unlocked()


def get_state():
    global last_state, last_request_time
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
        else:
            self.send_error(404)

    def do_POST(self):
        if self.path == "/action":
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length)) if length else {}
            ok = send_action(body)
            self._json({"ok": ok})
        elif self.path == "/disconnect":
            with robot_lock:
                _disconnect_unlocked()
            self._json({"ok": True, "message": f"Port {ROBOT_PORT} released"})
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
