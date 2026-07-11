---
id: TASK-178
aliases:
- TASK-178
title: Wire Cosmos 3 synthetic data into Training UI (generate wizard + tagged datasets + video preview)
slug: wire-cosmos-3-synthetic-data-into-training-ui-generate-wizard-tagged-datasets-vi
status: done
priority: 2
owner: ''
projects: []
customers: []
tags:
- extended
sprint: ''
depends_on:
- '[[TASK-175]]'
due_date: ''
created: 2026-06-29
updated: 2026-07-11
status_note: 'DONE — full-stack feature built + Playwright-validated. Code confirmed merged on main (2026-07-11: CosmosSyntheticService.ts, cosmos-synthetic.routes.ts, GenerateSyntheticModal.tsx all present). Generate wizard, synthetic-tagged datasets, local-disk episode/video/frames serving, in-browser video + trajectory chart all working. All ACs met.'
---


# Wire Cosmos 3 synthetic data into Training UI (generate wizard + tagged datasets + video preview)

## Description

Surface the TASK-175 Cosmos 3 synthetic-data pipeline (`server/curation/cosmos3_synth.py`)
in the app: a "Generate Synthetic" wizard on the Datasets page that runs
generation as a background job, registers the result as a real, training-ready
dataset tagged **synthetic**, and previews the generated video. Depends on [[TASK-175]].

## Details

**Current state before:** `cosmos3_synth.py` (generate→convert→LeRobot v2.1) was
CLI-only and unwired. The existing `/api/synthetic*` infra is Isaac-Lab + RustFS
and its executor is a stub. Dataset video/episode routes were RustFS/HF-only.

### Server
- `services/CosmosSyntheticService.ts` — singleton; runs `cosmos3_synth.py`
  `generate --episodes N [--prompt …]` then `convert` as a spawned process,
  streams progress from stdout (one active job at a time — ZeroGPU quota is
  serial), then registers the converted dir as a `ready` `Dataset` with
  `infoJson._synthetic = true` and an absolute local `storagePath`. Find-or-creates
  a `widowx_bridge` RobotType. Resolves the HF token from `HF_TOKEN` /
  `COSMOS_SYNTH_ENV` / `scratch/cosmos3/.env`.
- `routes/cosmos-synthetic.routes.ts` (`/api/synthetic-cosmos`): `GET /config`,
  `POST /generate`, `GET /jobs`, `GET /jobs/:id`, `POST /jobs/:id/cancel`.
- `routes/datasets.routes.ts` — guarded **local-disk** branches in the episodes,
  frames and video routes (`isLocalDataset`), so the existing viewer plays v2.1
  on-disk synthetic datasets (per-episode mp4 + parquet) with Range support.
- `types/vla.types.ts` — `LeRobotInfo._synthetic` / `_generator`.
- `cosmos3_synth.py` — additive optional `--prompt` flag.
- `scripts/seed-synthetic-demo.ts` (+ `npm run seed:synthetic`) — register an
  already-converted dir for UI testing without GPU spend.

### Frontend (`app/src/features/training`)
- `api/syntheticApi.ts`, `hooks/useSyntheticGeneration.ts` (config + job polling).
- `components/GenerateSyntheticModal.tsx` — wizard: Configure (episode slider 1–N,
  prompt, Cosmos provenance banner, token/availability notices) → live progress
  (phase, progress bar, generator log, cancel) → result (success + episode-0
  **video preview**) / failure.
- `DatasetCard.tsx` — purple "Synthetic" badge when `infoJson._synthetic`.
- `pages/DatasetsPage.tsx` — "Generate Synthetic" button, "Synthetic" stat,
  "Synthetic only" filter; on success refresh + navigate to episodes.
- `types/training.types.ts` — `_synthetic` marker + Cosmos job/config types.

## Acceptance Criteria
- [x] "Generate Synthetic" wizard on the Datasets page starts a real generation job and streams progress
- [x] Generated dataset is registered as `ready`, tagged synthetic, and listed (badge + stat + filter)
- [x] Generated episode video previews in the wizard and plays on the episodes page (local-disk serving)
- [x] Server + app typecheck clean; TASK-175 validation vitest still passes
- [x] Playwright-validated: desktop + mobile wizard, badge/stat/filter, episodes video + trajectory chart

## Test Strategy
Seed a converted dataset (`npm run seed:synthetic -- <dir>`), open `/datasets`:
verify the synthetic badge/stat/filter and the wizard Configure view; open the
dataset's episodes page and confirm the video plays and the joint-trajectory
chart renders from the local parquet. Real generation needs an HF PRO token.

## Notes
Validated on branch `feat/g1-pointcloud` (uncommitted). Related: [[TASK-175]],
[[project_cosmos3_wm_eval]], [[project_sim_rl_phase0]].
