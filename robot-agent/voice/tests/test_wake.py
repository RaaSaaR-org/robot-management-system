"""Wake-phrase matching and the pipeline gate around it: ignore unaddressed
speech, strip the phrase from the command, ack a bare wake, allow follow-ups
inside the window."""

from __future__ import annotations

import asyncio

from voice_service.a2a_client import AgentReply
from voice_service.config import VoiceConfig
from voice_service.events import EventBus
from voice_service.pipeline import VoicePipeline
from voice_service.stt.base import Transcript
from voice_service.vad.segmenter import SpeechEnd
from voice_service.wake import match_wake, strip_wake_phrase


# ---------------------------------------------------------------------------
# strip_wake_phrase / match_wake
# ---------------------------------------------------------------------------

def test_exact_phrase_with_command() -> None:
    assert strip_wake_phrase("hey g1 wie geht es dir", "hey g1") == "wie geht es dir"


def test_whisper_punctuation_and_case() -> None:
    assert strip_wake_phrase("Hey, G-1! Wie hoch ist dein Akku?", "hey g1") == \
        "Wie hoch ist dein Akku?"


def test_spacing_variance() -> None:
    assert strip_wake_phrase("Hey G 1 status", "hey g1") == "status"
    assert strip_wake_phrase("HeyG1 status", "hey g1") == "status"


def test_bare_wake_phrase_returns_empty() -> None:
    assert strip_wake_phrase("Hey G1!", "hey g1") == ""


def test_no_match() -> None:
    assert strip_wake_phrase("wie hoch ist dein akku", "hey g1") is None


def test_phrase_must_end_on_word_boundary() -> None:
    assert strip_wake_phrase("Hey G1000 status", "hey g1") is None


def test_phrase_longer_than_text() -> None:
    assert strip_wake_phrase("hey", "hey g1") is None


def test_empty_phrase_never_matches() -> None:
    assert strip_wake_phrase("hallo", "") is None
    assert strip_wake_phrase("hallo", "!!!") is None


def test_match_wake_first_phrase_wins() -> None:
    phrases = ("hey g1", "hallo g1")
    assert match_wake("Hallo G1, wo bist du?", phrases) == "wo bist du?"
    assert match_wake("Guten Tag", phrases) is None


# ---------------------------------------------------------------------------
# pipeline gate
# ---------------------------------------------------------------------------

class FakeMic:
    def set_muted(self, muted: bool) -> None:
        pass


class FakeSegmenter:
    threshold = 0.5

    def reset(self) -> None:
        pass


class FakeSTT:
    def __init__(self) -> None:
        self.next_text = "wie hoch ist dein akkustand"

    def transcribe(self, pcm: bytes) -> Transcript:
        return Transcript(text=self.next_text, language="de",
                          avg_logprob=-0.1, duration_s=1.0)


class FakeTTS:
    def __init__(self) -> None:
        self.spoken: list[str] = []

    def synthesize(self, text: str, language: str) -> tuple[bytes, int]:
        self.spoken.append(text)
        return b"\x00\x00" * 160, 16_000


class FakeOut:
    async def play(self, pcm: bytes, rate: int) -> None:
        pass


class FakeA2A:
    def __init__(self) -> None:
        self.sent: list[str] = []

    async def send(self, text: str, context_id: str) -> AgentReply:
        self.sent.append(text)
        return AgentReply(text="Der Akku ist bei 50 Prozent.", state="completed")


def _make_pipeline(**config_kwargs) -> tuple[VoicePipeline, FakeSTT, FakeTTS, FakeA2A]:
    config = VoiceConfig(thinking_filler_s=0.0, **config_kwargs)
    stt, tts, a2a = FakeSTT(), FakeTTS(), FakeA2A()
    pipeline = VoicePipeline(
        config,
        EventBus(),
        audio_in=FakeMic(),
        audio_out=FakeOut(),
        stt=stt,
        tts=tts,
        a2a=a2a,
        segmenter=FakeSegmenter(),
    )
    return pipeline, stt, tts, a2a


async def _turn(pipeline: VoicePipeline, text: str) -> None:
    pipeline._loop = asyncio.get_running_loop()
    pipeline._stop = asyncio.Event()
    pipeline._gpu_lock = asyncio.Lock()
    pipeline._speak_lock = asyncio.Lock()
    pipeline.stt.next_text = text
    await pipeline._handle_turn(SpeechEnd(pcm=b"\x00\x00" * 512, duration_s=1.0))


def test_gate_disabled_by_default() -> None:
    pipeline, _, _, a2a = _make_pipeline()
    asyncio.run(_turn(pipeline, "wie hoch ist dein akkustand"))
    assert a2a.sent == ["wie hoch ist dein akkustand"]


def test_unaddressed_speech_is_ignored() -> None:
    pipeline, _, tts, a2a = _make_pipeline(wake_phrases=("hey g1",))
    asyncio.run(_turn(pipeline, "wie hoch ist dein akkustand"))
    assert a2a.sent == []
    assert tts.spoken == []


def test_wake_phrase_is_stripped_before_agent() -> None:
    pipeline, _, _, a2a = _make_pipeline(wake_phrases=("hey g1",))
    asyncio.run(_turn(pipeline, "Hey G1, wie hoch ist dein Akkustand?"))
    assert a2a.sent == ["wie hoch ist dein Akkustand?"]


def test_bare_wake_acknowledges_and_opens_window() -> None:
    pipeline, _, tts, a2a = _make_pipeline(wake_phrases=("hey g1",))

    async def scenario() -> None:
        await _turn(pipeline, "Hey G1!")
        await _turn(pipeline, "wie hoch ist dein Akkustand?")

    asyncio.run(scenario())
    assert tts.spoken[0] == "Ja, bitte?"
    assert a2a.sent == ["wie hoch ist dein Akkustand?"]


def test_follow_up_allowed_inside_window() -> None:
    pipeline, _, _, a2a = _make_pipeline(wake_phrases=("hey g1",), wake_window_s=60.0)

    async def scenario() -> None:
        await _turn(pipeline, "Hey G1, wo bist du?")
        await _turn(pipeline, "und wie hoch ist dein Akku?")  # no phrase

    asyncio.run(scenario())
    assert a2a.sent == ["wo bist du?", "und wie hoch ist dein Akku?"]


def test_window_expiry_requires_wake_again() -> None:
    pipeline, _, _, a2a = _make_pipeline(wake_phrases=("hey g1",), wake_window_s=0.0)

    async def scenario() -> None:
        await _turn(pipeline, "Hey G1, wo bist du?")
        await _turn(pipeline, "und wie hoch ist dein Akku?")  # window already closed

    asyncio.run(scenario())
    assert a2a.sent == ["wo bist du?"]
