"""Abstract trainer interface."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable


@dataclass
class TrainerContext:
    """Everything a trainer needs to run a job."""

    job_id: str
    dataset_id: str
    dataset_storage_path: str  # RustFS prefix (UUID without trailing slash)
    dataset_lerobot_version: str | None
    base_model: str
    fine_tune_method: str
    hyperparameters: dict[str, Any]
    device: str  # "mps" | "cuda" | "cpu"
    work_dir: Path  # scratch directory for this job
    hf_cache_dir: Path


@dataclass
class ProgressEvent:
    """One training progress snapshot."""

    step: int
    total_steps: int
    epoch: int
    total_epochs: int
    loss: float
    learning_rate: float
    accuracy: float | None = None


@dataclass
class TrainerResult:
    """What a trainer returns when training finishes successfully."""

    artifact_path: Path
    final_metrics: dict[str, Any]


class CancelledError(Exception):
    """Raised by a trainer when it detects a user-initiated cancel.
    Distinct from generic failures — the server has already marked
    the job as cancelled, so the worker should NOT POST /failed."""


# A progress callback the trainer calls every step; returns True to continue,
# False to stop (for cancellations sent via heartbeat).
ProgressCallback = Callable[[ProgressEvent], bool]


class BaseTrainer(ABC):
    """All trainers implement this interface."""

    @abstractmethod
    def train(
        self,
        ctx: TrainerContext,
        on_progress: ProgressCallback,
    ) -> TrainerResult:
        """Run the training loop.

        - Call ``on_progress`` after each step. If it returns False, stop early.
        - Return a ``TrainerResult`` with the path to the final artifact.
        - Raise any exception on failure — caller will POST /failed.
        """
        raise NotImplementedError
