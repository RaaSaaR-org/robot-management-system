"""Utterance segmentation on top of a frame-level speech-probability model.

Pure logic — the VAD model is injected as a callable, so this is fully
unit-testable without ONNX or audio hardware. Consumes fixed 32 ms frames
(512 samples @ 16 kHz s16le) and emits SpeechStart / SpeechEnd events.
"""

from __future__ import annotations

import math
from collections import deque
from dataclasses import dataclass
from typing import Callable

from ..config import FRAME_BYTES, FRAME_SAMPLES, PIPELINE_SAMPLE_RATE

FRAME_MS = FRAME_SAMPLES * 1000 / PIPELINE_SAMPLE_RATE  # 32.0


@dataclass(slots=True)
class SpeechStart:
    """Speech confirmed (min_speech_ms of consecutive voiced frames)."""


@dataclass(slots=True)
class SpeechEnd:
    """Utterance finished; pcm holds pre-roll + speech + trailing silence."""

    pcm: bytes
    duration_s: float


class UtteranceSegmenter:
    """State machine: idle -> maybe_speech -> speech -> (SpeechEnd) -> idle."""

    def __init__(
        self,
        speech_prob: Callable[[bytes], float],
        *,
        threshold: float = 0.5,
        min_speech_ms: int = 250,
        min_silence_ms: int = 700,
        max_utterance_s: int = 30,
        pre_roll_ms: int = 300,
    ) -> None:
        self._speech_prob = speech_prob
        self.threshold = threshold
        self._min_speech_frames = max(1, math.ceil(min_speech_ms / FRAME_MS))
        self._min_silence_frames = max(1, math.ceil(min_silence_ms / FRAME_MS))
        self._max_frames = max(1, math.ceil(max_utterance_s * 1000 / FRAME_MS))
        self._pre_roll: deque[bytes] = deque(maxlen=max(1, math.ceil(pre_roll_ms / FRAME_MS)))
        self._state = "idle"
        self._buf: list[bytes] = []
        self._speech_run = 0
        self._silence_run = 0

    def push(self, frame: bytes) -> SpeechStart | SpeechEnd | None:
        if len(frame) != FRAME_BYTES:
            raise ValueError(f"expected {FRAME_BYTES}-byte frames, got {len(frame)}")
        voiced = self._speech_prob(frame) >= self.threshold

        if self._state == "idle":
            if voiced:
                self._buf = [*self._pre_roll, frame]
                self._pre_roll.clear()
                self._speech_run = 1
                if self._speech_run >= self._min_speech_frames:
                    self._state = "speech"
                    self._silence_run = 0
                    return SpeechStart()
                self._state = "maybe_speech"
            else:
                self._pre_roll.append(frame)
            return None

        if self._state == "maybe_speech":
            self._buf.append(frame)
            if voiced:
                self._speech_run += 1
                if self._speech_run >= self._min_speech_frames:
                    self._state = "speech"
                    self._silence_run = 0
                    return SpeechStart()
            else:
                # too short to be speech: recycle buffered frames as pre-roll
                for f in self._buf:
                    self._pre_roll.append(f)
                self._reset_to_idle()
            return None

        # state == "speech"
        self._buf.append(frame)
        if voiced:
            self._silence_run = 0
        else:
            self._silence_run += 1
            if self._silence_run >= self._min_silence_frames:
                return self._finish()
        if len(self._buf) >= self._max_frames:
            return self._finish()
        return None

    def reset(self) -> None:
        """Drop any in-flight utterance (e.g. when muting for playback)."""
        self._pre_roll.clear()
        self._reset_to_idle()

    def _finish(self) -> SpeechEnd:
        pcm = b"".join(self._buf)
        event = SpeechEnd(pcm=pcm, duration_s=len(self._buf) * FRAME_MS / 1000)
        self._reset_to_idle()
        return event

    def _reset_to_idle(self) -> None:
        self._state = "idle"
        self._buf = []
        self._speech_run = 0
        self._silence_run = 0
