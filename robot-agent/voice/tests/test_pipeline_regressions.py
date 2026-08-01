"""Regression tests for the half-duplex / mic-gating and /say fixes (issue #186)
plus the thinking-filler error path (#187).

Covered:
- /say overlapping a live VAD turn must NOT unmute the mic mid-turn (ref count).
- /say while paused returns to PAUSED, not a stuck 'speaking' state.
- /say with no segmenter wired (VAD failed to load) must not crash.
- A runtime mode->ptt config patch must actually gate (mute) the mic.
- A filler playback error must not discard an already-received reply.
"""

from __future__ import annotations

import asyncio

from voice_service.a2a_client import AgentReply
from voice_service.config import VoiceConfig
from voice_service.events import EventBus
from voice_service.pipeline import State, VoicePipeline
from voice_service.stt.base import Transcript
from voice_service.vad.segmenter import SpeechEnd


class FakeMic:
    """Tracks the current mute state so tests can assert half-duplex gating."""

    def __init__(self) -> None:
        self.muted = False

    def set_muted(self, muted: bool) -> None:
        self.muted = muted


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


class FlakyOut:
    """Fails the first play() (the filler), succeeds afterwards (the reply)."""

    def __init__(self) -> None:
        self.calls = 0

    async def play(self, pcm: bytes, rate: int) -> None:
        self.calls += 1
        if self.calls == 1:
            raise RuntimeError("audio device glitch")


class FakeA2A:
    def __init__(self, delay_s: float) -> None:
        self.delay_s = delay_s
        self.last_metadata: dict | None = None

    async def send(self, text: str, context_id: str,
                   metadata: dict | None = None) -> AgentReply:
        self.last_metadata = metadata
        await asyncio.sleep(self.delay_s)
        return AgentReply(text="Der Akku ist bei 50 Prozent.", state="completed")


def _init_loop(pipeline: VoicePipeline) -> None:
    pipeline._loop = asyncio.get_running_loop()
    pipeline._stop = asyncio.Event()
    pipeline._gpu_lock = asyncio.Lock()
    pipeline._speak_lock = asyncio.Lock()


def _make(*, mode: str = "vad", filler_s: float = 0.0, agent_delay_s: float = 0.0,
          out=None, segmenter: bool = True):
    config = VoiceConfig(mode=mode, thinking_filler_s=filler_s, half_duplex_tail_ms=10)
    mic = FakeMic()
    tts = FakeTTS()
    pipeline = VoicePipeline(
        config,
        EventBus(),
        audio_in=mic,
        audio_out=out if out is not None else FakeOut(),
        stt=FakeSTT(),
        tts=tts,
        a2a=FakeA2A(agent_delay_s),
        segmenter=FakeSegmenter() if segmenter else None,
    )
    return pipeline, tts, mic


def test_say_during_turn_keeps_mic_muted_until_turn_ends() -> None:
    # Bug #186: /say overlapping a live turn used to unmute the mic mid-turn.
    pipeline, tts, mic = _make(agent_delay_s=0.3)

    async def go() -> None:
        _init_loop(pipeline)
        turn = asyncio.create_task(
            pipeline._handle_turn(SpeechEnd(pcm=b"\x00\x00" * 512, duration_s=1.0))
        )
        await asyncio.sleep(0.05)  # turn is now in a2a.send: muted + THINKING
        assert mic.muted is True
        await pipeline._say_task("zwischenruf", "de")  # overlapping /say completes
        # The turn is still in flight -> the mic MUST remain muted.
        assert mic.muted is True
        assert pipeline._state is not State.LISTENING
        await turn
        assert mic.muted is False  # only the final release re-opens the mic
        assert pipeline._state is State.LISTENING

    asyncio.run(go())


def test_say_during_resume_tail_is_not_unmuted_by_stale_resume() -> None:
    # Bug (fix regression): a /say that arrives during the half-duplex tail
    # sleep — after a turn released the mic but before it re-opened — must not be
    # unmuted by the turn's now-stale _resume_listening waking from that sleep.
    pipeline, tts, mic = _make()
    pipeline.config.half_duplex_tail_ms = 100

    async def go() -> None:
        _init_loop(pipeline)
        pipeline._acquire_mic()  # a turn holds the mic (muted)
        resume = asyncio.create_task(pipeline._resume_listening())  # -> tail sleep
        await asyncio.sleep(0.02)  # we're now inside the 100ms tail
        pipeline._acquire_mic()  # a /say arrives mid-tail: re-acquires the mic
        await resume  # the stale resume wakes — must re-check and NOT unmute
        assert mic.muted is True
        assert pipeline._state is not State.LISTENING
        await pipeline._resume_listening()  # /say releases -> mic finally re-opens
        assert mic.muted is False
        assert pipeline._state is State.LISTENING

    asyncio.run(go())


def test_say_while_paused_returns_to_paused_not_speaking() -> None:
    # Bug #186: /say while paused left state stuck at 'speaking'.
    pipeline, tts, mic = _make(mode="ptt")

    async def go() -> None:
        _init_loop(pipeline)
        assert pipeline._paused is True
        mic.muted = True
        await pipeline._say_task("hallo", "de")

    asyncio.run(go())
    assert tts.spoken == ["hallo"]
    assert pipeline._state is State.PAUSED
    assert mic.muted is True  # stays muted while paused


def test_say_without_segmenter_does_not_crash() -> None:
    # Bug #186: /say hit segmenter.reset() on None when VAD failed to load.
    pipeline, tts, mic = _make(segmenter=False)

    async def go() -> None:
        _init_loop(pipeline)
        await pipeline._say_task("hallo", "de")

    asyncio.run(go())
    assert tts.spoken == ["hallo"]  # spoke instead of raising AttributeError
    assert pipeline._state is State.LISTENING


def test_runtime_mode_switch_to_ptt_mutes_mic() -> None:
    # Bug #186: patching mode->ptt at runtime did not gate the open mic.
    pipeline, tts, mic = _make(mode="vad")

    async def go() -> None:
        _init_loop(pipeline)
        pipeline._paused = False
        mic.muted = False
        pipeline.patch_config({"mode": "ptt"})
        await asyncio.sleep(0.01)  # let the loop-thread hand-off run
        assert pipeline._paused is True
        assert mic.muted is True
        assert pipeline._state is State.PAUSED

    asyncio.run(go())


def test_filler_playback_error_does_not_drop_reply() -> None:
    # Bug #187: an exception in the filler's playback (awaited in a finally)
    # used to discard an already-received valid reply.
    pipeline, tts, mic = _make(agent_delay_s=0.15, filler_s=0.05, out=FlakyOut())

    asyncio.run(_run_turn(pipeline))

    # The filler was attempted (and failed on play), but the real reply is still
    # synthesized and recorded — not replaced by the generic error line.
    assert "Der Akku ist bei 50 Prozent." in tts.spoken
    assert pipeline.last_reply is not None
    assert pipeline.last_reply["text"] == "Der Akku ist bei 50 Prozent."


async def _run_turn(pipeline: VoicePipeline) -> None:
    _init_loop(pipeline)
    await pipeline._handle_turn(SpeechEnd(pcm=b"\x00\x00" * 512, duration_s=1.0))


def test_turn_tells_the_agent_it_is_speaking_and_in_which_language() -> None:
    """The speech hint is what lets Agent Mode answer before the plan runs.

    Without it the robot-agent holds the A2A response open until the whole plan
    has finished, and this pipeline is deaf for exactly that long — so the word
    "stop" could not be said while the robot was walking.
    """
    pipeline, _tts, _mic = _make()

    async def go() -> None:
        _init_loop(pipeline)
        await pipeline._handle_turn(SpeechEnd(pcm=b"\x00\x00" * 512, duration_s=1.0))

    asyncio.run(go())

    # FakeSTT reports German; the hint must carry that, not the config default.
    assert pipeline.a2a.last_metadata == {
        "neodem/voice": {"speech": True, "language": "de"}
    }
