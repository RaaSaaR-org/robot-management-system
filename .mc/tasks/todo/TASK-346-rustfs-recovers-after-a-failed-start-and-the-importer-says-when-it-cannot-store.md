---
id: "TASK-346"
aliases: ["TASK-346"]
title: "RustFS recovers after a failed start, and the importer says when it cannot store"
slug: "rustfs-recovers-after-a-failed-start-and-the-importer-says-when-it-cannot-store"
status: "todo"
priority: 2
owner: "FlrnFrmm"
projects: []
customers: []
tags: ["core", "storage", "datasets"]
sprint: ""
parent: ""
depends_on: []
spe:
effort: ""
due_date: ""
created: "2026-10-10"
updated: "2026-10-10"
---

# RustFS recovers after a failed start, and the importer says when it cannot store

GitHub: RaaSaaR-org/robot-management-system#368

## Description

On NeoDEM Live (server `2026.09.12.1`) a HuggingFace import of
`unitreerobotics/G1_Dex3_ObjectPlacement_Dataset` returned HTTP 400 with
`EACCES: permission denied, mkdir '/app/data'`, while `GET /api/storage/stats`
returned 503 "RustFS storage is not initialized" — and RustFS itself was healthy.
One failed connection at startup disables object storage for the life of the
process, and the importer then silently picks a local disk that production
cannot write to. Fix the recovery, the reporting, and the fallback.

## Details

### Current state (traced on `main`, b2e7c509)

1. `server/src/index.ts:142-149` calls `initializeRustFSClient()` once, catches,
   logs a warning, continues. `storageCleanupJob.startSchedule(24)` only runs on
   success. Nothing ever retries.
2. `server/src/storage/rustfs-client.ts:419` `validateConnection()` swallows the
   S3 error (`catch { return false }`); `initializeRustFSClient` (`:458`) nulls the
   singleton and throws a generic "Failed to connect" — the cause (auth vs
   connectivity) is lost.
3. `server/src/services/HuggingFaceImportService.ts:209` `createSink()` picks
   RustFS iff `isRustFSInitialized()`, else `LocalImportSink` under
   `datasetStorageRoot()` (`DatasetService.ts:165`, defaults to
   `<server>/data/uploaded-datasets` = `/app/data/...` in the image, read-only
   for UID 1000).
4. `importDataset` (`HuggingFaceImportService.ts:274`) runs
   `resolveRobotTypeId` — which may **create** a RobotType (`:511`) — before
   `sink.prepare()`. The failed live attempt left RobotType
   `0799c6c9-59d7-4d91-82bb-174e3292b439` behind.
5. `GET /health` (`server/src/app.ts:216`) reports nothing about dependencies.
6. Errors without `HuggingFaceImportError` fall through `sendImportError`
   (`datasets.routes.ts:307`) to a generic 400.

### Decisions (2026-10-10)

- **Retry always.** When RustFS is configured but unreachable at startup, the
  server keeps retrying in the background with backoff, and on success starts
  the cleanup schedule.
- **Configured ⇒ required.** If `RUSTFS_ENDPOINT` is set, the importer never
  falls back to local disk; while RustFS is down it answers 503
  `STORAGE_UNAVAILABLE`. No new env var. Without `RUSTFS_ENDPOINT` (dev), local
  storage stays the sink.
- **Status in `/health`.** `/health` stays HTTP 200 (the pod is not killed for a
  dependency) and gains `dependencies.storage` with state + error kind.
- **Never log credentials.** Error classification keeps the S3 error name and
  HTTP status, not keys or signed headers.

### Out of scope

- The orphaned RobotType on Live — an operator checks references and deletes it
  by hand.
- The bucket-init hook masking `aws s3 mb` failures —
  RaaSaaR-org/deployments#13.

### Children

- TASK-347 — RustFS client retries after a failed start and keeps the cause
- TASK-348 — `/health` reports storage status (depends on 347)
- TASK-349 — HF import refuses an unusable sink with 503 and prepares storage
  before metadata (depends on 347)

## Acceptance Criteria

- [ ] All children done.
- [ ] Storage down at startup → backend recovers → RustFS import works, without a restart (regression test in TASK-347/349).
- [ ] With RustFS configured and down, import returns 503 `STORAGE_UNAVAILABLE`, never EACCES/400.
- [ ] `/health` shows the storage state an operator needs to spot "200 with storage disabled".

## Test Strategy

Each child carries its own vitest coverage; `./scripts/test-all.sh --skip-pw` green.
