---
id: TASK-089
title: LeRobot v0.5.0 — Pi0-FAST Backend in vla-server
status: todo
priority: medium
tags:
- vla
- backend
- lerobot
- deferred
owner: ''
depends_on:
- TASK-088
created: 2026-03-11
updated: 2026-04-11
---

# TASK-089 — LeRobot v0.5.0: Pi0-FAST Backend

## Motivation

Pi0-FAST is an autoregressive VLA (PaliGemma VLM backbone + Gemma 300M action
expert + FAST action tokenization), a sibling to the flow-matching Pi0 we already
serve via `vla-server/models/pi05.py`. Exposing it as a third selectable backend
lets us:

- Benchmark autoregressive vs flow-matching VLA on the same SO-101 task
- Demo architecture tradeoffs to customers without touching the robot-agent side
- Give the training-worker a second base model for LoRA experiments (TASK-090)

## Hardware reality (2026-04-11)

Pi0-FAST is **~3 B parameters** (PaliGemma-3B + 300M action expert). Feasibility
per target:

| Host | Feasibility | Notes |
|------|-------------|-------|
| **Mac** (MPS, ≥16 GB unified) | ✅ Works for demos/benchmarks | Autoregressive decode → ~500 ms–2 s per chunk on M-series. Too slow for closed-loop SO-101 control, fine for offline comparison and recording |
| **Pi** | ❌ No | Not enough RAM or compute for a 3B VLM |
| **Cloud burst** (Modal / Runpod A10/L4) | ✅ Production path | Sub-100 ms per chunk, rent by the minute — the right target when we actually want to drive the robot with Pi0-FAST |

So: the backend module is hardware-agnostic. Deployment decisions happen per
environment via `vla-server/config.yaml` and `VLA_SERVER_URL` on the robot-agent.

## Scope

### 1. Pi0-FAST backend module

`vla-server/models/pi0_fast.py` (new — sits alongside `smolvla.py`, `pi05.py`,
`groot.py`)
- Subclass the same base interface used by the existing models
  (`vla-server/models/base.py`)
- Load `lerobot/pi0_fast` policy via LeRobot v0.5.0 API
- Load FAST action tokenizer (`lerobot/fast-action-tokenizer`)
- Config fields: `temperature`, `max_decoding_steps`
- Compatible with the RTC plumbing from TASK-088 (accept `rtc_config` and pass
  through to the policy)
- Device selection: `cuda` if available, else `mps`, else `cpu` — same pattern
  as the other backends

### 2. Backend registry + config

`vla-server/server.py`
- Register `pi0_fast` in the backend lookup
- Surface latency / device info via `/health` so the RMS worker panel (shipped
  in TASK-145) can display it

`vla-server/config.yaml.example`
- Add a commented `backend: pi0_fast` example block with the new config fields

### 3. RMS UI — backend selector (only if >1 backend configured)

`app/src/features/deployment/` (or wherever the VLA control section now lives
after the TASK-147 sidebar consolidation — check `app/src/features/` first)
- Dropdown: `smolvla | pi05 | pi0_fast` (dynamically populated from
  vla-server `/health`)
- Only render when the server reports multiple backends — don't add chrome for
  the single-backend case

### 4. Tests + benchmarks

- `vla-server/tests/test_pi0_fast_backend.py` — unit test with a tiny stub policy
  (mirrors the existing SmolVLA/Pi05 test patterns)
- Manual benchmark doc: `docs/vla-backends-benchmark.md` with per-device median
  chunk latency for SmolVLA, Pi0.5, Pi0-FAST on Mac MPS (recorded once, updated
  when we add cloud hosts)
- `npx tsc --noEmit` in `app/` → 0 errors

## Done when

- [ ] `vla-server/models/pi0_fast.py` loads `lerobot/pi0_fast` and serves
      inference requests locally on Mac (MPS)
- [ ] `VLA_BACKEND=pi0_fast` in `vla-server/config.yaml` selects the new backend
- [ ] Backend dropdown appears in RMS when multiple backends are configured
- [ ] Unit test for the Pi0-FAST backend
- [ ] Latency benchmark doc committed with numbers for at least Mac MPS

## Non-goals

- Running Pi0-FAST against a live SO-101 in real time — the Mac is too slow for
  that, and we don't pay for cloud GPU full-time. Real-time Pi0-FAST is a
  follow-up task if a customer asks for it.
- Automatic cloud-burst provisioning — out of scope, operator manually starts a
  Modal/Runpod instance and points `VLA_SERVER_URL` at it.

## References

- Pi0-FAST docs: https://huggingface.co/docs/lerobot/pi0fast
- FAST tokenizer: https://huggingface.co/lerobot/fast-action-tokenizer
- Base model: https://huggingface.co/lerobot/pi0_fast
- Existing backends: `vla-server/models/smolvla.py`, `vla-server/models/pi05.py`
- Depends on TASK-088 (needs LeRobot v0.5.0 installed in vla-server)
