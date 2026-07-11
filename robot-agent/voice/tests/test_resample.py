"""Tests for sample-rate conversion helpers."""

import numpy as np

from voice_service.audio.resample import (
    StreamResampler,
    downmix_to_mono_s16le,
    resample_s16le,
)


def sine_s16le(freq: float, rate: int, seconds: float) -> bytes:
    t = np.arange(int(rate * seconds)) / rate
    return (np.sin(2 * np.pi * freq * t) * 20000).astype(np.int16).tobytes()


def test_resample_noop_same_rate() -> None:
    pcm = sine_s16le(440, 16000, 0.5)
    assert resample_s16le(pcm, 16000, 16000) is pcm


def test_resample_48k_to_16k_length() -> None:
    pcm = sine_s16le(440, 48000, 1.0)
    out = resample_s16le(pcm, 48000, 16000)
    n_out = len(out) // 2
    assert abs(n_out - 16000) <= 32  # within ~2ms of expected


def test_resample_16k_to_22050_length() -> None:
    pcm = sine_s16le(440, 16000, 1.0)
    out = resample_s16le(pcm, 16000, 22050)
    assert abs(len(out) // 2 - 22050) <= 44


def test_stream_resampler_matches_total_length() -> None:
    rate_in, rate_out = 48000, 16000
    pcm = sine_s16le(300, rate_in, 2.0)
    rs = StreamResampler(rate_in, rate_out)
    out = bytearray()
    chunk_bytes = 2 * 480  # 10ms chunks
    for i in range(0, len(pcm), chunk_bytes):
        out += rs.process(pcm[i : i + chunk_bytes])
    out += rs.process(b"", last=True)
    assert abs(len(out) // 2 - 32000) <= 160  # within 10ms


def test_stream_resampler_noop() -> None:
    rs = StreamResampler(16000, 16000)
    pcm = sine_s16le(440, 16000, 0.1)
    assert rs.process(pcm) == pcm


def test_downmix_stereo() -> None:
    left = np.full(100, 1000, dtype=np.int16)
    right = np.full(100, 3000, dtype=np.int16)
    stereo = np.column_stack([left, right]).tobytes()
    mono = np.frombuffer(downmix_to_mono_s16le(stereo, 2), dtype=np.int16)
    assert len(mono) == 100
    assert np.all(mono == 2000)
