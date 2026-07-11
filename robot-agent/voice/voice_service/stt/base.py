"""STT engine contract. Engines are synchronous; the pipeline runs them in
a worker thread guarded by a GPU lock."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass(slots=True)
class Transcript:
    text: str
    language: str  # resolved to one of config.languages
    avg_logprob: float
    duration_s: float


class STTEngine(ABC):
    @abstractmethod
    def load(self) -> None:
        """Heavyweight init (model download/load + warmup). Called once."""

    @abstractmethod
    def transcribe(self, pcm_16k: bytes, language: str | None = None) -> Transcript:
        """Transcribe 16 kHz mono s16le PCM."""
