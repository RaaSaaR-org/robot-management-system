---
id: "TASK-323"
aliases:
- TASK-323
title: "Run a data-ablation experiment end to end on a real dataset with reward scores and the GPU training worker"
slug: "run-a-data-ablation-experiment-end-to-end-on-a-real-dataset"
status: "todo"
priority: 3
owner: "huhn511"
projects: []
customers: []
tags:
- core
- training
- agent
sprint: ""
parent: ""
depends_on: []
spe: 3
effort: "low"
due_date: ""
created: "2026-09-30"
updated: "2026-09-30"
status_note: 'Split out of TASK-242: the one acceptance criterion and the manual test
  that need the GPU training worker and a reward-model run. Needs hardware — the GPU
  box, not a Mac.'
---

# Run a data-ablation experiment end to end on a real dataset with reward scores and the GPU training worker

## Description

TASK-242 shipped the experiment loop (propose → approve → train → evaluate in sim →
rate → verdict) and verified it against mocked training jobs, a mocked simulator
and seeded reward rows. What it could not do on a Mac is run it for real: a real
dataset scored by a reward model, two real training runs on the GPU training
worker, and two real MuJoCo evaluations of the resulting checkpoints. This task
does exactly that once and records what happened. **Needs hardware: the GPU box
running the training worker (separate `training-worker` repo).**

## Details

### Current state

- `POST /api/experiments/propose/data-ablation` (`server/src/services/ExperimentProposer.ts`)
  reads `EpisodeReward` rows of one `rewardType` for a dataset, creates one dataset
  view per low-score band (same rule as `POST /api/datasets/:id/views/from-rewards`)
  and proposes baseline = full dataset vs. one arm per view.
- `POST /api/experiments/:id/approve` (human only) freezes the views and submits one
  training job per arm through `TrainingJobService.submitJob`; the worker claims them
  over HTTP.
- `ExperimentService` (`server/src/services/ExperimentService.ts`) listens for
  `TrainingOrchestrator` `model:completed` / `model:failed` and `SimulationService`
  `job:completed` / `job:failed`, so after approval nothing is manual. A scored arm
  writes `EvaluationEpisode` rows (`source: 'sim'`, `robotId: null`) and a `Rating` on
  its `ModelVersion` by agent `experiment-runner`; the last arm writes the verdict and
  a comment on the experiment.
- UI: `/experiments` and `/experiments/:id` (`app/src/features/experiments/`).
- Everything above is covered by vitest with fakes and by
  `server/src/__tests__/experiments-routes.integration.test.ts` on SQLite.

### What to do

1. Pick a G1 dataset registered on the dev server (e.g. the apple-to-plate set used
   by `g1_apple_pnp`) and run a `reward_model` job for `robometer` on it so
   `EpisodeReward` rows exist.
2. `POST /api/experiments/propose/data-ablation` with
   `{ datasetId, bands: [0.1], baseModel: 'groot_n1_7', fineTuneMethod: 'lora',
   evaluation: { environment: 'g1_apple_pnp', rolloutCount: 50 } }` as an agent
   (`X-Agent-Name`), approve it in the UI.
3. Let both arms train on the GPU worker and evaluate in MuJoCo (real backend,
   `SimulationService.getExecutionBackend()` must answer `real`). Check the evaluator reports `totalEpisodes` /
   `successfulEpisodes` so the arm counts are exact.
4. Read the verdict on `/experiments/:id` and the `experiment-runner` rating with its
   evidence chips on each model's detail view. Write the outcome (numbers, verdict,
   anything that broke) into this file's Notes.

### Key files

- `server/src/services/ExperimentService.ts`, `server/src/services/ExperimentProposer.ts`
- `server/src/services/SimulationService.ts` (`submitEvaluation`)
- `app/src/features/experiments/`

## Acceptance Criteria

- [ ] The `data-ablation` proposer produces a valid experiment from a real dataset
      with reward scores (moved here from TASK-242)
- [ ] Both arms train on the GPU worker, evaluate in sim and reach `scored` without
      manual action
- [ ] The verdict and the runner agent's ratings, with their evidence, are visible
      in the UI

## Test Strategy

Manual, end to end on the local stack plus the GPU box, as above. No new code is
expected; a defect found here gets fixed in this task with a regression test.

## Notes
