---
id: TASK-136
aliases:
- TASK-136
title: 'Phase 1: Python training worker (NATS consumer + SmolVLA LoRA)'
slug: phase-1-python-training-worker-nats-consumer-smolvla-lora
status: backlog
priority: 1
owner: ''
projects: []
customers: []
tags:
- core
sprint: ''
depends_on: []
due_date: ''
created: 2026-04-05
updated: 2026-04-05
---

# Phase 1: Python training worker (NATS consumer + SmolVLA LoRA)

## Description

The training pipeline is fully wired up on the Node.js side (hyperparameter validation, NATS job queue, progress callbacks, MLflow hooks, ETA tracking, UI) but the worker that actually runs training is stubbed — it consumes the NATS message, acks it, logs "awaiting external Python worker", and returns. This task implements the actual Python worker that fine-tunes SmolVLA on a dataset and closes the loop.

## Details

### Current state

- `server/src/workers/training.worker.ts:155-170` — stub that acks messages and logs "awaiting external Python worker"
- Server already exposes callback endpoints that work:
  - `POST /api/training/workers/heartbeat`
  - `POST /api/training/workers/progress` (stepNumber, loss, accuracy, lr, …)
  - `POST /api/training/workers/complete` (artifactUri, finalMetrics)
  - `POST /api/training/workers/failed` (errorMessage)
  - `POST /api/training/workers/checkpoint` (checkpointUri, epoch)
- NATS JetStream subject: `training.jobs.finetune` (consumer: `training-workers`)
- MLflow server optional; RustFS S3-compatible storage for artifacts

### Architecture

Create a new Python package at `training-worker/` (sibling to `vla-server/`):

```
training-worker/
├── pyproject.toml          # uv package manifest
├── README.md               # setup + run instructions
├── worker.py               # NATS consumer entrypoint
├── trainers/
│   ├── __init__.py
│   ├── base.py             # BaseTrainer abstract interface
│   └── smolvla_lora.py     # SmolVLA LoRA fine-tune via LeRobot
├── callbacks.py            # HTTP client for /workers/* callbacks
├── storage.py              # RustFS artifact upload
└── config.py               # env/env-file configuration
```

### Implementation

**1. NATS consumer loop** (`worker.py`):
- Connect to NATS via `nats-py`, subscribe to `training.jobs.finetune` JetStream consumer
- Pull one message at a time, parse `TrainingJobMessage` shape (jobId, datasetId, hyperparameters, modelConfig)
- Spawn a trainer subprocess based on `baseModel` field (dispatches to SmolVLA LoRA first; pi0.5/GR00T future)
- Emit heartbeat every 30s while job is running
- On success: upload artifact + POST `/complete`; on failure: POST `/failed`
- Graceful shutdown on SIGTERM (cancels current job, requeues message)

**2. SmolVLA LoRA trainer** (`trainers/smolvla_lora.py`):
- Wrap LeRobot's `lerobot-train` CLI or use `lerobot.policies.smolvla.modeling_smolvla.SmolVLAPolicy` + HuggingFace `Trainer` with PEFT/LoRA config
- Stream training step metrics (loss, lr, grad_norm) to callback `/progress` every N steps
- Save checkpoints at configurable intervals, POST to `/checkpoint`
- Dataset: downloaded from RustFS using `datasetId` → presigned URL → local cache

**3. Callback client** (`callbacks.py`):
- Thin `httpx` wrapper that POSTs to server endpoints
- Retries with exponential backoff on network errors (job state must survive transient server blips)

**4. Artifact upload** (`storage.py`):
- After training: pack final model to a tarball + safetensors
- Upload to RustFS at `models/{jobId}/final.tar.gz`
- Return the artifact URI that goes into `/complete`

### Configuration

Environment variables (plus `.env.example`):
- `NATS_URL` (default `nats://localhost:4222`)
- `NEODEM_SERVER_URL` (default `http://localhost:3001`)
- `RUSTFS_ENDPOINT`, `RUSTFS_ACCESS_KEY`, `RUSTFS_SECRET_KEY`
- `TRAINING_DEVICE` (`mps` on Mac, `cuda` on Linux GPU, `cpu` fallback)
- `TRAINING_CHECKPOINT_INTERVAL` (default 5 epochs)
- `WORKER_ID` (unique identifier for heartbeats)

### Deployment

- Systemd service unit `neodem-training-worker.service` (on GPU host, not the Pi)
- For dev on Mac: `uv run python worker.py` (uses MPS for small fine-tune runs)
- For CI smoke test: point at stub LeRobot dataset, train 10 steps, verify callback roundtrip

### GPU vs CPU

- Pi has no GPU — worker will not run here
- Mac has MPS — usable for small LoRA runs (rank 8, batch 1-2, ~100-step fine-tune)
- Linux+CUDA — production target for serious fine-tuning

## Test Strategy

1. **Unit**: stub NATS message, assert trainer is dispatched with correct hyperparameters
2. **Integration (loopback)**: publish a fake training job to NATS, worker picks it up, runs 10 LoRA steps on a tiny LeRobot dataset, calls all 4 callbacks in order, uploads artifact tarball
3. **End-to-end**: submit job via UI (`/training`) → worker consumes → progress bar advances in UI → job completes with real checkpoint in RustFS → new ModelVersion row created
4. **Failure path**: invalid datasetId → worker POSTs `/failed` → UI shows error with message
5. **Cancellation**: cancel job via UI mid-run → worker receives cancel signal (NATS or DB poll) → stops training, POSTs `/failed` with "cancelled"
6. **Checkpoint**: verify checkpoints land in RustFS at the configured interval

## Open questions

- Should the worker pull its own dataset from RustFS, or does the server pre-signal + provide a URL? (Prefer: worker requests signed URL from server)
- How does the worker get a dataset's local path / formatted LeRobot v3 structure? (It downloads the Parquet + meta/ and lets LeRobot handle it)
- Should we support resume-from-checkpoint in this first version? (Deferred — v2)

## Dependencies

- Requires RustFS running for artifact storage
- Requires NATS JetStream running
- Requires at least one ready dataset with `status = 'ready'`
- GPU-capable host for meaningful training runs
