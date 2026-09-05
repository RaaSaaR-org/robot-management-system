"""Entry point: python -m voice_service

Builds the configured components (audio backends, STT, TTS, A2A client),
wires them into the VoicePipeline, and serves the HTTP control API.
Components that cannot be built (missing models, no mic, ...) are skipped
with a warning so the rest of the service stays usable — e.g. TTS-only.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path

from .config import VoiceConfig
from .events import EventBus
from .http_api import VoiceHttpServer
from .pipeline import VoicePipeline
from .vad.segmenter import UtteranceSegmenter


def _load_env_file(path: Path) -> None:
    """Minimal dotenv loader (KEY=VALUE lines, # comments). Existing env wins."""
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="voice_service")
    parser.add_argument("--env-file", type=Path, help="optional .env file with VOICE_* vars")
    parser.add_argument("--port", type=int, help="override VOICE_HTTP_PORT")
    parser.add_argument("--agent-url", help="override VOICE_AGENT_URL")
    parser.add_argument("--mode", choices=("vad", "ptt"), help="override VOICE_MODE")
    parser.add_argument("--input-backend", choices=("local", "g1", "none"))
    parser.add_argument("--output-backend", choices=("local", "g1", "none"))
    parser.add_argument("--no-agent", action="store_true", help="skip the A2A client (STT/TTS only)")
    return parser.parse_args()


def _build_components(config: VoiceConfig, bus: EventBus, args: argparse.Namespace) -> dict:
    """Construct each component; a failure disables that component only."""
    components: dict = {
        "audio_in": None, "audio_out": None, "stt": None, "tts": None,
        "a2a": None, "segmenter": None,
    }

    def build(name: str, factory) -> None:
        try:
            components[name] = factory()
        except Exception as exc:  # noqa: BLE001 — degrade, don't die
            print(f"[Voice] WARNING: component {name!r} unavailable: {exc}")

    if args.input_backend != "none":
        def make_input():
            if config.input_backend == "g1":
                from .audio.g1_mic import G1MulticastMic
                return G1MulticastMic(config)
            from .audio.local_mic import LocalMic
            return LocalMic(config)
        build("audio_in", make_input)

    if args.output_backend != "none":
        def make_output():
            if config.output_backend == "g1":
                from .audio.g1_speaker import G1Speaker
                return G1Speaker(config)
            from .audio.local_speaker import LocalSpeaker
            return LocalSpeaker(config)
        build("audio_out", make_output)

    def make_tts():
        # The registry IS the pipeline's TTS: it duck-types load()/synthesize()
        # and adds the voice axis on top. Individual packs load in its own
        # load(), where a broken one degrades to "unavailable with a reason"
        # instead of costing the service its whole mouth.
        from .tts.registry import VoiceRegistry, set_active_registry

        registry = VoiceRegistry(config)
        # Published process-wide so POST /config can refuse a runtime voice
        # switch to a pack that never loaded (config._require_loaded_voice).
        set_active_registry(registry)
        return registry
    build("tts", make_tts)

    def make_stt():
        from .stt.faster_whisper_stt import FasterWhisperSTT
        return FasterWhisperSTT(config)
    build("stt", make_stt)

    if components["audio_in"] is not None:
        def make_segmenter():
            from .vad.silero_onnx import SileroVad
            vad = SileroVad(config.models_dir)
            return UtteranceSegmenter(
                vad,
                threshold=config.vad_threshold,
                min_speech_ms=config.vad_min_speech_ms,
                min_silence_ms=config.vad_min_silence_ms,
                max_utterance_s=config.vad_max_utterance_s,
                pre_roll_ms=config.vad_pre_roll_ms,
            )
        build("segmenter", make_segmenter)

    if not args.no_agent:
        def make_a2a():
            from .a2a_client import A2AClient
            return A2AClient(config.agent_url, timeout_s=config.a2a_timeout_s)
        build("a2a", make_a2a)

    return components


def main() -> int:
    if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")

    args = _parse_args()
    if args.env_file:
        _load_env_file(args.env_file)
    config = VoiceConfig.from_env()
    if args.port:
        config.http_port = args.port
    if args.agent_url:
        config.agent_url = args.agent_url
    if args.mode:
        config.mode = args.mode
    if args.input_backend and args.input_backend != "none":
        config.input_backend = args.input_backend
    if args.output_backend and args.output_backend != "none":
        config.output_backend = args.output_backend
    config.validate()

    print(f"[Voice] voice-service starting (agent={config.agent_url}, "
          f"in={config.input_backend}, out={config.output_backend}, mode={config.mode})")

    bus = EventBus()
    components = _build_components(config, bus, args)
    pipeline = VoicePipeline(config, bus, **components)
    http = VoiceHttpServer(config.http_port, pipeline, bus)
    http.start()

    try:
        asyncio.run(pipeline.run())
    except KeyboardInterrupt:
        print("[Voice] shutting down")
    finally:
        http.stop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
