"""
@file stub.py
@description Stub inference engine that produces sine-wave trajectories
    without requiring torch, LeRobot, or any ML dependencies.
@feature smolvla-server
"""

import logging
import math
import time
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class InferenceResult:
    """Mirrors inference.InferenceResult without importing torch."""

    actions: list[list[float]]
    inference_time_ms: float


# Per-joint sine-wave parameters for a realistic SO-101 resting pose
# Joint order: shoulder_pan, shoulder_lift, elbow, wrist_pitch, wrist_roll, gripper
_OFFSETS = [0.0, -0.5, 1.0, -0.3, 0.0, 0.5]  # resting pose (radians)
_AMPLITUDES = [0.20, 0.30, 0.25, 0.15, 0.35, 0.40]  # conservative swing
_FREQUENCIES = [0.10, 0.15, 0.20, 0.30, 0.50, 0.70]  # Hz


class StubInferenceEngine:
    """Drop-in replacement for SmolVLAInferenceEngine that generates
    smooth sine-wave trajectories for testing without ML dependencies."""

    def __init__(self, **kwargs):
        self._step = 0
        self._loaded = False
        self._action_dim = 6
        self._chunk_size = 10
        self._state_dim = 6
        self._camera_names = ["front"]

    def load(self) -> None:
        """No-op — nothing to load."""
        self._loaded = True
        logger.info("StubInferenceEngine loaded (no ML dependencies)")

    @property
    def policy(self):
        """Return a truthy sentinel when loaded, None otherwise."""
        return self._loaded or None

    @property
    def action_dim(self) -> int:
        return self._action_dim

    @property
    def chunk_size(self) -> int:
        return self._chunk_size

    @property
    def state_dim(self) -> int:
        return self._state_dim

    @property
    def camera_names(self) -> list[str]:
        return list(self._camera_names)

    def predict(
        self, images: dict[str, str], state: list[float], task: str
    ) -> InferenceResult:
        """Generate a chunk of sine-wave actions.

        Each joint follows:
            value = offset[j] + amplitude[j] * sin(2*pi*freq[j]*t + j*0.5)

        where t advances by 1/30 per action step (simulating 30 Hz control).
        """
        t_start = time.perf_counter()
        actions: list[list[float]] = []

        for i in range(self._chunk_size):
            t = (self._step + i) / 30.0  # seconds at 30 Hz
            action = []
            for j in range(self._action_dim):
                value = _OFFSETS[j] + _AMPLITUDES[j] * math.sin(
                    2.0 * math.pi * _FREQUENCIES[j] * t + j * 0.5
                )
                action.append(value)
            actions.append(action)

        self._step += self._chunk_size
        inference_time_ms = (time.perf_counter() - t_start) * 1000

        return InferenceResult(actions=actions, inference_time_ms=inference_time_ms)

    def reset(self) -> None:
        """Reset step counter to restart the trajectory."""
        self._step = 0
        logger.info("StubInferenceEngine reset")
