---
id: TASK-238
aliases:
- TASK-238
title: Make the model registry writable and give it a lineage, so a fine-tune is a
  thing the system knows rather than a path someone remembers
slug: model-registry-write-api-and-lineage
status: todo
priority: 2
owner: ''
projects: []
customers: []
tags:
- core
- training
- deployment
sprint: ''
parent: ""
depends_on: []
spe: 8
effort: ""
due_date: ''
created: 2026-09-04
updated: "2026-09-05"
status_note: 'Written 2026-09-04 from a read of the live registry path. This is the
  foundation task for the agent-experiment work (TASK-239 .. TASK-242): none of the
  three above it can cite a model until a model can be registered, addressed and
  traced back to what it came from.'
---

# Make the model registry writable and give it a lineage

## Description

`ModelVersion` exists in the schema and is created automatically when a training
job completes, but it can only be **read** — there is no way to register a
fine-tune trained elsewhere, no way to link one to a skill after the fact, no
persisted record of its checkpoints, and no record of what it was derived from.
This task makes the registry a real registry: writable, addressable, and
lineage-aware.

## Details

### Current state

- **Creation, one path only.** `TrainingOrchestrator.completeJob`
  (`server/src/services/TrainingOrchestrator.ts:657`) creates a `ModelVersion`
  on job completion with `version: \`v${Date.now()}\``, `deploymentStatus:
  'staging'`, and `skillId: dataset?.skillId ?? null`. Its own comment says
  *"Skill linkage can be set later via the model registry"* — but there is no
  such registry surface.
- **API is read-only.** `server/src/routes/models.routes.ts` has exactly two
  handlers, `GET /api/models` and `GET /api/models/versions`. No POST, no PATCH.
- **Checkpoints are not persisted.** `TrainingOrchestrator` keeps them in an
  in-memory Map (`server/src/services/TrainingOrchestrator.ts:147`:
  `private checkpoints: Map<string, { epoch: number; uri: string }[]>`). The
  worker reports them via `POST /api/training/workers/checkpoint`
  (`server/src/routes/training.routes.ts:564`) and they are lost on restart.
  `ModelVersion.checkpointUri` exists in the schema and is never written —
  `completeJob` passes only `artifactUri`.
- **No lineage.** `ModelVersion` has `trainingJobId` but no parent. A model
  trained from another model cannot say so.
- **Evaluations are not anchored.** `EvaluationEpisode.modelVersion` is a free
  `String` with an index but no relation (`server/prisma/schema.prisma:2469`),
  while `SimToRealValidation.modelVersionId` uses the id. The two disagree, and
  neither is a foreign key, so "show me every evaluation of this model" is not
  answerable and a typo silently creates a second model in the charts.
- **No UI.** `ModelBrowser.tsx`, `ModelVersionCard.tsx` and `useModelVersions.ts`
  exist under `app/src/features/deployment/` and are exported from the feature
  barrel, but `grep` finds no `<ModelBrowser`, no `<ModelVersionCard` outside
  ModelBrowser itself, and no `useModelVersions()` call. `/models` is a redirect
  to `/training` (`app/src/App.tsx:453`) and the training page has only the tabs
  `jobs | simulation | evaluation`.

### Server

**Schema** (`server/prisma/schema.prisma`):

- `ModelVersion`: add `parentModelVersionId String?` with a self-relation
  (`parent` / `children`), and `name String?` so a model can carry a human name
  ("GR00T-N1.7 AppleToPlate") next to its timestamp version. Add
  `sourceKind String @default("training")` — `training | imported | derived` —
  so an externally trained checkpoint is distinguishable from one this server
  produced. Index `parentModelVersionId`.
- New model `ModelCheckpoint`: `id`, `modelVersionId?`, `trainingJobId`,
  `epoch Int`, `uri String`, `metricsJson String @default("{}")`,
  `createdAt`. Unique on `(trainingJobId, epoch)`. This replaces the in-memory
  Map — the Map may stay as a write-through cache but must not be the only copy.
- `EvaluationEpisode`: add `modelVersionId String?` with a relation to
  `ModelVersion`, **keeping** the existing `modelVersion String` column. Do not
  drop it in this task: rows already exist that only have the string, and a
  migration that guesses the id is worse than a nullable column. Backfill by
  exact match on `ModelVersion.version` and leave the rest null.

**Repository** (`server/src/repositories/VLARepository.ts`): add
`modelVersionRepository.update()` covering `skillId`, `deploymentStatus`,
`name`, `checkpointUri`, `parentModelVersionId`; and a
`modelCheckpointRepository` with `create` (upsert on `(trainingJobId, epoch)`)
and `listByJob`.

**Routes** (`server/src/routes/models.routes.ts`):

- `POST /api/models/versions` — register a model version. Body:
  `{ name?, version, artifactUri, modelType?, skillId?, parentModelVersionId?,
  trainingJobId?, trainingMetrics?, validationMetrics?, deploymentStatus? }`.
  `trainingJobId` becomes nullable in the input for `sourceKind: 'imported'`
  (schema change: `ModelVersion.trainingJobId String?`). Reject an `artifactUri`
  with no scheme — follow the `TrainingRunManifestDataset.uri` convention in
  `server/src/types/mixture.types.ts` (`hf://`, `s3://`, `file://`), for the
  same reason stated there: a bare path is not portable and fails on another
  machine in a way nobody can debug.
- `PATCH /api/models/versions/:id` — `skillId`, `deploymentStatus`, `name`.
- `GET /api/models/versions/:id` — one version with `skill`, `trainingJob`,
  `parent`, `children`, `checkpoints`, and an evaluation summary
  (count, success rate) derived from `EvaluationEpisode` by `modelVersionId`.
- `GET /api/models/versions/:id/lineage` — the ancestor chain to the root plus
  direct children, for a lineage view.

**Orchestrator** (`server/src/services/TrainingOrchestrator.ts`):
`recordCheckpoint` persists via `modelCheckpointRepository`; `completeJob` sets
`checkpointUri` on the created `ModelVersion` from the last recorded checkpoint,
and sets `parentModelVersionId` when the job carries one (that field arrives in
TASK-239 — write the plumbing so it is a one-line change there, but do not
depend on it).

### Frontend

- Turn `/models` into a real route rendering a new `ModelsPage` that uses the
  existing `ModelBrowser` + `useModelVersionsAutoFetch`, replacing the redirect
  at `app/src/App.tsx:453`. Keep `/training?tab=...` untouched.
- `ModelVersionCard`: show `name` when present (it currently falls back to
  `version.skill?.name || 'Unknown Skill'`, which reads as an error for every
  model whose dataset had no skill — i.e. all of them today), the
  `sourceKind` badge, and a parent link when `parentModelVersionId` is set.
- `SkillCard.tsx:83` renders the bare string "Model linked". Replace it with the
  linked model's name and version, fetched with the skill.
- A "Register model" modal on `ModelsPage`: name, version, artifact URI,
  optional skill, optional parent. This is what puts an externally trained
  fine-tune (e.g. the GR00T `g1_apple_pnp` checkpoint) into the system.

### Key files

- `server/prisma/schema.prisma`
- `server/src/routes/models.routes.ts`
- `server/src/repositories/VLARepository.ts`
- `server/src/repositories/index.ts`
- `server/src/services/TrainingOrchestrator.ts`
- `server/src/types/vla.types.ts` (`ModelVersion`, `CreateModelVersionInput`, `UpdateModelVersionInput`)
- `app/src/App.tsx`
- `app/src/features/deployment/pages/ModelsPage.tsx` (new)
- `app/src/features/deployment/api/deploymentApi.ts`
- `app/src/features/deployment/components/ModelVersionCard.tsx`
- `app/src/features/deployment/components/SkillCard.tsx`

## Acceptance Criteria

- [ ] `POST /api/models/versions` registers a model with no training job, and it
      appears in `GET /api/models/versions`
- [ ] `PATCH` sets `skillId` and `deploymentStatus`; the Skill Library card then
      shows the model's name instead of "Model linked"
- [ ] Checkpoints reported by a worker survive a server restart and are returned
      by `GET /api/models/versions/:id`
- [ ] `completeJob` writes `checkpointUri` on the created `ModelVersion`
- [ ] `GET /api/models/versions/:id/lineage` returns the ancestor chain
- [ ] `/models` renders the model list; a model with no skill does not read
      "Unknown Skill"
- [ ] An `artifactUri` without a scheme is rejected with a 400 naming the
      accepted schemes
- [ ] Existing `EvaluationEpisode` rows still load with `modelVersionId` null

## Test Strategy

- **Unit (vitest, server):** registry route validation (scheme rejection,
  nullable `trainingJobId`), `modelVersionRepository.update` field coverage,
  checkpoint upsert idempotency on a repeated `(jobId, epoch)`, lineage
  resolution including a cycle guard (a model must not be its own ancestor).
- **Unit (vitest, app):** `ModelVersionCard` renders `name` when present and
  does not print "Unknown Skill" for a null skill.
- **Manual:** register the `g1_apple_pnp` GR00T checkpoint via the modal, link
  it to a Skill, confirm `SkillExecutionService.executeSkillOnRobot`
  (`server/src/services/SkillExecutionService.ts:570`) resolves its
  `artifactUri` and forwards it to the robot agent.

## Notes

Scope boundary: this task does **not** change how a training job starts (that is
TASK-239) and does not add ratings or comments (TASK-241). It only makes the
registry writable, persistent and traceable.

The `EvaluationEpisode.modelVersion` string is deliberately kept alongside the
new FK. Collapsing the two is a follow-up once the backfill has been checked
against real rows.
