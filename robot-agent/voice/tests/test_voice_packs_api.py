"""The HTTP surface of the voice axis: /say, /health, /voices, /status.

These drive the real VoiceHttpServer over a socket rather than calling the
controller, because the status code *is* the contract here: a 4xx that only
exists in the handler's exception table is not a 4xx to the caller.

Four behaviours are worth this much machinery, and each of them is a way the
product lies to a customer if it breaks:

* asking for a voice that does not exist, or one that failed to load, must be
  an error — a robot that answers in Piper Thorsten when it was asked for the
  customer's own voice looks perfectly healthy while being wrong;
* a pack that failed to load must still be *listed*, with its reason, since an
  omitted pack is indistinguishable from one nobody ever configured;
* a pack that hangs (see the unresolved upstream stall recorded in TASK-229)
  must fail its own request and leave the service able to speak the next one;
* per-pack latency has to be visible, or a slow voice is indistinguishable from
  a slow robot.
"""

from __future__ import annotations

import asyncio
import http.client
import json
import threading
import time

import pytest

from voice_service import pipeline as pipeline_module
from voice_service.config import VoiceConfig
from voice_service.events import EventBus
from voice_service.http_api import VoiceHttpServer
from voice_service.pipeline import VoicePipeline
from voice_service.tts.base import TTSEngine
from voice_service.tts.registry import VoicePack, VoiceRegistry

PCM = b"\x00\x01" * 8

GOOD = "test_good"
SLOW = "test_slow"
BROKEN = "test_broken"
PREP = "test_prep"


# ---------------------------------------------------------------------------
# Doubles
# ---------------------------------------------------------------------------


class RecordingEngine(TTSEngine):
    """Speaks nothing, remembers every request. No model, no audio device."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, str, str | None]] = []

    def load(self) -> None:
        return None

    def synthesize(self, text, language, voice=None):
        self.calls.append((text, language, voice))
        return PCM, 16_000

    @property
    def texts(self) -> list[str]:
        return [call[0] for call in self.calls]


class HangingEngine(RecordingEngine):
    """The upstream hang, made local: synthesize() blocks until released."""

    def __init__(self) -> None:
        super().__init__()
        self.entered = threading.Event()
        self.release = threading.Event()

    def synthesize(self, text, language, voice=None):
        self.calls.append((text, language, voice))
        self.entered.set()
        # Bounded so a broken test leaks a thread for a while instead of
        # hanging the suite the way the real bug hangs a robot.
        self.release.wait(30)
        return PCM, 16_000


class FakeMic:
    def __init__(self) -> None:
        self.muted = False

    def set_muted(self, muted: bool) -> None:
        self.muted = muted


class FakeOut:
    async def play(self, pcm: bytes, rate: int) -> None:
        return None


def _pack(pack_id: str, engine: str, **overrides) -> VoicePack:
    base = {
        "label": f"test {pack_id}",
        "engine": engine,
        "languages": ("de",),
        "licence": "MIT",
        "commercial": True,
        "realtime": True,
    }
    base.update(overrides)
    return VoicePack(id=pack_id, **base)


# ---------------------------------------------------------------------------
# Harness
# ---------------------------------------------------------------------------


class Harness:
    """Pipeline + registry + the real HTTP server, each on its own thread."""

    def __init__(self, registry: VoiceRegistry, config: VoiceConfig) -> None:
        self.bus = EventBus()
        self.mic = FakeMic()
        self.pipeline = VoicePipeline(
            config,
            self.bus,
            audio_in=self.mic,
            audio_out=FakeOut(),
            tts=registry,
        )
        self.loop = asyncio.new_event_loop()
        self._thread = threading.Thread(target=self.loop.run_forever, daemon=True)
        self._thread.start()
        asyncio.run_coroutine_threadsafe(self._arm_pipeline(), self.loop).result(5)
        self.http = VoiceHttpServer(0, self.pipeline, self.bus)
        # Port 0 lets the OS pick a free one; the server keeps it to itself.
        self.port = self.http._server.server_address[1]
        self.http.start()

    async def _arm_pipeline(self) -> None:
        # What run() would do, minus the models: the primitives must be created
        # on the loop that will await them.
        self.pipeline._loop = asyncio.get_running_loop()
        self.pipeline._stop = asyncio.Event()
        self.pipeline._gpu_lock = asyncio.Lock()
        self.pipeline._speak_lock = asyncio.Lock()

    def request(self, method: str, path: str, body: dict | None = None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        try:
            payload = None if body is None else json.dumps(body)
            headers = {"Content-Type": "application/json"} if payload else {}
            conn.request(method, path, payload, headers)
            response = conn.getresponse()
            raw = response.read()
            return response.status, (json.loads(raw) if raw else {})
        finally:
            conn.close()

    def say(self, text: str, **body):
        return self.request("POST", "/say", {"text": text, **body})

    def events(self, type_: str) -> list[dict]:
        return [e.data for e in self.bus.history(limit=100) if e.type == type_]

    def close(self) -> None:
        self.http.stop()
        self.loop.call_soon_threadsafe(self.loop.stop)
        self._thread.join(timeout=5)
        self.loop.close()


def wait_until(predicate, timeout_s: float = 5.0) -> bool:
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.01)
    return predicate()


def _boom(config, pack):
    raise ImportError("No module named 'gradio_client'")


@pytest.fixture()
def service():
    """Four packs: one plain, one non-realtime that can hang, one that fails to
    load, one with a text-prep hook (what a dialect pack uses)."""
    engines = {"good": RecordingEngine(), "slow": HangingEngine()}
    prepared: list[str] = []

    def shout(text: str, language: str) -> str:
        prepared.append(text)
        return text.upper()

    packs = (
        _pack(GOOD, "good"),
        _pack(SLOW, "slow", realtime=False, licence="CC-BY-NC-4.0", commercial=False),
        _pack(BROKEN, "broken"),
        _pack(PREP, "good", prepare=shout),
    )
    factories = {
        "good": lambda config, pack: engines["good"],
        "slow": lambda config, pack: engines["slow"],
        "broken": _boom,
    }
    config = VoiceConfig(half_duplex_tail_ms=10)
    config.voice = GOOD  # set directly: validate() only knows the shipped packs
    registry = VoiceRegistry(config, packs=packs, factories=factories)
    registry.load()
    harness = Harness(registry, config)
    harness.engines = engines
    harness.registry = registry
    harness.prepared = prepared
    try:
        yield harness
    finally:
        engines["slow"].release.set()  # let any abandoned thread finish
        harness.close()


# ---------------------------------------------------------------------------
# /say never falls back
# ---------------------------------------------------------------------------


def test_say_with_an_unknown_voice_is_4xx_and_speaks_nothing(service) -> None:
    status, body = service.say("Hallo", voice="does-not-exist")

    assert status == 404
    assert "does-not-exist" in body["error"]
    # The whole point: no substitute voice spoke instead. /say is
    # fire-and-forget, so give a wrongly-queued utterance time to appear.
    time.sleep(0.1)
    assert service.engines["good"].calls == []


def test_say_with_a_declared_but_unloaded_voice_is_4xx_and_speaks_nothing(service) -> None:
    status, body = service.say("Hallo", voice=BROKEN)

    assert status == 409
    # The reason has to say *why*, not just "no": an operator cannot act on a
    # bare "unavailable".
    assert BROKEN in body["error"]
    assert "gradio_client" in body["error"]
    time.sleep(0.1)
    assert service.engines["good"].calls == []


def test_say_with_a_loaded_voice_speaks_in_that_pack_only(service) -> None:
    status, _ = service.say("Hallo", voice=SLOW)
    assert status == 202

    slow = service.engines["slow"]
    assert wait_until(lambda: slow.calls != [])
    slow.release.set()
    assert slow.calls[0][2] == SLOW
    assert service.engines["good"].calls == []  # the default pack stayed silent


def test_say_without_a_voice_uses_the_configured_pack(service) -> None:
    status, body = service.say("Hallo", language="de")
    assert status == 202
    # The response names the pack that will speak, so a caller never has to
    # assume which voice it got.
    assert body["voice"] == GOOD
    assert wait_until(lambda: service.engines["good"].calls != [])
    assert service.engines["good"].calls[0][2] == GOOD


# ---------------------------------------------------------------------------
# Listing the packs
# ---------------------------------------------------------------------------


def test_health_lists_an_unavailable_pack_with_its_reason(service) -> None:
    status, body = service.request("GET", "/health")

    assert status == 200
    listed = {entry["id"]: entry for entry in body["voice"]["voices"]}
    assert set(listed) == {GOOD, SLOW, BROKEN, PREP}

    broken = listed[BROKEN]
    assert broken["available"] is False
    assert "ImportError" in broken["reason"]
    assert "gradio_client" in broken["reason"]

    assert listed[GOOD]["available"] is True
    assert listed[GOOD]["reason"] is None
    assert body["voice"]["active"] == GOOD
    assert body["voice"]["available"] is True


def test_health_carries_the_licence_and_realtime_flags(service) -> None:
    _, body = service.request("GET", "/health")
    slow = {entry["id"]: entry for entry in body["voice"]["voices"]}[SLOW]

    # A non-commercial or non-real-time pack has to say so where the UI can see
    # it — those two fields decide whether a customer may ship the voice and
    # whether it belongs in a live conversational turn.
    assert slow["licence"] == "CC-BY-NC-4.0"
    assert slow["commercial"] is False
    assert slow["realtime"] is False


def test_voices_endpoint_is_the_list_the_server_relays(service) -> None:
    status, body = service.request("GET", "/voices")

    assert status == 200
    assert body["active"] == GOOD
    assert [entry["id"] for entry in body["voices"]] == [GOOD, SLOW, BROKEN, PREP]
    # Engine internals (which model file, which reference speaker) stay inside.
    assert "options" not in body["voices"][0]


# ---------------------------------------------------------------------------
# Order, latency, containment
# ---------------------------------------------------------------------------


def test_normalize_runs_before_the_pack_prepare_hook(service) -> None:
    # Dialect rules must see prose, not markdown — so tts_normalize() first,
    # then the pack's own prep, then the engine. And the sentence periods the
    # normalizer inserts have to survive the hook: they are the chunk boundary
    # a synthesizer splits on, and a text without them is one long chunk.
    status, _ = service.say("**Hallo** Welt\nZweiter Satz", voice=PREP)
    assert status == 202
    assert wait_until(lambda: service.engines["good"].calls != [])

    assert service.prepared == ["Hallo Welt. Zweiter Satz"]
    assert service.engines["good"].texts == ["HALLO WELT. ZWEITER SATZ"]


def test_status_reports_tts_latency_per_pack(service) -> None:
    service.say("Hallo", voice=GOOD)
    assert wait_until(lambda: service.engines["good"].calls != [])

    slow = service.engines["slow"]
    service.say("Hallo", voice=SLOW)
    assert wait_until(lambda: slow.entered.is_set())
    slow.release.set()
    assert wait_until(lambda: len(service.pipeline.metrics.summary()["stages"]) >= 4)

    _, body = service.request("GET", "/status")
    per_pack = body["voice"]["tts"]
    # Both packs are timed separately; the aggregate stays for existing readers.
    assert GOOD in per_pack and SLOW in per_pack
    assert per_pack[GOOD]["count"] == 1
    assert body["metrics"]["stages"]["tts"]["count"] == 2
    assert body["voice"]["active"] == GOOD


def test_the_timeout_scales_with_the_text_and_with_the_realtime_flag(service) -> None:
    # A fixed ceiling would either be useless against a hang or cut off a long
    # reply mid-sentence, so it grows with the text — and a pack that declares
    # itself non-realtime is allowed to be slow without being called wedged.
    short = service.pipeline._tts_timeout_s(GOOD, "Hallo.")
    long = service.pipeline._tts_timeout_s(GOOD, "Hallo. " * 200)
    assert long > short * 10

    assert service.pipeline._tts_timeout_s(SLOW, "Hallo.") > short


def test_a_hanging_pack_times_out_and_the_service_still_speaks(
    service, monkeypatch: pytest.MonkeyPatch
) -> None:
    # The containment for the unresolved upstream stall: the request dies, the
    # service does not. The synthesis thread is abandoned, not killed — Python
    # cannot interrupt it — which is why it runs off the shared executor.
    monkeypatch.setattr(pipeline_module, "TTS_TIMEOUT_BASE_S", 0.2)
    monkeypatch.setattr(pipeline_module, "TTS_SLOW_TIMEOUT_RTF", 0.0)
    slow = service.engines["slow"]

    status, _ = service.say("Das haengt", voice=SLOW)
    assert status == 202  # accepted; the failure surfaces on the event stream
    assert wait_until(lambda: slow.entered.is_set())

    assert wait_until(lambda: service.events("error") != [], timeout_s=5)
    error = service.events("error")[-1]
    assert error["stage"] == "say"
    assert SLOW in error["error"] and "no audio within" in error["error"]

    # ... and the next utterance goes through while that thread is still stuck.
    assert not slow.release.is_set()
    service.say("Und weiter", voice=GOOD)
    assert wait_until(lambda: service.engines["good"].calls != [])

    # Not wedged in 'speaking' with a mic held muted: the speak lock and the
    # half-duplex hold were both released when the request failed.
    assert wait_until(
        lambda: service.request("GET", "/status")[1]["state"] == "listening"
    )
    assert service.mic.muted is False
