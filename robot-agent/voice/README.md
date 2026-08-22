# Voice Service — "Speak with the Robot"

Robot-agnostic, fully local voice interaction for NeoDEM robots:

```
Microphone ──▶ VAD (Silero) ──▶ STT (faster-whisper, CUDA) ──▶ A2A agent (LLM via Ollama)
                                                                    │
Speaker ◀── audio backend ◀── TTS (Piper, CPU) ◀── reply text ◀─────┘
```

Everything runs on this machine — no cloud calls. The "brain" is any
A2A-compliant agent (`VOICE_AGENT_URL`); the ears/mouth are pluggable
audio backends (`local` = PC mic/speaker, `g1` = Unitree G1 mic-multicast +
speaker adapter). Supporting another robot means implementing one
`AudioInput` and/or `AudioOutput` class (see `voice_service/audio/base.py`).

## Setup

```powershell
cd robot-agent/voice
uv sync                                    # Python 3.12 venv + deps (~1.3 GB, CUDA DLLs)
uv run python scripts/download_models.py   # Silero VAD + Piper voices
# Whisper large-v3-turbo (~1.6 GB) downloads on first STT start
```

Prerequisites on this box: NVIDIA driver (CUDA 12.x), Ollama serving the
robot-agent's model, robot-agent running (e.g. `npm run dev:g1-edu-sim`).

## Run

```powershell
uv run python -m voice_service                       # open-mic VAD mode, PC audio
uv run python -m voice_service --mode ptt            # push-to-talk (gate via /listen/toggle)
uv run python -m voice_service --agent-url http://localhost:41243/   # other robot agent
uv run python -m voice_service --env-file .env.voice # load VOICE_* vars from a file
```

Speak German or English — the language is auto-detected per utterance and
the answer voice matches. Say **"Neues Gespräch"** / **"new conversation"**
to reset the conversation memory.

## HTTP control API (`:8768`)

| Endpoint | Description |
|---|---|
| `GET /health` | liveness, loaded models, wired components, agent reachability |
| `GET /status` | pipeline state, contextId, last transcript/reply, latency p50/p95 |
| `GET /config` / `POST /config` | view / patch runtime-tunable config (VAD thresholds, mode, …) |
| `POST /say` | `{"text": "...", "language": "de"}` — direct TTS output |
| `POST /listen/toggle` | pause/resume listening (push-to-talk gate) |
| `POST /session/reset` | new A2A contextId |
| `GET /events` | SSE stream of pipeline events (state, transcript, reply, errors) |

## Configuration

All settings are `VOICE_*` env vars with sensible defaults — see
`.env.voice.example` for the full annotated list. Key ones:

- `VOICE_AGENT_URL` (default `http://localhost:41244/`) — any A2A agent root
- `VOICE_MODE` — `vad` (open mic, default) or `ptt`
- `VOICE_INPUT_BACKEND` / `VOICE_OUTPUT_BACKEND` — `local` or `g1`
- `VOICE_LANGUAGES` / `VOICE_DEFAULT_LANGUAGE` — `en,de` / `de`
- `VOICE_INPUT_DEVICE` / `VOICE_OUTPUT_DEVICE` — index or name substring
  (`uv run python scripts/list_devices.py`)

## Turn-taking

Half-duplex: the mic is muted at the source from utterance-end until
playback-end + `VOICE_HALF_DUPLEX_TAIL_MS` (250 ms), so the robot never
hears itself. Barge-in (interrupting the robot mid-answer) is a possible
later upgrade (needs echo cancellation).

If the agent takes longer than `VOICE_THINKING_FILLER_S` (2.5 s, 0 disables),
the robot speaks a short "Einen Moment, bitte." / "One moment, please." in the
user's language so long LLM turns don't feel like dead air. The real reply
never overlaps the filler — it queues behind it on the speak lock.

## Wake phrase

Dedicated wake-word engines are a licensing dead end (Porcupine free tier
discontinued, openwakeword CC BY-NC-SA), so the wake phrase is software:
Whisper transcribes everything anyway, and the pipeline only acts on
utterances that start with one of `VOICE_WAKE_PHRASES` (comma-separated,
e.g. `hey g1,hallo g1`; empty = open mic, the default). Matching ignores
case, punctuation and spacing, so "Hey, G-1!" matches `hey g1`. Unaddressed
speech is dropped silently (visible as `wake_ignored` on `/events`).

- A bare "Hey G1" gets a "Ja, bitte?" / "Yes?" and the robot waits for the
  command.
- After the robot speaks, follow-ups within `VOICE_WAKE_WINDOW_S` (60 s)
  need no wake phrase, so conversations flow naturally.
- Both keys are runtime-mutable via `POST /config`; `GET /status` shows
  whether the follow-up window is open.

Recommended: off on the PC (lab use), `hey g1,hallo g1` on the real robot.

## Speaking with Agent Mode

Point the service at an agent whose Agent Mode is ON and the conversation
drives the robot: what you say becomes a block plan, and the robot answers
about what it is doing.

```powershell
cd robot-agent && npm run dev:g1-edu-agent           # Agent Mode on :41246
cd robot-agent/voice
uv run python -m voice_service --env-file .env.voice.agentmode
```

Say *"schau dich um und geh zur Tür"* and the robot answers **"Alles klar, ich
sehe mich im Raum um und gehe zu door."** before it starts moving, then
**"Fertig."** when it gets there. The plan appears in the NeoDEM Agent Mode tab
(`/agent`) like a typed one, marked `heard · DE`.

Three things make this work, all of them in the robot-agent:

- **The reply comes when the plan is UNDERSTOOD, not when it has run.** The
  pipeline is half-duplex — the microphone is shut until the robot has spoken
  its answer — so an agent that replied only after a two-minute plan would keep
  you mute for two minutes, including for the word "stop". A speech client says
  so with a `neodem/voice` metadata key on the A2A message; the outcome is
  spoken later through this service's own `/say`.
- **You can interrupt.** With the mic open during execution, `VOICE_WAKE_PHRASES`
  off and `AGENT_STOP_WORDS` (`stopp,stop,halt`) armed, saying "stopp" latches
  the E-Stop mid-plan. That is a spoken E-Stop, not a polite request — it damps
  the base.
- **The robot answers in the language it heard.** The detected language rides
  along on the same metadata key, and the planner is told to write its spoken
  text in it. `goto` targets stay English nouns whatever you speak, because
  that is what the scene memory is keyed by (see `VISION_PROMPT`).

Non-Agent-Mode agents are unaffected: the metadata key is ignored by anything
that does not know it, and the utterance goes to the tool-calling prompt as
before.

## Unitree G1 backends

- **Mic:** the G1 multicasts its 4-mic array as 16 kHz mono s16le PCM on UDP
  `239.168.123.161:5555`. Set `VOICE_INPUT_BACKEND=g1` and
  `VOICE_G1_LOCAL_IP` to the NIC on the robot LAN (GPU_BOX: `192.168.123.10`,
  "Ethernet 3"). Windows Firewall must allow inbound UDP 5555 for python.exe.
- **Speaker:** `adapters/g1_audio_adapter.py` wraps the Unitree SDK
  `AudioClient.PlayStream` (needs the Python 3.10 DDS venv with
  `unitree_sdk2py` on `PYTHONPATH`; cyclonedds has no cp312 wheels).
  It exposes `/play`, `/stop`, `/volume`, `/led` on `:8766`; the voice
  service reaches it via `VOICE_OUTPUT_BACKEND=g1` + `VOICE_G1_ADAPTER_URL`.
  Mock mode for robot-less testing: `G1_AUDIO_MOCK=1` (runs in any Python).
- Robot-less end-to-end test: `scripts/g1_mcast_replayer.py` replays a WAV
  the way the robot multicasts mic audio (see the script header).

Robot-day tooling:

```powershell
.\scripts\run_g1_adapter.ps1                      # adapter in the 3.10 DDS venv (-Mock to fake it)
uv run python scripts/g1_preflight.py             # every prerequisite in one shot
uv run python scripts/g1_say.py "Hallo Roboter"   # speak a phrase out of the robot (de/en auto)
uv run python scripts/g1_mic_dump.py --seconds 15 # multicast -> WAV + level/clipping report
uv run python -m voice_service --env-file .env.voice.g1
```

Real-robot validation is tracked in MissionControl task **TASK-181**;
**`ROBOT_DAY.md`** is the run sheet (power-up order, the eight steps,
sign-off checklist, troubleshooting).

## Testing

```powershell
uv run pytest                                   # 40+ unit tests, no GPU/mic needed
uv run python scripts/smoke_tts.py [--play]     # Piper -> WAV (out/)
uv run python scripts/smoke_stt.py              # Piper speech -> VAD -> Whisper golden test
uv run python scripts/smoke_roundtrip.py --lang de   # full loop against live agent + Ollama
```

Measured on this box (the GPU box’s GPU, gpt-oss:20b): STT ≈ 0.3–0.5 s, agent ≈
0.8–1.4 s, TTS ≈ 0.4 s ⇒ ~2 s from end-of-speech to first audio. VRAM:
Ollama + Whisper ≈ 18.5 GB of 32 GB.

## Licence note (Piper)

`piper-tts` (OHF-Voice piper1-gpl fork) is **GPL-3.0**; importing it makes
this service process GPL-derived. That is fine for internal/lab use (no
distribution). If the voice service is ever shipped commercially, swap the
TTS engine (the `TTSEngine` seam in `voice_service/tts/base.py` exists for
that — e.g. Qwen3-TTS-12Hz, Apache-2.0, GPU, German+English, via
`faster-qwen3-tts`) or invoke the piper CLI as a subprocess.

## Windows pitfalls handled here

- **cuBLAS/cuDNN DLLs:** ctranslate2 needs the pip-installed `nvidia/*/bin`
  dirs on `PATH` *and* `os.add_dll_directory` (done in
  `stt/faster_whisper_stt.py`).
- **Blackwell (sm_120):** requires `ctranslate2>=4.7`; `float16` is the
  safe compute type. A warmup transcription at startup surfaces problems.
- **WDM-KS audio:** PortAudio only enumerates WDM-KS devices here — no
  blocking API (callback streams only) and no 22.05 kHz support (playback
  resamples to the device's native rate).
