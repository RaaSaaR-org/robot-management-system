---
id: TASK-181
aliases:
- TASK-181
title: Voice interaction — validate on the real Unitree G1 EDU
slug: voice-g1-real-robot-validation
status: backlog
priority: 2
owner: ''
projects: []
customers: []
tags:
- extended
- robot
- voice
sprint: ''
depends_on: []
due_date: ''
created: 2026-07-11
updated: 2026-07-17
status_note: 'BLOCKED ON ROBOT — PC-side prep re-verified 2026-07-17: venvs intact (.venv-g1-audio py3.10.20 + cyclonedds; voice .venv py3.12.13), 79 voice unit tests green, Ollama serving gpt-oss:20b, NIC "Ethernet 3" = 192.168.123.10 up, Piper+Silero models on disk. Robot-day tooling added and loopback-tested: scripts/g1_preflight.py (one-shot prerequisite check), scripts/g1_mic_dump.py (step 3 capture+level report), scripts/run_g1_adapter.ps1 (adapter launcher), .env.voice.g1 (ready config), ROBOT_DAY.md (run sheet). Remaining: the admin firewall rule (step 1, one command, see ROBOT_DAY.md §0) + steps 2-8, all of which need the powered G1.'
---

## Description

Validate the (PC-validated) voice interaction service against the real G1 EDU:
robot 4-mic array in, robot speaker out, full spoken conversation with the
robot-agent LLM (local Ollama). All software exists and is tested robot-less;
this task is hardware bring-up, tuning, and sign-off.

## Details

### Current state (all on dz-226, the Windows GPU box)

- Voice service at `robot-agent/voice/` (Python 3.12 uv venv) is **fully working
  with PC mic/speaker**: Silero VAD → faster-whisper `large-v3-turbo` (CUDA) →
  A2A `message/send` to the robot-agent (`http://localhost:41244/`, Ollama
  `gpt-oss:20b`) → Piper TTS (de/en). 44 unit tests + smoke scripts green.
  Latency ≈ 2 s end-of-speech → first audio (excl. answer playback).
- **G1 backends are implemented and loopback-tested** (no robot yet):
  - `voice_service/audio/g1_mic.py` — receives the robot's mic multicast
    (16 kHz mono s16le PCM on UDP `239.168.123.161:5555`); tested via
    `scripts/g1_mcast_replayer.py`.
  - `voice_service/audio/g1_speaker.py` → HTTP → `adapters/g1_audio_adapter.py`
    (wraps `unitree_sdk2py AudioClient.PlayStream`, 96 000-byte chunks, 1 s
    pacing, PlayStop after buffered audio drains; `/play /stop /volume /led`
    on `:8766`); tested with `G1_AUDIO_MOCK=1`.
- Robot facts: G1 EDU on robot LAN `192.168.123.0/24`; dz-226 NIC
  "Ethernet 3" = `192.168.123.10`. DDS domain **0** = real robot.
- ✅ **Adapter venv READY (2026-07-11):** `C:\Unitree\.venv-g1-audio` created
  (uv-managed CPython 3.10.20, `cyclonedds==0.10.2`, `numpy`) — replaces the
  broken `.venv-g1-dds`. Adapter smoke-tested from it in mock mode:
  `G1_AUDIO_MOCK=1 PYTHONPATH=C:\Unitree\unitree_sdk2_python
  C:\Unitree\.venv-g1-audio\Scripts\python.exe adapters\g1_audio_adapter.py`
  → `GET :8766/health` = `{"status":"ok","mock":true,"interface":"Ethernet 3"}`.
- ✅ Voice service test suite re-verified on main 2026-07-11: **79 passed**
  (again 2026-07-17).
- ✅ **Robot-day tooling ready (2026-07-17)** — `robot-agent/voice/ROBOT_DAY.md`
  is the run sheet; it supersedes the bare step list below for execution order:
  - `scripts/g1_preflight.py` — checks NIC, robot ping, mic multicast, adapter
    (and flags mock mode), A2A agent, Ollama, models, CUDA in one shot.
  - `scripts/g1_mic_dump.py` — step 3: dumps the multicast to WAV + reports
    packet rate, RMS/peak dBFS, clipping, mid-stream gaps; names the firewall
    as the first suspect when nothing arrives. Loopback-tested via the replayer.
  - `scripts/run_g1_adapter.ps1` — starts the adapter in the 3.10 venv with the
    right `PYTHONPATH`/interface, refusing to start if the robot LAN NIC is down.
  - `.env.voice.g1` — ready config (g1 in/out, agent :41244, wake phrases on).

### Steps

> Execution order, commands and troubleshooting: `robot-agent/voice/ROBOT_DAY.md`.

1. **Firewall** *(needs an ADMIN shell — not possible from the unelevated
   agent session, do this on robot day)*: allow inbound UDP 5555 for the voice
   venv's python.exe on the robot LAN profile:
   `New-NetFirewallRule -DisplayName "NeoDEM voice G1 mic (UDP 5555)"
   -Direction Inbound -Protocol UDP -LocalPort 5555 -Action Allow
   -Program "C:\Unitree\robot-management-system\robot-agent\voice\.venv\Scripts\python.exe"`
2. **Adapter bring-up**: start `g1_audio_adapter.py` in the 3.10 venv
   (`G1_NET_INTERFACE=Ethernet 3`, no mock). `GET :8766/health`, then
   `POST /play` with a known WAV (16 k mono s16le body) → audible from the
   robot speaker; test `/volume` and `/stop` (mid-playback cut).
3. **Mic capture check**: `uv run python scripts/g1_mic_dump.py --seconds 15`
   → WAV + level/clipping/gap report; assess noise/echo by listening back.
   Verifies the IGMP join on "Ethernet 3" (`VOICE_G1_LOCAL_IP=192.168.123.10`)
   as a side effect.
4. **Full round trip**: `VOICE_INPUT_BACKEND=g1 VOICE_OUTPUT_BACKEND=g1
   uv run python -m voice_service` — speak to the robot from 1–3 m, German
   and English, multi-turn (follow-up question referencing the prior answer).
5. **Half-duplex tuning**: confirm the robot speaker does NOT re-trigger the
   4-mic array (the service mutes its input while speaking, but check the
   250 ms tail suffices; tune `VOICE_VAD_THRESHOLD` /
   `VOICE_HALF_DUPLEX_TAIL_MS`, fall back to `VOICE_MODE=ptt` if needed).
6. **Latency**: compare `GET /status` p50/p95 against the PC-mic baseline
   (stt ≈ 0.3 s, agent ≈ 1.2 s, tts ≈ 0.4 s).
7. **Conflict check**: verify Unitree's built-in voice assistant does not
   hold the speaker (if TTS playback fails/overlaps, investigate disabling
   the vui assistant on PC2) and that the running lowstate DDS bridge is
   unaffected (adapter uses the same domain 0 — expected to coexist).
8. Optional UX: wire pipeline states to `POST :8766/led`
   (listening=green, thinking=blue, speaking=white).

### Key files

- `robot-agent/voice/README.md` — setup/run/test reference
- `robot-agent/voice/voice_service/audio/{g1_mic.py,g1_speaker.py}`
- `robot-agent/voice/adapters/g1_audio_adapter.py`
- `robot-agent/voice/.env.voice.example` — all `VOICE_G1_*` vars

## Test Strategy

- Adapter smoke: `/health` ok; `/play` audible; `/stop` cuts within ~1 s.
- Live conversation: 5 consecutive DE + 5 EN turns, ≥ 9/10 correct
  transcripts at 1–3 m, no self-triggering during answers.
- Multi-turn memory: follow-up question answered with context; spoken
  "Neues Gespräch" resets the session (confirmation phrase spoken).
- Soak: 15 min open-mic in the lab without crash/stall; `GET /health`
  stays ok; VRAM stable (`nvidia-smi`).
