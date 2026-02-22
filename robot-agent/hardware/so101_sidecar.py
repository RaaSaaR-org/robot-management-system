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
import os
import subprocess
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

# --- VLA subprocess management ---
vla_process: subprocess.Popen | None = None
vla_active = False
vla_instruction = ""
vla_start_time: float = 0.0
CLIENT_DIR = os.path.expanduser("~/repos/vla-tests/pi05/client")
UV_BIN = os.path.expanduser("~/.local/bin/uv")


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
    global vla_process, vla_active
    while True:
        time.sleep(1.0)
        with robot_lock:
            if connected and (time.time() - last_request_time) > IDLE_TIMEOUT_S:
                _disconnect_unlocked()
        # Check if VLA subprocess died unexpectedly
        if vla_active and vla_process is not None and vla_process.poll() is not None:
            rc = vla_process.returncode
            elapsed = time.time() - vla_start_time
            print(f"[Sidecar/VLA] Process died unexpectedly (exit code {rc}) after {elapsed:.1f}s", flush=True)
            vla_process = None
            vla_active = False


def get_state():
    global last_state, last_request_time
    # While VLA is running, don't attempt to reconnect (it owns the port)
    if vla_active:
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
            running = vla_process is not None and vla_process.poll() is None
            self._json({
                "active": vla_active or running,
                "pid": vla_process.pid if (vla_process and running) else None,
                "instruction": vla_instruction,
            })
        else:
            self.send_error(404)

    def do_POST(self):
        global vla_process, vla_active, vla_instruction
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
            host = body.get("host", "100.125.78.40")
            server_port = body.get("port", 8080)
            robot_port = body.get("robotPort", "/dev/ttyACM0")
            model = body.get("model", "Elvinky/pi05_so101_pick_place_bottle")
            print(f"[Sidecar/VLA] Start requested: instruction='{instruction}' host={host} port={server_port} model={model}", flush=True)
            # Stop any existing VLA process
            if vla_process and vla_process.poll() is None:
                vla_process.terminate()
                try: vla_process.wait(timeout=3)
                except subprocess.TimeoutExpired: vla_process.kill()
            # Release arm so client_pi.py can claim /dev/ttyACM0
            print("[Sidecar/VLA] Releasing arm for VLA", flush=True)
            with robot_lock:
                _disconnect_unlocked()
            vla_active = True
            vla_instruction = instruction
            vla_start_time = time.time()
            cmd = [
                UV_BIN, "run", "python",
                os.path.join(CLIENT_DIR, "client_pi.py"),
                "--backend", "lerobot",
                "--host", host,
                "--server-port", str(server_port),
                "--port", robot_port,
                "--model", model,
                "--prompt", instruction,
            ]
            vla_process = subprocess.Popen(cmd, cwd=CLIENT_DIR)
            print(f"[Sidecar/VLA] Subprocess spawned: PID={vla_process.pid}", flush=True)
            self._json({"ok": True, "pid": vla_process.pid})
        elif self.path == "/vla/stop":
            elapsed = time.time() - vla_start_time if vla_start_time else 0
            if vla_process and vla_process.poll() is None:
                vla_process.terminate()
                try: vla_process.wait(timeout=5)
                except subprocess.TimeoutExpired: vla_process.kill()
            vla_process = None
            vla_active = False
            vla_start_time = 0.0
            print(f"[Sidecar/VLA] Stopped (ran for {elapsed:.1f}s)", flush=True)
            self._json({"ok": True})
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
