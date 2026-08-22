---
id: TASK-219
aliases:
- TASK-219
title: Dataset validation runs on the request thread and HEADs one file at a time
slug: dataset-validation-runs-on-the-request-thread
status: todo
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


# Dataset validation runs on the request thread and HEADs one file at a time

## Description

`POST /api/datasets/:id/validate` reads whole parquet files and stats every
file the manifest names, synchronously, inside the request. On a real dataset
that is seconds to minutes during which the server answers nothing else. Both
halves were raised by the TASK-217 review and deliberately left out of that
PR's fix pass, because each changes what validation *is* rather than correcting
something it got wrong.

## Details

### Current state

`server/src/services/lerobot/validateDataset.ts` is called from
`DatasetService.validateStructure` (`server/src/services/DatasetService.ts`),
which is called from `validateAndUpdateDataset`, which the route awaits.

Two costs:

1. **CPU on the event loop.** `readParquetShape` and `readFirstRow` call
   `ParquetReader.openBuffer` on a `Buffer` holding the entire file. The review
   measured **6 s for one 100 MB parquet**, and `MAX_DATA_FILES_READ = 8`, so
   one call can hold the loop for the better part of a minute. Nothing else the
   server does is served during it — health checks included.
2. **Round trips.** For a RustFS dataset, `expectedFiles` produces one path per
   episode per camera and each one is a separate sequential
   `getMetadata` (HEAD). A 500-episode two-camera dataset is 1500 sequential
   HEADs before a byte of data is read.

There is already a queue path: `DatasetService.queueValidationJob` publishes
`jobs.dataset.validate` when NATS is connected, and `server/src/workers/`
already runs dataset work off-thread. `completeUpload` uses it. The manual
`POST /:id/validate` route does not.

### What to do

**Server**

- Run validation off the request thread. Either publish to the existing
  `jobs.dataset.validate` subject and have the route answer `202` with the
  progress channel the upload flow already polls, or move it into a worker
  thread next to `server/src/workers/dataset-validation.worker.ts`. The route
  must refuse to re-enter while a validation for that dataset is in flight —
  today two clicks start two full passes.
- Read parquet **footers** rather than whole files where only the shape is
  needed. `readParquetShape` needs the row count and column names, both of
  which are in the footer; `readFirstRow` is the only caller that needs data,
  and it needs exactly one row group.
- Replace the per-file HEAD storm with prefix listings: `tree.list('data')` and
  `tree.list('videos')` once each, compared in memory against the expected set.
  Note this changes what the validator can say — a listing also reveals files
  the manifest does NOT name, which is worth reporting as a warning
  (`UNEXPECTED_FILE`) rather than dropping. `DatasetTree.list` already exists
  and paginates.

### Key files

- `server/src/services/lerobot/validateDataset.ts` — the readers and
  `expectedFiles`
- `server/src/services/lerobot/DatasetTree.ts` — `list`, `stat`, `read`
- `server/src/services/DatasetService.ts` — `validateStructure`,
  `validateAndUpdateDataset`, `queueValidationJob`
- `server/src/routes/datasets.routes.ts` — `POST /:id/validate`
- `server/src/workers/` — the existing off-thread pattern

## Test Strategy

Measure first, or there is nothing to show. Time `POST /:id/validate` against a
dataset with a 100 MB parquet while a second client polls `/api/health`, and
record the health check's latency during the call. That number is the defect;
the same number after the change is the fix.

Then: a test that a second `POST /:id/validate` while one is in flight is
refused rather than queued behind it, and a test that the file-existence check
survives the switch from HEADs to a listing — including the case the listing
makes newly possible, a file present on the store that `info.json` never names.

## Notes

Raised as findings 22/23 and 6/38 of the TASK-217 adversarial review
(PR #242). Left out of that PR on purpose: the fix pass corrected things the
diff got wrong, and this is a change to how validation runs.
