"""
@file base.py
@description Abstract base class for VLA model backends.

All model implementations must subclass VLAModel and implement
load / predict / reset / info.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field


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
