"""Voice pipeline: the half-duplex conversation state machine.

    IDLE -> LISTENING -> CAPTURING -> THINKING -> SPEAKING -> LISTENING
                              (PAUSED via /listen/toggle or ptt mode)

The microphone is muted at the *source* from utterance-end until playback-end
plus a short tail, so the robot never hears itself. All components are
injected duck-typed (see audio/base.py, stt/base.py, tts/base.py,
a2a_client.py), which keeps this module runnable with any subset wired up:
TTS-only (phase 1), transcribe-only (phase 2), or the full loop.

Implements the PipelineController protocol consumed by http_api.py; those
methods are called from HTTP server threads and marshal into the asyncio
loop where needed.
"""

from __future__ import annotations

import asyncio
import time
from enum import Enum

from . import __version__
from .config import VoiceConfig
from .events import EventBus
from .metrics import Metrics
from .session import Session
from .tts.normalize import tts_normalize
from .vad.segmenter import SpeechEnd, SpeechStart, UtteranceSegmenter
from .wake import match_wake

LOW_CONFIDENCE_LOGPROB = -1.5

CANNED = {
    "error": {
        "de": "Entschuldigung, da ist etwas schiefgelaufen.",
        "en": "Sorry, something went wrong.",
    },
    "reset": {
        "de": "Okay, neues Gespräch.",
        "en": "Okay, starting fresh.",
    },
    "thinking": {
        "de": "Einen Moment, bitte.",
        "en": "One moment, please.",
    },
    "wake_ack": {
        "de": "Ja, bitte?",
        "en": "Yes?",
    },
}


class State(str, Enum):
    IDLE = "idle"
    LISTENING = "listening"
    CAPTURING = "capturing"
    THINKING = "thinking"
    SPEAKING = "speaking"
    PAUSED = "paused"


class VoicePipeline:
    def __init__(
        self,
        config: VoiceConfig,
        bus: EventBus,
        *,
        audio_in=None,
        audio_out=None,
        stt=None,
        tts=None,
        a2a=None,
        segmenter: UtteranceSegmenter | None = None,
    ) -> None:
        self.config = config
        self.bus = bus
        self.audio_in = audio_in
        self.audio_out = audio_out
        self.stt = stt
        self.tts = tts
        self.a2a = a2a
        self.segmenter = segmenter

        self.session = Session(config.session_timeout_s)
        self.metrics = Metrics()
        self.last_transcript: dict | None = None
        self.last_reply: dict | None = None

        self._state = State.IDLE
        self._paused = config.mode == "ptt"  # ptt starts muted until toggled
        # Ref count of active speaking spans holding the mic muted (a VAD turn
        # and/or one-or-more /say). The mic only re-opens when it hits 0, so an
        # overlapping /say can't unmute mid-turn.
        self._mic_holders = 0
        self._wake_deadline = 0.0  # monotonic; follow-ups before this need no wake phrase
        self._models_loaded = {"stt": False, "tts": False}
        self._loop: asyncio.AbstractEventLoop | None = None
        self._stop: asyncio.Event | None = None
        self._gpu_lock: asyncio.Lock | None = None
        self._speak_lock: asyncio.Lock | None = None

    # ------------------------------------------------------------------
    # Lifecycle (runs in the asyncio loop)
    # ------------------------------------------------------------------

    async def run(self) -> None:
        self._loop = asyncio.get_running_loop()
        self._stop = asyncio.Event()
        self._gpu_lock = asyncio.Lock()
        self._speak_lock = asyncio.Lock()
        self.bus.publish(
            "service_started",
            version=__version__,
            mode=self.config.mode,
            input=self.config.input_backend if self.audio_in else None,
            output=self.config.output_backend if self.audio_out else None,
            agent=self.config.agent_url if self.a2a else None,
        )

        if self.tts is not None:
            await asyncio.to_thread(self.tts.load)
            self._models_loaded["tts"] = True
            self.bus.publish("tts_loaded", engine=self.config.tts_engine)
        if self.stt is not None:
            await asyncio.to_thread(self.stt.load)
            self._models_loaded["stt"] = True
            self.bus.publish("stt_loaded", model=self.config.stt_model)

        if self.audio_in is not None and self.stt is not None and self.segmenter is not None:
            await self._listen_loop()
        else:
            missing = [
                name
                for name, comp in (
                    ("audio_in", self.audio_in),
                    ("stt", self.stt),
                    ("segmenter", self.segmenter),
                )
                if comp is None
            ]
            self.bus.publish("listen_loop_disabled", missing=missing)
            print(f"[Voice] listen loop disabled (missing: {', '.join(missing)})")
            self._set_state(State.IDLE)
            await self._stop.wait()

    def shutdown(self) -> None:
        """Thread-safe: request the run() loop to exit."""
        if self._loop is not None and self._stop is not None:
            self._loop.call_soon_threadsafe(self._stop.set)

    async def _listen_loop(self) -> None:
        await self.audio_in.start()
        self.audio_in.set_muted(self._paused)
        self._set_state(State.PAUSED if self._paused else State.LISTENING)
        print(f"[Voice] listening (mode={self.config.mode}, paused={self._paused})")
        try:
            async for frame in self.audio_in.frames():
                if self._stop.is_set():
                    break
                event = self.segmenter.push(frame)
                if isinstance(event, SpeechStart):
                    self._set_state(State.CAPTURING)
                elif isinstance(event, SpeechEnd):
                    await self._handle_turn(event)
        finally:
            await self.audio_in.stop()

    # ------------------------------------------------------------------
    # One conversation turn
    # ------------------------------------------------------------------

    async def _handle_turn(self, speech: SpeechEnd) -> None:
        turn_start = time.monotonic()
        self._acquire_mic()  # half-duplex: deaf until we finish (ref-counted)
        self._set_state(State.THINKING)
        language = self.config.default_language
        addressed = False  # wake gate passed -> refresh the follow-up window
        try:
            t0 = time.monotonic()
            async with self._gpu_lock:
                transcript = await asyncio.to_thread(self.stt.transcribe, speech.pcm)
            self.metrics.record("stt", time.monotonic() - t0)

            text = (transcript.text or "").strip()
            language = transcript.language or language
            if not text:
                self.bus.publish("transcript_discarded", reason="empty")
                return
            if transcript.avg_logprob < LOW_CONFIDENCE_LOGPROB:
                self.bus.publish(
                    "transcript_discarded",
                    reason="low_confidence",
                    text=text,
                    avg_logprob=round(transcript.avg_logprob, 2),
                )
                return

            self.last_transcript = {
                "text": text,
                "language": language,
                "duration_s": round(speech.duration_s, 2),
                "ts": time.time(),
            }
            self.bus.publish("transcript", text=text, language=language)
            print(f"[Voice] heard ({language}): {text}")

            if self.config.wake_phrases:
                remainder = match_wake(text, self.config.wake_phrases)
                if remainder is None and time.monotonic() >= self._wake_deadline:
                    self.bus.publish("wake_ignored", text=text, language=language)
                    print(f"[Voice] not addressed to me, ignoring: {text}")
                    return
                addressed = True
                if remainder is not None:
                    text = remainder
                if not text:  # bare "Hey G1" -> acknowledge, await the command
                    await self._speak(
                        CANNED["wake_ack"].get(language, CANNED["wake_ack"]["en"]), language
                    )
                    return

            if Session.is_reset_command(text):
                self.session.reset()
                self.bus.publish("session_reset", source="voice")
                await self._speak(CANNED["reset"].get(language, CANNED["reset"]["en"]), language)
                return

            if self.a2a is None:
                self.bus.publish("agent_skipped", reason="no A2A client wired")
                return

            context_id = self.session.context_id()
            t1 = time.monotonic()
            reply_arrived = asyncio.Event()
            filler = asyncio.create_task(self._thinking_filler(language, reply_arrived))
            try:
                reply = await self.a2a.send(text, context_id)
                self.metrics.record("agent", time.monotonic() - t1)
            finally:
                reply_arrived.set()
                try:
                    await filler  # if mid-sentence, finish before the reply
                except Exception as exc:  # noqa: BLE001
                    # This runs in a finally after a2a.send may already have
                    # succeeded; a filler TTS/playback glitch must NOT discard
                    # an already-received reply. Log and speak the reply anyway.
                    self.bus.publish("error", stage="filler", error=str(exc))
            self.session.touch()

            self.last_reply = {"text": reply.text, "state": reply.state, "ts": time.time()}
            self.bus.publish("reply", text=reply.text, state=reply.state)
            print(f"[Voice] reply ({reply.state}): {reply.text[:200]}")

            if reply.state == "failed" or not reply.text.strip():
                await self._speak(CANNED["error"].get(language, CANNED["error"]["en"]), language)
            else:
                await self._speak(reply.text, language)
            self.metrics.record("turn_total", time.monotonic() - turn_start)
        except Exception as exc:  # noqa: BLE001 — a broken turn must not kill the loop
            self.bus.publish("error", stage="turn", error=str(exc))
            print(f"[Voice] turn failed: {exc}")
            try:
                await self._speak(CANNED["error"].get(language, CANNED["error"]["en"]), language)
            except Exception:  # noqa: BLE001
                pass
        finally:
            if addressed:
                self._wake_deadline = time.monotonic() + self.config.wake_window_s
            await self._resume_listening()

    async def _thinking_filler(self, language: str, reply_arrived: asyncio.Event) -> None:
        """Speak a short acknowledgement if the agent is still thinking.

        Long LLM turns otherwise mean dead air after the user stops talking.
        If the reply arrives within thinking_filler_s the filler stays silent;
        once it starts speaking, _handle_turn awaits this task before the real
        reply, so filler and reply never overlap or reorder.
        """
        delay = self.config.thinking_filler_s
        if delay <= 0 or self.tts is None or self.audio_out is None:
            return
        try:
            await asyncio.wait_for(reply_arrived.wait(), timeout=delay)
            return  # reply came fast enough — no filler needed
        except asyncio.TimeoutError:
            pass
        self.bus.publish("thinking_filler", language=language)
        await self._speak(CANNED["thinking"].get(language, CANNED["thinking"]["en"]), language)
        self._set_state(State.THINKING)

    def _acquire_mic(self) -> None:
        """Take exclusive (muted) mic access for a speaking span.

        Ref-counted and paired with _resume_listening(): a /say that overlaps a
        live VAD turn (or another /say) increments the count and can't unmute
        the mic until every holder has released. Safe when audio_in/segmenter
        are unwired (TTS-only / no-VAD builds) — the guards no-op.
        """
        if self.audio_in is not None:
            self.audio_in.set_muted(True)
        if self.segmenter is not None:
            self.segmenter.reset()
        # Increment last so a raising backend can't leave a leaked holder that
        # would pin the mic muted forever.
        self._mic_holders += 1

    async def _resume_listening(self) -> None:
        """Release one mic holder; only the final release re-opens the mic."""
        self._mic_holders = max(0, self._mic_holders - 1)
        if self._mic_holders > 0:
            return  # another speaking span still holds the mic muted
        if self.audio_in is None:
            self._set_state(State.IDLE)
            return
        if self._paused:
            self._set_state(State.PAUSED)
            return
        await asyncio.sleep(self.config.half_duplex_tail_ms / 1000)
        # A new speaker may have re-acquired the mic DURING the tail sleep; if
        # so it now owns the mute and will re-open on its own release. Re-check
        # here — unmuting unconditionally would open the mic mid-/say and
        # re-break half-duplex (the bug this ref count exists to prevent).
        if self._mic_holders > 0:
            return
        if self.segmenter is not None:
            self.segmenter.reset()
        self.audio_in.set_muted(False)
        self._set_state(State.LISTENING)

    async def _speak(self, text: str, language: str) -> None:
        if self.tts is None or self.audio_out is None:
            self.bus.publish("speak_skipped", reason="no TTS/output wired", text=text[:100])
            return
        text = tts_normalize(text)
        if not text:
            return
        async with self._speak_lock:
            self._set_state(State.SPEAKING)
            t0 = time.monotonic()
            pcm, rate = await asyncio.to_thread(self.tts.synthesize, text, language)
            self.metrics.record("tts", time.monotonic() - t0)
            self.bus.publish("tts_start", chars=len(text), language=language)
            t1 = time.monotonic()
            await self.audio_out.play(pcm, rate)
            self.metrics.record("speak", time.monotonic() - t1)
            self.bus.publish("tts_end")

    # ------------------------------------------------------------------
    # PipelineController (called from HTTP server threads)
    # ------------------------------------------------------------------

    def health(self) -> dict:
        return {
            "status": "ok",
            "state": self._state.value,
            "paused": self._paused,
            "models_loaded": dict(self._models_loaded),
            "components": {
                "audio_in": self.audio_in is not None,
                "audio_out": self.audio_out is not None,
                "stt": self.stt is not None,
                "tts": self.tts is not None,
                "a2a": self.a2a is not None,
            },
            "agent_reachable": getattr(self.a2a, "last_ok", None),
        }

    def status(self) -> dict:
        return {
            "state": self._state.value,
            "paused": self._paused,
            "wake": {
                "enabled": bool(self.config.wake_phrases),
                "windowOpenS": round(max(0.0, self._wake_deadline - time.monotonic()), 1)
                if self.config.wake_phrases
                else None,
            },
            "contextId": self.session.peek(),
            "lastTranscript": self.last_transcript,
            "lastReply": self.last_reply,
            "metrics": self.metrics.summary(),
        }

    def get_config(self) -> dict:
        return self.config.public_dict()

    def patch_config(self, patch: dict) -> dict:
        changed = self.config.apply_patch(patch)
        if "session_timeout_s" in changed:
            self.session.timeout_s = int(changed["session_timeout_s"])
        if self.segmenter is not None and "vad_threshold" in changed:
            self.segmenter.threshold = float(changed["vad_threshold"])
        if "mode" in changed:
            # Re-gate only on an ACTUAL vad<->ptt transition: apply_patch echoes
            # every patched key in `changed` (even unchanged ones), so a UI
            # settings-resave carrying the same mode must NOT reset the segmenter
            # or disturb a live turn. Hand off to the loop like toggle_listen.
            new_paused = self.config.mode == "ptt"
            if new_paused != self._paused:
                self._paused = new_paused
                if self._loop is not None:
                    self._loop.call_soon_threadsafe(self._apply_pause, new_paused)
        self.bus.publish("config_changed", **changed)
        return changed

    def say(self, text: str, language: str | None) -> None:
        if self.tts is None or self.audio_out is None:
            raise RuntimeError("TTS path not available")
        if self._loop is None:
            raise RuntimeError("pipeline not running yet")
        lang = language if language in self.config.languages else self.config.default_language
        asyncio.run_coroutine_threadsafe(self._say_task(text, lang), self._loop)

    async def _say_task(self, text: str, language: str) -> None:
        # Ref-counted acquire/release keeps /say half-duplex-correct even when it
        # overlaps a live VAD turn or another /say, guards a missing segmenter
        # (VAD failed to load), and always restores the right resting state
        # (LISTENING / PAUSED / IDLE) — including when the pipeline is paused.
        self._acquire_mic()
        try:
            await self._speak(text, language)
        except Exception as exc:  # noqa: BLE001
            self.bus.publish("error", stage="say", error=str(exc))
            print(f"[Voice] /say failed: {exc}")
        finally:
            await self._resume_listening()

    def toggle_listen(self) -> bool:
        self._paused = not self._paused
        if self._loop is not None:
            self._loop.call_soon_threadsafe(self._apply_pause, self._paused)
        return self._paused

    def _apply_pause(self, paused: bool) -> None:
        if self.audio_in is not None:
            self.audio_in.set_muted(paused)
        if self.segmenter is not None:
            self.segmenter.reset()
        if paused:
            self._set_state(State.PAUSED)
        elif self.audio_in is not None:
            self._set_state(State.LISTENING)
        else:
            self._set_state(State.IDLE)
        self.bus.publish("listen_toggled", paused=paused)

    def reset_session(self) -> str:
        context_id = self.session.reset()
        self.bus.publish("session_reset", source="http")
        return context_id

    # ------------------------------------------------------------------

    def _set_state(self, state: State) -> None:
        if state is self._state:
            return
        self._state = state
        self.bus.publish("state", state=state.value)
