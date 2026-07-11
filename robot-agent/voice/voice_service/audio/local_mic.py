"""PC microphone input via sounddevice (callback API — WDM-KS has no
blocking reads), resampled to the 16 kHz / 512-sample pipeline frames."""

from __future__ import annotations

import asyncio
from typing import AsyncIterator

from ..config import FRAME_BYTES, PIPELINE_SAMPLE_RATE, VoiceConfig
from .base import AudioInput
from .local_speaker import resolve_device
from .resample import StreamResampler, downmix_to_mono_s16le

CALLBACK_BLOCK_S = 0.032
QUEUE_MAX_CHUNKS = 256


class LocalMic(AudioInput):
    def __init__(self, config: VoiceConfig) -> None:
        import sounddevice

        self._sd = sounddevice
        self._device = resolve_device(config.input_device)
        info = self._sd.query_devices(self._device, "input")
        self._name = info["name"]
        self._rate, self._channels = self._pick_format(int(info["default_samplerate"]))
        self._muted = False
        self._running = False
        self._loop: asyncio.AbstractEventLoop | None = None
        self._queue: asyncio.Queue[bytes | None] | None = None
        self._stream = None
        self._resampler: StreamResampler | None = None
        self._buf = b""

    def _pick_format(self, default_rate: int) -> tuple[int, int]:
        for rate in (default_rate, 48_000, 44_100, PIPELINE_SAMPLE_RATE):
            for channels in (1, 2):
                try:
                    self._sd.check_input_settings(
                        device=self._device, samplerate=rate, channels=channels, dtype="int16"
                    )
                    return rate, channels
                except Exception:  # noqa: BLE001 — try the next candidate
                    continue
        raise RuntimeError("input device supports none of the candidate formats")

    async def start(self) -> None:
        self._loop = asyncio.get_running_loop()
        self._queue = asyncio.Queue(maxsize=QUEUE_MAX_CHUNKS)
        self._resampler = StreamResampler(self._rate, PIPELINE_SAMPLE_RATE)
        self._buf = b""
        self._running = True
        self._stream = self._sd.InputStream(
            samplerate=self._rate,
            channels=self._channels,
            dtype="int16",
            blocksize=max(1, int(self._rate * CALLBACK_BLOCK_S)),
            device=self._device,
            callback=self._callback,
        )
        self._stream.start()
        print(f"[Voice] mic: {self._name} @ {self._rate} Hz x{self._channels}")

    async def stop(self) -> None:
        self._running = False
        if self._stream is not None:
            self._stream.stop()
            self._stream.close()
            self._stream = None
        if self._queue is not None:
            self._queue.put_nowait(None)

    def _callback(self, indata, _frames, _time, _status) -> None:
        # PortAudio thread: get out fast, drop everything while muted.
        if self._muted or not self._running or self._loop is None:
            return
        data = bytes(indata)
        self._loop.call_soon_threadsafe(self._enqueue, data)

    def _enqueue(self, data: bytes) -> None:
        try:
            self._queue.put_nowait(data)
        except asyncio.QueueFull:
            pass  # consumer is behind: drop, never block the audio thread

    async def frames(self) -> AsyncIterator[bytes]:
        while self._running:
            chunk = await self._queue.get()
            if chunk is None:
                break
            if self._channels > 1:
                chunk = downmix_to_mono_s16le(chunk, self._channels)
            self._buf += self._resampler.process(chunk)
            while len(self._buf) >= FRAME_BYTES:
                yield self._buf[:FRAME_BYTES]
                self._buf = self._buf[FRAME_BYTES:]

    def set_muted(self, muted: bool) -> None:
        self._muted = muted
        if muted:
            self._buf = b""
            if self._loop is not None:
                self._loop.call_soon_threadsafe(self._drain)

    def _drain(self) -> None:
        if self._queue is None:
            return
        while True:
            try:
                self._queue.get_nowait()
            except asyncio.QueueEmpty:
                return
