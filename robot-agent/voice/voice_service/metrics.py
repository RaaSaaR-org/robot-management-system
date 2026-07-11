"""Per-turn latency metrics with rolling percentiles for GET /status."""

from __future__ import annotations

import threading
from collections import defaultdict, deque

ROLLING_WINDOW = 50

# Canonical stage names recorded by the pipeline:
#   stt        utterance end -> transcript
#   agent      transcript -> agent reply (includes LLM think time)
#   tts        reply -> synthesized audio
#   speak      synthesized -> playback finished
#   turn_total utterance end -> playback finished
STAGES = ("stt", "agent", "tts", "speak", "turn_total")


class Metrics:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._samples: dict[str, deque[float]] = defaultdict(
            lambda: deque(maxlen=ROLLING_WINDOW)
        )
        self._turns = 0

    def record(self, stage: str, seconds: float) -> None:
        with self._lock:
            self._samples[stage].append(seconds)
            if stage == "turn_total":
                self._turns += 1

    def summary(self) -> dict:
        with self._lock:
            out: dict = {"turns": self._turns, "stages": {}}
            for stage, samples in self._samples.items():
                if not samples:
                    continue
                ordered = sorted(samples)
                out["stages"][stage] = {
                    "count": len(ordered),
                    "p50_s": round(_percentile(ordered, 0.50), 3),
                    "p95_s": round(_percentile(ordered, 0.95), 3),
                    "last_s": round(samples[-1], 3),
                }
            return out


def _percentile(ordered: list[float], q: float) -> float:
    if not ordered:
        return 0.0
    idx = min(len(ordered) - 1, max(0, round(q * (len(ordered) - 1))))
    return ordered[idx]
