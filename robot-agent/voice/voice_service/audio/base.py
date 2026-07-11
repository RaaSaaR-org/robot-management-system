"""Audio backend contracts — the robot-agnostic seam of the voice service.

Any robot (or the local PC) is supported by implementing these two classes:
AudioInput delivers 16 kHz mono s16le PCM in 512-sample frames; AudioOutput
plays arbitrary-rate mono s16le PCM. Backends: local (sounddevice),
g1 (Unitree multicast mic / AudioClient speaker adapter).
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import AsyncIterator

from ..config import FRAME_BYTES, FRAME_SAMPLES, PIPELINE_SAMPLE_RATE

__all__ = ["AudioInput", "AudioOutput", "FRAME_BYTES", "FRAME_SAMPLES", "PIPELINE_SAMPLE_RATE"]


class AudioInput(ABC):
    """Microphone source yielding fixed 32 ms pipeline frames."""

    @abstractmethod
    async def start(self) -> None: ...

    @abstractmethod
    async def stop(self) -> None: ...

    @abstractmethod
    def frames(self) -> AsyncIterator[bytes]:
        """Yield FRAME_BYTES-sized 16 kHz mono s16le frames until stopped."""

    @abstractmethod
    def set_muted(self, muted: bool) -> None:
        """Half-duplex gate. Muting drops frames at the source (no buffering)."""


class AudioOutput(ABC):
    """Speaker sink for mono s16le PCM at a given sample rate."""

    @abstractmethod
    async def play(self, pcm: bytes, sample_rate: int) -> None:
        """Play to completion (or until cancel()); returns when audio ended."""

    @abstractmethod
    async def cancel(self) -> None:
        """Stop playback immediately."""
