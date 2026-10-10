---
id: "TASK-350"
aliases: ["TASK-350"]
title: "Storage callers other than the HF importer never fall back to local disk while RustFS is configured"
slug: "storage-callers-other-than-the-hf-importer-never-fall-back-to-local-disk-while-rustfs-is-configured"
status: "backlog"
priority: 3
owner: "FlrnFrmm"
projects: []
customers: []
tags: ["core", "storage"]
sprint: ""
parent: ""
depends_on: []
spe:
effort: ""
due_date: ""
created: "2026-10-11"
updated: "2026-10-11"
---

# Storage callers other than the HF importer never fall back to local disk while RustFS is configured

## Description

Epic TASK-346 (GitHub #368, ADR-346) settled **configured ⇒ required** for the
HuggingFace importer: with `RUSTFS_ENDPOINT` set, it answers 503
`STORAGE_UNAVAILABLE` while RustFS is down instead of writing to local disk. The
other storage callers still make the old "initialized? else local disk" choice,
so while RustFS is recovering they can write to an unwritable `/app/data` in
production, or store data where nothing will look for it once RustFS is back.
Filed as `backlog`: whether each caller should refuse, queue or wait is not
decided yet — run `/grill` before building.

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

### Open decisions (for `/grill`)

- Whether the cleanup job should skip silently, log, or fail while RustFS is down.
- Whether `model-storage.ts` callers (training artifacts) should refuse or wait for
  recovery.

## Acceptance Criteria

- [ ] With `RUSTFS_ENDPOINT` set and RustFS down, none of the callers above writes to local disk.
- [ ] Each one answers or logs with the RustFS `state`/`errorKind` instead of an EACCES.
- [ ] Without `RUSTFS_ENDPOINT`, local-disk behavior is unchanged.

## Test Strategy

Per caller, vitest with `../storage/rustfs-client.js` mocked to configured +
`unavailable`, asserting no filesystem write and the 503 or log line.
