"""Voice pack registry: a voice is declared data, not a subclass.

A *voice pack* is the robot's output identity — which engine synthesizes, which
languages the voice is meant for, under which licence, and whether it is fast
enough for a conversational turn. It is a separate axis from `language`, which
is an *input* property (what Whisper detected, see stt/faster_whisper_stt.py).
The two never gate each other: an operator may deliberately have a German voice
read an English sentence, and `languages` below is UI metadata, not a filter.

Packs are data so that shipping another voice is a table entry plus an engine
factory instead of a subclass per voice. Two rules follow from that, and both
are the point of this module rather than incidental to it:

* **A bad pack may not take the robot down.** Engines are imported inside their
  factory, and `VoiceRegistry.load()` never raises: a pack whose dependency is
  missing, whose model will not load or whose remote endpoint is unreachable
  becomes *unavailable with a reason*, and every other pack still speaks.
* **Never fall back silently.** Asking for an unknown or unloaded pack raises
  (`UnknownVoiceError` / `VoiceUnavailableError`) so the caller can answer 4xx.
  Answering in some other voice would leave a demo speaking the wrong language
  while every health check stays green.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from .base import TTSEngine

if TYPE_CHECKING:  # avoids config -> registry -> config at import time
    from ..config import VoiceConfig

# (text, language) -> text. Runs after tts_normalize(), before synthesize().
PrepareHook = Callable[[str, str], str]
EngineFactory = Callable[["VoiceConfig", "VoicePack"], TTSEngine]


class VoiceError(Exception):
    """Base for voice-pack resolution failures; callers map these to 4xx."""


class UnknownVoiceError(VoiceError):
    """No pack with that id is declared."""


class VoiceUnavailableError(VoiceError):
    """The pack is declared but did not load; the message carries the reason."""


@dataclass(frozen=True, slots=True)
class VoicePack:
    """One selectable voice. Pure data — no engine state lives here.

    `options` is the engine-specific corner (which Piper voice, which reference
    speaker, ...): keeping it opaque is what stops one engine's internals from
    leaking into the product API. `prepare` is an optional text hook for packs
    whose orthography differs from what the agent writes (dialect rules); when
    it is None the engine's own `prepare()` — identity by default — is used.
    """

    id: str
    label: str
    engine: str
    languages: tuple[str, ...]
    licence: str
    commercial: bool
    realtime: bool
    options: Mapping[str, object] = field(default_factory=dict)
    prepare: PrepareHook | None = None

    def public_dict(self) -> dict:
        """JSON-safe metadata. `options` stays out: it is engine internals."""
        return {
            "id": self.id,
            "label": self.label,
            "engine": self.engine,
            "languages": list(self.languages),
            "licence": self.licence,
            "commercial": self.commercial,
            "realtime": self.realtime,
        }


# --------------------------------------------------------------------------
# Declared packs
# --------------------------------------------------------------------------

# Piper is one voice per model file, so it is one pack per voice — the old
# "load every configured language into one engine" shape was the language axis
# doing the voice axis' job. licence is the constraint that actually binds this
# process: importing piper-tts (GPL-3.0) makes the service GPL-derived, which
# is why commercial is False (see the licence note in voice/README.md). The
# per-voice model licence is a separate question and is not asserted here.
VOICE_PACKS: tuple[VoicePack, ...] = (
    VoicePack(
        id="piper_de",
        label="Piper Thorsten (DE)",
        engine="piper",
        languages=("de",),
        licence="GPL-3.0 (piper-tts)",
        commercial=False,
        realtime=True,
        options={"piper_language": "de"},
    ),
    VoicePack(
        id="piper_en",
        label="Piper Lessac (EN)",
        engine="piper",
        languages=("en",),
        licence="GPL-3.0 (piper-tts)",
        commercial=False,
        realtime=True,
        options={"piper_language": "en"},
    ),
)


def _make_piper(config: VoiceConfig, pack: VoicePack) -> TTSEngine:
    # Imported here rather than at module scope so that a broken or missing
    # piper-tts is one unavailable pack, not an unimportable registry.
    from .piper_engine import PiperEngine

    language = str(pack.options.get("piper_language", config.default_language))
    return PiperEngine(config, voice_name=config.piper_voice_for(language))


ENGINE_FACTORIES: dict[str, EngineFactory] = {
    "piper": _make_piper,
}


def engine_ids() -> tuple[str, ...]:
    """Engines that can actually be built. config.VALID_TTS_ENGINES is this."""
    return tuple(sorted(ENGINE_FACTORIES))


def pack_ids() -> tuple[str, ...]:
    """Declared pack ids, in declaration order (not availability)."""
    return tuple(pack.id for pack in VOICE_PACKS)


# --------------------------------------------------------------------------
# Registry
# --------------------------------------------------------------------------


@dataclass(slots=True)
class PackState:
    """A declared pack plus what happened when it was loaded."""

    pack: VoicePack
    engine: TTSEngine | None = None
    error: str | None = None

    @property
    def available(self) -> bool:
        return self.engine is not None


class VoiceRegistry:
    """Loads the declared packs and resolves a voice id to an engine.

    Duck-types the TTSEngine surface the pipeline uses (`load`, `synthesize`),
    so it can occupy the pipeline's `tts` slot directly, with `voice` defaulting
    to `config.voice`.
    """

    def __init__(
        self,
        config: VoiceConfig,
        packs: Iterable[VoicePack] | None = None,
        factories: Mapping[str, EngineFactory] | None = None,
    ) -> None:
        self.config = config
        # Injectable so tests can declare a deliberately broken pack without
        # touching the real table.
        self._packs = tuple(VOICE_PACKS if packs is None else packs)
        self._factories = dict(ENGINE_FACTORIES if factories is None else factories)
        self._states = {pack.id: PackState(pack) for pack in self._packs}

    # -- loading -----------------------------------------------------------

    def load(self) -> None:
        """Load every declared pack. Never raises — that is the contract.

        The pipeline calls this at startup and a raise here would kill the
        service; a customer-supplied pack must not be able to do that.

        The containment is Python-level. An engine whose native library calls
        exit() instead of raising (piper's espeak-ng bridge does, on a bad data
        path) still takes the process with it; isolating that would need the
        engine to run in a subprocess.
        """
        for state in self._states.values():
            self._load_pack(state)
        loaded = self.loaded_ids()
        print(f"[Voice] voice packs loaded: {list(loaded)}")
        for state in self._states.values():
            if not state.available:
                print(f"[Voice] WARNING: voice pack {state.pack.id!r} unavailable: {state.error}")
        if not loaded:
            print("[Voice] WARNING: no voice pack loaded — the robot cannot speak")

    def _load_pack(self, state: PackState) -> None:
        try:
            factory = self._factories.get(state.pack.engine)
            if factory is None:
                raise LookupError(f"no factory for engine {state.pack.engine!r}")
            engine = factory(self.config, state.pack)
            engine.load()
        except Exception as exc:  # noqa: BLE001 — degrade this pack, not the service
            state.engine = None
            # The type name matters for the reason to be actionable: a bare
            # ImportError message ("No module named x") reads as nothing.
            state.error = f"{type(exc).__name__}: {exc}"
            return
        state.engine = engine
        state.error = None

    # -- queries -----------------------------------------------------------

    @property
    def packs(self) -> tuple[VoicePack, ...]:
        return self._packs

    def is_declared(self, voice: str) -> bool:
        return voice in self._states

    def is_loaded(self, voice: str) -> bool:
        """True only for a pack that came up. False for an unknown id."""
        state = self._states.get(voice)
        return state is not None and state.available

    def reason(self, voice: str) -> str | None:
        """Why `voice` cannot speak, or None when it can."""
        state = self._states.get(voice)
        if state is None:
            return f"unknown voice pack {voice!r}"
        if state.available:
            return None
        return state.error or "not loaded"

    def loaded_ids(self) -> tuple[str, ...]:
        return tuple(pid for pid, state in self._states.items() if state.available)

    def describe(self) -> list[dict]:
        """The pack list for GET /health and the server relay."""
        out = []
        for state in self._states.values():
            entry = state.pack.public_dict()
            entry["available"] = state.available
            entry["reason"] = self.reason(state.pack.id)
            out.append(entry)
        return out

    # -- resolution --------------------------------------------------------

    def resolve(self, voice: str | None = None) -> PackState:
        """Resolve a voice id (or the configured one) to a loaded pack.

        Raises rather than substituting another voice — see the module note.
        """
        voice = voice or self.config.voice
        state = self._states.get(voice)
        if state is None:
            raise UnknownVoiceError(f"unknown voice pack {voice!r}")
        if not state.available:
            raise VoiceUnavailableError(f"voice pack {voice!r} is not loaded: {state.error}")
        return state

    def engine_for(self, voice: str | None = None) -> TTSEngine:
        engine = self.resolve(voice).engine
        assert engine is not None  # resolve() guarantees it
        return engine

    # -- TTS surface -------------------------------------------------------

    def prepare(self, text: str, language: str, voice: str | None = None) -> str:
        """Pack-specific text prep. Runs after tts_normalize(), before synthesize()."""
        state = self.resolve(voice)
        if state.pack.prepare is not None:
            return state.pack.prepare(text, language)
        assert state.engine is not None
        return state.engine.prepare(text, language)

    def synthesize(
        self, text: str, language: str, voice: str | None = None
    ) -> tuple[bytes, int]:
        state = self.resolve(voice)
        assert state.engine is not None
        return state.engine.synthesize(text, language, state.pack.id)


# --------------------------------------------------------------------------
# Active registry
# --------------------------------------------------------------------------

# The process has one registry, built at startup. config.apply_patch() needs to
# ask it whether a pack is loaded before allowing a runtime voice switch, and
# the config cannot hold a reference (frozen field set, serialized by
# public_dict()), so the registry publishes itself here instead.
_ACTIVE_REGISTRY: VoiceRegistry | None = None


def set_active_registry(registry: VoiceRegistry | None) -> None:
    global _ACTIVE_REGISTRY
    _ACTIVE_REGISTRY = registry


def active_registry() -> VoiceRegistry | None:
    """The process registry, or None before one is built (tests, TTS-less run)."""
    return _ACTIVE_REGISTRY
