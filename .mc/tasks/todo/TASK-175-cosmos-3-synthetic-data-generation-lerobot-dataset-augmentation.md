---
id: TASK-175
aliases:
- TASK-175
title: Cosmos 3 synthetic-data generation → LeRobot dataset augmentation
slug: cosmos-3-synthetic-data-generation-lerobot-dataset-augmentation
status: backlog
priority: 3
owner: ''
projects: []
customers: []
tags:
- extended
sprint: ''
depends_on:
- '[[TASK-174]]'
due_date: ''
created: 2026-06-28
updated: 2026-06-28
status_note: 'Pipeline DONE on HF PRO — generate→convert→validate proven end-to-end (3/4 AC). Only the real-vs-synthetic fine-tune ablation remains (needs rented GPU).'
---


# Cosmos 3 synthetic-data generation → LeRobot dataset augmentation

## Description

Use **Cosmos 3** (forward-dynamics / action-conditioned video generation) to produce **synthetic robot episodes** that augment our **LeRobot datasets**, increasing data diversity for VLA fine-tuning in `training-worker`. This is the strongest **offline** near-term fit for Cosmos 3. See [[RES-001]]. Depends on [[TASK-174]] (access path + cost) before committing GPU spend.

## Details

**Current state:** NeoDEM collects real episodes (LeRobotDataset format, HF Hub sync) and fine-tunes VLAs (SmolVLA/pi0/ACT) in the separate `training-worker` repo. We have no synthetic-data pipeline. Cosmos 3 is explicitly positioned to "generate action-conditioned robot data … diverse task trajectories at scale" and ships **open post-training/inference scripts** at `github.com/nvidia/cosmos`.

**Goal:** a repeatable pipeline that takes a small seed of real LeRobot episodes (or text+image prompts) and emits additional episodes in a Cosmos-supported embodiment, exported back into **LeRobotDataset** format so `training-worker` can consume them unchanged.

**Approach:**
0. **Prototype free first (HF PRO):** the official **`nvidia/Cosmos3-Action-Viewer`** (HF Space, ZeroGPU) does **forward dynamics** (actions→video) — exactly action-conditioned generation. With HF PRO ($9/mo, 40 GPU-min/day) generate a handful of action-conditioned rollouts and wire one through the LeRobot converter to validate the pipeline end-to-end **before** any rented-GPU spend. See [[RES-001]] §4.7 + `scratch/cosmos3/HF-PRO-RUNBOOK.md`. (Note: ZeroGPU is capped — use it to prove the pipeline, not to produce the full dataset.)
   - ⛔ **Verified end-to-end 2026-06-28 — this step REQUIRES HF PRO.** The `/generate` action endpoint is a **300s GPU job**. Anonymous → blocked (duration cap). Free signed-in token → clears the cap but **300s exceeds the free daily quota (~300s/day)** → `AppError: exceeded your free ZeroGPU quota`. HF's error explicitly points to PRO (40 min/day ≈ ~8 runs). So: **buy PRO**, then `scratch/cosmos3/hf_generate.py --action`.
   - **Request schema** (`/generate` request_json): `{"dataset":"bridge","baked_action":[[…action_dim floats…]],"sample_index":0,"model_mode":"forward_dynamics","prompt_description":"…","num_steps":30,"guidance":1.0,"seed":0}`. Conditioning frames come from the Space's packaged dataset (`bridge`=WidowX, `robomind_franka[_dual]`); `baked_action` width must match the dataset's action dim. Easiest source of a valid `baked_action`: the in-browser viewer, or read a sample from the packaged LeRobot dataset.
1. Pick the **scale** access path from [[TASK-174]] (rented H100/H200 with `nvidia/Cosmos3-Super` via `vllm serve --omni`, or the **Generator NIM** `cosmos3-generator:1.0.0` — now shipped; or DeepInfra pay-per-second for managed batch).
2. Generate action-conditioned rollouts for a **documented embodiment first** (e.g. Franka 10D / WidowX 10D) — do NOT block on G1, which is unsupported (that is [[TASK-177]]).
3. Write a converter to LeRobotDataset (episodes, frames, actions, task strings) and validate with the existing dataset-validation worker (`server/src/workers/`).
4. Run a small **ablation**: fine-tune a VLA on real-only vs real+synthetic and compare eval success rate via the existing evaluation feature.

**Key files / repos:** new converter (likely in `training-worker` or a small sidecar repo), reuse `server/` dataset ingest + `app/src/features/training` for visibility. Keep generation off-box (cloud GPU).

## Result (2026-06-28, HF PRO)

End-to-end pipeline **proven on HF PRO** — no rented GPU needed for prototyping.

- **Pipeline:** `server/curation/cosmos3_synth.py` (`generate` → `convert`).
  - `generate` calls `nvidia/Cosmos3-Action-Viewer-Prerelease` (ZeroGPU, Cosmos3-Nano
    forward-dynamics) via the **raw gradio HTTP API** (`/gradio_api/call/generate` +
    SSE). `gradio_client` was abandoned: it auto-downloads file outputs and 403s on a
    checkpoint path embedded in the result JSON. Artifacts fetched with the bearer token.
  - **Action representation:** bridge/WidowX model action is **10-D** (`quantile_rot`:
    `[trans(3) + 6D-rot + gripper]`), not the LeRobot column's 7-D euler. Converter
    `euler→6D` (real `action` column → valid `baked_action`). Conditioning frames come
    from the Space's packaged bridge LeRobot dataset (downloaded on demand).
  - **Latency/cost:** ~**10–35s per rollout** (warm checkpoint), 640×480, ~17 frames.
    Generated **4 bridge episodes** (`task175-bridge-00..03`), all `ok=true`.
- **Export:** valid **LeRobot v2.1** dataset (`meta/info.json|stats.json|episodes.json|
  episodes.jsonl|tasks.jsonl`, `data/chunk-000/episode_*.parquet`,
  `videos/observation.images.image_0/chunk-000/*.mp4`). 4 episodes, 68 frames.
- **Validation (real worker code):** `server/src/services/__tests__/synthetic-dataset-validation.test.ts`
  runs the actual `DatasetService.validateStructure` + `computeQualityScore` against the
  fixture `fixtures/cosmos-synthetic-bridge/` → `valid=true`, no errors, formatCompliance=10. ✅
- **Docs:** `server/curation/README.md` (Cosmos 3 section) + `scratch/cosmos3/HF-PRO-RUNBOOK.md`.

**Remaining (AC #3 — ablation):** real-vs-synthetic fine-tune needs `training-worker`
+ a **rented GPU** (RES-001 §4.2–4.3) and a real seed dataset; ZeroGPU can't train.
Recommend tracking as a follow-up under training-worker rather than blocking this task.

## Acceptance Criteria
- [x] Generate ≥N synthetic episodes for a supported embodiment and export valid LeRobotDataset — 4 bridge episodes, LeRobot v2.1
- [x] Synthetic dataset passes existing dataset-validation worker — real `validateStructure` test passes
- [ ] Ablation result (real vs real+synthetic) recorded in [[RES-001]] or the task — **deferred: needs rented GPU + training-worker**
- [x] Pipeline documented well enough to re-run — `cosmos3_synth.py` + README + runbook

## Test Strategy
Validate exported dataset loads via LeRobot tooling + our validation worker; ablation eval numbers logged. Manual spot-check of generated frames for physical plausibility (note NVIDIA's own caveat that world models can be unreliable simulators).

## Notes
Offline only — no closed-loop control. Defer G1-specific generation to [[TASK-177]].
