"""
@file base.py
@description Abstract base class for VLA model backends.

All model implementations must subclass VLAModel and implement
load / predict / reset / info.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any


@dataclass
class ModelConfig:
    """Model configuration returned by /config."""

    action_dim: int
    chunk_size: int
    cameras: list[str]
    state_dim: int


@dataclass
class PredictResult:
    """Output of a single inference call."""

    actions: list[list[float]]
    inference_time_ms: float


class VLAModel(ABC):
    """Abstract base for all VLA model backends (SmolVLA, pi0.5, ...)."""

    @abstractmethod
    def load(self) -> None:
        """Load model weights onto the configured device."""

    @abstractmethod
    def predict(
        self,
        images: dict[str, str],
        state: list[float],
        task: str,
    ) -> PredictResult:
        """Run inference on a single observation.

        Args:
            images: camera_name -> base64-encoded JPEG string
            state: Current joint positions
            task: Natural-language instruction

        Returns:
            PredictResult with action chunk and timing.
        """

    @abstractmethod
    def reset(self) -> None:
        """Reset internal state between episodes."""

    @abstractmethod
    def info(self) -> ModelConfig:
        """Return model configuration / metadata."""

    @property
    @abstractmethod
    def is_loaded(self) -> bool:
        """Whether the model is loaded and ready."""

    def load_adapter(self, adapter_path: str, adapter_id: str | None = None) -> dict[str, Any]:
        """Hot-swap a LoRA adapter on top of the loaded base model.

        Backends that don't support hot-swap must raise NotImplementedError.

        Args:
            adapter_path: s3:// URI, local directory, or .tar.gz path
            adapter_id: caller-supplied identifier (e.g. modelVersionId);
                backends use it as the PEFT adapter name when registering.

        Returns:
            Dict with at minimum: {adapter_id, info}
        """
        raise NotImplementedError(
            f"{self.__class__.__name__} does not support adapter hot-swap"
        )

    @property
    def active_adapter_id(self) -> str | None:
        """Currently loaded adapter identifier (None if no adapter)."""
        return None
