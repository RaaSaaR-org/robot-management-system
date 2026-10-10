# ADR-346 — RustFS recovers after a failed start, and the importer says when it cannot store

- **Status:** Accepted — implemented and merged 2026-10-11
- **Epic:** TASK-346 (closed; children TASK-347 … TASK-349, PRs #369, #371, #373)
- **Issue:** RaaSaaR-org/robot-management-system#368
- **Supersedes:** the spec body of TASK-346, distilled here so the task file can close

## Context

On NeoDEM Live (server `2026.09.12.1`) a HuggingFace import of
`unitreerobotics/G1_Dex3_ObjectPlacement_Dataset` answered HTTP 400 with
`EACCES: permission denied, mkdir '/app/data'`, while `GET /api/storage/stats`
answered 503 "RustFS storage is not initialized" — and RustFS itself was healthy.

Four defects lined up:

1. `server/src/index.ts` called `initializeRustFSClient()` once at startup, logged
   a warning on failure and never tried again. One failed connection disabled
   object storage for the life of the process.
2. `validateConnection()` swallowed the S3 error, so the cause (bad credentials vs
   unreachable endpoint) was lost.
3. The HF importer picked RustFS only if the client was initialized, and otherwise
   silently fell back to a local directory that the production image (UID 1000)
   cannot write. It also resolved — and could create — the RobotType before
   preparing storage, so the failed attempt left an orphan RobotType behind.
4. `/health` reported nothing about dependencies, so nothing told an operator
   that the server was up with storage off.

## Decision

Four decisions, made 2026-10-10:

1. **Retry always.** When RustFS is configured but unreachable, the server keeps
   retrying in the background. `startRustFSRecovery()` backs off from 5 s, doubling
   up to 5 min, runs one loop at a time, and stops only on a `config` failure. On
   success it starts the storage cleanup schedule. The client singleton is
   published only after its probe succeeds.
2. **Configured ⇒ required.** If `RUSTFS_ENDPOINT` is set, the importer never falls
   back to local disk: while RustFS is down it answers 503 `STORAGE_UNAVAILABLE`
   naming the error kind. Local disk is the sink only when no object store is
   configured (dev), and an unwritable local directory is the same 503, pointing at
   `DATASET_UPLOAD_DIR`. No new env var. Storage is prepared before any metadata
   is written, so a refused import leaves no RobotType and no dataset row.
3. **Status in `/health`, which stays 200.** `/health` is the Helm
   liveness/readiness probe, and a pod restart does not bring RustFS back, so a
   dependency never turns it red. It gains
   `dependencies.storage: { configured, state, errorKind?, lastAttemptAt?, attempts }`,
   `state` one of `disabled | connecting | ready | unavailable`. The storage
   routes' 503 carries the same `state` and `errorKind`.
4. **Never expose credentials.** A failure is classified as `config`, `auth`,
   `connectivity` or `unknown` from the S3 error name, code and HTTP status only;
   the message is dropped because a server may echo the access key id in it.
   `errorDetail` (e.g. `InvalidAccessKeyId (403)`) is kept for logs and
   authenticated callers, and never appears on the unauthenticated `/health`.

## Slicing

| Task | PR | Delivered |
| ---- | -- | --------- |
| TASK-347 | #369 | `RustFSConnectionError` with a kind, `getRustFSStatus()`, background recovery with backoff |
| TASK-349 | #371 | importer 503 `STORAGE_UNAVAILABLE` instead of a local fallback; storage prepared before metadata |
| TASK-348 | #373 | `/health` `dependencies.storage`; storage routes' 503 carries `state` and `errorKind` |

## Consequences

- An import against a configured but unreachable RustFS fails fast with a 503 the
  operator can act on, and works again once RustFS reconnects, without a restart.
- Operators read storage state off `/health` instead of inferring it from failed
  imports.

## Out of scope

- The orphaned RobotType `0799c6c9-59d7-4d91-82bb-174e3292b439` on Live — an
  operator checks its references and deletes it by hand.
- The bucket-init hook masking `aws s3 mb` failures — RaaSaaR-org/deployments#13.
- Other storage callers still make the "initialized? else local disk" choice while
  `RUSTFS_ENDPOINT` is set: `datasets.routes.ts` (upload paths),
  `DatasetService.ts`, `model-storage.ts`, `jobs/storage-cleanup.ts`. #368 covered
  only the HF importer.
