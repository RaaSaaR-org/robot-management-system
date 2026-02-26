"""
@file vla_runner.py
@description Thread-based VLA control loop.

Replaces the subprocess.Popen(client_pi.py) approach with a native
Python thread that talks to the consolidated vla-server over HTTP.

Control loop:
    1. Capture camera frame (picamera2 or opencv)
    2. Read current joint state from the robot
    3. If action queue is empty, call vla-server /predict to refill
    4. Pop next action from queue and send to robot
    5. Sleep to maintain target frequency (default 5 Hz)

Usage from so101_sidecar.py:
    runner = VLARunner(server_url="http://192.168.178.40:8000")
    runner.start(instruction="pick up the green object")
    ...
    runner.stop()
"""

import base64
import io
import logging
import threading
import time
from collections import deque

import numpy as np

from vla_safety import (
    ActionValidator,
    GracefulDegradation,
    MovementRateLimiter,
    NetworkWatchdog,
)

logger = logging.getLogger(__name__)


class VLARunner:
    """Thread-based VLA control loop.

    Captures camera images, sends observations to a vla-server, and
    executes the returned action chunks on the robot arm.
    """

    def __init__(
        self,
        server_url: str,
        robot_port: str = "/dev/ttyACM0",
        robot_id: str = "my_so101",
        camera_type: str = "auto",
        camera_index: int = 0,
        wrist_camera_index: int = -1,
        hz: float = 5.0,
        timeout: float = 10.0,
        config: dict | None = None,
    ):
        self.server_url = server_url.rstrip("/")
        self.robot_port = robot_port
        self.robot_id = robot_id
        self.camera_type = camera_type
        self.camera_index = camera_index
        self.wrist_camera_index = wrist_camera_index
        self.hz = hz
        self.timeout = timeout

        self._thread: threading.Thread | None = None
        self._stop_event = threading.Event()
        self._action_queue: deque = deque()
        self._step = 0
        self._instruction = ""
        self._error: str | None = None

        # Safety modules
        cfg = config or {}
        self.validator = ActionValidator()
        self.rate_limiter = MovementRateLimiter(
            max_delta=cfg.get("max_delta_degrees", 10.0)
        )
        self.watchdog = NetworkWatchdog(
            timeout_ms=cfg.get("watchdog_timeout_ms", 100.0)
        )
        self.degradation = GracefulDegradation()

    @property
    def is_running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    @property
    def last_error(self) -> str | None:
        return self._error

    def start(self, instruction: str) -> None:
        """Start the VLA control loop in a background thread."""
        if self.is_running:
            logger.warning("VLARunner already running, stopping first")
            self.stop()

        self._stop_event.clear()
        self._action_queue.clear()
        self._step = 0
        self._instruction = instruction
        self._error = None

        # Reset safety state for new run
        self.rate_limiter.reset()
        self.watchdog.reset()
        self.degradation.clear_events()

        self._thread = threading.Thread(
            target=self._control_loop,
            name="vla-runner",
            daemon=True,
        )
        self._thread.start()
        logger.info(f"VLARunner started: instruction='{instruction}' server={self.server_url}")

    def stop(self) -> None:
        """Stop the control loop and wait for the thread to finish."""
        self._stop_event.set()
        if self._thread is not None:
            self._thread.join(timeout=5.0)
            self._thread = None
        logger.info(f"VLARunner stopped after {self._step} steps")

    def status(self) -> dict:
        """Return current status."""
        return {
            "active": self.is_running,
            "instruction": self._instruction,
            "step": self._step,
            "queue_size": len(self._action_queue),
            "error": self._error,
        }

    def safety_status(self) -> dict:
        """Return safety module status."""
        validator_stats = self.validator.stats
        return {
            "validator_enabled": True,
            "rate_limiter_enabled": True,
            "watchdog_healthy": self.watchdog.is_healthy(),
            "last_watchdog_latency_ms": self.watchdog.last_latency_ms,
            "actions_validated": validator_stats["validated"],
            "actions_rejected": validator_stats["rejected"],
            "actions_clipped": validator_stats["clipped"],
            "rate_limiter_max_delta": self.rate_limiter.max_delta,
            "watchdog_timeout_ms": self.watchdog.timeout_ms,
            "degradation_events": self.degradation.events,
        }

    def update_safety_config(self, config: dict) -> None:
        """Update safety parameters at runtime."""
        if "max_delta_degrees" in config:
            self.rate_limiter.max_delta = float(config["max_delta_degrees"])
            logger.info(f"Safety: max_delta updated to {self.rate_limiter.max_delta}")
        if "watchdog_timeout_ms" in config:
            self.watchdog.timeout_ms = float(config["watchdog_timeout_ms"])
            logger.info(f"Safety: watchdog timeout updated to {self.watchdog.timeout_ms}ms")

    def _control_loop(self) -> None:
        """Main control loop — runs in a background thread."""
        import httpx

        robot = None
        camera = None
        wrist_cam = None

        try:
            # Initialize robot and camera
            robot = self._connect_robot()
            camera = self._make_camera(self.camera_index)
            if self.wrist_camera_index >= 0:
                wrist_cam = self._make_camera(self.wrist_camera_index)

            client = httpx.Client(timeout=self.timeout)
            period = 1.0 / self.hz

            logger.info(
                f"VLA loop running at {self.hz} Hz, "
                f"instruction: '{self._instruction}'"
            )

            while not self._stop_event.is_set():
                t_start = time.time()

                # Refill action queue if empty
                if not self._action_queue:
                    img_b64 = self._capture_b64(camera)
                    state = self._get_state(robot)

                    images = {"front": img_b64}
                    if wrist_cam is not None:
                        images["wrist"] = self._capture_b64(wrist_cam)

                    try:
                        t_predict = time.time()
                        resp = client.post(
                            f"{self.server_url}/predict",
                            json={
                                "images": images,
                                "state": state,
                                "task": self._instruction,
                            },
                        )
                        resp.raise_for_status()
                        latency_ms = (time.time() - t_predict) * 1000
                        self.watchdog.record_latency(latency_ms)

                        actions = resp.json()["actions"]
                        self._action_queue.extend(actions)

                        if self._step % 10 == 0:
                            elapsed = time.time() - t_start
                            logger.info(
                                f"[Step {self._step}] inference={elapsed*1000:.0f}ms "
                                f"latency={latency_ms:.0f}ms "
                                f"chunk_size={len(actions)}"
                            )
                    except Exception as e:
                        logger.error(f"Predict failed: {e}")
                        self._error = str(e)
                        time.sleep(1.0)
                        continue

                # Check watchdog health
                if not self.watchdog.is_healthy():
                    logger.warning("[Safety] Watchdog unhealthy — triggering safe stop")
                    self.degradation.safe_stop(
                        reason="Network watchdog timeout exceeded",
                        sidecar_url="http://localhost:8765",
                    )
                    self._error = "safety: watchdog timeout"
                    break

                # Execute next action with safety pipeline
                if self._action_queue:
                    action = self._action_queue.popleft()

                    # 1. Validate joint limits (clip, don't block)
                    action = self.validator.clip(action)

                    # 2. Rate-limit movement deltas (clip to max delta)
                    action = self.rate_limiter.clip(action)

                    # 3. Apply to robot
                    self._send_action(robot, action)
                    self.degradation.record_good_action(action)
                    self._step += 1

                elapsed = time.time() - t_start
                sleep_time = max(0, period - elapsed)
                if sleep_time > 0 and not self._stop_event.is_set():
                    self._stop_event.wait(timeout=sleep_time)

        except Exception as e:
            logger.error(f"VLA loop error: {e}", exc_info=True)
            self._error = str(e)
        finally:
            if camera is not None:
                self._release_camera(camera)
            if wrist_cam is not None:
                self._release_camera(wrist_cam)
            if robot is not None:
                self._disconnect_robot(robot)

    def _connect_robot(self):
        """Connect to SO-101 via LeRobot."""
        import sys

        from lerobot.robots.so_follower import SO101Follower
        from lerobot.robots.so_follower.config_so_follower import SO101FollowerConfig

        config = SO101FollowerConfig(port=self.robot_port, id=self.robot_id)
        robot = SO101Follower(config)

        # Auto-accept calibration prompt
        old_stdin = sys.stdin
        sys.stdin = io.StringIO("\n")
        try:
            robot.connect()
        finally:
            sys.stdin = old_stdin

        logger.info(f"Robot connected on {self.robot_port}")
        return robot

    def _disconnect_robot(self, robot) -> None:
        try:
            robot.disconnect()
        except Exception:
            pass

    def _get_state(self, robot) -> list[float]:
        """Read joint positions from robot."""
        joint_names = [
            "shoulder_pan", "shoulder_lift", "elbow_flex",
            "wrist_flex", "wrist_roll", "gripper",
        ]
        obs = robot.get_observation()
        return [float(obs.get(f"{name}.pos", 0.0)) for name in joint_names]

    def _send_action(self, robot, action: list[float]) -> None:
        """Send joint position action to robot."""
        joint_names = [
            "shoulder_pan", "shoulder_lift", "elbow_flex",
            "wrist_flex", "wrist_roll", "gripper",
        ]
        action_dict = {}
        for i, name in enumerate(joint_names):
            if i < len(action):
                action_dict[f"{name}.pos"] = float(action[i])
        robot.send_action(action_dict)

    def _make_camera(self, index: int):
        """Create camera interface."""
        if self.camera_type == "picamera2" or self.camera_type == "auto":
            try:
                from picamera2 import Picamera2

                cam = Picamera2(index)
                config = cam.create_video_configuration(
                    main={"size": (640, 480), "format": "RGB888"}
                )
                cam.configure(config)
                cam.start()
                time.sleep(0.5)
                logger.info(f"PiCamera {index} ready (640x480)")
                return ("picamera2", cam)
            except Exception:
                if self.camera_type == "picamera2":
                    raise

        # Fallback to OpenCV
        import cv2

        cap = cv2.VideoCapture(index)
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
        if not cap.isOpened():
            raise RuntimeError(f"Cannot open camera {index}")
        logger.info(f"OpenCV camera {index} ready (640x480)")
        return ("opencv", cap)

    def _release_camera(self, camera_tuple) -> None:
        cam_type, cam = camera_tuple
        try:
            if cam_type == "picamera2":
                cam.stop()
                cam.close()
            else:
                cam.release()
        except Exception:
            pass

    def _capture_b64(self, camera_tuple) -> str:
        """Capture a frame and return as base64-encoded JPEG."""
        cam_type, cam = camera_tuple

        if cam_type == "picamera2":
            frame = cam.capture_array()  # RGB
        else:
            import cv2

            ret, frame = cam.read()
            if not ret:
                raise RuntimeError("Failed to capture frame")
            frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

        from PIL import Image

        img = Image.fromarray(frame)
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=85)
        return base64.b64encode(buf.getvalue()).decode()
