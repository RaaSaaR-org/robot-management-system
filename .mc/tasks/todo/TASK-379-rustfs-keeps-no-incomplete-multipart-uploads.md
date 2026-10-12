---
id: "TASK-379"
aliases: []
title: "RustFS keeps no incomplete multipart uploads"
slug: "rustfs-keeps-no-incomplete-multipart-uploads"
status: "review"
priority: 3
owner: "huhn511"
projects: []
customers: []
tags: ["core"]
sprint: ""
parent: ""
depends_on: []
spe: 3
effort: "low"
due_date: ""
created: "2026-10-12"
updated: "2026-10-12"
---

# RustFS keeps no incomplete multipart uploads

## Description

`RustFSClient.upload()` (`server/src/storage/rustfs-client.ts`) streams through
`@aws-sdk/lib-storage`'s `Upload`, which uses an S3 multipart upload for any body
over one part (5 MB). When such an upload is interrupted — the operator cancels a
Hugging Face dataset import (`POST /api/datasets/:id/import/cancel`), the request
dies, or the server restarts mid-upload — the multipart upload is never aborted and
its parts stay in the bucket: invisible to `ListObjects`, never deleted by
`deletePrefix`, and taking space forever. Make interrupted uploads abort their
multipart upload, and sweep away the ones a crash left behind.

## Details

### Current state

- `upload(bucket, key, body, options)` builds `new Upload({ client, params })` and
  awaits `done()`. It takes no `AbortSignal`; nothing can stop it but the body erroring.
- lib-storage 3.966: `leavePartsOnError` defaults to `false`, so a part or body
  error runs `markUploadAsAborted()` → `AbortMultipartUploadCommand`. `upload.abort()`
  rejects `done()` at once with an `AbortError`, but the server-side abort is only sent
  once the part loop notices — and a body that stalls never lets it notice.
- `HuggingFaceImportService.downloadFileToSink` already has a per-attempt
  `AbortController` (operator cancel + transfer timeout) that aborts the Hub fetch;
  `RustFsImportSink.write(path, response)` does not receive it.
- A crash/restart leaves multipart uploads behind with nothing to clean them up.
  `StorageCleanupJob` (`server/src/jobs/storage-cleanup.ts`) only deletes temp objects.
  RustFS may not implement the `AbortIncompleteMultipartUpload` lifecycle rule, so the
  server sweeps them itself.

### Server

- `UploadOptions.signal?: AbortSignal`. `upload()` rejects with an `AbortError` without
  touching the store when the signal is already aborted; on abort it calls
  `upload.abort()` and destroys a `Readable` body so a stalled stream ends the part
  loop and lib-storage sends `AbortMultipartUploadCommand`. `leavePartsOnError: false`
  is set explicitly so the error path's behaviour is a decision, not a default.
- `RustFSClient.listMultipartUploads(bucket)` (paginated `ListMultipartUploadsCommand`)
  and `abortMultipartUpload(bucket, key, uploadId)`.
- `ImportSink.write(path, response, signal?)`; `downloadFileToSink` passes the
  per-attempt controller's signal, so a cancel or a transfer timeout aborts the upload.
- New job `server/src/jobs/multipart-upload-sweep.ts`: for every bucket in `BUCKETS`
  list the in-progress multipart uploads and abort those initiated more than
  `RUSTFS_MULTIPART_MAX_AGE_HOURS` (default 24) ago. Runs once when RustFS becomes
  ready (startup or recovery) and every `RUSTFS_MULTIPART_SWEEP_INTERVAL_HOURS`
  (default 6). Only when RustFS is initialized; a missing bucket is skipped; every
  failure is logged and counted, never thrown.
- Document both env vars in `server/.env.example`, the env table in `docs/deployment.md`
  and the RustFS client section of `docs/nats-rustfs.md`.

### Key files

- `server/src/storage/rustfs-client.ts`
- `server/src/services/HuggingFaceImportService.ts`
- `server/src/jobs/multipart-upload-sweep.ts` (new)
- `server/src/index.ts`
- `server/.env.example`, `docs/deployment.md`, `docs/nats-rustfs.md`

## Acceptance Criteria

- [x] `upload()` accepts `signal`; aborting it rejects the upload and sends `AbortMultipartUploadCommand` for a started multipart upload, even when the body stalls
- [x] An already-aborted signal rejects without any request to the store
- [x] A body or part error aborts the multipart upload (lib-storage `leavePartsOnError: false`, covered by a test against the real `Upload`)
- [x] Cancelling a dataset import (or a transfer timeout) aborts the RustFS upload in flight
- [x] The sweep aborts multipart uploads older than the configured age in every server bucket, leaves younger ones, skips missing buckets, and never throws
- [x] The sweep runs at startup/recovery and periodically, only when RustFS is initialized, and stops on shutdown
- [x] Both env vars are documented in `server/.env.example`, `docs/deployment.md` and `docs/nats-rustfs.md`

## Test Strategy

- `server/src/storage/__tests__/rustfs-client-multipart.test.ts`: the real `Upload`
  against a real `S3Client` whose `send` is stubbed — error, abort, stalled-body abort,
  pre-aborted, and the happy path.
- `server/src/jobs/__tests__/multipart-upload-sweep.test.ts`: age cut-off, buckets,
  failures, pagination, schedule.
- `server/src/services/__tests__`: the import sink receives an abort signal that fires on cancel.
- `cd server && npm run typecheck && npx vitest run`.

## Notes
