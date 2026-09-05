"""Tests for the voice pack registry: declaration, degradation, resolution.

The two behaviours worth protecting here are the ones a customer-supplied pack
would otherwise break: a pack that cannot load must not take the service down,
and an unknown or unloaded pack must never be answered in some other voice.
"""

import os
from pathlib import Path

import pytest

from voice_service.config import VALID_TTS_ENGINES, VoiceConfig
from voice_service.tts.base import TTSEngine
from voice_service.tts.registry import (
    ENGINE_FACTORIES,
    VOICE_PACKS,
    UnknownVoiceError,
    VoicePack,
    VoiceRegistry,
    VoiceUnavailableError,
    engine_ids,
    pack_ids,
    set_active_registry,
)

PCM = b"\x00\x01" * 8


class FakeEngine(TTSEngine):
    """Engine that records what it was asked for; no model, no audio device."""

    def __init__(self, rate: int = 16_000) -> None:
        self.rate = rate
        self.calls: list[tuple[str, str, str | None]] = []

    def load(self) -> None:
        return None

    def synthesize(self, text, language, voice=None):
        self.calls.append((text, language, voice))
        return PCM, self.rate


class ShoutingEngine(FakeEngine):
    """Engine with its own prepare() — the seam a dialect pack would use."""

    def prepare(self, text: str, language: str) -> str:
        return text.upper()


def _pack(pack_id: str, **overrides) -> VoicePack:
    base = {
        "label": f"test {pack_id}",
        "engine": "fake",
        "languages": ("de",),
        "licence": "MIT",
        "commercial": True,
        "realtime": True,
    }
    base.update(overrides)
    return VoicePack(id=pack_id, **base)


def _config(**overrides) -> VoiceConfig:
    cfg = VoiceConfig.from_env(env={})
    for key, value in overrides.items():
        setattr(cfg, key, value)
    return cfg


@pytest.fixture(autouse=True)
def _no_leaked_registry():
    # The active registry is process-global (config.apply_patch consults it);
    # a leak from one test would silently decide another one's outcome.
    yield
    set_active_registry(None)


# ---------------------------------------------------------------------------
# Declaration
# ---------------------------------------------------------------------------


def test_declared_packs_carry_the_full_metadata() -> None:
    assert VOICE_PACKS, "at least one voice pack must be declared"
    for pack in VOICE_PACKS:
        assert pack.id and pack.label
        assert pack.engine in ENGINE_FACTORIES
        assert isinstance(pack.languages, tuple) and pack.languages
        assert pack.licence
        assert isinstance(pack.commercial, bool)
        assert isinstance(pack.realtime, bool)


def test_pack_ids_are_unique() -> None:
    assert len(set(pack_ids())) == len(pack_ids())


def test_valid_tts_engines_is_derived_from_the_registry() -> None:
    # A hand-kept list here is the bug this assertion exists to catch.
    assert VALID_TTS_ENGINES == engine_ids()
    assert set(VALID_TTS_ENGINES) == set(ENGINE_FACTORIES)


def test_the_two_piper_packs_are_declared_per_language() -> None:
    piper = {p.id: p for p in VOICE_PACKS if p.engine == "piper"}
    assert set(piper) == {"piper_de", "piper_en"}
    assert piper["piper_de"].languages == ("de",)
    assert piper["piper_en"].languages == ("en",)
    assert piper["piper_de"].realtime and piper["piper_en"].realtime


def test_piper_packs_resolve_to_their_own_voice_model() -> None:
    # The factory runs for real (no model load): one pack, one Piper voice.
    cfg = _config()
    piper = [p for p in VOICE_PACKS if p.engine == "piper"]
    engines = {p.id: ENGINE_FACTORIES["piper"](cfg, p) for p in piper}
    assert engines["piper_de"].voice_name == cfg.piper_voice_de
    assert engines["piper_en"].voice_name == cfg.piper_voice_en


# ---------------------------------------------------------------------------
# Degradation: a bad pack must not take the service down
# ---------------------------------------------------------------------------


def _boom_import(config, pack):
    raise ImportError("No module named 'gradio_client'")


def _boom_load(config, pack):
    class Broken(FakeEngine):
        def load(self) -> None:
            raise RuntimeError("HTTP 401 from the voice space")

    return Broken()


def test_pack_whose_engine_cannot_be_imported_is_unavailable_with_a_reason() -> None:
    reg = VoiceRegistry(_config(), packs=[_pack("remote")], factories={"fake": _boom_import})
    reg.load()  # must not raise
    assert reg.is_loaded("remote") is False
    reason = reg.reason("remote")
    assert "ImportError" in reason and "gradio_client" in reason


def test_pack_whose_model_fails_to_load_is_unavailable_with_a_reason() -> None:
    reg = VoiceRegistry(_config(), packs=[_pack("remote")], factories={"fake": _boom_load})
    reg.load()
    assert reg.is_loaded("remote") is False
    assert "401" in reg.reason("remote")


def test_a_broken_pack_leaves_the_others_speaking() -> None:
    good = FakeEngine()
    factories = {"fake": lambda c, p: good, "broken": _boom_import}
    reg = VoiceRegistry(
        _config(),
        packs=[_pack("good"), _pack("bad", engine="broken")],
        factories=factories,
    )
    reg.load()
    assert reg.loaded_ids() == ("good",)
    assert reg.synthesize("hallo", "de", "good") == (PCM, 16_000)


def test_pack_with_an_undeclared_engine_is_unavailable_not_fatal() -> None:
    reg = VoiceRegistry(_config(), packs=[_pack("orphan", engine="nope")], factories={})
    reg.load()
    assert reg.is_loaded("orphan") is False
    assert "nope" in reg.reason("orphan")


def test_load_survives_every_pack_failing() -> None:
    reg = VoiceRegistry(
        _config(), packs=[_pack("a"), _pack("b")], factories={"fake": _boom_import}
    )
    reg.load()
    assert reg.loaded_ids() == ()


# ---------------------------------------------------------------------------
# Resolution: never a silent fallback
# ---------------------------------------------------------------------------


def test_unknown_pack_id_is_an_error() -> None:
    good = FakeEngine()
    reg = VoiceRegistry(_config(), packs=[_pack("good")], factories={"fake": lambda c, p: good})
    reg.load()
    with pytest.raises(UnknownVoiceError, match="does-not-exist"):
        reg.resolve("does-not-exist")
    with pytest.raises(UnknownVoiceError):
        reg.synthesize("hallo", "de", "does-not-exist")
    assert good.calls == []  # the loaded pack must NOT have answered instead


def test_declared_but_unloaded_pack_is_an_error_carrying_the_reason() -> None:
    good = FakeEngine()
    factories = {"fake": lambda c, p: good, "broken": _boom_import}
    reg = VoiceRegistry(
        _config(),
        packs=[_pack("good"), _pack("bad", engine="broken")],
        factories=factories,
    )
    reg.load()
    with pytest.raises(VoiceUnavailableError, match="gradio_client"):
        reg.synthesize("hallo", "de", "bad")
    assert good.calls == []


def test_synthesize_defaults_to_the_configured_voice() -> None:
    de, en = FakeEngine(), FakeEngine()
    engines = {"de": de, "en": en}
    reg = VoiceRegistry(
        _config(voice="en"),
        packs=[_pack("de"), _pack("en")],
        factories={"fake": lambda c, p: engines[p.id]},
    )
    reg.load()
    reg.synthesize("hello", "en")
    assert de.calls == []
    assert en.calls == [("hello", "en", "en")]


def test_language_and_voice_are_independent() -> None:
    # An English sentence spoken by the German pack is a choice, not an error.
    de = FakeEngine()
    reg = VoiceRegistry(_config(), packs=[_pack("de")], factories={"fake": lambda c, p: de})
    reg.load()
    reg.synthesize("hello", "en", "de")
    assert de.calls == [("hello", "en", "de")]


def test_describe_reports_availability_and_licence_for_the_api() -> None:
    factories = {"fake": lambda c, p: FakeEngine(), "broken": _boom_import}
    reg = VoiceRegistry(
        _config(),
        packs=[_pack("good", licence="CC-BY-NC-4.0", commercial=False, realtime=False),
               _pack("bad", engine="broken")],
        factories=factories,
    )
    reg.load()
    by_id = {entry["id"]: entry for entry in reg.describe()}
    assert by_id["good"] == {
        "id": "good",
        "label": "test good",
        "engine": "fake",
        "languages": ["de"],
        "licence": "CC-BY-NC-4.0",
        "commercial": False,
        "realtime": False,
        "available": True,
        "reason": None,
    }
    assert by_id["bad"]["available"] is False
    assert "ImportError" in by_id["bad"]["reason"]


def test_reason_is_none_for_a_loaded_pack_and_set_for_an_unknown_one() -> None:
    reg = VoiceRegistry(
        _config(), packs=[_pack("good")], factories={"fake": lambda c, p: FakeEngine()}
    )
    reg.load()
    assert reg.reason("good") is None
    assert "unknown" in reg.reason("nope")


# ---------------------------------------------------------------------------
# prepare()
# ---------------------------------------------------------------------------


def test_prepare_defaults_to_identity() -> None:
    reg = VoiceRegistry(
        _config(), packs=[_pack("plain")], factories={"fake": lambda c, p: FakeEngine()}
    )
    reg.load()
    text = "Der Akku ist bei 61 Prozent. Alles in Ordnung."
    assert reg.prepare(text, "de", "plain") == text


def test_engine_prepare_is_used_when_the_pack_declares_none() -> None:
    reg = VoiceRegistry(
        _config(), packs=[_pack("loud")], factories={"fake": lambda c, p: ShoutingEngine()}
    )
    reg.load()
    assert reg.prepare("hallo.", "de", "loud") == "HALLO."


def test_pack_prepare_is_applied_and_keeps_sentence_periods() -> None:
    # Sentence-final periods are the chunk boundary for a streaming engine;
    # a prep stage that eats them collapses the text into one long chunk.
    def dialect(text: str, language: str) -> str:
        return text.lower().replace("nicht", "nedd")

    reg = VoiceRegistry(
        _config(),
        packs=[_pack("dialect", prepare=dialect)],
        factories={"fake": lambda c, p: ShoutingEngine()},
    )
    reg.load()
    out = reg.prepare("Das ist Nicht schlimm. Alles gut.", "de", "dialect")
    assert out == "das ist nedd schlimm. alles gut."  # the pack wins over the engine
    assert out.count(".") == 2


def test_prepare_on_an_unloaded_pack_is_an_error() -> None:
    reg = VoiceRegistry(_config(), packs=[_pack("bad")], factories={"fake": _boom_import})
    reg.load()
    with pytest.raises(VoiceUnavailableError):
        reg.prepare("hallo", "de", "bad")


# ---------------------------------------------------------------------------
# Config: VOICE_VOICE and the runtime switch
# ---------------------------------------------------------------------------


def test_voice_defaults_to_a_declared_pack() -> None:
    cfg = VoiceConfig.from_env(env={})
    assert cfg.voice == "piper_de"
    assert cfg.voice in pack_ids()


def test_voice_env_override() -> None:
    assert VoiceConfig.from_env(env={"VOICE_VOICE": "piper_en"}).voice == "piper_en"


def test_undeclared_voice_env_is_rejected() -> None:
    with pytest.raises(ValueError, match="VOICE_VOICE"):
        VoiceConfig.from_env(env={"VOICE_VOICE": "saar"})


def test_runtime_switch_between_loaded_packs_works() -> None:
    reg = VoiceRegistry(
        _config(),
        packs=[_pack("piper_de"), _pack("piper_en")],
        factories={"fake": lambda c, p: FakeEngine()},
    )
    reg.load()
    set_active_registry(reg)
    cfg = VoiceConfig.from_env(env={})
    assert cfg.apply_patch({"voice": "piper_en"}) == {"voice": "piper_en"}
    assert cfg.voice == "piper_en"


def test_runtime_switch_to_an_unloaded_pack_is_rejected_and_rolled_back() -> None:
    reg = VoiceRegistry(
        _config(),
        packs=[_pack("piper_de"), _pack("piper_en", engine="broken")],
        factories={"fake": lambda c, p: FakeEngine(), "broken": _boom_import},
    )
    reg.load()
    set_active_registry(reg)
    cfg = VoiceConfig.from_env(env={})
    with pytest.raises(ValueError, match="not loaded"):
        cfg.apply_patch({"voice": "piper_en"})
    assert cfg.voice == "piper_de"  # no silent switch, no half-applied patch


def test_runtime_switch_rollback_covers_the_rest_of_the_patch() -> None:
    reg = VoiceRegistry(
        _config(),
        packs=[_pack("piper_de"), _pack("piper_en", engine="broken")],
        factories={"fake": lambda c, p: FakeEngine(), "broken": _boom_import},
    )
    reg.load()
    set_active_registry(reg)
    cfg = VoiceConfig.from_env(env={})
    with pytest.raises(ValueError):
        cfg.apply_patch({"mode": "ptt", "voice": "piper_en"})
    assert cfg.mode == "vad"
    assert cfg.voice == "piper_de"


def test_unrelated_patches_still_work_when_the_active_voice_is_unloaded() -> None:
    # A config whose selected pack failed to load must not brick POST /config —
    # the voice is broken, the VAD knobs are not.
    reg = VoiceRegistry(_config(), packs=[_pack("piper_de")], factories={"fake": _boom_import})
    reg.load()
    set_active_registry(reg)
    cfg = VoiceConfig.from_env(env={})
    assert cfg.apply_patch({"vad_threshold": 0.65}) == {"vad_threshold": 0.65}


# ---------------------------------------------------------------------------
# The real Piper packs (skipped unless the voice models are on disk)
# ---------------------------------------------------------------------------


def _models_dir() -> Path:
    raw = os.environ.get("VOICE_MODELS_DIR")
    return Path(raw) if raw else VoiceConfig.from_env(env={}).models_dir


_HAVE_PIPER_MODELS = (_models_dir() / "piper" / "de_DE-thorsten-high.onnx").exists()

# Opt-in (VOICE_TEST_PIPER=1) on top of the models being present: this one
# needs the ~230 MB of gitignored voice models AND a working espeak-ng bridge,
# so it is an environment check, not a unit test.
_RUN_PIPER = _HAVE_PIPER_MODELS and os.environ.get("VOICE_TEST_PIPER") == "1"

_PIPER_PROBE = """
import sys
sys.path.insert(0, {root!r})
from voice_service.config import VoiceConfig
from voice_service.tts.registry import VoiceRegistry

cfg = VoiceConfig.from_env(env={{"VOICE_MODELS_DIR": {models!r}}})
reg = VoiceRegistry(cfg)
reg.load()
assert set(reg.loaded_ids()) == {{"piper_de", "piper_en"}}, reg.describe()
for voice in ("piper_de", "piper_en"):
    pcm, rate = reg.synthesize("Hallo, hier spricht der Roboter.", "de", voice)
    assert len(pcm) > 1000 and rate == 22_050, (voice, len(pcm), rate)
    print(voice, len(pcm), rate)
"""


@pytest.mark.skipif(not _RUN_PIPER, reason="set VOICE_TEST_PIPER=1 with the Piper models on disk")
def test_real_piper_packs_load_and_synthesize() -> None:
    # Out of process on purpose: piper's espeak-ng bridge is a native library
    # that calls exit() on a bad data path instead of raising, which would take
    # the test runner (and, in production, the service) down with it. A
    # subprocess turns that into a return code the registry contract can talk
    # about.
    import subprocess
    import sys

    root = str(Path(__file__).resolve().parent.parent)
    probe = _PIPER_PROBE.format(root=root, models=str(_models_dir()))
    done = subprocess.run(
        [sys.executable, "-c", probe],
        capture_output=True,
        text=True,
        timeout=300,
    )
    assert done.returncode == 0, f"stdout={done.stdout}\nstderr={done.stderr}"
