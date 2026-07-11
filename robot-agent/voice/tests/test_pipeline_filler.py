"""Thinking-filler behavior: spoken only when the agent is slow, never
overlapping or reordering with the real reply."""

from __future__ import annotations

import asyncio

import pytest

from voice_service.a2a_client import AgentReply
from voice_service.config import VoiceConfig
from voice_service.events import EventBus
from voice_service.pipeline import VoicePipeline
from voice_service.stt.base import Transcript
from voice_service.vad.segmenter import SpeechEnd


class FakeMic:
    def set_muted(self, muted: bool) -> None:
        pass


class FakeSegmenter:
    threshold = 0.5

    def reset(self) -> None:
        pass


class FakeSTT:
    def transcribe(self, pcm: bytes) -> Transcript:
        return Transcript(text="wie hoch ist dein akkustand", language="de",
                          avg_logprob=-0.1, duration_s=1.0)


class FakeTTS:
    def __init__(self) -> None:
        self.spoken: list[str] = []

    def synthesize(self, text: str, language: str) -> tuple[bytes, int]:
        self.spoken.append(text)
        return b"\x00\x00" * 160, 16_000


class FakeOut:
    def __init__(self, play_s: float = 0.0) -> None:
        self.play_s = play_s

    async def play(self, pcm: bytes, rate: int) -> None:
        if self.play_s:
            await asyncio.sleep(self.play_s)


class FakeA2A:
    def __init__(self, delay_s: float) -> None:
        self.delay_s = delay_s

    async def send(self, text: str, context_id: str) -> AgentReply:
        await asyncio.sleep(self.delay_s)
        return AgentReply(text="Der Akku ist bei 50 Prozent.", state="completed")


def _make_pipeline(agent_delay_s: float, filler_s: float,
                   play_s: float = 0.0) -> tuple[VoicePipeline, FakeTTS]:
    config = VoiceConfig(thinking_filler_s=filler_s)
    tts = FakeTTS()
    pipeline = VoicePipeline(
        config,
        EventBus(),
        audio_in=FakeMic(),
        audio_out=FakeOut(play_s),
        stt=FakeSTT(),
        tts=tts,
        a2a=FakeA2A(agent_delay_s),
        segmenter=FakeSegmenter(),
    )
    return pipeline, tts


async def _run_turn(pipeline: VoicePipeline) -> None:
    pipeline._loop = asyncio.get_running_loop()
    pipeline._stop = asyncio.Event()
    pipeline._gpu_lock = asyncio.Lock()
    pipeline._speak_lock = asyncio.Lock()
    await pipeline._handle_turn(SpeechEnd(pcm=b"\x00\x00" * 512, duration_s=1.0))


def test_filler_spoken_when_agent_is_slow() -> None:
    pipeline, tts = _make_pipeline(agent_delay_s=0.3, filler_s=0.05)
    asyncio.run(_run_turn(pipeline))
    assert tts.spoken == ["Einen Moment, bitte.", "Der Akku ist bei 50 Prozent."]


def test_no_filler_when_agent_is_fast() -> None:
    pipeline, tts = _make_pipeline(agent_delay_s=0.0, filler_s=0.5)
    asyncio.run(_run_turn(pipeline))
    assert tts.spoken == ["Der Akku ist bei 50 Prozent."]


def test_no_filler_when_disabled() -> None:
    pipeline, tts = _make_pipeline(agent_delay_s=0.2, filler_s=0.0)
    asyncio.run(_run_turn(pipeline))
    assert tts.spoken == ["Der Akku ist bei 50 Prozent."]


def test_reply_waits_for_filler_playback() -> None:
    # reply arrives while the filler is mid-playback -> filler finishes first
    pipeline, tts = _make_pipeline(agent_delay_s=0.15, filler_s=0.05, play_s=0.3)
    asyncio.run(_run_turn(pipeline))
    assert tts.spoken == ["Einen Moment, bitte.", "Der Akku ist bei 50 Prozent."]


def test_filler_uses_english_for_english_turns() -> None:
    pipeline, tts = _make_pipeline(agent_delay_s=0.3, filler_s=0.05)
    pipeline.stt.transcribe = lambda pcm: Transcript(  # type: ignore[method-assign]
        text="what is your battery level", language="en",
        avg_logprob=-0.1, duration_s=1.0)
    asyncio.run(_run_turn(pipeline))
    assert tts.spoken[0] == "One moment, please."
