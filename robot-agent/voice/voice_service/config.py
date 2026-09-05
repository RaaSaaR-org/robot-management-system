"""Configuration for the voice service.

All settings come from VOICE_* environment variables with sensible defaults,
optionally overridden by CLI flags (see __main__.py). Follows the sidecar
convention of the surrounding repo: env-var driven, UPPER_SNAKE names.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field, fields
from pathlib import Path

from .tts.registry import active_registry, engine_ids, pack_ids

ENV_PREFIX = "VOICE_"

VALID_MODES = ("vad", "ptt")
VALID_BACKENDS = ("local", "g1")
# Derived, never hand-kept: a literal list here would silently drift out of
# step with the packs the registry can actually build.
VALID_TTS_ENGINES = engine_ids()

# Audio contract used across the whole pipeline (Silero v5+ requires
# 512-sample frames at 16 kHz; the G1 speaker/mic are 16 kHz s16le too).
PIPELINE_SAMPLE_RATE = 16_000
FRAME_SAMPLES = 512
FRAME_BYTES = FRAME_SAMPLES * 2  # s16le mono


@dataclass(slots=True)
class VoiceConfig:
    """Runtime configuration, resolved once at startup."""

    http_port: int = 8768
    agent_url: str = "http://localhost:41244/"
    mode: str = "vad"  # "vad" (open mic) | "ptt" (gated via /listen/toggle)

    input_backend: str = "local"  # "local" | "g1"
    output_backend: str = "local"  # "local" | "g1"
    input_device: str | None = None  # sounddevice index or name substring
    output_device: str | None = None

    stt_model: str = "large-v3-turbo"
    stt_device: str = "cuda"
    stt_compute: str = "float16"

    languages: tuple[str, ...] = ("en", "de")
    default_language: str = "de"
    language_min_prob: float = 0.6

    tts_engine: str = "piper"
    # The selected voice pack (tts/registry.py). A voice is its own axis: it is
    # not derived from `languages` and does not constrain what may be spoken.
    voice: str = "piper_de"
    piper_voice_de: str = "de_DE-thorsten-high"
    piper_voice_en: str = "en_US-lessac-high"

    vad_threshold: float = 0.5
    vad_min_speech_ms: int = 250
    vad_min_silence_ms: int = 700
    vad_max_utterance_s: int = 30
    vad_pre_roll_ms: int = 300

    half_duplex_tail_ms: int = 250
    session_timeout_s: int = 300
    a2a_timeout_s: float = 90.0
    # spoken "one moment" if the agent is still thinking after this; 0 disables
    thinking_filler_s: float = 2.5
    # software wake phrase(s), comma-separated ("hey g1,hallo g1");
    # empty = every utterance is addressed to the robot (open mic)
    wake_phrases: tuple[str, ...] = ()
    # after the robot speaks, follow-ups within this window need no wake phrase
    wake_window_s: float = 60.0

    g1_mcast_group: str = "239.168.123.161"
    g1_mcast_port: int = 5555
    g1_local_ip: str = "192.168.123.10"
    g1_adapter_url: str = "http://localhost:8766"

    models_dir: Path = field(
        default_factory=lambda: Path(__file__).resolve().parent.parent / "models"
    )

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> "VoiceConfig":
        """Build a config from VOICE_* environment variables."""
        env = dict(os.environ) if env is None else env
        kwargs: dict[str, object] = {}
        for f in fields(cls):
            raw = env.get(ENV_PREFIX + f.name.upper())
            if raw is None or raw == "":
                continue
            kwargs[f.name] = _coerce(f.name, raw)
        cfg = cls(**kwargs)  # type: ignore[arg-type]
        cfg.validate()
        return cfg

    def validate(self) -> None:
        if self.mode not in VALID_MODES:
            raise ValueError(f"VOICE_MODE must be one of {VALID_MODES}, got {self.mode!r}")
        if self.input_backend not in VALID_BACKENDS:
            raise ValueError(f"VOICE_INPUT_BACKEND must be one of {VALID_BACKENDS}")
        if self.output_backend not in VALID_BACKENDS:
            raise ValueError(f"VOICE_OUTPUT_BACKEND must be one of {VALID_BACKENDS}")
        if self.tts_engine not in VALID_TTS_ENGINES:
            raise ValueError(f"VOICE_TTS_ENGINE must be one of {VALID_TTS_ENGINES}")
        if self.voice not in pack_ids():
            raise ValueError(f"VOICE_VOICE must be one of {pack_ids()}, got {self.voice!r}")
        if not (0.0 < self.vad_threshold < 1.0):
            raise ValueError("VOICE_VAD_THRESHOLD must be in (0, 1)")
        if self.default_language not in self.languages:
            raise ValueError(
                f"VOICE_DEFAULT_LANGUAGE {self.default_language!r} not in "
                f"VOICE_LANGUAGES {self.languages}"
            )
        if not self.agent_url.startswith(("http://", "https://")):
            raise ValueError("VOICE_AGENT_URL must be an http(s) URL")
        if self.wake_window_s < 0:
            raise ValueError("VOICE_WAKE_WINDOW_S must be >= 0")

    def piper_voice_for(self, language: str) -> str:
        """Which Piper model file a Piper pack uses — the pack's own option
        lookup, not a language->voice mapping for the service."""
        mapping = {"de": self.piper_voice_de, "en": self.piper_voice_en}
        if language in mapping:
            return mapping[language]
        return mapping.get(self.default_language, self.piper_voice_en)

    def public_dict(self) -> dict:
        """JSON-safe view for GET /config."""
        out = {}
        for f in fields(self):
            v = getattr(self, f.name)
            out[f.name] = str(v) if isinstance(v, Path) else v
        return out

    # Fields that POST /config may mutate at runtime (no model reloads needed).
    RUNTIME_MUTABLE = (
        "mode",
        "vad_threshold",
        "vad_min_speech_ms",
        "vad_min_silence_ms",
        "vad_max_utterance_s",
        "half_duplex_tail_ms",
        "session_timeout_s",
        "default_language",
        # Only ever to an already-loaded pack — see _require_loaded_voice().
        "voice",
        "thinking_filler_s",
        "wake_phrases",
        "wake_window_s",
    )

    def apply_patch(self, patch: dict) -> dict:
        """Apply a runtime config patch atomically; returns the changed keys.

        The mutation is tentative: if coercion or validate() rejects any key,
        every field is rolled back to its prior value before the error
        propagates. Without this, a single bad patch (e.g. vad_threshold=5)
        would leave the live config poisoned and brick POST /config for the
        rest of the process, since validate() would then fail on every
        subsequent patch too.
        """
        changed: dict = {}
        snapshot: dict = {}
        try:
            for key, value in patch.items():
                if key not in self.RUNTIME_MUTABLE:
                    raise ValueError(f"config key {key!r} is not runtime-mutable")
                # JSON payloads may send lists for tuple fields and null to clear
                if isinstance(value, (list, tuple)):
                    value = ",".join(str(v) for v in value)
                elif value is None:
                    value = ""
                if key not in snapshot:
                    snapshot[key] = getattr(self, key)
                coerced = _coerce(key, str(value))
                if key == "voice":
                    self._require_loaded_voice(str(coerced))
                setattr(self, key, coerced)
                changed[key] = coerced
            self.validate()
        except Exception:
            for key, old in snapshot.items():
                setattr(self, key, old)
            raise
        return changed

    def _require_loaded_voice(self, voice: str) -> None:
        """A runtime voice switch may only target a pack that is already loaded.

        RUNTIME_MUTABLE promises "no model reloads needed", so switching to a
        pack that never came up must be an explicit error here rather than a
        twenty-second stall inside POST /config — or, worse, a robot that keeps
        speaking the old voice while /config reports the new one.

        Before a registry exists (unit tests, a TTS-less run) the declared-id
        check in validate() is all there is to go on.
        """
        registry = active_registry()
        if registry is None:
            return
        if not registry.is_loaded(voice):
            raise ValueError(f"voice pack {voice!r} is not loaded: {registry.reason(voice)}")


def _coerce(name: str, raw: str) -> object:
    """Coerce an env/patch string to the field's type."""
    int_fields = {
        "http_port", "vad_min_speech_ms", "vad_min_silence_ms",
        "vad_max_utterance_s", "vad_pre_roll_ms", "half_duplex_tail_ms",
        "session_timeout_s", "g1_mcast_port",
    }
    float_fields = {
        "vad_threshold", "a2a_timeout_s", "language_min_prob",
        "thinking_filler_s", "wake_window_s",
    }
    if name in int_fields:
        return int(raw)
    if name in float_fields:
        return float(raw)
    if name in ("languages", "wake_phrases"):
        return tuple(s.strip().lower() for s in raw.split(",") if s.strip())
    if name == "models_dir":
        return Path(raw)
    return raw
