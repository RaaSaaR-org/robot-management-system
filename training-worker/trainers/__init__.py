"""Pluggable trainer backends for NeoDEM training jobs."""

from .base import BaseTrainer, TrainerContext, ProgressEvent
from .stub import StubTrainer

__all__ = ["BaseTrainer", "TrainerContext", "ProgressEvent", "StubTrainer"]
