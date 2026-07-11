"""Minimal Silero VAD ONNX wrapper (no torch dependency).

Mirrors the OnnxWrapper from snakers4/silero-vad (MIT): the model takes the
current 512-sample frame prefixed with 64 samples of context from the
previous frame, plus a recurrent state. Model file: models/silero_vad.onnx
(fetched by scripts/download_models.py).
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

from ..config import FRAME_SAMPLES

CONTEXT_SAMPLES = 64
MODEL_FILENAME = "silero_vad.onnx"


class SileroVad:
    """Callable frame -> speech probability, for UtteranceSegmenter."""

    def __init__(self, models_dir: Path) -> None:
        model_path = Path(models_dir) / MODEL_FILENAME
        if not model_path.exists():
            raise RuntimeError(
                f"Silero VAD model missing at {model_path} — "
                "run: uv run python scripts/download_models.py"
            )
        import onnxruntime as ort

        opts = ort.SessionOptions()
        opts.log_severity_level = 3
        self._session = ort.InferenceSession(
            str(model_path), sess_options=opts, providers=["CPUExecutionProvider"]
        )
        self._sr = np.array(16_000, dtype=np.int64)
        self.reset()

    def reset(self) -> None:
        self._state = np.zeros((2, 1, 128), dtype=np.float32)
        self._context = np.zeros((1, CONTEXT_SAMPLES), dtype=np.float32)

    def __call__(self, frame: bytes) -> float:
        samples = np.frombuffer(frame, dtype=np.int16).astype(np.float32) / 32768.0
        if len(samples) != FRAME_SAMPLES:
            raise ValueError(f"expected {FRAME_SAMPLES} samples, got {len(samples)}")
        x = np.concatenate([self._context, samples[None, :]], axis=1)
        out, self._state = self._session.run(
            None, {"input": x, "state": self._state, "sr": self._sr}
        )
        self._context = x[:, -CONTEXT_SAMPLES:]
        return float(out[0][0])
