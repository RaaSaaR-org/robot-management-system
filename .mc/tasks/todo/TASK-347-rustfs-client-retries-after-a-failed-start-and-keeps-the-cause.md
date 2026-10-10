---
id: "TASK-347"
aliases: ["TASK-347"]
title: "RustFS client retries after a failed start and keeps the cause"
slug: "rustfs-client-retries-after-a-failed-start-and-keeps-the-cause"
status: "in-progress"
priority: 2
owner: "FlrnFrmm"
projects: []
customers: []
tags: ["core", "storage"]
sprint: ""
parent: "[[TASK-346]]"
depends_on: []
spe: 3
effort: "medium"
due_date: ""
created: "2026-10-10"
updated: "2026-10-10"
---

# RustFS client retries after a failed start and keeps the cause

## Description

One failed RustFS connection at server startup disables object storage until the
process restarts, and the S3 error that caused it is thrown away. Make the client
keep a classified status and retry in the background until it connects.
(GitHub #368.)

## Details

### Current state

- `server/src/storage/rustfs-client.ts:419` — `validateConnection()` does
  `ListBucketsCommand` and `catch { return false }`.
- `server/src/storage/rustfs-client.ts:433-473` — module singleton
  `rustfsClient`; `initializeRustFSClient()` nulls it on failure and throws
  `Failed to connect to RustFS at <endpoint>`. `getConfigFromEnv()` (`:478`)
  throws when `RUSTFS_ENDPOINT`/`RUSTFS_ACCESS_KEY`/`RUSTFS_SECRET_KEY` are missing.
- `server/src/index.ts:142-149` — one attempt; on success
  `storageCleanupJob.startSchedule(24)`; on failure a warn log, nothing more.
- Every other consumer (`DatasetService`, `model-storage`, `storage.routes`,
  `HuggingFaceImportService`, …) asks `isRustFSInitialized()` per call, so they
  pick up a recovered client with no change.

### Server — `server/src/storage/rustfs-client.ts`

Add, and re-export from `server/src/storage/index.ts`:

```ts
export type RustFSErrorKind = 'config' | 'auth' | 'connectivity' | 'unknown';

export interface RustFSStatus {
  configured: boolean;            // RUSTFS_ENDPOINT is set
  state: 'disabled' | 'connecting' | 'ready' | 'unavailable';
  errorKind?: RustFSErrorKind;    // set while unavailable
  errorDetail?: string;           // S3 error name + HTTP status, e.g. "InvalidAccessKeyId (403)"; never keys
  lastAttemptAt?: string;         // ISO
  attempts: number;
}

export class RustFSConnectionError extends Error { readonly kind: RustFSErrorKind }
export function isRustFSConfigured(): boolean;
export function getRustFSStatus(): RustFSStatus;
export function startRustFSRecovery(opts: {
  onReady: () => void;
  initialDelayMs?: number;   // default 5_000
  maxDelayMs?: number;       // default 300_000, doubling
}): () => void;              // returns stop()
```

- `validateConnection()` keeps its boolean signature for callers, but a new
  private/exported `classifyS3Error(err)` maps: `err.name` in
  `InvalidAccessKeyId | SignatureDoesNotMatch | AccessDenied | Forbidden` or
  `$metadata.httpStatusCode` 401/403 → `auth`; `err.code`/`name` in
  `ECONNREFUSED | ENOTFOUND | ETIMEDOUT | ECONNRESET | TimeoutError | NetworkingError`
  → `connectivity`; else `unknown`. `initializeRustFSClient` throws
  `RustFSConnectionError` with that kind; missing env → kind `config`, state
  `disabled` (not `unavailable` — no endpoint means storage is simply off).
- Status is module state updated on every attempt. `state` is `connecting` during
  an attempt, `ready` on success.
- `startRustFSRecovery` schedules `initializeRustFSClient()` with exponential
  backoff on an `unref()`'d timer; on success calls `onReady` exactly once and
  stops. Does nothing (returns a no-op stop) when not configured or already ready.
- Log at warn on the first failure and on a change of `errorKind`, not every
  retry; info on recovery. Log `errorDetail`, never the config object.

### Server — `server/src/index.ts`

On the startup failure, if `isRustFSConfigured()`, call
`startRustFSRecovery({ onReady: () => { storageCleanupJob.startSchedule(24); logger.info('[RustFS] Object storage recovered'); } })`.
Include `errorKind` in the existing warn log.

### Key files

- `server/src/storage/rustfs-client.ts`
- `server/src/storage/index.ts`
- `server/src/index.ts`
- `server/src/storage/__tests__/rustfs-client.test.ts` (extend; it already mocks `S3Client.send` via `vi.hoisted` — copy that pattern)

## Acceptance Criteria

- [ ] `send` rejecting with `{ name: 'InvalidAccessKeyId', $metadata: { httpStatusCode: 403 } }` → `initializeRustFSClient` throws `RustFSConnectionError` with `kind: 'auth'`; `getRustFSStatus()` is `unavailable`/`auth`, `errorDetail` contains no access key or secret.
- [ ] `ECONNREFUSED` → `connectivity`; unset env → `config` with state `disabled`.
- [ ] Regression: send fails at startup → `startRustFSRecovery` → send starts succeeding → after advancing fake timers `isRustFSInitialized()` is true, `state` is `ready`, `onReady` called exactly once, no further attempts.
- [ ] Backoff doubles from `initialDelayMs` and caps at `maxDelayMs`.
- [ ] Recovery is a no-op when not configured.
- [ ] `cd server && npm run typecheck && npx vitest run src/storage` green.

## Test Strategy

Vitest with fake timers in `rustfs-client.test.ts`; reset the module singleton
between cases the way the existing "singleton lifecycle" tests do.
