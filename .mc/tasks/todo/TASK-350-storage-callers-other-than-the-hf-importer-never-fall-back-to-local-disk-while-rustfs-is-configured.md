---
id: "TASK-350"
aliases: ["TASK-350"]
title: "Storage callers other than the HF importer never fall back to local disk while RustFS is configured"
slug: "storage-callers-other-than-the-hf-importer-never-fall-back-to-local-disk-while-rustfs-is-configured"
status: "in-progress"
priority: 3
owner: "huhn511"
projects: []
customers: []
tags: ["core", "storage"]
sprint: ""
parent: ""
depends_on: []
spe: 3
effort: ""
due_date: ""
created: "2026-10-11"
updated: "2026-10-12"
---

# Storage callers other than the HF importer never fall back to local disk while RustFS is configured

## Description

Epic TASK-346 (GitHub #368, ADR-346) settled **configured ⇒ required** for the
HuggingFace importer: with `RUSTFS_ENDPOINT` set, it answers 503
`STORAGE_UNAVAILABLE` while RustFS is down instead of writing to local disk. The
other storage callers still make the old "initialized? else local disk" choice,
so while RustFS is recovering they can write to an unwritable `/app/data` in
production, or store data where nothing will look for it once RustFS is back.
The decisions below (2026-10-12) settle refuse/queue/wait per caller.

## Details

### Current state

Found during TASK-349 (#371); line numbers as of `main` at 24e0bf14:

- `server/src/routes/datasets.routes.ts:278` and `:1215` — dataset upload paths
- `server/src/services/DatasetService.ts:885`
- `server/src/storage/model-storage.ts:147`
- `server/src/jobs/storage-cleanup.ts:47`

The pattern to copy is `createSink()` in
`server/src/services/HuggingFaceImportService.ts`: `isRustFSConfigured()` and not
`isRustFSInitialized()` → `STORAGE_UNAVAILABLE` 503 naming
`getRustFSStatus().errorKind`; local disk only when not configured. Both helpers
come from `server/src/storage/index.ts`.

### Additional callers (found by grepping `isRustFSInitialized` and local-disk writes)

Same rule — refuse while configured but down, local disk only when unconfigured:

- `server/src/storage/model-storage.ts` `uploadTwinArtifact` and
  `uploadIncidentClip` — the two local-disk fallbacks inside model storage
  (callers: `twin.routes.ts` artifact upload, `SimulationService`,
  `TwinExportService` best-effort cache, `IncidentService.storeClip`).
- `server/src/services/SensorScanService.ts` `persistFrame` — local `.pcd` fallback.
- `server/src/services/PatrolPhotoStore.ts` `put` — local photo fallback
  (`forceLocal` still writes locally, for tests).
- `server/src/routes/incident.routes.ts` — the clip upload answered every failure
  with a bare 500; it now goes through `sendFailure`, so the 503 reaches the robot.

Read-only callers that already refuse or fall through to another source and write
nothing locally are left as they are: `TeleoperationService` (info.json read),
`MarketplaceService` (presign), `DatasetCurationService` (refuses already),
`lerobot/DatasetTree.ts`, the dataset video and episode readers, and
`multipart-upload-sweep.ts` (RustFS only).

## Decisions

Made 2026-10-12 on the user's go-ahead, extending ADR-346 decision 2
("configured ⇒ required"):

1. **Dataset uploads refuse.** `POST /api/datasets/:id/upload/initiate` and
   `/upload/complete` (`DatasetService.initiateUpload` / `completeUpload`) answer
   503 `STORAGE_UNAVAILABLE` naming `getRustFSStatus().errorKind`, exactly like
   `createSink()` in `HuggingFaceImportService.ts`. `completeUpload` refuses before
   the row moves to `validating`, so a good upload is not marked `failed` and the
   client can retry.
2. **`model-storage.ts` refuses too.** Every bucket operation goes through one
   guarded client that throws the same typed `StorageUnavailableError`, so a
   training or eval job fails visibly with the reason instead of hanging or
   writing to local disk.
3. **The cleanup job skips.** `storage-cleanup.ts` skips the run and logs one
   warning with `state`/`errorKind` while RustFS is configured but down; no
   local-disk cleanup then.

The rule lives in `server/src/storage/availability.ts`
(`StorageUnavailableError`, `refuseWhileObjectStorageDown()`,
`storageUnavailableMessage()`); `createSink()` uses the same message.
`sendFailure` adds `code`, `state` and `errorKind` to the body of a
`STORAGE_UNAVAILABLE` error.

## Acceptance Criteria

- [x] With `RUSTFS_ENDPOINT` set and RustFS down, none of the callers above writes to local disk.
- [x] Each one answers or logs with the RustFS `state`/`errorKind` instead of an EACCES.
- [x] Both dataset upload routes answer 503 `STORAGE_UNAVAILABLE` with `state` and `errorKind` in the body.
- [x] A `model-storage` read or write while down throws `StorageUnavailableError`, not "client not initialized".
- [x] The cleanup job logs exactly one warning with `state`/`errorKind` and skips.
- [x] Without `RUSTFS_ENDPOINT`, local-disk behavior is unchanged.

## Test Strategy

Per caller, vitest with `../storage/rustfs-client.js` mocked to configured +
`unavailable`, asserting no filesystem write and the 503 or log line.
