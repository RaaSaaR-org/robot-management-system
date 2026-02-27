"""
@file groot.py
@description GR00T N1 model backend for vla-server.

Connects to Isaac-GR00T policy server via ZMQ (port 5555).
Stub mode: returns sine-wave actions when ZMQ server is unavailable.

Protocol:
- Server: gr00t.policy.server_client PolicyServer (port 5555)
- Observation keys: video.front, state.single_arm, state.gripper, annotation
- Action keys: action.single_arm (h,5), action.gripper (h,1)
- Action horizon: 16 steps (configurable)
"""

import base64
import io
import logging
import math
import time

import numpy as np
from PIL import Image

from .base import ModelConfig, PredictResult, VLAModel

logger = logging.getLogger(__name__)

# SO-101 defaults
ACTION_DIM = 6  # 5 arm joints + 1 gripper
CHUNK_SIZE = 16  # GR00T action horizon
STATE_DIM = 6
IMAGE_SIZE = 224


class GR00TModel(VLAModel):
    """GR00T N1 policy via ZMQ TCP connection to Isaac-GR00T server.

    In stub mode, returns sine-wave actions without any ZMQ or ML deps.
    """

    def __init__(
        self,
        host: str = "localhost",
        port: int = 5555,
        stub: bool = False,
    ):
        self.host = host
        self.port = port
        self.stub = stub
        self._socket = None
        self._zmq_ctx = None
        self._loaded = False
        self._step = 0

    def load(self) -> None:
        if self._loaded:
            logger.warning("GR00TModel already loaded, skipping")
            return

        if self.stub:
            logger.info("GR00TModel loaded (stub mode — sine-wave actions)")
            self._loaded = True
            return

        try:
            import zmq
        except ImportError:
            raise ImportError(
                "pyzmq required for GR00T backend: pip install pyzmq"
            )

        try:
            self._zmq_ctx = zmq.Context()
            self._socket = self._zmq_ctx.socket(zmq.REQ)
            self._socket.connect(f"tcp://{self.host}:{self.port}")
            self._socket.setsockopt(zmq.RCVTIMEO, 5000)  # 5s timeout
            self._socket.setsockopt(zmq.SNDTIMEO, 5000)
        except Exception as e:
            raise RuntimeError(
                f"Cannot connect to GR00T server at {self.host}:{self.port}: {e}"
            )

        self._loaded = True
        logger.info(
            f"GR00TModel loaded: ZMQ -> tcp://{self.host}:{self.port}"
        )

    def predict(
        self,
        images: dict[str, str],
        state: list[float],
        task: str,
    ) -> PredictResult:
        if not self._loaded:
            raise RuntimeError("Model not loaded. Call load() first.")

        t_start = time.perf_counter()

        if self.stub:
            actions = self._stub_predict(state)
        else:
            actions = self._zmq_predict(images, state, task)

        inference_time_ms = (time.perf_counter() - t_start) * 1000
        return PredictResult(actions=actions, inference_time_ms=inference_time_ms)

    def reset(self) -> None:
        self._step = 0
        if self._socket is not None and not self.stub:
            try:
                import msgpack

                self._socket.send(msgpack.packb({"reset": True}, use_bin_type=True))
                self._socket.recv()  # consume response
            except Exception:
                pass  # reset is best-effort

    def info(self) -> ModelConfig:
        return ModelConfig(
            action_dim=ACTION_DIM,
            chunk_size=CHUNK_SIZE,
            cameras=["front"],
            state_dim=STATE_DIM,
        )

    @property
    def is_loaded(self) -> bool:
        return self._loaded

    # ── ZMQ inference ────────────────────────────────────────────

    def _zmq_predict(
        self,
        images: dict[str, str],
        state: list[float],
        task: str,
    ) -> list[list[float]]:
        """Run inference via GR00T policy server over ZMQ."""
        import msgpack
        import msgpack_numpy as m

        m.patch()

        obs = self._build_observation(images, state, task)

        try:
            self._socket.send(msgpack.packb(obs, use_bin_type=True))
            raw = self._socket.recv()
            result = msgpack.unpackb(raw, raw=False)
        except Exception as e:
            raise RuntimeError(f"GR00T inference failed: {e}")

        # Parse GR00T action format
        arm_actions = result.get("action.single_arm", [])
        gripper_actions = result.get("action.gripper", [])
        return self._combine_actions(arm_actions, gripper_actions)

    # ── Observation building ─────────────────────────────────────

    @staticmethod
    def _build_observation(
        images: dict[str, str],
        state: list[float],
        task: str,
    ) -> dict:
        """Convert vla-server format to GR00T observation dict."""
        obs: dict = {}

        # Front camera -> video.front (224x224 RGB uint8 numpy)
        if "front" in images:
            img_bytes = base64.b64decode(images["front"])
            img = (
                Image.open(io.BytesIO(img_bytes))
                .convert("RGB")
                .resize((IMAGE_SIZE, IMAGE_SIZE))
            )
            obs["video.front"] = np.array(img, dtype=np.uint8)

        # State: SO-101 has 6 joints -> first 5 = arm, last 1 = gripper
        if len(state) >= ACTION_DIM:
            obs["state.single_arm"] = np.array(state[:5], dtype=np.float32)
            obs["state.gripper"] = np.array([state[5]], dtype=np.float32)
        elif state:
            obs["state.single_arm"] = np.array(
                state[: min(5, len(state))], dtype=np.float32
            )
            obs["state.gripper"] = np.array([0.0], dtype=np.float32)

        obs["annotation.human.task_description"] = task
        return obs

    @staticmethod
    def _combine_actions(
        arm: list | np.ndarray,
        gripper: list | np.ndarray,
    ) -> list[list[float]]:
        """Combine arm (h,5) + gripper (h,1) into (h,6) SO-101 actions."""
        arm_arr = np.array(arm)
        grip_arr = np.array(gripper)

        if arm_arr.ndim == 1:
            arm_arr = arm_arr.reshape(1, -1)
        if grip_arr.ndim == 1:
            grip_arr = grip_arr.reshape(-1, 1)

        # SO-101: [shoulder_pan, shoulder_lift, elbow_flex, wrist_flex, wrist_roll, gripper]
        combined = np.concatenate([arm_arr, grip_arr], axis=1)
        return combined[:, :ACTION_DIM].tolist()

    # ── Stub ─────────────────────────────────────────────────────

    def _stub_predict(self, state: list[float]) -> list[list[float]]:
        """Stub: returns gentle sine-wave actions for testing."""
        actions: list[list[float]] = []
        for i in range(CHUNK_SIZE):
            t = (self._step + i) / 30.0
            action = [
                (state[j] if j < len(state) else 0.0)
                + 2.0 * math.sin(2.0 * math.pi * 0.1 * t + j * 0.5)
                for j in range(ACTION_DIM)
            ]
            actions.append(action)
        self._step += CHUNK_SIZE
        return actions
