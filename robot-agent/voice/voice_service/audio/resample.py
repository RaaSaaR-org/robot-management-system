"""Sample-rate conversion helpers (soxr) for s16le mono PCM."""

from __future__ import annotations

import numpy as np
import soxr


def resample_s16le(pcm: bytes, from_rate: int, to_rate: int) -> bytes:
    """One-shot resample of a complete buffer (use StreamResampler for live audio)."""
    if from_rate == to_rate:
        return pcm
    samples = np.frombuffer(pcm, dtype=np.int16)
    return soxr.resample(samples, from_rate, to_rate).tobytes()


class StreamResampler:
    """Streaming resampler that keeps filter state across chunks
    (avoids the boundary artifacts of chunk-wise one-shot resampling)."""

    def __init__(self, from_rate: int, to_rate: int) -> None:
        self.from_rate = from_rate
        self.to_rate = to_rate
        self._stream = (
            None
            if from_rate == to_rate
            else soxr.ResampleStream(from_rate, to_rate, 1, dtype="int16")
        )

    def process(self, pcm: bytes, last: bool = False) -> bytes:
        if self._stream is None:
            return pcm
        samples = np.frombuffer(pcm, dtype=np.int16)
        return self._stream.resample_chunk(samples, last=last).tobytes()


def downmix_to_mono_s16le(pcm: bytes, channels: int) -> bytes:
    if channels == 1:
        return pcm
    samples = np.frombuffer(pcm, dtype=np.int16).reshape(-1, channels)
    return samples.mean(axis=1).astype(np.int16).tobytes()
