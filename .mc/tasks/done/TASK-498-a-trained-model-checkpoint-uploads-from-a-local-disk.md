---
id: "TASK-498"
aliases: []
title: "A trained model checkpoint uploads from a local disk straight into the instance's storage and appears in the model registry"
slug: "a-trained-model-checkpoint-uploads-from-a-local-disk"
status: "done"                # backlog | todo | in-progress | review | done | cancelled
priority: 1                   # 1=critical, 2=high, 3=medium, 4=low
owner: "claude"
projects: []
customers: []
tags: ["models", "storage", "api", "core"]
sprint: ""
parent: ""
depends_on: []
spe: 8
effort: "high"
due_date: "2026-11-16"
created: "2026-11-13"
updated: "2026-11-13"
---

# A trained model checkpoint uploads from a local disk straight into the instance's storage and appears in the model registry

## Description

The GR00T N1.7 finetunes for the apple pick-and-place use case sit on a local disk
(`pipe_g11_aktion_schrittweite2`: 15 files, 6.9 GB, one safetensors shard of 4.99 GB).
The model registry could only record an `artifactUri` that points somewhere else — a
Hugging Face repository, a bucket somebody else filled — so there was no way to put such
a checkpoint on an instance, and the registry on the demo instance is empty. This adds
the way in: a checkpoint directory is sent straight into the instance's model store and
registered as a model version, with no Hugging Face and no external URL, and can be
fetched back.

## Details

### Current state (before this task)

- Datasets have a direct, resumable upload (TASK-480): `services/datasetUpload/`
  (`DatasetUploadService`, `UploadSink`, `uploadManifest`), `routes/dataset-uploads.routes.ts`,
  contract `docs/dataset-upload.md`, client `rmsctl datasets upload`. A dataset's files
  come back out through `routes/dataset-files.routes.ts` (TASK-496).
- `POST /api/models/versions` (`routes/models.routes.ts`) registers a row with an
  `artifactUri` (`hf://`, `s3://`, `file://`) and stores nothing. `ModelVersion` has no
  base model of its own (a trained model reads it off its `TrainingJob`), no dataset link
  and no size. `DELETE /api/models/versions/:id` archives, never removes (TASK-272).
- Buckets are in `storage/model-storage.ts`; `production-models` exists and is unused.

### Decisions

- **One machinery, not a copy.** What a direct upload does between its first and last
  step does not depend on what is uploaded, so it moved out of `DatasetUploadService`
  into `services/datasetUpload/uploadSession.ts` (`PartReceiver`, `progressOf`,
  `assertNothingMissing`, `assembleAndVerify`) and `routes/uploadRouteSupport.ts`
  (`handlePartRequest`, `sendUploadError`); `uploadManifest.ts` gained
  `parseDeclaredFiles` / `toUploadEntries` and `modelUploadLimits`. The dataset upload
  now runs on these too — its 161 tests are unchanged and green. The file answer of
  TASK-496 moved to `utils/fileResponse.ts` (`sendStoredFile`, `parseFileRange`) and
  serves both a dataset's and a model's files.
- **No model version until the upload is whole.** The session is its own table
  (`ModelUpload`), and the `ModelVersion` is created — under the upload's id — only after
  every file is assembled and verified. An unfinished, failed or cancelled upload is
  never in the registry, so it can never be deployed. (A dataset is created at start with
  status `uploading`; a model has no such status and should not get one.)
- **The registry says what the model is.** `ModelVersion` gets `baseModel` (one of
  `BaseModels`, so GR00T N1.7 is `groot_n1_7`, never guessed), `datasetId` (a plain id —
  deleting the dataset must not touch the model), `notes`, `artifactSizeBytes`,
  `artifactFileCount`; `sourceKind` gets `uploaded`.
- **Deleting an uploaded model removes its files.** `DELETE /api/models/versions/:id`
  still archives the row (deployments, evaluations and lineage point at it) and then
  removes the stored files; the answer says how much was freed, the row says when, and
  the app's confirmation says it before it happens.
- **The download has the shape of a dataset's** (`/files?limit=&after=`,
  `/files/content?path=` with `Range`), so `rmsctl` downloads both with one engine.
- **No upload dialog in the app.** The dataset dialog is 1,950 lines built around a
  LeRobot tree (`meta/info.json` preview, dataset rows, the top-bar chip). A checkpoint
  is a multi-gigabyte directory on a training machine; the CLI is the way in, and the
  app shows the result.

### Server

- `server/prisma/schema.prisma`, `migrations/20261113180000_task_498_model_upload`:
  table `ModelUpload` (session; tenant-scoped, added to `TENANT_SCOPED_MODELS`) and the
  five `ModelVersion` columns.
- `server/src/services/modelUpload/ModelUploadService.ts` (new): start (metadata and
  manifest checked, `409 MODEL_VERSION_EXISTS`, `507 INSUFFICIENT_STORAGE`), status,
  list, parts, finish → background assemble / verify / register (in the upload's tenant,
  exactly once across restarts), cancel, idle reaper (also removes failed uploads),
  `manifest` / `file` / `removeStoredFiles` for the stored model.
- `server/src/services/modelUpload/modelUploadSink.ts` (new): the dataset sinks pointed
  at `production-models/uploads/<id>/`, or `MODEL_UPLOAD_DIR/<id>/` without RustFS.
- `server/src/repositories/ModelUploadRepository.ts` (new).
- `server/src/routes/model-uploads.routes.ts` (new), mounted on `/api/models` ahead of
  the registry router; part requests are exempt from the rate limits (`app.ts`).
- `server/src/routes/models.routes.ts`: `DELETE` removes stored files after the archive;
  `GET /versions/:id` adds `trainedOnDataset` and `storage`.
- `server/src/index.ts`, `jobs/multipart-upload-sweep.ts`: resume interrupted uploads at
  startup, start the reaper, keep running uploads' multipart uploads from the sweep.
- `assembleAndVerify` treats a file that is in the store with its size as assembled even
  when the store's answer to the join was lost — a multi-gigabyte
  `CompleteMultipartUpload` can outlast its request.

API (contract: `docs/model-upload.md`):

```
POST /api/models/uploads                                  → 201 { uploadId, chunkSize, files[] }
PUT  /api/models/uploads/:id/files/:fileId/parts/:n       → 200
GET  /api/models/uploads/:id                              → 200 { state, files[].receivedParts, modelVersionId, error }
POST /api/models/uploads/:id/finish                       → 202 (409 UPLOAD_INCOMPLETE)
POST /api/models/uploads/:id/cancel                       → 200
GET  /api/models/uploads                                  → 200 { uploads }
GET  /api/models/versions/:id/files?limit=&after=         → 200 { files[], nextCursor, totalBytes, fileCount }
GET  /api/models/versions/:id/files/content?path=         → 200 | 206 (Range)
```

### rmsctl (separate repo, RaaSaaR-org/rmsctl)

`models upload <dir> --version … [--name] [--model-type] [--base-model] [--dataset <id>]
[--metrics k=v|file]… [--eval-metrics k=v|file]… [--notes] [--exclude <glob>]…`,
`models upload-status [id]`, `models upload-cancel`, `models files`, `models download
<id> [--out dir] [--resume]`, `models delete`; `models list` shows base model, source and
size. Upload and download reuse the dataset commands' engines (`dataset_upload.rs` takes
the upload's base path, `dataset_download.rs` a `Kind`).

### Frontend

- `app/src/features/deployment/components/ModelBrowser.tsx`: base model beside the
  version, a Size column, an empty state that names the upload command.
- `components/models/ModelDetailsModal.tsx`: base model, "Trained on" (a link to the
  dataset), "Stored here", notes, metrics, and `ModelStoredFiles.tsx` (new) — the file
  list, or that the files were removed.
- `components/models/ModelUploadsPanel.tsx` (new): uploads that are not models yet.
- `pages/ModelsPage.tsx`: archiving an uploaded model says its files are deleted.
- `hooks/useModelStorage.ts` (new), `api/deploymentApi.ts`, `types/deployment.types.ts`
  (`uploaded` → "Uploaded directly"), `components/models/modelDisplay.ts`.

### Key files

- `server/src/services/modelUpload/` (new), `server/src/routes/model-uploads.routes.ts`
  (new), `server/src/repositories/ModelUploadRepository.ts` (new)
- `server/src/services/datasetUpload/uploadSession.ts` (new),
  `server/src/routes/uploadRouteSupport.ts` (new), `server/src/utils/fileResponse.ts` (new)
- `server/src/services/datasetUpload/{DatasetUploadService,UploadSink,uploadManifest}.ts`,
  `server/src/routes/{dataset-uploads,dataset-files,models}.routes.ts`
- `server/prisma/schema.prisma`, `server/prisma/migrations/20261113180000_task_498_model_upload/`
- `server/src/types/vla.types.ts`, `server/src/repositories/VLARepository.ts`,
  `server/src/database/client.ts`, `server/src/app.ts`, `server/src/index.ts`,
  `server/src/jobs/multipart-upload-sweep.ts`
- `app/src/features/deployment/` (see Frontend), `app/src/components/docs/docsRegistry.ts`
- `docs/model-upload.md` (new — the contract), `docs/api.md`, `docs/dataset-upload.md`,
  `docs/deployment.md`, `docs/README.md`, `README.md`, `CLAUDE.md`, `server/AGENTS.md`,
  `server/.env.example`

## Acceptance Criteria

- [x] A checkpoint directory is uploaded through the API server into the model store —
      start, parts, status, finish, cancel — with the dataset upload's resume, the same
      refusals, and `507` when the store cannot hold it.
- [x] Finishing registers one model version whose `artifactUri` is the stored prefix,
      with name, version, base model, training dataset, metrics, notes, total size and
      file count. GR00T N1.7 is stated as `groot_n1_7`.
- [x] An upload that is not finished, failed or cancelled is not in the registry.
- [x] A single 4.99 GB file works (149 parts of 32 MiB), in the unit tests by arithmetic
      and end to end with the real checkpoint.
- [x] The stored files are listed and served byte for byte, with `Range`, through
      `sendStream`; a client that leaves has its store stream given back.
- [x] Deleting an uploaded model removes its stored files; a model that may not be
      archived keeps them.
- [x] The dataset upload and the dataset file download behave as before (their suites
      are unchanged and green).
- [x] The Models page shows an uploaded model with name, version, base model, size,
      source "Uploaded directly", its metrics, the dataset it was trained on, and its
      files; uploads in progress are visible; the empty state says how a checkpoint
      gets here.
- [x] `rmsctl models upload | upload-status | upload-cancel | files | download | delete`.

## Test Strategy

- Unit: `server/src/services/modelUpload/__tests__/ModelUploadService.test.ts` (start
  refusals, parts, resume, finish → register, failure, restart, cancel, reaper, manifest,
  ranged read, removal — against an in-memory object store and a real directory),
  `server/src/routes/__tests__/model-uploads-routes.test.ts` (status codes, raw part
  body, `Range` / `416` / `HEAD`, store timeout, client leaving mid-download, the delete
  hook), the unchanged dataset suites, and the ratchets that move
  (`tenantAllowlist`, `write-route-authorization`). App:
  `app/src/features/deployment/components/__tests__/UploadedModel.test.tsx`.
- Migration: `prisma migrate deploy` on a clean Postgres, then `migrate diff
  --exit-code` (no drift).
- End to end against a local server + RustFS + Postgres with `rmsctl`: a synthetic
  checkpoint (upload → list → download → `diff -r`), an upload interrupted by SIGINT and
  resumed, a download killed and resumed, cancel (no objects and no open multipart
  uploads left), a store too small (`507`), delete (files gone, `410` afterwards), and
  the real g11 checkpoint (6,918,209,810 bytes in 15 files, uploaded, downloaded and
  `diff -r` identical).

## Notes

- The demo instance's object store was 5 Gi when this was built; the deployments repo
  has since grown it to 20 Gi with `datasetUploadStoreCapacityBytes` at 19 Gi
  (deployments #28, #30). With 1.8 GB held, the 6.9 GB g11 checkpoint fits once that
  is rolled out; a store that is too small still refuses at start with
  `507 INSUFFICIENT_STORAGE`, before a byte is sent.
- Not done: an "Upload model" dialog in the app (see Decisions).
- Measured on 2026-11-13 against a local server, RustFS and Postgres, with the real g11
  checkpoint read from a hard disk: upload 173 s in all — 88 s hashing the 15 files on
  the client, 78 s sending 220 parts (89 MB/s, the source disk's read speed), 6 s for the
  server to assemble two multipart files and read all 6.9 GB back for their SHA-256;
  download 9 s including the SHA-256 comparison; `diff -r` against the source identical
  (6,918,209,810 bytes, 15 files); no open multipart upload left.
- A second start of a name and version whose upload is still open is refused
  (`409 UPLOAD_IN_PROGRESS`, with the open upload's id), so a retried start cannot store
  a checkpoint twice.
- The rmsctl half is RaaSaaR-org/rmsctl `feat/models-upload`.
- Review on 2026-11-13 (second pass, same PR): an uploaded model whose files were
  removed by its deletion can no longer be moved off `archived`
  (`PATCH /api/models/versions/:id` answers `409 ARTIFACT_REMOVED`) — it would have been
  a deployable model with nothing behind its `artifactUri`. On the Models table the
  "Derived from" column now gives way below 1440 px, so the new Size column and the row
  menu both fit at 1280. Re-run against a local server, RustFS and Postgres: the
  synthetic round trips, 300 aborted downloads of a 1.1 GB file (the store's sockets
  were all given back, the server's memory stayed flat at about 0.4 GB), a dataset
  upload and download for regression, and g11 again — 178 s up, 9 s down, identical.
