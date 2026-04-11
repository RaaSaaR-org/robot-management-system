---
id: TASK-150
aliases:
- TASK-150
title: 'Repo split: extract vla-server and training-worker into separate repositories'
slug: extract-vla-server-and-training-worker-repos
status: todo
priority: 3
owner: ''
projects: []
customers: []
sprint: ''
tags:
- core
- deferred
depends_on: []
due_date: ''
created: '2026-04-07'
---

## Description

Extract `vla-server/` and `training-worker/` from the monorepo into their own repositories. Both are pure Python services with clean API boundaries — no shared code with the Node.js components. Splitting enables independent versioning, independent deployment to GPU machines, and independent scaling.

## Why Split

### Current pain points
- **Different deployment targets**: vla-server and training-worker run on GPU machines (CUDA), while server+app run on CPU machines. Deploying the whole monorepo to a GPU box wastes time and space.
- **Different release cycles**: Model updates (vla-server) and training improvements (worker) happen independently of UI changes. Currently every change is one commit history.
- **Different dependency stacks**: Python (torch, transformers, lerobot) vs Node.js (express, prisma). Installing everything everywhere is wasteful.
- **Scaling**: Training workers should be spun up/down independently. Having them in the same repo makes containerization heavier than needed.

### Why these two specifically
- **vla-server** — stateless inference server, only HTTP API boundary (`/predict`, `/health`, `/config`, `/reset`). Zero shared code with Node.js. Already has its own `pyproject.toml`.
- **training-worker** — stateless polling worker, only talks to server via HTTP + RustFS via S3. Has its own `pyproject.toml`. Different people/agents might work on training vs UI.

### What stays in the monorepo
- **app/** + **server/** — tightly coupled via 48+ implicit REST endpoints, no OpenAPI schema, shared type assumptions. Splitting these would require generating type contracts first (not worth it yet).
- **robot-agent/** — contains both Node.js and Python (`hardware/`, `smolvla/`). The Python parts depend on lerobot for hardware control. Could split later but boundaries are blurry.
- **helm/**, **docs/**, **protos/**, **.claude/**, **.mc/** — stay with the main repo, they describe the system as a whole.

## Dependency Analysis

### vla-server dependencies
```
vla-server/
├── Depends on:
│   ├── PyTorch, transformers (model loading)
│   ├── LeRobot (SmolVLAPolicy, dataset stats)
│   ├── PEFT (LoRA adapter wrapping)
│   └── Model files from HuggingFace Hub or RustFS
├── Depended on by:
│   ├── robot-agent (POST /predict for inference)
│   └── sim_evaluator (POST /predict during simulation)
└── Communication: HTTP REST only (FastAPI)
    No shared code, no shared DB, no shared types with Node.js
```

### training-worker dependencies
```
training-worker/
├── Depends on:
│   ├── server HTTP API (claim jobs, report progress)
│   ├── RustFS/S3 (download datasets, upload artifacts)
│   ├── PyTorch, transformers, PEFT (LoRA training)
│   ├── LeRobot (SmolVLAPolicy, LeRobotDataset)
│   ├── pyarrow (parquet stats computation)
│   └── NATS JetStream (optional, for stats-worker)
├── Depended on by:
│   └── server (receives progress callbacks)
└── Communication: HTTP polling + S3 API + optional NATS
    No shared code with Node.js components
```

## Plan

### Phase 1: Prepare (in monorepo)

1. **Document API contracts** — write down the exact HTTP endpoints each service exposes/consumes:
   - vla-server: `/predict`, `/health`, `/config`, `/reset` (+ future `/load-adapter` from TASK-146)
   - training-worker: consumes `/api/training/workers/claim`, `/workers/progress`, `/workers/complete`, `/workers/failed`, `/workers/heartbeat`, `/workers/checkpoint`
   - training-worker stats: consumes NATS `jobs.dataset.compute-stats`, calls `/api/datasets/{id}`

2. **Version the API** — add a version header or path prefix so the split repos can evolve independently without breaking

3. **Ensure standalone pyproject.toml** — each should be pip-installable independently
   - `vla-server/pyproject.toml` — already exists, verify completeness
   - `training-worker/pyproject.toml` — already exists, verify completeness

### Phase 2: Extract vla-server

1. Create new repo `RaaSaaR-org/vla-server`
2. Move `vla-server/` contents to new repo root
3. Add CI (lint, type check, basic tests)
4. Add Dockerfile for GPU deployment
5. Add README with API docs and deployment instructions
6. In monorepo: replace `vla-server/` with a README pointing to the new repo
7. Update `docker-compose.yml` and `helm/` to reference the external image
8. Update `robot-agent/hardware/` references (VLA_SERVER_URL is already configurable)

### Phase 3: Extract training-worker

1. Create new repo `RaaSaaR-org/training-worker`
2. Move `training-worker/` contents to new repo root
3. Add CI (lint, type check, stub trainer test)
4. Add Dockerfile for GPU deployment
5. Add README with worker setup and configuration
6. In monorepo: replace `training-worker/` with a README pointing to the new repo
7. Update `docker-compose.yml` and `helm/` to reference the external image
8. Update test scripts (`scripts/test-all.sh`, `training-worker/scripts/test-e2e.sh`)

### Phase 4: Clean up monorepo

1. Remove extracted directories
2. Update `CLAUDE.md` project overview
3. Update `docs/architecture.md`
4. Update helm chart values
5. Verify `scripts/test-all.sh` still works (may need to skip extracted component tests or run them separately)

## Key Files

### vla-server (to extract)
- `vla-server/server.py` — FastAPI entry point
- `vla-server/models/` — model backends (smolvla.py, pi05.py, groot.py, base.py)
- `vla-server/pyproject.toml` — Python dependencies
- `vla-server/README.md` — existing docs

### training-worker (to extract)
- `training-worker/worker.py` — main polling loop
- `training-worker/trainers/` — smolvla_lora.py, stub.py, base.py
- `training-worker/stats_worker.py` — dataset stats computation
- `training-worker/storage.py` — S3/RustFS client
- `training-worker/callbacks.py` — HTTP callbacks to server
- `training-worker/config.py` — environment config
- `training-worker/pyproject.toml` — Python dependencies
- `training-worker/scripts/test-e2e.sh` — E2E test

### Monorepo files to update
- `docker-compose.yml` — service definitions
- `helm/neodem/` — K8s templates (vla-inference-deployment.yaml, etc.)
- `CLAUDE.md` — project overview table
- `docs/architecture.md` — system architecture
- `scripts/test-all.sh` — test orchestration

## Risks

- **Breaking E2E tests** — `test-all.sh` runs the training pipeline E2E which spans server + worker + vla-server. After split, this test needs a way to pull the other repos or use published Docker images.
- **LeRobot version drift** — if vla-server and training-worker pin different lerobot versions, model compatibility could break. Solution: shared version constraint in CI or a compatibility matrix.
- **Development friction** — changes that span server API + worker (e.g. new training parameter) now require PRs in two repos. Mitigated by stable API contracts.

## Test Strategy

- After each extraction: verify the extracted repo builds, tests pass, Docker image works
- Verify monorepo `scripts/test-all.sh` still runs (with external services)
- Verify `docker-compose up` still brings up the full stack
- Verify helm chart deploys correctly with external images
