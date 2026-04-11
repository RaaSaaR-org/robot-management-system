---
id: TASK-090
title: Pi0 LoRA trainer in training-worker (LeRobot v0.5.0 PEFT)
slug: pi0-lora-trainer-training-worker
status: todo
priority: medium
tags:
- vla
- training
- peft
- lerobot
- deferred
owner: ''
depends_on:
- TASK-088
created: 2026-03-11
updated: 2026-04-11
---

# TASK-090 — Pi0 LoRA trainer in training-worker

## What changed (2026-04-11 refactor)

The original version of this task proposed a separate SSH-to-Phuc training flow
with a dedicated `FineTuningPage.tsx` and a REST endpoint that `nohup`-spawned
`lerobot-train` on a remote box. **All of that is obsolete:**

- We already have a real LoRA training pipeline end-to-end (TASK-136 Phase 1a +
  1b, shipped). It uses **HTTP-polling** from `training-worker/worker.py` against
  a server claim endpoint — no NATS, no SSH, clean cancellation, live progress.
- `training-worker/trainers/smolvla_lora.py` is a real HF Transformers + PEFT
  LoRA trainer, wired into `TrainingOrchestrator`, with E2E test coverage
  (TASK-141, `scripts/test-e2e.sh`).
- The "Train a Skill" workflow already exists in the RMS training wizard
  (TASK-134, TASK-143). Sidebar was consolidated in TASK-147 — no room for a
  second training page.
- We don't have Phuc anymore. Training runs on the Mac (MPS) or on a short-lived
  cloud burst instance, whichever the operator chooses via a per-worker env.

So the real work is narrower: **add Pi0 as a second base model** in the
existing training-worker, using LeRobot v0.5.0's built-in PEFT flags. Keep all
our orchestration. Don't build a parallel UI.

## Motivation

Today `training-worker` can only fine-tune SmolVLA — our own PEFT wiring in
`trainers/smolvla_lora.py`. LeRobot v0.5.0 added first-class PEFT/LoRA support
to the `lerobot-train` CLI (`--policy.peft_config.use_peft=true`), which covers
Pi0 (and Pi0-FAST after TASK-089) without us hand-rolling target-module
detection. Leveraging it gives us:

- A second base model option for SO-101 skills (more capable than SmolVLA for
  long-horizon tasks)
- Less glue code — LeRobot owns the PEFT plumbing for Pi-family policies
- A clean template for adding Pi0-FAST LoRA later

## Hardware reality (2026-04-11)

| Host | SmolVLA LoRA | Pi0 LoRA |
|------|--------------|----------|
| **Mac** (MPS, 16–32 GB unified) | ✅ Already works (shipped) | ⚠️ Very slow but fits in unified memory with `lora_rank=8`. OK for tiny datasets / validation runs |
| **Cloud burst** (Modal / Runpod A10 / L4) | ✅ | ✅ Production path — rent GPU for a training run, tear down |
| **Pi** | ❌ | ❌ |

The training-worker is designed to be portable — the same binary runs on Mac or
a cloud pod. Worker picks job from the server's claim endpoint, doesn't care
where it lives.

## Scope

### 1. `training-worker/trainers/pi0_lora.py` (new)

Mirrors the `smolvla_lora.py` structure:

- Subclass `BaseTrainer` from `trainers/base.py` (same cancellation + progress
  callback contract as SmolVLA)
- **Wraps `lerobot-train` as a subprocess** (not a library call) — pass the
  PEFT flags:
  ```
  lerobot-train \
    --policy.type=pi0 \
    --policy.peft_config.use_peft=true \
    --policy.peft_config.lora_rank=<rank> \
    --dataset.repo_id=<staged lerobot dataset path> \
    --output_dir=<temp dir>
  ```
- Parse LeRobot's stdout/stderr for step/epoch progress → emit `ProgressEvent`
  on the existing callback
- Forward `CancelledError` to the subprocess via SIGTERM (respect the
  server's cancel signal just like `smolvla_lora.py` does)
- On success: tar the output directory (PEFT adapter safetensors + config) and
  hand back a `TrainerResult` — same shape as SmolVLA so `storage.py` can
  upload to RustFS unchanged
- Dataset staging: reuse `training-worker/storage.py` to download the LeRobot v3
  dataset from RustFS and point `--dataset.repo_id` at the local path

### 2. Trainer registry

`training-worker/trainers/__init__.py`
- Register `pi0_lora` alongside `smolvla_lora` and `stub`
- Keyed by `trainer_type` field in the job payload

`training-worker/config.py`
- Expose `TRAINER_TYPES` env or config so a given worker can opt out of Pi0
  (e.g. a laptop worker with limited disk won't claim Pi0 jobs)

### 3. Server — job schema

`server/src/services/TrainingOrchestrator.ts` + training routes
- Add `baseModel: 'smolvla' | 'pi0'` to the training job schema
- Route to the matching `trainer_type` when a worker claims the job
- Existing claim endpoint (TASK-136 Phase 1a) — no new endpoints

### 4. Training wizard — base model picker

`app/src/features/training/` (locate the existing wizard — TASK-134 put it under
a unified "Train a Skill" flow)
- Add a base-model step (or inline field): dropdown `SmolVLA | Pi0`, with a
  short tooltip comparing them (size, expected training time, when to pick
  which)
- LoRA rank field — already exists for SmolVLA, reuse the same control
- **No new page.** Extend the existing wizard.

### 5. Tests

- `training-worker/tests/test_pi0_lora.py` — subprocess-mocked unit test
  (assert correct CLI args, progress parsing, cancellation)
- Extend `scripts/test-e2e.sh` with a Pi0 LoRA path, gated on a
  `TEST_PI0=1` flag so it stays opt-in (Pi0 checkpoint download is heavy — CI
  would suffer if it ran every time)

## Done when

- [ ] `training-worker/trainers/pi0_lora.py` implemented against LeRobot v0.5.0
      PEFT
- [ ] Training job with `baseModel: 'pi0'` runs end-to-end on Mac: claim →
      train (few steps) → artifact uploaded to RustFS → visible in RMS
- [ ] Training wizard in RMS offers `SmolVLA | Pi0` base model selection
- [ ] Cancellation works: kill the subprocess, worker reports cancelled,
      job state transitions correctly
- [ ] Unit test for Pi0 trainer passes
- [ ] `npm run typecheck` in `server/` and `app/` → 0 errors

## Non-goals

- Pi0-FAST LoRA — follow-up once TASK-089 lands the Pi0-FAST backend
- Full Pi0 training on Pi hardware (it's a 3B VLM, the Pi isn't the right host)
- Automatic cloud-burst provisioning — operator manually spins up a GPU pod and
  runs `training-worker` there; job scheduling is unchanged

## References

- LeRobot PEFT docs: https://huggingface.co/docs/lerobot/peft_training
- LeRobot v0.5.0 blog: https://huggingface.co/blog/lerobot-release-v050
- Existing SmolVLA LoRA trainer: `training-worker/trainers/smolvla_lora.py`
- Training worker base: `training-worker/trainers/base.py`
- HTTP-polling claim flow (TASK-136 Phase 1a): `training-worker/worker.py`
- E2E test harness (TASK-141): `training-worker/scripts/test-e2e.sh`
- Training wizard entry: `app/src/features/training/`
