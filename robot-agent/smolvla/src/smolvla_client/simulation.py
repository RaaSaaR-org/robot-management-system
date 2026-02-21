"""
@file simulation.py
@description Simulated camera and robot classes for testing the SmolVLA
    control loop without physical hardware.
@feature smolvla-client
"""

import base64
import logging

import cv2
import numpy as np

from .config import CameraConfig

logger = logging.getLogger(__name__)

# SO-101 joint limits (radians) — conservative bounds
# Joint order: shoulder_pan, shoulder_lift, elbow, wrist_pitch, wrist_roll, gripper
_JOINT_LIMITS_LOW = [-2.0, -2.0, -2.0, -2.0, -2.0, -0.5]
_JOINT_LIMITS_HIGH = [2.0, 2.0, 2.0, 2.0, 2.0, 1.5]


class SimulatedCamera:
    """Generates random 224x224 RGB noise frames encoded as JPEG."""

    def __init__(self, name: str, config: CameraConfig):
        self.name = name
        self.config = config
        self._connected = False

    def connect(self) -> None:
        self._connected = True
        logger.info(f"SimulatedCamera '{self.name}' connected ({self.config.width}x{self.config.height})")

    def capture_jpeg_b64(self, quality: int = 85) -> str:
        """Generate a random noise frame and return as base64 JPEG."""
        if not self._connected:
            raise RuntimeError(f"SimulatedCamera '{self.name}' not connected. Call connect() first.")

        frame = np.random.randint(
            0, 256,
            (self.config.height, self.config.width, 3),
            dtype=np.uint8,
        )
        encode_params = [cv2.IMWRITE_JPEG_QUALITY, quality]
        success, jpeg_bytes = cv2.imencode(".jpg", frame, encode_params)
        if not success:
            raise RuntimeError(f"Failed to JPEG-encode simulated frame for '{self.name}'")
        return base64.b64encode(jpeg_bytes.tobytes()).decode("ascii")

    def disconnect(self) -> None:
        self._connected = False
        logger.info(f"SimulatedCamera '{self.name}' disconnected")


class SimulatedCameraManager:
    """Manages multiple SimulatedCamera instances.

    Same interface as CameraManager (connect_all, capture_all_b64, disconnect_all).
    """

    def __init__(self, cameras_config: dict[str, CameraConfig]):
        self.cameras: dict[str, SimulatedCamera] = {
            name: SimulatedCamera(name, cfg) for name, cfg in cameras_config.items()
        }

    def connect_all(self) -> None:
        for cam in self.cameras.values():
            cam.connect()

    def capture_all_b64(self, quality: int = 85) -> dict[str, str]:
        """Capture from all simulated cameras, return dict of name -> base64 JPEG."""
        return {name: cam.capture_jpeg_b64(quality) for name, cam in self.cameras.items()}

    def disconnect_all(self) -> None:
        for cam in self.cameras.values():
            cam.disconnect()


class SimulatedRobot:
    """Simulated SO-101 robot arm that tracks joint state in memory.

    Maintains a 6-element state vector. send_action() sets target positions
    clamped to joint limits. get_state() returns current positions.
    """

    def __init__(self, **kwargs):
        self._state = np.zeros(6, dtype=np.float32)
        self._connected = False
        self._step_count = 0
        self._log_interval = 30  # log every ~1 sec at 30 Hz

    def connect(self) -> None:
        self._connected = True
        logger.info("SimulatedRobot connected (6-DOF, all zeros initial state)")

    def get_state(self) -> list[float]:
        """Return current joint positions."""
        if not self._connected:
            raise RuntimeError("SimulatedRobot not connected. Call connect() first.")
        return self._state.tolist()

    def send_action(self, action: list[float]) -> None:
        """Apply action as target positions, clamped to joint limits."""
        if not self._connected:
            raise RuntimeError("SimulatedRobot not connected. Call connect() first.")

        action_array = np.array(action, dtype=np.float32)
        clamped = np.clip(action_array, _JOINT_LIMITS_LOW, _JOINT_LIMITS_HIGH)
        self._state = clamped
        self._step_count += 1

        if self._step_count % self._log_interval == 0:
            state_str = ", ".join(f"{v:.3f}" for v in self._state)
            logger.info(f"SimulatedRobot step {self._step_count}: [{state_str}]")

    def disconnect(self) -> None:
        if self._connected:
            logger.info(f"SimulatedRobot disconnected after {self._step_count} steps")
            self._connected = False

    @property
    def connected(self) -> bool:
        return self._connected
