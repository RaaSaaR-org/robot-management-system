"""
@file smolvla.py
@description SmolVLA model backend via LeRobot.

Loads a SmolVLA policy checkpoint and runs inference.
Supports MPS (Apple Silicon), CUDA, and CPU devices.

Ported from smolvla-server/src/smolvla_server/inference.py and
vla-inference/models/smolvla.py — consolidated into one implementation.
"""

import base64
import gc
import io
import logging
import time

import numpy as np
import torch
from PIL import Image

from .base import ModelConfig, PredictResult, VLAModel

logger = logging.getLogger(__name__)

# SO-101 defaults
ACTION_DIM = 6
CHUNK_SIZE = 10
STATE_DIM = 6


class SmolVLAModel(VLAModel):
    """SmolVLA via LeRobot policy API."""

    def __init__(self, model_path: str = "lerobot/smolvla_base", device: str = "cpu"):
        self.model_path = model_path
        self.device = device
        self.policy = None
        self._action_dim = ACTION_DIM
        self._chunk_size = CHUNK_SIZE
        self._state_dim = STATE_DIM

    def load(self) -> None:
        if self.policy is not None:
            logger.warning("SmolVLA already loaded, skipping")
            return

        logger.info(f"Loading SmolVLA from {self.model_path} on {self.device}")

        # Pattern A: lerobot >= 0.4 (policies moved to lerobot.policies.*)
        try:
            from lerobot.policies.smolvla.modeling_smolvla import SmolVLAPolicy

            self.policy = SmolVLAPolicy.from_pretrained(self.model_path)
        except (ImportError, AttributeError):
            # Pattern B: lerobot < 0.4 (lerobot.common.policies.*)
            try:
                from lerobot.common.policies.smolvla.modeling_smolvla import SmolVLAPolicy as SmolVLAPolicyLegacy

                self.policy = SmolVLAPolicyLegacy.from_pretrained(self.model_path)
            except (ImportError, AttributeError) as e:
                raise RuntimeError(
                    f"Could not load SmolVLA. Tried lerobot.policies and lerobot.common.policies. "
                    f"Check LeRobot installation. Error: {e}"
                ) from e

        self.policy.to(self.device)
        self.policy.eval()

        # Extract dimensions from config
        try:
            cfg = self.policy.config
            self._action_dim = getattr(
                cfg,
                "action_dim",
                getattr(cfg, "output_shapes", {}).get("action", [ACTION_DIM])[0]
                if hasattr(cfg, "output_shapes")
                else ACTION_DIM,
            )
            self._chunk_size = getattr(
                cfg, "chunk_size", getattr(cfg, "n_action_steps", CHUNK_SIZE)
            )
            self._state_dim = getattr(
                cfg,
                "state_dim",
                getattr(cfg, "input_shapes", {}).get("observation.state", [STATE_DIM])[0]
                if hasattr(cfg, "input_shapes")
                else STATE_DIM,
            )
        except Exception:
            logger.warning("Could not read model config dims, using SO-101 defaults")

        logger.info(
            f"SmolVLA loaded: action_dim={self._action_dim}, "
            f"chunk_size={self._chunk_size}, state_dim={self._state_dim}"
        )

    def predict(
        self,
        images: dict[str, str],
        state: list[float],
        task: str,
    ) -> PredictResult:
        if self.policy is None:
            raise RuntimeError("Model not loaded. Call load() first.")

        t_start = time.perf_counter()
        obs = self._build_observation(images, state, task)

        with torch.no_grad():
            action = self.policy.select_action(obs)

        if isinstance(action, torch.Tensor):
            action_np = action.cpu().numpy()
        elif isinstance(action, np.ndarray):
            action_np = action
        else:
            action_np = np.array(action)

        if action_np.ndim == 1:
            action_np = action_np.reshape(1, -1)

        inference_time_ms = (time.perf_counter() - t_start) * 1000
        return PredictResult(actions=action_np.tolist(), inference_time_ms=inference_time_ms)

    def reset(self) -> None:
        if self.policy is not None and hasattr(self.policy, "reset"):
            self.policy.reset()

    def info(self) -> ModelConfig:
        cameras = ["front"]
        if self.policy is not None:
            try:
                # LeRobot 0.4+: cfg.image_features is a dict keyed by
                # "observation.images.<camera>" → PolicyFeature(...)
                cfg = self.policy.config
                if hasattr(cfg, "image_features") and cfg.image_features:
                    cameras = [
                        k.replace("observation.images.", "")
                        for k in cfg.image_features
                        if k.startswith("observation.images.")
                    ]
                elif hasattr(cfg, "camera_names"):
                    cameras = list(cfg.camera_names)
                elif hasattr(cfg, "input_shapes"):
                    cameras = [
                        k.replace("observation.images.", "")
                        for k in cfg.input_shapes
                        if k.startswith("observation.images.")
                    ]
            except Exception:
                pass
        return ModelConfig(
            action_dim=self._action_dim,
            chunk_size=self._chunk_size,
            cameras=cameras,
            state_dim=self._state_dim,
        )

    @property
    def is_loaded(self) -> bool:
        return self.policy is not None

    def unload(self) -> None:
        """Release model and clear GPU/MPS memory."""
        if self.policy is None:
            return
        logger.info("Unloading SmolVLA")
        del self.policy
        self.policy = None
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        if hasattr(torch, "mps") and hasattr(torch.mps, "empty_cache"):
            torch.mps.empty_cache()
        gc.collect()

    def _build_observation(
        self, images: dict[str, str], state: list[float], task: str
    ) -> dict:
        """Convert raw inputs to LeRobot observation dict.

        If the model expects more cameras than provided (e.g. 3 cameras but only
        1 available on the robot), the single image is duplicated into all slots.
        """
        # Auto-expand: if model needs specific camera keys, remap / duplicate
        # LeRobot 0.4+: camera names live in policy.config.image_features
        _img_features = (
            getattr(getattr(self.policy, "config", None), "image_features", None) or {}
        )
        if self.policy is not None and _img_features:
            expected = [
                k.replace("observation.images.", "")
                for k in _img_features
                if k.startswith("observation.images.")
            ]
            if expected:
                provided_vals = list(images.values())
                if provided_vals:
                    images = {
                        cam: provided_vals[i % len(provided_vals)]
                        for i, cam in enumerate(expected)
                    }

        obs: dict = {}
        for camera_name, b64_jpeg in images.items():
            jpeg_bytes = base64.b64decode(b64_jpeg)
            pil_image = Image.open(io.BytesIO(jpeg_bytes)).convert("RGB")
            img_array = np.array(pil_image, dtype=np.float32) / 255.0
            img_tensor = torch.from_numpy(img_array).permute(2, 0, 1)
            obs[f"observation.images.{camera_name}"] = img_tensor.to(self.device)

        state_padded = list(state)
        if len(state_padded) < self._state_dim:
            state_padded += [0.0] * (self._state_dim - len(state_padded))
        obs["observation.state"] = torch.tensor(
            state_padded[: self._state_dim], dtype=torch.float32
        ).to(self.device)
        obs["task"] = task
        return obs
