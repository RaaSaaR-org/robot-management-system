"""Piper TTS engine (piper-tts 1.4.2, OHF-Voice piper1-gpl fork).

CPU real-time synthesis; one voice per configured language, downloaded on
first load into <models_dir>/piper/. Note: piper-tts is GPL-3.0 — see the
licence note in voice/README.md.
"""

from __future__ import annotations

from ..config import VoiceConfig
from .base import TTSEngine

PIPER_DEFAULT_RATE = 22_050


class PiperEngine(TTSEngine):
    def __init__(self, config: VoiceConfig) -> None:
        self.config = config
        self._voice_dir = config.models_dir / "piper"
        self._voices: dict[str, object] = {}

    def load(self) -> None:
        from piper import PiperVoice
        from piper.download_voices import download_voice

        self._voice_dir.mkdir(parents=True, exist_ok=True)
        for lang in self.config.languages:
            name = self.config.piper_voice_for(lang)
            onnx = self._voice_dir / f"{name}.onnx"
            if not onnx.exists():
                print(f"[Voice] downloading Piper voice {name} ...")
                download_voice(name, self._voice_dir)
            self._voices[lang] = PiperVoice.load(onnx)
        loaded = {lang: self.config.piper_voice_for(lang) for lang in self._voices}
        print(f"[Voice] Piper voices loaded: {loaded}")

    def synthesize(self, text: str, language: str) -> tuple[bytes, int]:
        voice = (
            self._voices.get(language)
            or self._voices.get(self.config.default_language)
            or next(iter(self._voices.values()))
        )
        pcm = bytearray()
        rate = PIPER_DEFAULT_RATE
        for chunk in voice.synthesize(text):
            pcm += chunk.audio_int16_bytes
            rate = chunk.sample_rate
        return bytes(pcm), rate
