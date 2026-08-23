---
id: TASK-220
aliases:
- TASK-220
title: Import a Hub dataset, mix it with another, and export the run to a cluster
slug: import-a-hub-dataset-mix-it-and-export-the-run
status: done
priority: 2
owner: ''
projects: []
customers: []
tags:
- core
sprint: ''
depends_on: []
due_date: ''
created: 2026-08-23
updated: 2026-08-23
---

# Import a Hub dataset, mix it with another, and export the run to a cluster

## Description

Take the platform from "there is an Import from Hub button" to "a real Hub dataset is in the
library, mixed with a second one, and the resulting run can be handed to a GPU cluster this
server cannot reach". Driven by a concrete case: `nvidia/GR00T-N1.7-AppleToPlate`.

## Current state — measured, not assumed

Everything below was observed on the running stack on 2026-08-23.

- **The import cannot succeed on a dev machine.** `HuggingFaceImportService.downloadFiles`
  opens with `if (!isRustFSInitialized()) throw new Error('RustFS storage not available')`.
  RustFS is optional per `CLAUDE.md` and is not running. An import of the GR00T repo through
  the UI produced dataset `eec2b7a9-…` at status `failed` **305 ms** after the POST, having
  downloaded 0 of 813 files.
- **The metadata was read correctly** before it died — `v2.1`, 30 fps, 402 episodes,
  171 625 frames — so the failure is purely the sink.
- **A metadata-only import could not have succeeded either.** `includeVideos` defaults false
  and `validateDataset.ts` raises `MISSING_VIDEO_FILE` as an *error* per declared camera
  feature: 402 errors → `valid:false` → `failed`.
- **The failure reason is unrecoverable.** It exists only as one WebSocket broadcast, fired
  before the browser opens its socket. The card reads `Failed` and nothing else, forever.
- **The robot-type matcher aims at a name this database does not hold** — it looks up
  `'Unitree G1 + Dex3'`, the DB has `'Unitree G1 EDU (Dex3-1)'` — so it minted a junk
  `RobotType` named `unitree_g1` with `actionDim: 0, proprioceptionDim: 0`. That zero makes
  the width check in `validateDataset.ts` inert, so a 43-wide dataset on a 0-DOF type
  "validates".
- **A training job can only ever name one dataset.** `TrainingJob.datasetId` is a single
  nullable FK; the wizard's step 2 is a single-select with no checkboxes; nothing anywhere
  merges or mixes datasets. A `datasetIds` array in the POST body is silently dropped.
- **Nothing exports a run.** `training.routes.ts` has 15 routes and none of them export.
  The only handoff is inbound worker polling, which requires the cluster to reach RustFS.
- **`Dataset.storagePath` is an untyped mixed namespace** — 6 of 9 live rows hold absolute
  macOS paths while the claim handler's comment asserts it is a RustFS prefix.

## Details

### The design decision: a mixture, not a merge

`nvidia/GR00T-N1.7-AppleToPlate` is **43**-wide `unitree_g1` in the **v2.1** layout.
`unitreerobotics/G1_Dex3_ObjectPlacement_Dataset` is **28**-wide `Unitree_G1` in **v3.0**.
Same robot family, different action space — one drives the whole body, the other two arms.
Concatenating them yields a parquet whose `action` column has no single meaning.

So a training job references its datasets **where they are**, with sampling weights, and the
product states plainly what the difference means. This is also what the trainers consume:
LeRobot's `MultiLeRobotDataset` and GR00T's per-embodiment projectors both take a list.
It is additionally the only form exportable without moving a gigabyte.

### Server

- `HuggingFaceImportService.ts` — local-disk sink when RustFS is absent (absolute
  `storagePath`, which `isLocalDataset()` and `DatasetTree` already understand); resolve
  `revision` to a commit SHA and pin it; record `importMode`; persist `importErrorJson`;
  match robot types on a slug and take dims from `info.json` instead of writing zeros.
- `validateDataset.ts` — missing videos are a WARNING for a declared metadata-only import and
  stay an ERROR for a full one.
- `datasetCompatibility.ts` (new) — `analyzeCompatibility()` over fps, state/action width,
  robot type, LeRobot version, camera keys and status. Differing width is
  `multi_embodiment`, not failure.
- `TrainingRunExportService.ts` (new) — `TrainingRunManifest`, scheme-tagged dataset URIs
  (`hf://repo@sha`, `s3://`, `file://`), normalised weights, licenses, and an explicit
  `warnings` list for anything a remote cluster cannot reach. No secrets, ever.
- New endpoints: `GET /api/datasets/hf/preview`, `POST /api/datasets/:id/import/retry`,
  `POST /api/datasets/compatibility`, `GET /api/training/jobs/:id/export`.

### Schema

`Dataset.sourceRevision`, `Dataset.importMode`, `Dataset.importErrorJson`, and a
`TrainingJobDataset` join table. `TrainingJob.datasetId` stays and stays authoritative for
single-dataset jobs.

### Frontend

Preview-before-import with the download size split data/video; include-videos, revision and
robot-type controls; persisted failure reasons with retry; multi-select on the dataset list
into a compatibility table; per-member weights in the wizard; an Export run action on the job
card.

## Test Strategy

- Import a real public Hub dataset end to end through the UI with RustFS down, and see it
  reach `ready` with files on disk.
- Revert each fix and confirm its test fails.
- Two datasets of different widths produce `multi_embodiment` with the recommendation naming
  per-embodiment projectors; a non-ready member produces `incompatible` and blocks submission.
- The exported manifest resolves every dataset to a URI a cluster can fetch, or says in
  `warnings` that it cannot, and contains no token.
