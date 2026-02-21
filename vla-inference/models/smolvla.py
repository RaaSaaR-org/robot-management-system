"""
@file smolvla.py
@description SmolVLA model implementation using LeRobot
@feature vla-inference

Real VLA model backend that loads SmolVLA weights via LeRobot's policy API.
Unlike the CPU stubs (pi0, openvla, groot), this loads actual model weights
and runs real inference on MPS/CUDA/CPU.

Adapted from: temp/smolvla-remote/server/src/smolvla_server/inference.py
"""

import base64
import gc
import io
import logging
import time
from typing import List, Optional

import numpy as np
import torch
from PIL import Image

from .base import (
    VLAModel,
    ModelInfo,
    Observation,
    Action,
    ActionChunk,
)

logger = logging.getLogger(__name__)

# SmolVLA model constants
ACTION_DIM = 6        # 6 DOF (SO-101 arm joints)
CHUNK_SIZE = 10       # Actions per prediction chunk
IMAGE_SIZE = 224      # Expected input image resolution
STATE_DIM = 6         # Joint state dimensionality
BASE_MODEL = "smolvla"
SUPPORTED_EMBODIMENTS = ["so101_arm", "so101"]


class SmolVLAModel(VLAModel):
    """
    SmolVLA Vision-Language-Action model via LeRobot.

    Loads real SmolVLA weights and runs inference using LeRobot's policy API.
    Supports MPS (Apple Silicon), CUDA, and CPU devices.
    """

    MODEL_NAME = "smolvla"
    MODEL_VERSION = "1.0.0"

    def __init__(self):
        self._loaded = False
        self._device = "cpu"
        self._checkpoint_path = None
        self._sequence_counter = 0
        self._policy = None
        self._action_dim = ACTION_DIM
        self._chunk_size = CHUNK_SIZE
        self._state_dim = STATE_DIM

    def load(self, checkpoint_path: Optional[str] = None, device: str = "cpu") -> None:
        """
        Load SmolVLA model weights via LeRobot.

        Uses multi-pattern fallback for LeRobot API compatibility:
        - Pattern A: Direct SmolVLAPolicy.from_pretrained()
        - Pattern B: Factory-based make_policy()

        Args:
            checkpoint_path: HuggingFace repo ID or local path
                (defaults to "lerobot/smolvla_base")
            device: Target device ("cpu", "cuda", "mps")
        """
        if self._loaded:
            logger.warning("SmolVLA model already loaded, skipping")
            return

        model_path = checkpoint_path or "lerobot/smolvla_base"
        logger.info(f"Loading SmolVLA model from: {model_path}")
        logger.info(f"Target device: {device}")

        # Pattern A: Direct import (most likely for SmolVLA)
        try:
            from lerobot.common.policies.smolvla.modeling_smolvla import SmolVLAPolicy

            self._policy = SmolVLAPolicy.from_pretrained(model_path)
        except (ImportError, AttributeError):
            # Pattern B: Factory-based loading
            try:
                from lerobot.common.policies.factory import make_policy

                self._policy = make_policy(type="smolvla", pretrained_path=model_path)
            except (ImportError, AttributeError) as e:
                raise RuntimeError(
                    f"Could not load SmolVLA policy. Tried direct import and factory. "
                    f"Check LeRobot version and API. Error: {e}"
                ) from e

        self._policy.to(device)
        self._policy.eval()

        # Extract model dimensions from config
        try:
            config = self._policy.config
            self._action_dim = getattr(
                config, "action_dim",
                getattr(config, "output_shapes", {}).get("action", [ACTION_DIM])[0]
                if hasattr(config, "output_shapes") else ACTION_DIM
            )
            self._chunk_size = getattr(
                config, "chunk_size",
                getattr(config, "n_action_steps", CHUNK_SIZE)
            )
            self._state_dim = getattr(
                config, "state_dim",
                getattr(config, "input_shapes", {}).get("observation.state", [STATE_DIM])[0]
                if hasattr(config, "input_shapes") else STATE_DIM
            )
        except Exception:
            logger.warning("Could not read model config dims, using SO-101 defaults")
            self._action_dim = ACTION_DIM
            self._chunk_size = CHUNK_SIZE
            self._state_dim = STATE_DIM

        self._checkpoint_path = model_path
        self._device = device
        self._loaded = True
        self._sequence_counter = 0

        logger.info(
            f"SmolVLA model loaded. action_dim={self._action_dim}, "
            f"chunk_size={self._chunk_size}, state_dim={self._state_dim}"
        )

    def predict(self, observation: Observation) -> ActionChunk:
        """
        Run inference on a single observation.

        Converts gRPC Observation to LeRobot observation dict format,
        runs policy.select_action(), and converts output to ActionChunk.
        """
        self._check_loaded()

        start_time = time.perf_counter()

        # Build LeRobot observation dict
        obs = self._build_observation(observation)

        # Run inference
        with torch.no_grad():
            action = self._policy.select_action(obs)

        # Convert action tensor to numpy
        if isinstance(action, torch.Tensor):
            action_np = action.cpu().numpy()
        elif isinstance(action, np.ndarray):
            action_np = action
        else:
            action_np = np.array(action)

        # Ensure 2D: (chunk_size, action_dim)
        if action_np.ndim == 1:
            action_np = action_np.reshape(1, -1)

        inference_time_ms = (time.perf_counter() - start_time) * 1000
        self._sequence_counter += 1

        # Convert to Action list
        actions = []
        base_time = observation.timestamp
        dt = 1.0 / 30.0  # 30Hz control frequency
        for i, action_vec in enumerate(action_np):
            # Split: first N-1 values are joint commands, last is gripper
            if len(action_vec) > 1:
                joint_commands = action_vec[:-1].tolist()
                gripper_command = float(action_vec[-1])
            else:
                joint_commands = action_vec.tolist()
                gripper_command = 0.0

            actions.append(Action(
                joint_commands=joint_commands,
                gripper_command=gripper_command,
                timestamp=base_time + (i + 1) * dt,
            ))

        return ActionChunk(
            actions=actions,
            inference_time_ms=inference_time_ms,
            model_version=self.MODEL_VERSION,
            confidence=self._calculate_confidence(observation),
            sequence_number=self._sequence_counter,
        )

    def predict_batch(self, observations: List[Observation]) -> List[ActionChunk]:
        """
        Run batched inference.

        Processes sequentially — SmolVLA is typically used for single-robot
        real-time control rather than fleet-scale batching.
        """
        self._check_loaded()
        return [self.predict(obs) for obs in observations]

    def unload(self) -> None:
        """Release model and clear GPU/MPS memory."""
        if not self._loaded:
            return

        logger.info("Unloading SmolVLA model")

        del self._policy
        self._policy = None
        self._loaded = False
        self._sequence_counter = 0

        # Clear GPU/MPS memory
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        if hasattr(torch, "mps") and hasattr(torch.mps, "empty_cache"):
            torch.mps.empty_cache()
        gc.collect()

        logger.info("SmolVLA model unloaded")

    @property
    def model_info(self) -> ModelInfo:
        """Return SmolVLA model metadata."""
        return ModelInfo(
            model_name=self.MODEL_NAME,
            model_version=self.MODEL_VERSION,
            action_dim=self._action_dim,
            chunk_size=self._chunk_size,
            supported_embodiments=SUPPORTED_EMBODIMENTS,
            image_width=IMAGE_SIZE,
            image_height=IMAGE_SIZE,
            base_model=BASE_MODEL,
        )

    @property
    def chunk_size(self) -> int:
        """Number of actions per chunk."""
        return self._chunk_size

    def _build_observation(self, observation: Observation) -> dict:
        """Convert gRPC Observation to LeRobot observation dict.

        Mapping:
            observation.camera_image (JPEG bytes) -> tensor (C,H,W) -> obs["observation.images.front"]
            observation.joint_positions (float list) -> tensor -> obs["observation.state"]
            observation.language_instruction -> obs["task"]
        """
        obs = {}

        # Process camera image: JPEG bytes -> PIL -> tensor (C, H, W)
        if observation.camera_image:
            pil_image = Image.open(io.BytesIO(observation.camera_image)).convert("RGB")
            img_array = np.array(pil_image, dtype=np.float32) / 255.0  # (H, W, C) normalized
            img_tensor = torch.from_numpy(img_array).permute(2, 0, 1)  # (3, H, W)
            obs["observation.images.front"] = img_tensor.to(self._device)

        # Process joint state
        state = observation.joint_positions[:self._state_dim]
        if len(state) < self._state_dim:
            state = list(state) + [0.0] * (self._state_dim - len(state))
        state_tensor = torch.tensor(state, dtype=torch.float32)
        obs["observation.state"] = state_tensor.to(self._device)

        # Task description (language conditioning)
        obs["task"] = observation.language_instruction or ""

        return obs

    def _calculate_confidence(self, observation: Observation) -> float:
        """Calculate prediction confidence based on embodiment support."""
        if observation.embodiment_tag in SUPPORTED_EMBODIMENTS:
            return 0.95
        return 0.6
