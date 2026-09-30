"""Saarländisch voice pack: F5-TTS dialect finetune behind a Gradio Space.

The model is not vendored. It runs in the `saar-voice-example` project's
Gradio app — the private HF Space `huhn511/saar-tts`, or the same app served
locally (`saar-tts serve`) — and this engine calls its `/speak_pcm` endpoint,
which answers base64 s16le mono PCM at a requested sample rate. Asking for the
pipeline's 16 kHz means no WAV parsing and no resample on the G1 leg.

Keeping it remote keeps a 1.3 GB checkpoint and a CUDA/MPS torch stack out of
the voice venv. The price is a network hop and a voice that is not real-time
(RTF ~1.95 warm on Apple MPS), which is what `realtime=False` on the pack says
and what widens the pipeline's per-request synthesis timeout.

Licence: the finetune inherits CC-BY-NC-4.0 from its base weights
(hvoss-techfak/F5-TTS-German). Internal and demo use only — not shippable to a
customer until it is retrained on an MIT-weights base.

The HF token is read from VOICE_SAAR_TOKEN, falling back to HF_TOKEN. It is
never a config field (GET /config would publish it) and never logged.
"""

from __future__ import annotations

import base64
import json
import os
import time
from typing import TYPE_CHECKING, Any

from .base import TTSEngine
from .saar_dialect import to_saarlaendisch

if TYPE_CHECKING:
    from ..config import VoiceConfig

SPEAK_PCM_API = "/speak_pcm"
SAAR_SAMPLE_RATE = 16_000
TOKEN_ENV_VARS = ("VOICE_SAAR_TOKEN", "HF_TOKEN")


class SaarVoiceEngine(TTSEngine):
    """Remote dialect voice. One engine per Space; the speaker is a pack option."""

    def __init__(
        self,
        config: VoiceConfig,
        space: str,
        speaker: str,
        speed: float = 1.0,
        client_factory: Any = None,
    ) -> None:
        self.config = config
        self.space = space.strip()
        self.speaker = speaker
        self.speed = speed
        # Injectable so tests never open a network connection.
        self._client_factory = client_factory
        self._client: Any = None

    def load(self) -> None:
        if not self.space:
            # Opt-in by design: a robot should not start calling a third-party
            # endpoint because a default said so.
            raise RuntimeError("VOICE_SAAR_SPACE is not set (HF Space id or URL of the Saar TTS app)")
        factory = self._client_factory or _gradio_client
        started = time.perf_counter()
        self._client = factory(self.space, _token())
        print(f"[Voice] saar pack connected to {self.space} in {time.perf_counter() - started:.1f}s")

    def prepare(self, text: str, language: str) -> str:
        """Dialect rules + corpus orthography; sentence periods survive."""
        return to_saarlaendisch(text, language)

    def synthesize(
        self, text: str, language: str, voice: str | None = None
    ) -> tuple[bytes, int]:
        if self._client is None:
            raise RuntimeError("saar pack not loaded")
        result = self._client.predict(
            text,
            self.speaker,
            float(self.speed),
            SAAR_SAMPLE_RATE,
            False,  # from_german: the dialect stage already ran in prepare()
            "rules",  # dialect_mode, unused while from_german is False
            api_name=SPEAK_PCM_API,
        )
        if isinstance(result, str):  # some gradio versions hand back JSON text
            result = json.loads(result)
        if not isinstance(result, dict) or "pcm_base64" not in result:
            raise RuntimeError(f"unexpected /speak_pcm response: {type(result).__name__}")
        pcm = base64.b64decode(result["pcm_base64"])
        rate = int(result.get("sample_rate") or SAAR_SAMPLE_RATE)
        return pcm, rate


def _token() -> str | None:
    for name in TOKEN_ENV_VARS:
        value = os.environ.get(name, "").strip()
        if value:
            return value
    return None


def _gradio_client(space: str, token: str | None) -> Any:
    """Connect a gradio_client.Client; imported lazily so a missing package
    makes this one pack unavailable instead of the registry unimportable."""
    from gradio_client import Client

    # gradio_client 1.x named the token argument hf_token, 2.x names it token.
    for kw in ("token", "hf_token"):
        try:
            return Client(space, verbose=False, **{kw: token})
        except TypeError as exc:
            if kw not in str(exc):
                raise
    return Client(space, verbose=False)
