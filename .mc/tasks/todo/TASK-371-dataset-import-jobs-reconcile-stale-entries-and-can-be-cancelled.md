---
id: "TASK-371"
aliases: []
title: "Dataset import jobs reconcile stale entries and can be cancelled"
slug: "dataset-import-jobs-reconcile-stale-entries-and-can-be-cancelled"
status: "review"
priority: 2
owner: "huhn511"
projects: []
customers: []
tags: ["core"]
sprint: ""
parent: ""
depends_on: []
spe: 5
effort: "medium"
due_date: ""
created: "2026-10-12"
updated: "2026-10-12"
---

# Dataset import jobs reconcile stale entries and can be cancelled

## Description

Two gaps in the background dataset import tracker (TASK-352). (1) The app persists
tracked imports in localStorage (`neodem-import-jobs`); jobs from an earlier
server or cluster on the same origin show up forever as stuck jobs. (2) A running
Hub import cannot be cancelled — the operator can only wait for a gigabyte download
to finish or fail.

## Details

**Current state**
- `app/src/features/training/store/importJobsStore.ts` persists `jobs`/`order`.
  `useImportJobsFeed` only backfills jobs whose state is `running`; a 404 turns a
  running job into a permanent `failed` "dataset no longer exists" row; finished
  rows are never re-checked or expired.
- `server/src/services/HuggingFaceImportService.ts` runs imports in the background
  (`launch` → `runImport` → `downloadFiles`), tracked in an in-memory `running`
  map. There is no way to stop one.

### Server
- `HuggingFaceImportService.cancelImport(datasetId)`: every claim carries an
  `AbortController`; abort stops the download workers cooperatively (between
  files and mid-transfer via the fetch signal, and during retry backoff).
  The run then removes the partial files (local directory or RustFS prefix),
  marks the row `failed` with `importError.cancelled: true` and a
  "cancelled" message (so Retry still works), and emits
  `dataset:import:failed` with `cancelled: true`.
- An `importing` row this process is not running (orphan of a restart) is
  cancelled directly. A row that is validating, ready or failed is a 409.
- `POST /api/datasets/:id/import/cancel`: looks the dataset up through the
  tenant-scoped `datasetService.get` first, so a dataset of another organization
  is a 404 even while this process runs its import.

### Frontend
- `ImportJobState` gains `cancelled`. Store action `cancel(datasetId)` calls the
  endpoint; socket frames and backfills with `cancelled` end the job as cancelled.
- `reconcile()` runs once on load (from `useImportJobsFeed`): drops persisted jobs
  the server answers 404 for (ghosts from another server), updates the rest from
  the server, and expires finished entries older than 24 h and running entries
  older than 7 days that the server cannot confirm.
- `ImportActivity.tsx`: a Cancel button on a running job (not while validating),
  a "Cancelled" state with Retry.

**Key files**
- `server/src/services/HuggingFaceImportService.ts`
- `server/src/routes/datasets.routes.ts`
- `server/src/types/vla.types.ts`, `server/src/types/dataset.types.ts`
- `app/src/features/training/store/importJobsStore.ts`
- `app/src/features/training/hooks/useImportJobsFeed.ts`
- `app/src/features/training/components/ImportActivity.tsx`, `ImportProgress.tsx`
- `app/src/features/training/api/trainingApi.ts`, `types/training.types.ts`

## Acceptance Criteria
- [x] Persisted import jobs the server answers 404 for are dropped on load, not shown as stuck or failed
- [x] Persisted jobs the server knows are updated on load (finished ones show their outcome)
- [x] Stale persisted entries expire (finished > 24 h; running > 7 days and unconfirmed)
- [x] `POST /api/datasets/:id/import/cancel` stops a running import cooperatively, removes partial files, and marks it cancelled
- [x] The endpoint is tenant-scoped: a dataset not visible to the caller is a 404
- [x] Cancelling a finished or validating import is a 409
- [x] The import panel has a Cancel button on a running import and shows the cancelled state with Retry
- [x] Tests cover reconcile, expiry, the cancel service path, the route and the store action

## Test Strategy
- Server vitest: `HuggingFaceImportService.cancel.test.ts` (abort mid-download → files removed, row failed+cancelled, event emitted; orphan; 409), route tests in `datasets-hf-routes.test.ts` (202/404/409).
- App vitest: `importJobsStore.test.ts` (reconcile drops 404, updates known, expiry; cancel action; cancelled frame).

## Notes
- PR #395. Playwright's `/a2a/*` app-routes specs fail identically on `origin/main` (pre-existing, not this change).
