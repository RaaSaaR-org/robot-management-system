"""TTS engine contract. Engines are synchronous; the pipeline runs them in
a worker thread. Keeping this seam allows swapping Piper (GPL, CPU) for
e.g. Qwen3-TTS (Apache, GPU) with a single config change."""

from __future__ import annotations

from abc import ABC, abstractmethod


class TTSEngine(ABC):
    @abstractmethod
    def load(self) -> None:
        """Heavyweight init (model/voice loading + downloads). Called once."""

    @abstractmethod
    def synthesize(self, text: str, language: str) -> tuple[bytes, int]:
        """Return (mono s16le PCM, native sample rate)."""
