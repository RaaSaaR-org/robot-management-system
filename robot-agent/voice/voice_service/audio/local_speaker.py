"""PC speaker output via sounddevice, cancellable mid-playback.

Uses the callback API: on this box PortAudio only enumerates WDM-KS
devices, which reject the blocking read/write API ("Blocking API not
supported yet", PaErrorCode -9999).
"""

from __future__ import annotations

import asyncio
import threading

import numpy as np

from ..config import VoiceConfig
from .base import AudioOutput
from .resample import resample_s16le

PLAY_TIMEOUT_MARGIN_S = 5.0


def resolve_device(spec: str | None) -> int | str | None:
    """sounddevice accepts an index or a name substring."""
    if spec is None or spec == "":
        return None
    return int(spec) if spec.isdigit() else spec


class LocalSpeaker(AudioOutput):
    def __init__(self, config: VoiceConfig) -> None:
        import sounddevice  # fail here (not at play time) if PortAudio is broken

        self._sd = sounddevice
        self._device = resolve_device(config.output_device)
        self._cancel = threading.Event()
        info = self._sd.query_devices(self._device, "output")
        # WDM-KS devices only accept their native rates (22.05k from Piper is
        # rejected), so we open at a device-supported rate and resample into it.
        self._device_rate = self._pick_device_rate(int(info["default_samplerate"]))
        print(f"[Voice] speaker: {info['name']} @ {self._device_rate} Hz")

    def _pick_device_rate(self, default_rate: int) -> int:
        for rate in (default_rate, 48_000, 44_100):
            try:
                self._sd.check_output_settings(
                    device=self._device, samplerate=rate, channels=1, dtype="int16"
                )
                return rate
            except Exception:  # noqa: BLE001 — try the next candidate
                continue
        raise RuntimeError("output device supports none of the candidate sample rates")

    async def play(self, pcm: bytes, sample_rate: int) -> None:
        self._cancel.clear()
        await asyncio.to_thread(self._play_blocking, pcm, sample_rate)

    async def cancel(self) -> None:
        self._cancel.set()

    def _play_blocking(self, pcm: bytes, sample_rate: int) -> None:
        if sample_rate != self._device_rate:
            pcm = resample_s16le(pcm, sample_rate, self._device_rate)
            sample_rate = self._device_rate
        samples = np.frombuffer(pcm, dtype=np.int16)
        if len(samples) == 0:
            return
        pos = 0
        done = threading.Event()
        sd = self._sd

        def callback(outdata: np.ndarray, frames: int, _time, _status) -> None:
            nonlocal pos
            if self._cancel.is_set():
                raise sd.CallbackAbort
            chunk = samples[pos : pos + frames]
            outdata[: len(chunk), 0] = chunk
            if len(chunk) < frames:
                outdata[len(chunk) :, 0] = 0
                raise sd.CallbackStop
            pos += frames

        with sd.OutputStream(
            samplerate=sample_rate,
            channels=1,
            dtype="int16",
            device=self._device,
            callback=callback,
            finished_callback=done.set,
        ):
            done.wait(timeout=len(samples) / sample_rate + PLAY_TIMEOUT_MARGIN_S)
