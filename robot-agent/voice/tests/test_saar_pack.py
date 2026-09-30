"""Tests for the Saarländisch voice pack: text prep, the /speak_pcm contract,
and how the pack degrades when it is not configured.

No test here opens a network connection except the opt-in live one at the
bottom, which needs VOICE_SAAR_LIVE_SPACE (an HF Space id or the URL of a
locally served `saar-tts serve`).
"""

from __future__ import annotations

import base64
import builtins
import os
import re

import pytest

from voice_service.config import VoiceConfig
from voice_service.tts.normalize import tts_normalize
from voice_service.tts.registry import (
    VOICE_PACKS,
    VoiceRegistry,
    VoiceUnavailableError,
    set_active_registry,
)
from voice_service.tts.saar_dialect import split_sentences, to_saarlaendisch
from voice_service.tts.saar_engine import SAAR_SAMPLE_RATE, SaarVoiceEngine

PCM = b"\x10\x00\x20\x00" * 40


@pytest.fixture(autouse=True)
def _no_leaked_registry():
    yield
    set_active_registry(None)


def _saar_pack():
    return next(p for p in VOICE_PACKS if p.id == "saar")


class FakeClient:
    """Stands in for gradio_client.Client; records predict() calls."""

    def __init__(self, response=None) -> None:
        self.calls: list[tuple[tuple, dict]] = []
        self.response = response if response is not None else {
            "pcm_base64": base64.b64encode(PCM).decode("ascii"),
            "sample_rate": SAAR_SAMPLE_RATE,
        }

    def predict(self, *args, **kwargs):
        self.calls.append((args, kwargs))
        return self.response


def _engine(client: FakeClient, space: str = "huhn511/saar-tts", speaker: str = "P03"):
    seen: dict = {}

    def factory(space_arg, token):
        seen["space"], seen["token"] = space_arg, token
        return client

    engine = SaarVoiceEngine(VoiceConfig.from_env(env={}), space=space, speaker=speaker,
                             client_factory=factory)
    return engine, seen


# -- the declared pack --------------------------------------------------------

def test_the_saar_pack_is_declared_honestly() -> None:
    pack = _saar_pack()
    assert pack.engine == "saar"
    assert pack.languages == ("de",)
    assert "CC-BY-NC-4.0" in pack.licence
    # The two caveats a customer must see: not shippable, not real-time.
    assert pack.commercial is False
    assert pack.realtime is False


def test_saar_is_a_voice_not_a_language() -> None:
    cfg = VoiceConfig.from_env(env={"VOICE_VOICE": "saar"})
    assert cfg.voice == "saar"
    # Selecting the dialect voice leaves what the robot *understands* alone:
    # Whisper can never return "saar", so it must never enter this list.
    assert cfg.languages == ("en", "de")
    assert cfg.default_language == "de"


# -- text prep ----------------------------------------------------------------

def test_prepare_lowercases_and_applies_the_dialect_rules() -> None:
    out = to_saarlaendisch("Ich bin der Roboter aus Saarbrücken", "de")
    assert out == "isch bin der roboter aus saarbrigge."
    assert out == out.lower()


def test_prepare_keeps_every_sentence_final_period() -> None:
    text = "Hallo, ich bin da. Das ist nicht schlecht! Wie geht es dir? Ich komme gleich"
    out = to_saarlaendisch(text, "de")
    # four sentences in, four chunk boundaries out — losing them would render
    # the whole reply as one chunk
    assert out.count(".") == 4
    assert len(split_sentences(out)) == 4
    assert out.endswith(".")
    assert "!" not in out and "?" not in out and "," not in out


def test_prepare_keeps_decimals_and_ordinals_inside_a_sentence() -> None:
    out = to_saarlaendisch("Ich gehe in den 2. Stock. Es sind 3.5 Meter.", "de")
    assert "3.5" in out
    assert out.endswith("meder.")


def test_protected_words_are_left_alone() -> None:
    out = to_saarlaendisch("Der Unitree G1 hat einen Akku.", "de")
    assert "unitree g1" in out and "akku" in out


def test_non_german_text_gets_the_orthography_but_not_the_dialect_rules() -> None:
    assert to_saarlaendisch("Hello there. I am a robot", "en") == "hello there. i am a robot."


def test_empty_text_prepares_to_empty() -> None:
    assert to_saarlaendisch("", "de") == ""
    assert to_saarlaendisch("  ...  ", "de") == ""


def test_normalize_then_prepare_keeps_the_line_break_periods() -> None:
    # tts_normalize() inserts sentence periods at line breaks and strips
    # markdown; the dialect stage must keep both effects.
    spoken = to_saarlaendisch(tts_normalize("**Hallo**\nIch bin da\n- und warte"), "de")
    assert "*" not in spoken
    assert len(split_sentences(spoken)) == 3


def test_the_engine_prepare_is_the_dialect_stage() -> None:
    engine, _ = _engine(FakeClient())
    assert engine.prepare("Das ist gut.", "de") == "des is gudd."


# -- the /speak_pcm contract --------------------------------------------------

def test_synthesize_calls_speak_pcm_at_16k_with_the_pack_speaker() -> None:
    client = FakeClient()
    engine, seen = _engine(client, speaker="P02")
    engine.load()
    pcm, rate = engine.synthesize("des is gudd.", "de", "saar")
    assert (pcm, rate) == (PCM, 16_000)
    (args, kwargs), = client.calls
    assert kwargs == {"api_name": "/speak_pcm"}
    text, speaker, speed, sample_rate, from_german, _mode = args
    assert (text, speaker, speed, sample_rate) == ("des is gudd.", "P02", 1.0, 16_000)
    # the dialect stage already ran locally; the Space must not run it again
    assert from_german is False
    assert seen["space"] == "huhn511/saar-tts"


def test_a_json_text_response_is_decoded() -> None:
    import json

    body = json.dumps({"pcm_base64": base64.b64encode(PCM).decode(), "sample_rate": 22_050})
    engine, _ = _engine(FakeClient(response=body))
    engine.load()
    assert engine.synthesize("a.", "de") == (PCM, 22_050)


def test_a_malformed_response_is_an_error_not_silence() -> None:
    engine, _ = _engine(FakeClient(response={"error": "gpu quota"}))
    engine.load()
    with pytest.raises(RuntimeError, match="unexpected /speak_pcm response"):
        engine.synthesize("a.", "de")


def test_the_token_comes_from_the_environment(monkeypatch) -> None:
    monkeypatch.setenv("HF_TOKEN", "hf_fallback")
    monkeypatch.setenv("VOICE_SAAR_TOKEN", "hf_specific")
    engine, seen = _engine(FakeClient())
    engine.load()
    assert seen["token"] == "hf_specific"


def test_the_token_is_never_part_of_the_published_config(monkeypatch) -> None:
    monkeypatch.setenv("VOICE_SAAR_TOKEN", "hf_secret_value")
    cfg = VoiceConfig.from_env()
    assert "hf_secret_value" not in repr(cfg.public_dict())


# -- degradation --------------------------------------------------------------

def test_an_unconfigured_saar_pack_is_unavailable_with_a_reason() -> None:
    # The real declared pack and the real factory: with no VOICE_SAAR_SPACE the
    # pack comes up unavailable, says why, and nothing else is affected.
    reg = VoiceRegistry(VoiceConfig.from_env(env={}), packs=[_saar_pack()])
    reg.load()
    assert not reg.is_loaded("saar")
    assert "VOICE_SAAR_SPACE is not set" in (reg.reason("saar") or "")
    with pytest.raises(VoiceUnavailableError, match="VOICE_SAAR_SPACE"):
        reg.resolve("saar")


def test_a_missing_gradio_client_is_unavailable_with_a_reason(monkeypatch) -> None:
    real_import = builtins.__import__

    def no_gradio(name, *args, **kwargs):
        if name.startswith("gradio_client"):
            raise ImportError("No module named 'gradio_client'")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", no_gradio)
    cfg = VoiceConfig.from_env(env={"VOICE_SAAR_SPACE": "huhn511/saar-tts"})
    reg = VoiceRegistry(cfg, packs=[_saar_pack()])
    reg.load()  # must not raise
    entry, = reg.describe()
    assert entry["available"] is False
    assert entry["reason"].startswith("ImportError:")
    assert "gradio_client" in entry["reason"]


def test_registry_prepare_routes_to_the_dialect_stage() -> None:
    client = FakeClient()
    reg = VoiceRegistry(
        VoiceConfig.from_env(env={}),
        packs=[_saar_pack()],
        factories={"saar": lambda c, p: _engine(client)[0]},
    )
    reg.load()
    assert reg.prepare("Ich bin da.", "de", "saar") == "isch bin dòò."
    reg.synthesize("isch bin dòò.", "de", "saar")
    assert client.calls[0][0][0] == "isch bin dòò."


# -- live (opt-in) ------------------------------------------------------------

LIVE_SPACE = os.environ.get("VOICE_SAAR_LIVE_SPACE", "")


@pytest.mark.skipif(not LIVE_SPACE, reason="set VOICE_SAAR_LIVE_SPACE to run against a real Saar app")
def test_live_saar_synthesis_returns_16k_speech() -> None:
    pytest.importorskip("gradio_client")
    engine = SaarVoiceEngine(VoiceConfig.from_env(env={}), space=LIVE_SPACE, speaker="P03")
    engine.load()
    text = engine.prepare("Hallo, ich bin der Roboter. Das ist gut.", "de")
    assert re.fullmatch(r"[a-zäöüßò .]+", text)
    pcm, rate = engine.synthesize(text, "de", "saar")
    assert rate == 16_000
    seconds = len(pcm) / 2 / rate
    assert 1.0 < seconds < 20.0, seconds
