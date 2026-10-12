---
id: "TASK-359"
aliases: ["TASK-359"]
title: "Dataset storage lifecycle survives deletes, restarts and storage outages"
slug: "dataset-storage-lifecycle-survives-deletes-restarts-and-storage-outages"
status: "done"
priority: 2
owner: "huhn511"
projects: []
customers: []
tags: ["core", "storage", "compliance"]
sprint: ""
parent: ""
depends_on: []
spe: 5
effort: "medium"
due_date: ""
created: "2026-10-12"
updated: "2026-10-12"
---

# Dataset storage lifecycle survives deletes, restarts and storage outages

## Description

A system test of the production chart (`../deployments/neoDEM`, installed into k3d by
`scripts/e2e-k3d/run.sh` against `31f1853c`) found that the dataset lifecycle breaks at
its edges. Deleting a dataset leaves its objects in RustFS. An import cut off by a
restart stays `importing` for ever, and retrying it answers 409. Closing NATS during
shutdown fails a dataset that is validating. `/health` reports storage as `ready` while
RustFS is down. In production every audit-log write fails, because the compliance key
is the public example value. This task makes each of these either recover or fail
loudly, with the reason recorded.

## Details

### Current state

- `DatasetService.delete` (`server/src/services/DatasetService.ts`) removes only
  `<id>/latest/data.bin` and `<id>/upload/data.bin` from the `training-datasets`
  bucket. The Hub importer writes under a fresh uuid prefix, `storagePath = "<uuid>/"`
  (`createSink(uuidv4())` in `HuggingFaceImportService.ts`), so none of an imported
  dataset's objects are ever deleted. The local-disk branch already handles this case.
- `retryImport` refuses `importing` with 409 `IN_PROGRESS`, and `claimForImport`
  refuses it as well. After a restart nothing is running for the row, so nothing ever
  moves it out of `importing`. The k3d row `ce4cd156-…` is still stuck there.
- On SIGTERM, `natsClient.close()` runs while an import or validation may still be in
  flight. A `CONNECTION_CLOSED` from the publish or KV write lands in a catch that marks
  the row `failed`. Several `failed` writes also carry no reason at all (an unpack
  failure, a revalidation whose store is unavailable, a missing row).
- `/health` reads `getRustFSStatus()`, which only reports whether a client was ever
  published. Once RustFS has connected, the health endpoint answers `ready` for ever.
- `security/encryption.ts` already rejects the public example key in production, but
  only lazily, on the first `encrypt`. The server therefore starts, and every audit
  write fails afterwards.
- `scripts/e2e-k3d/test.sh` starts its port-forward through the `kc` shell function, so
  `$!` is the PID of the function's subshell, not of `kubectl`. `cleanup` kills the
  subshell and the `kubectl port-forward` lives on as an orphan.

### Server

1. **Delete removes the storage prefix.** If `storagePath` is a bare uuid (`<uuid>` or
   `<uuid>/`, and nothing else), delete every object under `<uuid>/` in
   `BUCKETS.TRAINING_DATASETS` (via a new `RustFSClient.deletePrefix` and
   `modelStorage.deleteDatasetPrefix`). A `storagePath` of any other shape is never used
   as a prefix. If RustFS is configured but cannot delete the prefix (it is down, or the
   delete fails), the delete is refused with 503 and the row is kept, so it can be
   retried. Deleting the row and leaving the objects behind would orphan them for good.
2. **Startup sweep plus orphan retry.** `HuggingFaceImportService` tracks the imports
   this process runs. At startup, every `importing` row that this process does not own
   is marked `failed`, with `importError = { phase: 'downloading', error: 'Server
   restarted during import', … }`. `retryImport` accepts an `importing` row that this
   process does not own (an orphan) and reclaims it. One that this process does own
   still answers 409. The server runs as a single replica (`replicaCount: 1` in both
   charts), so "not owned by this process" means "orphaned".
3. **NATS shutdown requeues instead of failing.** When `validateAndUpdateDataset` or the
   import's validation publish fails because the NATS connection is closed or draining,
   the row is left `validating`, never written `failed`. The startup recovery re-queues
   every `validating` row through `requestValidation`: right after storage is
   initialised, and again when RustFS recovers. Every remaining `failed` write records a
   reason (`validation.error`, or `importError`).
4. **Live storage probe.** `probeRustFS()` sends a `HeadBucket` for `training-datasets`
   with a 2 s timeout. It is cached for 10 s, and a single request is shared by
   concurrent callers. `/health` reports `state: 'unavailable'` with an `errorKind` when
   the probe fails, even though the client exists, and adds `checkedAt`. `/health` stays
   HTTP 200, as before: it is the liveness probe. In the import log, a transfer retry
   line names the stage and the sink, e.g. `write to rustfs failed`, so a RustFS outage
   during an import shows up in the log.
5. **Compliance key fails fast.** `assertComplianceKeyUsable()` (in `encryption.ts`)
   runs first in `main()`. In production, a missing, malformed or public-example key
   stops the server before it listens. The production values file in
   `../deployments/neoDEM` still sets the example key. That repo is out of scope here,
   and the fix is reported to its owner. The k3d E2E passes a per-cluster key derived
   with `--set` in `install.sh`.

### Scripts

6. `scripts/e2e-k3d/test.sh` starts `kubectl port-forward` directly, so `$!` is the
   kubectl PID. It also gains a step 6: delete the dataset, then list
   `s3://training-datasets/<storagePath>`, and the listing must be empty.

### Key files

- `server/src/services/DatasetService.ts`
- `server/src/services/HuggingFaceImportService.ts`
- `server/src/index.ts`, `server/src/app.ts`
- `server/src/storage/rustfs-client.ts`, `server/src/storage/model-storage.ts`
- `server/src/security/encryption.ts`
- `server/src/workers/dataset-validation.worker.ts`
- `scripts/e2e-k3d/test.sh`, `scripts/e2e-k3d/install.sh`

## Acceptance Criteria

- [x] Deleting a dataset whose `storagePath` is `<uuid>/` removes every object under
      that prefix. A non-uuid `storagePath` is never used as a prefix. When the prefix
      cannot be removed, the answer is 503 and the row stays.
- [x] After a restart, an `importing` row reads `failed` with importError `Server
      restarted during import`. Retrying an orphaned `importing` row is accepted, and
      retrying one this process is running still answers 409.
- [x] A connection-closed NATS error leaves a `validating` row `validating` and does not
      write `failed`. Such rows are re-queued at startup, and no code path writes
      `status: 'failed'` without a reason.
- [x] `/health` reports storage `unavailable` within about 10 s of RustFS going down,
      while staying HTTP 200. Transfer retries name the stage and the sink in the
      import log.
- [x] In production, the server refuses to start when the compliance key is missing,
      malformed or the public example value.
- [x] `test.sh` kills its own port-forward, and asserts that a deleted dataset leaves no
      objects behind.
- [x] Server typecheck and vitest pass. New unit tests cover each server item above.

## Test Strategy

Unit tests in `DatasetService.test.ts` (prefix delete, uuid guard, the 503 refusal,
connection-closed handling), in the HF import tests (startup sweep, orphan retry),
`health-storage-status.test.ts` (probe failure) and `encryption.test.ts`
(`assertComplianceKeyUsable`). Then the k3d E2E (`scripts/e2e-k3d/run.sh`, or
`install.sh` plus `test.sh` against the running cluster) with the new delete step.

## Notes

Out of repo, to report: `../deployments/neoDEM/values.yaml`
`secrets.complianceLogEncryptionKey` must become a unique `openssl rand -hex 32` value
before a release containing this change is deployed. Otherwise the server will refuse
to start.
