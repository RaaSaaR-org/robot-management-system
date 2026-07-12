"""
@file vla_runner.py
@description Thread-based VLA control loop with optional Real-Time Chunking (RTC).

Replaces the subprocess.Popen(client_pi.py) approach with a native
Python thread that talks to the consolidated vla-server over HTTP.

Control loop (standard):
    1. Capture camera frame (picamera2 or opencv)
    2. Read current joint state from the robot
    3. If action queue is empty, call vla-server /predict to refill
    4. Pop next action from queue and send to robot
    5. Sleep to maintain target frequency (default 5 Hz)

Control loop (RTC enabled):
    1. Execute actions from merged queue continuously
    2. Async inference thread pre-fetches next chunk while executing
    3. At chunk boundary, blend overlapping actions via weighted average
    4. Result: smoother, more reactive arm movements with no pauses

RTC is inspired by Physical Intelligence's Real-Time Chunking paper and
LeRobot v0.5.0's native RTCConfig. This client-side implementation handles
the action queue blending while the server handles inference. When upgrading
to LeRobot v0.5.0, the server can additionally use native RTC guidance
during denoising for even smoother results.

Usage from so101_sidecar.py:
    runner = VLARunner(server_url="http://192.168.178.40:8000")
    runner.start(instruction="pick up the green object")
    ...
    runner.stop()

RTC env vars:
    VLA_RTC_ENABLED=true        Enable async inference + chunk blending
    VLA_RTC_BLEND_STEPS=5       Steps to blend at chunk boundaries
    VLA_RTC_CHUNK_OVERLAP=3     Steps of overlap between consecutive chunks

@status support
    TASK-146 final 20% moved the agent's closed loop into the TS
    SkillExecutor, and TASK-184 removed the agent's last calls to the
    sidecar /vla/* surface. This runner is still imported at module level
    by so101_sidecar.py (@status live) for its /vla/start|stop|status
    endpoints, and its backends are used by sim_evaluator/evaluate_vla.py
    — it is NOT orphaned and must not be deleted while those stand.
"""

import base64
import io
import logging
import os
import threading
import time
from collections import deque

import numpy as np

from backends import SmolVLABackend, VLABackend
from vla_safety import (
    ActionValidator,
    GracefulDegradation,
    MovementRateLimiter,
    NetworkWatchdog,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# RTC: Client-side Real-Time Chunking action queue
# ---------------------------------------------------------------------------

def _blend_actions(
    tail: list[list[float]],
    head: list[list[float]],
    blend_steps: int,
) -> list[list[float]]:
    """Weighted-average blend between the tail of the old chunk and the head of the new one.

    Uses a linear ramp: weight of new chunk goes from 0→1 over *blend_steps*.
    Returns the blended region (length = blend_steps).
    """
    n = min(blend_steps, len(tail), len(head))
    if n == 0:
        return []
    blended: list[list[float]] = []
    for i in range(n):
        w_new = (i + 1) / (n + 1)  # 0 < w < 1, never exactly 0 or 1
        w_old = 1.0 - w_new
        merged = [
            w_old * old_val + w_new * new_val
            for old_val, new_val in zip(tail[i], head[i])
        ]
        blended.append(merged)
    return blended


class RTCActionQueue:
    """Thread-safe action queue with chunk blending for Real-Time Chunking.

    Manages two concerns:
      1. Merging new action chunks with the remainder of the previous chunk
         using weighted blending at the overlap region.
      2. Providing a simple get() interface for the control loop.
    """

    def __init__(self, blend_steps: int = 5, chunk_overlap: int = 3):
        self.blend_steps = blend_steps
        self.chunk_overlap = chunk_overlap
        self._queue: deque[list[float]] = deque()
        self._lock = threading.Lock()

    def __len__(self) -> int:
        with self._lock:
            return len(self._queue)

    def get(self) -> list[float] | None:
        """Pop and return the next action, or None if empty."""
        with self._lock:
            return self._queue.popleft() if self._queue else None

    def get_left_over(self) -> list[list[float]]:
        """Return remaining actions without consuming them (for RTC server-side guidance)."""
        with self._lock:
            return list(self._queue)

    def merge(self, new_actions: list[list[float]]) -> None:
        """Merge a new action chunk into the queue with blending.

        If the queue still has actions remaining (overlap region), blend
        the tail of the remaining queue with the head of the new chunk.
        Otherwise, just append.
        """
        with self._lock:
            remaining = list(self._queue)
            self._queue.clear()

            if not remaining:
                self._queue.extend(new_actions)
                return

            overlap = min(self.blend_steps, len(remaining), len(new_actions))
            if overlap > 0:
                # Keep non-overlapping prefix from old queue
                self._queue.extend(remaining[:-overlap])
                # Blend the overlap region
                blended = _blend_actions(
                    remaining[-overlap:],
                    new_actions[:overlap],
                    overlap,
                )
                self._queue.extend(blended)
                # Append remainder of new chunk after overlap
                self._queue.extend(new_actions[overlap:])
            else:
                self._queue.extend(remaining)
                self._queue.extend(new_actions)

    def clear(self) -> None:
        with self._lock:
            self._queue.clear()


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
        backend: VLABackend | None = None,
    ):
        self.server_url = server_url.rstrip("/")
        self.robot_port = robot_port
        self.robot_id = robot_id
        self.camera_type = camera_type
        self.camera_index = camera_index
        self.wrist_camera_index = wrist_camera_index
        self.hz = hz
        self.timeout = timeout

        # VLA inference backend (default: SmolVLABackend over HTTP)
        self._backend: VLABackend = backend or SmolVLABackend(timeout=timeout)

        self._thread: threading.Thread | None = None
        self._stop_event = threading.Event()
        self._step = 0
        self._instruction = ""
        self._error: str | None = None

        # RTC (Real-Time Chunking) configuration
        self.rtc_enabled = os.environ.get("VLA_RTC_ENABLED", "false").lower() in ("true", "1", "yes")
        self.rtc_blend_steps = int(os.environ.get("VLA_RTC_BLEND_STEPS", "5"))
        self.rtc_chunk_overlap = int(os.environ.get("VLA_RTC_CHUNK_OVERLAP", "3"))

        if self.rtc_enabled:
            self._action_queue = RTCActionQueue(
                blend_steps=self.rtc_blend_steps,
                chunk_overlap=self.rtc_chunk_overlap,
            )
        else:
            self._action_queue: deque | RTCActionQueue = deque()

        # Async inference state (RTC mode)
        self._inference_thread: threading.Thread | None = None
        self._pending_actions: list[list[float]] | None = None
        self._inference_lock = threading.Lock()

        # Safety modules
        cfg = config or {}
        self.validator = ActionValidator()
        self.rate_limiter = MovementRateLimiter(
            max_delta=cfg.get("max_delta_degrees", 10.0)
        )
        self.watchdog = NetworkWatchdog(
            timeout_ms=cfg.get("watchdog_timeout_ms", 30000.0)
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
        self._pending_actions = None

        # Reset safety state for new run
        self.rate_limiter.reset()
        self.watchdog.reset()
        self.degradation.clear_events()

        self._thread = threading.Thread(
            target=self._control_loop_rtc if self.rtc_enabled else self._control_loop,
            name="vla-runner",
            daemon=True,
        )
        self._thread.start()
        mode = "RTC" if self.rtc_enabled else "standard"
        logger.info(
            f"VLARunner started ({mode}): instruction='{instruction}' "
            f"server={self.server_url}"
        )

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
            "rtc_enabled": self.rtc_enabled,
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

    def _connect_backend(self) -> None:
        """Connect the VLA backend to the server (if not already connected)."""
        if not self._backend.is_connected:
            self._backend.connect(self.server_url, {"timeout": self.timeout})

    def _control_loop(self) -> None:
        """Main control loop — runs in a background thread."""
        robot = None
        camera = None
        wrist_cam = None

        try:
            # Connect backend to VLA server
            self._connect_backend()
            camera_names = (
                self._backend.camera_names
                if hasattr(self._backend, "camera_names")
                else ["front"]
            )

            # Initialize robot and camera
            robot = self._connect_robot()

            # Seed rate limiter with current robot state so the FIRST action
            # is also rate-limited. Without this, the first VLA action has no
            # delta cap and can command a 60°+ single-step jump → servo stall.
            initial_state = self._get_state(robot)
            self.rate_limiter._last_action = initial_state[:]
            logger.info(f"Rate limiter seeded from robot state: {[round(s,1) for s in initial_state]}")

            camera = self._make_camera(self.camera_index)
            if self.wrist_camera_index >= 0:
                try:
                    wrist_cam = self._make_camera(self.wrist_camera_index)
                except Exception as e:
                    logger.warning(
                        f"Wrist camera {self.wrist_camera_index} not available: {e} "
                        "— proceeding with front camera only"
                    )
                    wrist_cam = None

            period = 1.0 / self.hz

            logger.info(
                f"VLA loop running at {self.hz} Hz, "
                f"instruction: '{self._instruction}', "
                f"cameras: {camera_names}"
            )

            while not self._stop_event.is_set():
                t_start = time.time()

                # Refill action queue if empty
                if not self._action_queue:
                    img_b64 = self._capture_b64(camera)
                    state = self._get_state(robot)

                    # Map available cameras to model-expected names
                    images = {cam: img_b64 for cam in camera_names}
                    if wrist_cam is not None and len(camera_names) > 1:
                        images[camera_names[-1]] = self._capture_b64(wrist_cam)

                    try:
                        actions, latency_ms = self._backend.predict_with_latency(
                            images, state, self._instruction,
                        )
                        self.watchdog.record_latency(latency_ms)
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
            self._backend.disconnect()

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

    # -------------------------------------------------------------------
    # RTC control loop — async inference + action blending
    # -------------------------------------------------------------------

    def _control_loop_rtc(self) -> None:
        """RTC-enabled control loop.

        Differs from _control_loop in two key ways:
          1. Inference runs in a background thread so the robot keeps moving
             while the next chunk is being computed.
          2. New chunks are merged into an RTCActionQueue with weighted
             blending at the overlap boundary — no pauses or jumps.
        """
        robot = None
        camera = None
        wrist_cam = None
        assert isinstance(self._action_queue, RTCActionQueue)

        try:
            # Connect backend to VLA server
            self._connect_backend()
            camera_names = (
                self._backend.camera_names
                if hasattr(self._backend, "camera_names")
                else ["front"]
            )

            robot = self._connect_robot()

            initial_state = self._get_state(robot)
            self.rate_limiter._last_action = initial_state[:]
            logger.info(f"[RTC] Rate limiter seeded: {[round(s,1) for s in initial_state]}")

            camera = self._make_camera(self.camera_index)
            if self.wrist_camera_index >= 0:
                try:
                    wrist_cam = self._make_camera(self.wrist_camera_index)
                except Exception as e:
                    logger.warning(f"Wrist camera {self.wrist_camera_index} not available: {e}")
                    wrist_cam = None

            period = 1.0 / self.hz

            logger.info(
                f"[RTC] Loop running at {self.hz} Hz, "
                f"blend_steps={self.rtc_blend_steps}, "
                f"chunk_overlap={self.rtc_chunk_overlap}, "
                f"cameras={camera_names}"
            )

            # Kick off first inference synchronously to prime the queue
            self._fetch_and_merge(robot, camera, wrist_cam, camera_names)

            while not self._stop_event.is_set():
                t_start = time.time()

                # Start async inference when queue is running low
                queue_len = len(self._action_queue)
                if queue_len <= self.rtc_blend_steps and not self._is_inferring():
                    self._start_async_inference(robot, camera, wrist_cam, camera_names)

                # Collect completed async inference results
                self._collect_async_results()

                # Check watchdog
                if not self.watchdog.is_healthy():
                    logger.warning("[RTC/Safety] Watchdog unhealthy — safe stop")
                    self.degradation.safe_stop(
                        reason="Network watchdog timeout exceeded",
                        sidecar_url="http://localhost:8765",
                    )
                    self._error = "safety: watchdog timeout"
                    break

                # Execute next action
                action = self._action_queue.get()
                if action is not None:
                    action = self.validator.clip(action)
                    action = self.rate_limiter.clip(action)
                    self._send_action(robot, action)
                    self.degradation.record_good_action(action)
                    self._step += 1
                else:
                    # Queue empty — do a synchronous fetch to avoid stalling
                    logger.debug("[RTC] Queue empty, synchronous refill")
                    self._fetch_and_merge(robot, camera, wrist_cam, camera_names)

                elapsed = time.time() - t_start
                sleep_time = max(0, period - elapsed)
                if sleep_time > 0 and not self._stop_event.is_set():
                    self._stop_event.wait(timeout=sleep_time)

        except Exception as e:
            logger.error(f"[RTC] Loop error: {e}", exc_info=True)
            self._error = str(e)
        finally:
            # Wait for any in-flight inference
            if self._inference_thread is not None:
                self._inference_thread.join(timeout=3.0)
            if camera is not None:
                self._release_camera(camera)
            if wrist_cam is not None:
                self._release_camera(wrist_cam)
            if robot is not None:
                self._disconnect_robot(robot)
            self._backend.disconnect()

    def _fetch_and_merge(self, robot, camera, wrist_cam, camera_names) -> None:
        """Synchronous: capture → predict via backend → merge into RTCActionQueue."""
        img_b64 = self._capture_b64(camera)
        state = self._get_state(robot)

        images = {cam: img_b64 for cam in camera_names}
        if wrist_cam is not None and len(camera_names) > 1:
            images[camera_names[-1]] = self._capture_b64(wrist_cam)

        try:
            actions, latency_ms = self._backend.predict_with_latency(
                images, state, self._instruction,
            )
            self.watchdog.record_latency(latency_ms)

            assert isinstance(self._action_queue, RTCActionQueue)
            self._action_queue.merge(actions)

            if self._step % 10 == 0:
                logger.info(
                    f"[RTC Step {self._step}] latency={latency_ms:.0f}ms "
                    f"chunk={len(actions)} queue={len(self._action_queue)}"
                )
        except Exception as e:
            logger.error(f"[RTC] Predict failed: {e}")
            self._error = str(e)

    def _is_inferring(self) -> bool:
        return self._inference_thread is not None and self._inference_thread.is_alive()

    def _start_async_inference(self, robot, camera, wrist_cam, camera_names) -> None:
        """Kick off inference in a background thread."""
        # Capture observation NOW (before inference latency)
        img_b64 = self._capture_b64(camera)
        state = self._get_state(robot)
        images = {cam: img_b64 for cam in camera_names}
        if wrist_cam is not None and len(camera_names) > 1:
            images[camera_names[-1]] = self._capture_b64(wrist_cam)

        def _infer():
            try:
                actions, latency_ms = self._backend.predict_with_latency(
                    images, state, self._instruction,
                )
                self.watchdog.record_latency(latency_ms)
                with self._inference_lock:
                    self._pending_actions = actions
            except Exception as e:
                logger.error(f"[RTC async] Predict failed: {e}")
                self._error = str(e)

        self._inference_thread = threading.Thread(target=_infer, name="vla-rtc-infer", daemon=True)
        self._inference_thread.start()

    def _collect_async_results(self) -> None:
        """If async inference finished, merge results into queue."""
        with self._inference_lock:
            if self._pending_actions is not None:
                assert isinstance(self._action_queue, RTCActionQueue)
                self._action_queue.merge(self._pending_actions)
                logger.debug(f"[RTC] Merged async chunk ({len(self._pending_actions)} actions)")
                self._pending_actions = None
