"""Backend registry for the neural-trajectory generator (TASK-182).

A backend turns one episode spec (prompt, seed) into on-disk artifacts inside
the episode's job dir:

  video.mp4          the neural-trajectory rollout video (real, decodable mp4)
  trajectory.json    per-frame 28-dim state/action arrays (IDM pseudo-labels)

and returns ``{"nframes": int, "width": int, "height": int}``.
"""
from __future__ import annotations

from ..errors import NeuralTrajError


def get_backend(name: str):
    """Instantiate a backend by name (``mock`` or ``wsl``)."""
    if name == "mock":
        from .mock import MockBackend

        return MockBackend()
    if name == "wsl":
        from .wsl import WslBackend

        return WslBackend()
    raise NeuralTrajError(f"unknown backend '{name}' (expected 'mock' or 'wsl')")
