"""SmolVLA model loading and inference.

This module wraps LeRobot's policy loading to serve predictions over HTTP.

IMPORTANT FOR IMPLEMENTER:
    The LeRobot policy API may evolve. The key integration points to verify are:
    1. How to instantiate a SmolVLA policy from a pretrained path
    2. The exact observation dict format the policy expects
    3. How to call forward/select_action and extract the action tensor

    Check these LeRobot source files for the current API:
    - lerobot/common/policies/smolvla/modeling_smolvla.py
    - lerobot/scripts/eval.py (how eval loads and calls policies)
    - lerobot/scripts/control_robot.py (how real-time inference works)
"""

import base64
import io
import logging
import time
from dataclasses import dataclass

import numpy as np
import torch
from PIL import Image

logger = logging.getLogger(__name__)


@dataclass
class InferenceResult:
    actions: list[list[float]]
    inference_time_ms: float


class SmolVLAInferenceEngine:
    """Loads SmolVLA and runs inference on observation dicts."""

    def __init__(self, model_path: str, device: str = "mps"):
        self.model_path = model_path
        self.device = device
        self.policy = None
        self._action_dim: int = 0
        self._chunk_size: int = 0
        self._state_dim: int = 0

    def load(self) -> None:
        """Load the SmolVLA policy from a pretrained checkpoint.

        Uses multi-pattern fallback for LeRobot API compatibility:
        - Pattern A: Direct SmolVLAPolicy.from_pretrained()
        - Pattern B: Factory-based make_policy()
        """
        logger.info(f"Loading SmolVLA model from: {self.model_path}")
        logger.info(f"Target device: {self.device}")

        # Pattern A: Direct import (most likely for SmolVLA)
        try:
            from lerobot.common.policies.smolvla.modeling_smolvla import SmolVLAPolicy

            self.policy = SmolVLAPolicy.from_pretrained(self.model_path)
        except (ImportError, AttributeError):
            # Pattern B: Factory-based loading
            try:
                from lerobot.common.policies.factory import make_policy

                self.policy = make_policy(type="smolvla", pretrained_path=self.model_path)
            except (ImportError, AttributeError) as e:
                raise RuntimeError(
                    f"Could not load SmolVLA policy. Tried direct import and factory. "
                    f"Check LeRobot version and API. Error: {e}"
                ) from e

        self.policy.to(self.device)
        self.policy.eval()

        # Extract model dimensions from config
        try:
            config = self.policy.config
            self._action_dim = getattr(
                config, "action_dim",
                getattr(config, "output_shapes", {}).get("action", [6])[0]
                if hasattr(config, "output_shapes") else 6
            )
            self._chunk_size = getattr(
                config, "chunk_size",
                getattr(config, "n_action_steps", 10)
            )
            self._state_dim = getattr(
                config, "state_dim",
                getattr(config, "input_shapes", {}).get("observation.state", [6])[0]
                if hasattr(config, "input_shapes") else 6
            )
        except Exception:
            # Fallback defaults for SO-101 (6 DOF)
            logger.warning("Could not read model config dims, using SO-101 defaults")
            self._action_dim = 6
            self._chunk_size = 10
            self._state_dim = 6

        logger.info(
            f"Model loaded. action_dim={self._action_dim}, "
            f"chunk_size={self._chunk_size}, state_dim={self._state_dim}"
        )

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
        """Return expected camera names from the policy config."""
        try:
            config = self.policy.config
            # Try direct attribute
            if hasattr(config, "camera_names"):
                return list(config.camera_names)
            # Try extracting from input_shapes
            if hasattr(config, "input_shapes"):
                return [
                    k.replace("observation.images.", "")
                    for k in config.input_shapes
                    if k.startswith("observation.images.")
                ]
        except Exception:
            pass
        return ["front"]  # Default for single-camera SO-101 setup

    def predict(self, images: dict[str, str], state: list[float], task: str) -> InferenceResult:
        """Run inference on a single observation.

        Args:
            images: Dict of camera_name -> base64-encoded JPEG string
            state: Current joint positions as float list
            task: Natural language task description

        Returns:
            InferenceResult with action chunk and timing info
        """
        t_start = time.perf_counter()

        # Build the observation dict in the format LeRobot policies expect
        observation = self._build_observation(images, state, task)

        with torch.no_grad():
            action = self.policy.select_action(observation)

        # Convert action tensor to nested list
        if isinstance(action, torch.Tensor):
            action_np = action.cpu().numpy()
        elif isinstance(action, np.ndarray):
            action_np = action
        else:
            action_np = np.array(action)

        # Ensure 2D: (chunk_size, action_dim)
        if action_np.ndim == 1:
            action_np = action_np.reshape(1, -1)

        actions_list = action_np.tolist()
        inference_time_ms = (time.perf_counter() - t_start) * 1000

        return InferenceResult(actions=actions_list, inference_time_ms=inference_time_ms)

    def _build_observation(
        self, images: dict[str, str], state: list[float], task: str
    ) -> dict:
        """Convert raw inputs into the observation dict format LeRobot expects.

        Standard LeRobot observation dict format:
            {
                "observation.images.front": tensor (C, H, W) float32 [0, 1],
                "observation.state": tensor (state_dim,) float32,
                "task": str,
            }
        """
        obs = {}

        # Process images
        for camera_name, b64_jpeg in images.items():
            jpeg_bytes = base64.b64decode(b64_jpeg)
            pil_image = Image.open(io.BytesIO(jpeg_bytes)).convert("RGB")
            img_array = np.array(pil_image, dtype=np.float32) / 255.0  # (H, W, C) normalized

            # Convert to (C, H, W) tensor
            img_tensor = torch.from_numpy(img_array).permute(2, 0, 1)  # (3, H, W)
            obs[f"observation.images.{camera_name}"] = img_tensor.to(self.device)

        # Process joint state
        state_tensor = torch.tensor(state, dtype=torch.float32)
        obs["observation.state"] = state_tensor.to(self.device)

        # Task description
        obs["task"] = task

        return obs

    def reset(self) -> None:
        """Reset the policy's internal state between episodes."""
        if hasattr(self.policy, "reset"):
            self.policy.reset()
