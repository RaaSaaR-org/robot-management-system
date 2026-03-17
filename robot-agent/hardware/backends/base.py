"""
@file base.py
@description Abstract base class for VLA inference backends.
@feature hardware/backends

All concrete backends must implement connect(), predict(), disconnect(),
and the is_connected property. This allows vla_runner.py to delegate
HTTP/gRPC/other transport to a swappable backend without changing
the control loop logic.
"""

from abc import ABC, abstractmethod

import numpy as np


class VLABackend(ABC):
    """Abstract base class for VLA inference backends."""

    @abstractmethod
    def connect(self, server_url: str, config: dict | None = None) -> None:
        """Connect to the VLA inference server.

        Args:
            server_url: Base URL of the inference server (e.g. "http://host:8000").
            config: Optional backend-specific configuration.

        Raises:
            ConnectionError: If the server is not reachable.
        """
        ...

    @abstractmethod
    def predict(
        self,
        images: dict[str, np.ndarray],
        state: np.ndarray,
        prompt: str,
    ) -> list[np.ndarray]:
        """Send observation and return action vectors.

        Args:
            images: Camera name -> image array (RGB, HWC uint8 or base64 str).
            state: Current joint state vector.
            prompt: Natural-language task instruction.

        Returns:
            List of action vectors (one per timestep in the chunk).

        Raises:
            RuntimeError: If prediction fails.
        """
        ...

    @abstractmethod
    def disconnect(self) -> None:
        """Clean up connection resources."""
        ...

    @property
    @abstractmethod
    def is_connected(self) -> bool:
        """Whether the backend is currently connected."""
        ...
