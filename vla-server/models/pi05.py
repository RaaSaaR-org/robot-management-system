"""
@file pi05.py
@description pi0.5 model backend stub.

This is a placeholder for Peter's GPU server running pi0.5 via LeRobot's
async inference (gRPC policy_server). Full implementation in TASK-078.

For now, this can run in stub mode, producing sine-wave actions for testing.
"""

import logging
import math
import time

from .base import ModelConfig, PredictResult, VLAModel

logger = logging.getLogger(__name__)

# SO-101 defaults
ACTION_DIM = 6
CHUNK_SIZE = 50

# Sine-wave stub parameters (realistic resting pose)
_OFFSETS = [0.0, -0.5, 1.0, -0.3, 0.0, 0.5]
_AMPLITUDES = [0.20, 0.30, 0.25, 0.15, 0.35, 0.40]
_FREQUENCIES = [0.10, 0.15, 0.20, 0.30, 0.50, 0.70]


class Pi05Model(VLAModel):
    """pi0.5 stub — sine-wave actions, no ML dependencies.

    TODO(TASK-078): Replace with real pi0.5 LeRobot policy loading.
    """

    def __init__(self, model_path: str = "", device: str = "cpu"):
        self.model_path = model_path
        self.device = device
        self._loaded = False
        self._step = 0
        self._active_adapter_id: str | None = None

    def load(self) -> None:
        self._loaded = True
        self._step = 0
        logger.info("Pi05Model loaded (stub mode — sine-wave actions)")

    def predict(
        self,
        images: dict[str, str],
        state: list[float],
        task: str,
    ) -> PredictResult:
        if not self._loaded:
            raise RuntimeError("Model not loaded. Call load() first.")

        t_start = time.perf_counter()
        actions: list[list[float]] = []

        for i in range(CHUNK_SIZE):
            t = (self._step + i) / 30.0
            action = [
                _OFFSETS[j] + _AMPLITUDES[j] * math.sin(
                    2.0 * math.pi * _FREQUENCIES[j] * t + j * 0.5
                )
                for j in range(ACTION_DIM)
            ]
            actions.append(action)

        self._step += CHUNK_SIZE
        inference_time_ms = (time.perf_counter() - t_start) * 1000
        return PredictResult(actions=actions, inference_time_ms=inference_time_ms)

    def reset(self) -> None:
        self._step = 0

    def info(self) -> ModelConfig:
        return ModelConfig(
            action_dim=ACTION_DIM,
            chunk_size=CHUNK_SIZE,
            cameras=["front"],
            state_dim=6,
        )

    @property
    def is_loaded(self) -> bool:
        return self._loaded

    @property
    def active_adapter_id(self) -> str | None:
        return self._active_adapter_id

    def load_adapter(self, adapter_path: str, adapter_id: str | None = None) -> dict:
        """Stub adapter loader — records the id without loading any weights.

        Useful for end-to-end testing of the /load-adapter wiring without ML deps.
        """
        if not self._loaded:
            raise RuntimeError("Model not loaded; cannot apply adapter")
        name = adapter_id or f"adapter-{int(time.time() * 1000)}"
        self._active_adapter_id = name
        logger.info(f"Pi05Model: stub-loaded adapter '{name}' from {adapter_path}")
        return {
            "adapter_id": name,
            "info": {"strategy": "stub", "path": adapter_path},
        }
