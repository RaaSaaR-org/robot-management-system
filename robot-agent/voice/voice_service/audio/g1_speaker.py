"""Unitree G1 speaker backend — HTTP client to the G1 audio adapter.

The adapter (adapters/g1_audio_adapter.py) runs in the legacy Python 3.10
venv with unitree_sdk2py/cyclonedds and wraps AudioClient.PlayStream. This
class only needs httpx: it resamples to the robot's required 16 kHz mono
s16le and POSTs the raw PCM. POST /play returns when playback finished.
"""

from __future__ import annotations

import httpx

from ..config import PIPELINE_SAMPLE_RATE, VoiceConfig
from .base import AudioOutput
from .resample import resample_s16le

PLAY_TIMEOUT_MARGIN_S = 20.0


class G1Speaker(AudioOutput):
    def __init__(self, config: VoiceConfig) -> None:
        self._base_url = config.g1_adapter_url.rstrip("/")
        self._client: httpx.AsyncClient | None = None
        # fail fast at wiring time if the adapter is not running
        health = httpx.get(self._base_url + "/health", timeout=3.0)
        health.raise_for_status()
        print(f"[Voice] G1 speaker adapter: {health.json()}")

    async def play(self, pcm: bytes, sample_rate: int) -> None:
        if self._client is None:
            self._client = httpx.AsyncClient()
        pcm16 = resample_s16le(pcm, sample_rate, PIPELINE_SAMPLE_RATE)
        audio_s = len(pcm16) / 2 / PIPELINE_SAMPLE_RATE
        response = await self._client.post(
            self._base_url + "/play",
            content=pcm16,
            headers={"Content-Type": "application/octet-stream"},
            timeout=audio_s + PLAY_TIMEOUT_MARGIN_S,
        )
        response.raise_for_status()

    async def cancel(self) -> None:
        if self._client is None:
            self._client = httpx.AsyncClient()
        await self._client.post(self._base_url + "/stop", timeout=5.0)
