---
id: TASK-219
aliases:
- TASK-219
title: Dataset validation runs on the request thread and HEADs one file at a time
slug: dataset-validation-runs-on-the-request-thread
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
status_note: 'DONE 2026-08-25. Shipped: (a) POST /api/datasets/:id/validate no longer runs validation inside the request — DatasetService.requestValidation publishes to the existing jobs.dataset.validate subject when NATS is connected and otherwise runs the pass detached in this process (NATS is optional; a dev box has none), the route answers 202 with {state, progressUrl} and 409 VALIDATION_IN_FLIGHT while one is running, 503 STORE_UNAVAILABLE when neither backing store opens; (b) data parquets are read by FOOTER over a new DatasetTree.readRange (RustFSClient.downloadRange issues a ranged GET and slices defensively if the store ignores Range), and the vector widths come from the footer''s num_values/num_rows with a one-row-group read as fallback; (c) the per-file HEAD storm is replaced by tree.list(''data'') and tree.list(''videos'') compared in memory, which also surfaces files info.json never names as UNEXPECTED_FILE warnings (capped at 10 plus an UNEXPECTED_FILE_COUNT summary). Measured on this MacBook against synthetic fixtures in a scratch dir, before vs after, same machine and same run: a 91 MB pyarrow-written data parquet (one row group, the shape lerobot actually writes) went from 5911/5332/3928 ms with 5879/5304/3890 ms of blocked event loop to 4.6-8.1 ms with 0.7-2.5 ms; a 97 MB parquetjs-written file from ~1060 ms to ~7 ms; bytes pulled through the process from 91-97 MB to under 4 KB whole-file plus under 9 KB ranged; and a 500-episode two-camera v2.1 tree from 1504 stat/HEAD calls to 4 stats and 2 listings. Verified here: server npx tsc --noEmit clean; 20 scoped vitest files, 505 tests, green (validateDataset, DatasetService, the dataset routes, the validation worker, rustfs-client, the HF import); five mutations proven red — guard removed, footer read reverted to a whole read, listing reverted to per-file stat, UNEXPECTED_FILE suppressed, and the route reverted to awaiting validateAndUpdateDataset (its route test then times out at 15 s, which is the defect). NOT verified here: no RustFS/S3 and no NATS server were running, so the ranged GET against a real S3-compatible store, the JetStream publish and the worker consuming the job were exercised only through mocks — the Range path and the queue path need one live re-check on a deployment that has both. No real 100 MB production dataset, no GPU, no Unitree G1, no Isaac Sim, no VLA server and no lidar were involved; the full server was never booted, so no HTTP /api/health latency was measured — the latency numbers above are event-loop lateness measured by an in-process probe, which is what a concurrent health check would suffer.'
created: 2026-08-23
updated: 2026-08-25
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
