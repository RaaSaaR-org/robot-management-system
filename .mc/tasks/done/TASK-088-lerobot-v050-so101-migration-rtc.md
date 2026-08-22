---
id: TASK-088
title: LeRobot v0.5.0 — SO-101 Migration + Real-Time Chunking (RTC)
status: done
priority: high
tags:
- vla
- hardware
- lerobot
- sidecar
- deferred
owner: ''
depends_on: []
created: 2026-03-11
updated: 2026-07-12
status_note: 'RETIRED 2026-07-12 — superseded. The v0.5.0 migration half was overtaken by TASK-179 (LeRobot 0.6.0 adopted everywhere; sidecars verified unaffected). The hardware context (Pi + Mac, "no GPU server") pre-dates the G1 pivot and GPU_BOX. The one living kernel — Real-Time Chunking — was extracted into [[TASK-183]], retargeted at the live loop robot-agent/src/vla/skill-executor.ts (vla_runner.py is orphaned since TASK-146). Do not implement as written.'
---

# TASK-088 — LeRobot v0.5.0: SO-101 Migration + RTC

## Motivation

LeRobot v0.5.0 consolidates SO-100 and SO-101 into a single unified API. Our SO-101
sidecar (`robot-agent/hardware/so101_sidecar.py`) still pins the pre-consolidation
interface — anything above the current LeRobot version will break it. Upgrading is
load-bearing for every other VLA task.

v0.5.0 also ships **Real-Time Chunking (RTC)**: instead of serially draining an action
chunk queue and waiting for the next inference, RTC overlaps inference with execution
and blends predictions at chunk boundaries. Concretely: noticeably smoother, more
reactive SO-101 motion — no more micro-stalls at chunk edges.

## Hardware reality (2026-04-11)

- **Pi** (`robot@192.168.178.45`): runs the real SO-101, `so101_sidecar.py`,
  LeRobot in a conda env
- **Mac** (local dev): runs `training-worker` (MPS-based SmolVLA LoRA trainer,
  already shipped in TASK-136) and optionally `vla-server` for inference
- **No GPU server.** If we need heavier compute we reach for cloud burst (Modal,
  Runpod, HF Inference Endpoints) — not a dedicated box.

## Scope

### 1. SO-101 sidecar migration — Pi

`robot-agent/hardware/so101_sidecar.py`
- Port to the v0.5.0 consolidated SO-100/SO-101 API
- Update imports and class names (breaking changes in `lerobot.common.robot_devices`)
- Verify calibration format — v0.5.0 uses consolidated calibration; existing
  calibration files may need re-export
- Pi conda env: `conda activate lerobot && pip install 'lerobot==0.5.0'`
  - v0.5.0 requires Python 3.12. Pi system Python is 3.11, so the conda env needs
    a 3.12 base (`conda create -n lerobot python=3.12` + reinstall deps)
- Smoke test on real hardware: calibrate → home → teleop via leader arm

### 2. training-worker upgrade — Mac (separate repo: `../training-worker/`)

`pyproject.toml` (in the training-worker repo)
- Bump `lerobot` to `==0.5.0`
- Verify `trainers/smolvla_lora.py` still loads `lerobot/smolvla_base` against the
  v0.5.0 model registry (API may have renamed loader helpers)
- Re-run the E2E training test (`scripts/test-e2e.sh` — shipped in TASK-141)
  against a known LeRobot v3 dataset to confirm no regression in the LoRA pipeline

### 3. vla-server upgrade (separate repo: `../vla-server/`)

`pyproject.toml` (in the vla-server repo)
- Bump `lerobot` to `==0.5.0`
- `models/smolvla.py` — re-validate policy loading and action-chunk
  schema; v0.5.0 may have changed dict keys
- `models/pi05.py` — same
- Re-run `tests/` to confirm all backends still load

### 4. Real-Time Chunking (in the vla-server repo)

`server.py`
- Thread `rtc_config.enabled` + `blend_interval` + `chunk_overlap` through the
  policy loading path for SmolVLA and Pi0.5
- Expose via `config.yaml` (see `config.yaml.example`)

`robot-agent/src/vla/` (TypeScript inference client)
- Current behaviour: request chunk N → execute → request chunk N+1
- RTC behaviour: request chunk N+1 *while* executing chunk N, blend at the
  configured overlap window
- Config: `VLA_RTC_ENABLED=true|false`, `VLA_RTC_BLEND_INTERVAL_MS`,
  `VLA_RTC_CHUNK_OVERLAP` in `robot-agent/.env.so101.example`

## Done when

- [ ] SO-101 sidecar runs on v0.5.0 on the Pi, calibrates, homes, accepts teleop
- [ ] `training-worker` (separate repo) e2e test green against v0.5.0
- [ ] `vla-server` (separate repo) tests green against v0.5.0, SmolVLA + Pi0.5 still load
- [ ] `VLA_RTC_ENABLED=true` produces visibly smoother SO-101 motion in a scripted
      pick-and-place (recorded comparison video in `docs/` or as a PR artifact)
- [ ] `robot-agent/.env.so101.example` documents the three RTC env vars
- [ ] `npx tsc --noEmit` in `robot-agent/` → 0 errors

## References

- LeRobot v0.5.0 blog: https://huggingface.co/blog/lerobot-release-v050
- RTC paper: https://huggingface.co/papers/2506.07339
- RTC docs: https://huggingface.co/docs/lerobot/rtc
- SO-101 docs: https://huggingface.co/docs/lerobot/so101
- Current sidecar: `robot-agent/hardware/so101_sidecar.py`
- Pi SSH target: `robot@192.168.178.45`
