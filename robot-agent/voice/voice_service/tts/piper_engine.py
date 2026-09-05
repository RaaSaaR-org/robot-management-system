"""Piper TTS engine (piper-tts 1.4.2, OHF-Voice piper1-gpl fork).

CPU real-time synthesis. One instance is **one voice**, downloaded on first
load into <models_dir>/piper/: a Piper voice is one model file, so the voice
axis is one pack per model (piper_de, piper_en — see registry.py) rather than
one engine holding a language->voice map. Note: piper-tts is GPL-3.0 — see the
licence note in voice/README.md.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from .base import TTSEngine

if TYPE_CHECKING:  # config imports the registry, which imports this lazily
    from ..config import VoiceConfig

PIPER_DEFAULT_RATE = 22_050


class PiperEngine(TTSEngine):
    def __init__(self, config: VoiceConfig, voice_name: str | None = None) -> None:
        self.config = config
        # A bare PiperEngine(config) still works for the dev scripts under
        # scripts/, which predate voice packs; it then speaks the default
        # language's voice, whatever language it is handed.
        self.voice_name = voice_name or config.piper_voice_for(config.default_language)
        self._voice_dir = config.models_dir / "piper"
        self._voice: object | None = None

    def load(self) -> None:
        from piper import PiperVoice
        from piper.download_voices import download_voice

        self._voice_dir.mkdir(parents=True, exist_ok=True)
        onnx = self._voice_dir / f"{self.voice_name}.onnx"
        if not onnx.exists():
            print(f"[Voice] downloading Piper voice {self.voice_name} ...")
            download_voice(self.voice_name, self._voice_dir)
        self._voice = PiperVoice.load(onnx)
        print(f"[Voice] Piper voice loaded: {self.voice_name}")

    def synthesize(
        self, text: str, language: str, voice: str | None = None
    ) -> tuple[bytes, int]:
        # language and voice are both ignored on purpose: this instance IS one
        # voice, and which one was chosen is the pack's decision, already made.
        # Handing German text to piper_en renders it in the English voice —
        # an operator's choice, not an error to be silently corrected.
        if self._voice is None:
            raise RuntimeError(f"Piper voice {self.voice_name!r} not loaded; call load() first")
        pcm = bytearray()
        rate = PIPER_DEFAULT_RATE
        for chunk in self._voice.synthesize(text):
            pcm += chunk.audio_int16_bytes
            rate = chunk.sample_rate
        return bytes(pcm), rate
