"""Tests for VoiceConfig env parsing, validation, and runtime patching."""

import pytest

from voice_service.config import VoiceConfig


def test_defaults() -> None:
    cfg = VoiceConfig.from_env(env={})
    assert cfg.http_port == 8768
    assert cfg.mode == "vad"
    assert cfg.languages == ("en", "de")
    assert cfg.default_language == "de"
    assert cfg.input_backend == "local"
    assert cfg.agent_url == "http://localhost:41244/"


def test_env_overrides() -> None:
    cfg = VoiceConfig.from_env(
        env={
            "VOICE_HTTP_PORT": "9000",
            "VOICE_MODE": "ptt",
            "VOICE_LANGUAGES": "de, en",
            "VOICE_VAD_THRESHOLD": "0.7",
            "VOICE_AGENT_URL": "http://localhost:41243/",
            "VOICE_INPUT_BACKEND": "g1",
        }
    )
    assert cfg.http_port == 9000
    assert cfg.mode == "ptt"
    assert cfg.languages == ("de", "en")
    assert cfg.vad_threshold == 0.7
    assert cfg.input_backend == "g1"


def test_invalid_mode_rejected() -> None:
    with pytest.raises(ValueError, match="VOICE_MODE"):
        VoiceConfig.from_env(env={"VOICE_MODE": "open"})


def test_default_language_must_be_allowed() -> None:
    with pytest.raises(ValueError, match="VOICE_DEFAULT_LANGUAGE"):
        VoiceConfig.from_env(env={"VOICE_LANGUAGES": "en", "VOICE_DEFAULT_LANGUAGE": "de"})


def test_agent_url_must_be_http() -> None:
    with pytest.raises(ValueError, match="VOICE_AGENT_URL"):
        VoiceConfig.from_env(env={"VOICE_AGENT_URL": "tcp://x"})


def test_piper_voice_selection() -> None:
    cfg = VoiceConfig.from_env(env={})
    assert cfg.piper_voice_for("de") == cfg.piper_voice_de
    assert cfg.piper_voice_for("en") == cfg.piper_voice_en
    assert cfg.piper_voice_for("fr") == cfg.piper_voice_de  # falls back to default lang


def test_runtime_patch_applies_and_validates() -> None:
    cfg = VoiceConfig.from_env(env={})
    changed = cfg.apply_patch({"vad_threshold": 0.65, "mode": "ptt"})
    assert changed == {"vad_threshold": 0.65, "mode": "ptt"}
    assert cfg.vad_threshold == 0.65


def test_runtime_patch_rejects_immutable_key() -> None:
    cfg = VoiceConfig.from_env(env={})
    with pytest.raises(ValueError, match="not runtime-mutable"):
        cfg.apply_patch({"stt_model": "tiny"})


def test_runtime_patch_rejects_invalid_value() -> None:
    cfg = VoiceConfig.from_env(env={})
    with pytest.raises(ValueError):
        cfg.apply_patch({"vad_threshold": 3.0})
