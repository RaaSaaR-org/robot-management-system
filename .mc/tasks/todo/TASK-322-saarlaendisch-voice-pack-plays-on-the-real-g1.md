---
id: "TASK-322"
aliases:
- TASK-322
title: "Saarländisch voice pack plays on the real G1"
slug: "saarlaendisch-voice-pack-plays-on-the-real-g1"
status: "todo"
priority: 3
owner: "huhn511"
projects: []
customers: []
tags:
- core
- voice
- tts
- hardware
sprint: ""
parent: ""
depends_on: []
spe: 2
effort: "low"
due_date: ""
created: "2026-09-30"
updated: "2026-09-30"
---

# Saarländisch voice pack plays on the real G1

## Description

The `saar` voice pack (TASK-229) synthesizes Saarländisch through the Saar TTS
app's `/speak_pcm` and was verified end to end on a Mac against a locally served
app — but only up to the WAV file. This task is the one leg that needs the robot:
the same audio coming out of the Unitree G1 speaker via `scripts/g1_say.py`.
**Needs real hardware** (a G1 on the robot LAN and the G1 audio adapter); nothing
here can be checked in simulation.

## Where this stands

- `robot-agent/voice/voice_service/tts/saar_engine.py` — the pack engine;
  `tts/saar_dialect.py` — the Hochdeutsch→Saarländisch text stage;
  `tts/registry.py` — the `saar` pack entry (CC-BY-NC-4.0, `commercial: false`,
  `realtime: false`).
- `robot-agent/voice/scripts/g1_say.py` runs normalize → pack `prepare()` →
  synthesis → resample → `POST /play` on the adapter, and prints the dialect text
  it sends (`spoken as: …`). `--voice list` shows whether the pack loaded and why not.
- Verified off-robot (2026-09-30): `g1_say.py "…" --voice saar --no-play --save`
  against a local `saar-tts serve` on Apple MPS produced 5.4 s of 16 kHz speech in
  10.0 s; the opt-in live pytest `VOICE_SAAR_LIVE_SPACE=… pytest tests/test_saar_pack.py`
  passes.
- The speaker leg itself was validated on real hardware in TASK-181 (2026-07-17),
  so no new audio bring-up is expected — only the Saar source is new.

## Details

### Robot Agent — voice service (`robot-agent/voice/`)

On the robot-side box (GPU_BOX), with the G1 audio adapter running
(`scripts/run_g1_adapter.ps1`):

```powershell
cd robot-agent/voice
uv sync --group saar
$env:VOICE_SAAR_SPACE = "huhn511/saar-tts"   # or the URL of a local saar-tts serve
$env:VOICE_SAAR_TOKEN = "hf_..."             # private Space; falls back to HF_TOKEN
uv run python scripts/g1_say.py --voice list
uv run python scripts/g1_say.py "Hallo, ich bin der Roboter aus Saarbrücken." --voice saar
```

If the private Space is not reachable from the robot LAN, serve the app from
`saar-voice-example` on a machine that is (`saar-tts serve --port 7860`) and point
`VOICE_SAAR_SPACE` at it. On macOS that app needs FFmpeg ≤ 7 for torchcodec (see
its README); on Linux/CUDA it runs as documented.

Record in this file: cold-start latency of the first request against the Space
(ZeroGPU cold start is unmeasured, TASK-229 open question), warm latency, and
whether the audio is audible and recognisably dialect.

Key files (read-only unless a defect turns up):
`robot-agent/voice/scripts/g1_say.py`, `robot-agent/voice/voice_service/tts/saar_engine.py`,
`robot-agent/voice/ROBOT_DAY.md` (sign-off checklist line for this task).

## Test Strategy

Manual, on the robot: the command above plays audibly out of the G1 speaker; a
second run with `--voice nope` fails with `unknown voice pack 'nope'` and plays
nothing (no silent Piper fallback). Tick the TASK-322 line in
`robot-agent/voice/ROBOT_DAY.md` §3.

## Acceptance Criteria

- [ ] `scripts/g1_say.py --voice saar "…"` is audible out of the G1 speaker and
      recognisably Saarländisch
- [ ] Cold-start and warm latency of the Space are measured and written here
- [ ] An unknown `--voice` plays nothing and names the reason

## Notes

Moved out of TASK-229 on 2026-09-30: that task's acceptance criterion "A
Saarländisch pack synthesizes through `/speak_pcm` and comes out of the G1 speaker
via `scripts/g1_say.py --voice saar`" was met up to the speaker; this is the
speaker half.
