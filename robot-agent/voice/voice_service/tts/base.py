"""TTS engine contract. Engines are synchronous; the pipeline runs them in
a worker thread. Keeping this seam allows swapping Piper (GPL, CPU) for
e.g. Qwen3-TTS (Apache, GPU) with a single config change.

An engine backs one or more *voice packs* (see registry.py); the pack id it is
asked for rides along on `synthesize()` so an engine that serves several packs
can tell them apart."""

from __future__ import annotations

from abc import ABC, abstractmethod


class TTSEngine(ABC):
    @abstractmethod
    def load(self) -> None:
        """Heavyweight init (model/voice loading + downloads). Called once."""

    @abstractmethod
    def synthesize(
        self, text: str, language: str, voice: str | None = None
    ) -> tuple[bytes, int]:
        """Return (mono s16le PCM, native sample rate).

        `voice` is the resolved pack id, or None for the engine's own default.
        Language and voice are independent axes: an engine is asked to render
        this text in this pack's voice, whatever language the text is in.
        """

    def prepare(self, text: str, language: str) -> str:
        """Rewrite text after tts_normalize() and before synthesize().

        Identity by default, so engines that need nothing are unaffected. It
        exists for voices whose written form is not what the agent writes —
        dialect rules, a corpus orthography — which have to happen after
        markdown is stripped and before the model sees the text.
        """
        return text
