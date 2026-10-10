---
id: "TASK-349"
aliases: ["TASK-349"]
title: "HF import refuses an unusable sink with 503 and prepares storage before metadata"
slug: "hf-import-refuses-an-unusable-sink-with-503-and-prepares-storage-before-metadata"
status: "done"
priority: 2
owner: "FlrnFrmm"
projects: []
customers: []
tags: ["core", "storage", "datasets"]
sprint: ""
parent: "[[TASK-346]]"
depends_on: ["[[TASK-347]]"]
spe: 3
effort: "low"
due_date: ""
created: "2026-10-10"
updated: "2026-10-10"
---

# HF import refuses an unusable sink with 503 and prepares storage before metadata

## Description

With RustFS down, the HuggingFace importer fell back to a local directory
production cannot write, answered `EACCES ... mkdir '/app/data'` as HTTP 400,
and had already created a RobotType. Make it refuse with an actionable 503 and
touch no metadata until storage is ready. (GitHub #368.)

## Details

### Current state

- `server/src/services/HuggingFaceImportService.ts:209` —
  `createSink(storageId)` returns `RustFsImportSink` iff `isRustFSInitialized()`,
  else `LocalImportSink(join(datasetStorageRoot(), storageId))`.
- `LocalImportSink.prepare()` (`:165`) is `mkdir(root, { recursive: true })` — the EACCES.
- `importDataset` (`:274`): `resolveSource` → `fetchInfoJson` →
  **`resolveRobotTypeId`** (may `robotTypeRepository.create`, `:511`) →
  `createSink` → `sink.prepare()` → `datasetRepository.create`.
- The retry path (`:391`) also does `createSink(storageIdOf(existing.storagePath))` + `prepare()`.
- `HuggingFaceImportError(code, message, status = 400)` (`:90`); the route maps
  it through `sendImportError` (`server/src/routes/datasets.routes.ts:307`) to
  `res.status(error.status)` with `code`.
- TASK-347 adds `isRustFSConfigured()` (true iff `RUSTFS_ENDPOINT` set) and
  `getRustFSStatus()` (`{ state, errorKind, … }`) to
  `server/src/storage/rustfs-client.ts`.

### Server — `HuggingFaceImportService.ts`

- `createSink`:
  - `isRustFSInitialized()` → `RustFsImportSink` (unchanged).
  - else `isRustFSConfigured()` → throw
    `new HuggingFaceImportError('STORAGE_UNAVAILABLE', 'Object storage (RustFS) is configured but unavailable (<errorKind>); the server is retrying — try again shortly.', 503)`.
  - else `LocalImportSink` (dev, unchanged).
- `LocalImportSink.prepare()` wraps `mkdir`: on `EACCES`/`EROFS`/`EPERM` throw
  `HuggingFaceImportError('STORAGE_UNAVAILABLE', 'Local dataset storage <root> is not writable; set DATASET_UPLOAD_DIR to a writable path or configure RustFS.', 503)`.
- In `importDataset`, move `createSink(...)` + `await sink.prepare()` **before**
  `resolveRobotTypeId`, so a storage refusal leaves no RobotType and no dataset
  row. The retry path already prepares before writing; it just inherits the new errors.

### Key files

- `server/src/services/HuggingFaceImportService.ts`
- `server/src/services/__tests__/HuggingFaceImportService.import.test.ts` (it mocks `../../storage/rustfs-client.js` with `isRustFSInitialized: vi.fn().mockReturnValue(false)` — add `isRustFSConfigured` / `getRustFSStatus` to that mock)

## Acceptance Criteria

- [ ] RustFS configured + not initialized → `importDataset` rejects `HuggingFaceImportError` `STORAGE_UNAVAILABLE`, status 503; `robotTypeRepository.create` and `datasetRepository.create` not called.
- [ ] Not configured + `DATASET_UPLOAD_DIR` pointing at an unwritable dir → same code/503, message names `DATASET_UPLOAD_DIR`; no RobotType created.
- [ ] Regression: `isRustFSInitialized` false (configured) → 503; flip it to true (backend recovered) → the next import uses the RustFS sink (`getRustFSClient().upload` called, `storagePath` is a key prefix, not an absolute path).
- [ ] Not configured, writable dir → local import unchanged (existing tests still green).
- [ ] `cd server && npm run typecheck && npx vitest run src/services/__tests__/HuggingFaceImportService` green.

## Test Strategy

Extend `HuggingFaceImportService.import.test.ts`; for the unwritable case point
`DATASET_UPLOAD_DIR` at a temp dir chmod'ed `0o500` (skip when running as root).
