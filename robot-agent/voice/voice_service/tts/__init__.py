"""Text-to-speech: the engine contract, the voice-pack registry, the normalizer.

Engine implementations are deliberately not re-exported here. An engine module
imports the service config, and the config imports this package for the pack
table, so exporting one would close a config -> registry -> engine -> config
import cycle. Ask the registry for an engine instead.
"""

from .base import TTSEngine
from .normalize import tts_normalize
from .registry import (
    ENGINE_FACTORIES,
    VOICE_PACKS,
    PackState,
    UnknownVoiceError,
    VoiceError,
    VoicePack,
    VoiceRegistry,
    VoiceUnavailableError,
    active_registry,
    engine_ids,
    pack_ids,
    set_active_registry,
)

__all__ = [
    "ENGINE_FACTORIES",
    "VOICE_PACKS",
    "PackState",
    "TTSEngine",
    "UnknownVoiceError",
    "VoiceError",
    "VoicePack",
    "VoiceRegistry",
    "VoiceUnavailableError",
    "active_registry",
    "engine_ids",
    "pack_ids",
    "set_active_registry",
    "tts_normalize",
]
