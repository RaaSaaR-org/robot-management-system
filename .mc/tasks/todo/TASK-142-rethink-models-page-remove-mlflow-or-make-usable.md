---
id: TASK-142
aliases:
- TASK-142
title: 'Rethink /models page: remove MLflow or make it usable'
slug: rethink-models-page-remove-mlflow-or-make-usable
status: todo
priority: 3
owner: ''
projects: []
customers: []
sprint: ''
tags:
- extended
depends_on: []
due_date: ''
created: '2026-04-06'
---

## Description

The `/models` page (`http://localhost:1420/models`) is a full MLflow model registry UI that will never work without deploying a separate MLflow server. Since MLflow is optional infrastructure we don't run, this page always returns 503. Decide whether to remove it entirely or replace it with something that connects to the actual training/inference pipeline (vla-server + RustFS).

## Problem

The current `/models` page and its backend are a dead-end MLflow integration:

- **Server routes** proxy to an MLflow API that isn't running → always 503 ("MLflow not available")
- **Frontend** has a full registry UI (model list, version management, comparison dashboard) that never shows data
- **Actual model flow** bypasses MLflow entirely: training worker → RustFS (S3 storage) → vla-server loads adapter

## Current Architecture (what actually happens)

1. Training worker fine-tunes SmolVLA LoRA adapters
2. Checkpoints/adapters are stored in **RustFS** (S3-compatible object storage)
3. **vla-server** (FastAPI, `vla-server/server.py`) loads models for inference
4. MLflow is not in the loop at all

## Options

### Option A: Remove it
Delete the MLflow-backed models page, routes, service, and types. One less dead feature.

### Option B: Replace with a real models page
Build a simpler models page that shows what actually exists:
- Trained adapters/checkpoints in RustFS
- Metadata from training jobs in the DB (Prisma)
- Which model is loaded in vla-server
- Possibly trigger model deployment to vla-server from the UI

## Key Files

### Frontend
- `app/src/features/training/pages/ModelsPage.tsx` — main page component
- `app/src/features/training/components/ModelRegistryList.tsx` — model list
- `app/src/features/training/components/ModelVersionList.tsx` — version list
- `app/src/features/training/components/ModelComparisonDashboard.tsx` — comparison UI
- `app/src/features/training/hooks/useModels.ts` — hook (calls MLflow-backed store actions)
- `app/src/routes/lazyPages.ts` — lazy import (`LazyModelsPage`)
- `app/src/App.tsx:337` — route definition (`path="/models"`)
- `app/src/components/layout/Sidebar.tsx:202` — sidebar nav entry

### Server
- `server/src/routes/models.routes.ts` — ~500 lines of MLflow proxy routes (experiments, runs, registry, versions, aliases, compare)
- `server/src/services/MLflowService.ts` — MLflow HTTP client service
- `server/src/types/mlflow.types.ts` — MLflow type definitions

### Actual inference (what we use instead)
- `vla-server/server.py` — FastAPI VLA inference server (SmolVLA, Pi0.5, GR00T)
- `server/src/storage/` — RustFS/S3 storage client (where trained models live)

## Test Strategy

- If removing: verify typecheck passes, `/models` route removed, sidebar link removed
- If replacing: new page should show models from RustFS/DB, no MLflow dependency
