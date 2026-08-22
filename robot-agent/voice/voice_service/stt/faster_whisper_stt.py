"""faster-whisper STT engine (CTranslate2, CUDA float16 on the GPU box's GPU).

Windows pitfall handled here: ctranslate2 needs the cuBLAS/cuDNN DLLs from
the pip-installed nvidia-* packages on the DLL search path, otherwise it
fails with e.g. "Could not locate cudnn_ops64_9.dll". Blackwell/sm_120 needs
ctranslate2 >= 4.7 (float16 is the safe default compute type).
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import numpy as np

from ..config import PIPELINE_SAMPLE_RATE, VoiceConfig
from .base import STTEngine, Transcript


def _add_nvidia_dll_dirs() -> None:
    base = Path(sys.prefix) / "Lib" / "site-packages" / "nvidia"
    found = False
    for sub in ("cublas", "cudnn", "cuda_nvrtc"):
        p = base / sub / "bin"
        if p.is_dir():
            # ctranslate2 resolves some CUDA DLLs via the classic PATH search,
            # so os.add_dll_directory alone is not sufficient.
            os.add_dll_directory(str(p))
            os.environ["PATH"] = str(p) + os.pathsep + os.environ.get("PATH", "")
            found = True
    if not found:
        print(
            "[Voice] WARNING: no nvidia DLL dirs found under site-packages — "
            "CUDA STT will likely fail to load cuBLAS/cuDNN"
        )


class FasterWhisperSTT(STTEngine):
    def __init__(self, config: VoiceConfig) -> None:
        self.config = config
        self._model = None

    def load(self) -> None:
        _add_nvidia_dll_dirs()
        from faster_whisper import WhisperModel

        print(
            f"[Voice] loading Whisper {self.config.stt_model} "
            f"({self.config.stt_device}/{self.config.stt_compute}) ..."
        )
        self._model = WhisperModel(
            self.config.stt_model,
            device=self.config.stt_device,
            compute_type=self.config.stt_compute,
        )
        # Warmup: exercises the CUDA kernels so the first real utterance is
        # fast and any sm_120/DLL problem surfaces at startup, not mid-turn.
        warmup = np.zeros(PIPELINE_SAMPLE_RATE // 2, dtype=np.float32)
        list(self._model.transcribe(warmup, language="en", beam_size=1)[0])
        print("[Voice] Whisper ready")

    def transcribe(self, pcm_16k: bytes, language: str | None = None) -> Transcript:
        if self._model is None:
            raise RuntimeError("STT model not loaded")
        audio = np.frombuffer(pcm_16k, dtype=np.int16).astype(np.float32) / 32768.0
        segments, info = self._model.transcribe(
            audio,
            language=language,
            beam_size=5,
            vad_filter=False,  # we already segmented with Silero
            condition_on_previous_text=False,
        )
        segs = list(segments)
        text = " ".join(s.text.strip() for s in segs).strip()
        avg_logprob = (
            sum(s.avg_logprob for s in segs) / len(segs) if segs else -10.0
        )
        detected = info.language
        prob = info.language_probability or 0.0
        if detected not in self.config.languages or prob < self.config.language_min_prob:
            detected = self.config.default_language
        return Transcript(
            text=text,
            language=detected,
            avg_logprob=avg_logprob,
            duration_s=len(audio) / PIPELINE_SAMPLE_RATE,
        )
