---
id: TASK-239
aliases:
- TASK-239
title: Let a training run start from an existing model, so a fine-tune can be improved
  instead of only re-derived from a foundation model
slug: resume-training-from-a-checkpoint
status: todo
priority: 2
owner: ''
projects: []
customers: []
tags:
- core
- training
sprint: ''
parent: ""
depends_on:
spe: 5
effort: ""
- '[[TASK-238]]'
due_date: ''
created: 2026-09-04
updated: "2026-09-05"
status_note: 'Written 2026-09-04. Depends on TASK-238 because a run cannot cite a
  starting model until model versions are addressable and their checkpoints
  persisted.'
---

# Let a training run start from an existing model

## Description

Today every training run starts from one of six foundation models. There is no
way to continue from a checkpoint or to fine-tune a fine-tune, which makes
iterative improvement — the whole point of an experiment loop — impossible to
express.

## Details

### Current state

- `TrainingJob.baseModel` is a closed enum
  (`server/src/types/vla.types.ts:23`):
  `['pi0', 'pi0_6', 'openvla', 'groot', 'groot_n1_7', 'smolvla']`.
- The wizard (`app/src/features/training/components/TrainingJobWizard.tsx:67`)
  renders exactly those six as selectable cards; `form.baseModel` is the only
  thing that decides where weights come from.
- There is no `resumeFrom`, `initFrom` or `parentModelVersionId` anywhere in the
  job path — a repo-wide grep for those names returns only `baseModel` hits.
- After TASK-238, `ModelVersion` has a `parentModelVersionId` and persisted
  `ModelCheckpoint` rows, so both a finished model and a mid-run checkpoint are
  addressable.

### Server

**Schema** (`server/prisma/schema.prisma`): `TrainingJob` gains
`initFromModelVersionId String?` and `initFromCheckpointId String?` (at most one
set — enforce in the service, not the DB). `baseModel` stays required and keeps
recording which foundation architecture the weights descend from: a run
initialised from a `groot_n1_7` fine-tune is still a `groot_n1_7` run, and the
worker needs that to pick a trainer.

**Types** (`server/src/types/vla.types.ts`): add both fields to `TrainingJob`,
`CreateTrainingJobInput` and the worker job payload.

**Validation** (`server/src/services/TrainingJobService.ts`): reject a job whose
`initFromModelVersionId` names a model whose `baseModel` differs from the job's
`baseModel` — initialising a pi0 run from GR00T weights is not a decision the
operator can rescue at submission time. Word the error the way
`CompatibilityReport.headline` is worded in
`server/src/types/mixture.types.ts`: one sentence, quotable in a 400.

**Lineage** (`server/src/services/TrainingOrchestrator.ts`): `completeJob`
already has the hook from TASK-238 — set the new `ModelVersion.parentModelVersionId`
from the job's `initFromModelVersionId`, so the model graph records the chain
without anyone maintaining it by hand.

**Worker contract**: the job payload gains `initFrom: { artifactUri, kind:
'model' | 'checkpoint' } | null`. The training worker is a separate repo
(`../training-worker/`) — this task ships the server side and documents the
field in `docs/training-run-export.md`; a worker that ignores the field must
still run, so it is additive and never required.

**Export manifest** (`server/src/types/mixture.types.ts`,
`TrainingRunManifest`): add `job.initFrom` so an exported run states what it
started from. A run that says only "groot_n1_7" when it actually resumed a
14k-step fine-tune is not reproducible, which is the same failure
`sourceRevision` was added to fix.

### Frontend

`TrainingJobWizard.tsx` step "Model": add a second mode next to the six
foundation cards — "Continue from an existing model". Selecting it shows a
model picker (the `useModelVersions` hook and `ModelVersionCard` from TASK-238),
filtered to models whose `baseModel` matches, plus an optional checkpoint
dropdown for that model. The review step must print what the run starts from;
`form.baseModel.toUpperCase()` at line 742 currently implies a foundation model
unconditionally.

### Key files

- `server/prisma/schema.prisma`
- `server/src/types/vla.types.ts`
- `server/src/types/mixture.types.ts`
- `server/src/services/TrainingJobService.ts`
- `server/src/services/TrainingOrchestrator.ts`
- `server/src/services/TrainingRunExportService.ts` (manifest)
- `server/src/routes/training.routes.ts`
- `app/src/features/training/components/TrainingJobWizard.tsx`
- `app/src/features/training/types/training.types.ts`
- `docs/training-run-export.md`

## Acceptance Criteria

- [ ] A job can be created with `initFromModelVersionId`, and the worker payload
      carries `initFrom.artifactUri`
- [ ] A job can be created from a specific `ModelCheckpoint` of a running or
      finished job
- [ ] A mismatched `baseModel` is rejected with a one-sentence 400
- [ ] The `ModelVersion` produced by such a run has `parentModelVersionId` set
- [ ] The export manifest states `job.initFrom`
- [ ] The wizard offers "Continue from an existing model" and the review step
      names the starting model, not just the architecture
- [ ] A job with neither field set behaves exactly as before

## Test Strategy

- **Unit (vitest, server):** base-model mismatch rejection; both-fields-set
  rejection; payload shape with and without `initFrom`; `completeJob` sets
  `parentModelVersionId`; manifest contains `initFrom`.
- **Unit (vitest, app):** wizard advances with a picked model and blocks with
  none; review step text.
- **Manual:** register the `g1_apple_pnp` GR00T checkpoint (TASK-238), start a
  run from it, confirm the resulting `ModelVersion` links back to it in
  `GET /api/models/versions/:id/lineage`.

## Notes

Deliberately out of scope: actually making the training worker honour
`initFrom`. That lives in `../training-worker/` and is tracked there; the server
contract is additive so both sides can land independently.
