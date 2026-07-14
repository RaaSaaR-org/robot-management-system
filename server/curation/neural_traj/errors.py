"""Error types for the neural-trajectory generator (TASK-182)."""
from __future__ import annotations


class NeuralTrajError(RuntimeError):
    """Raised for clean, user-facing generator failures (bad backend, stub)."""
