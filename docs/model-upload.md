# Uploading a model checkpoint directly

A trained checkpoint directory on your machine — `config.json`, the
safetensors shards, `processor/`, whatever the trainer wrote — can be sent
straight into a NeoDEM instance's model store and registered in the model
registry. No Hugging Face repository and no external URL in between. The
client sends the directory **file by file, each file in bounded parts, through
the API server**, which streams every part into the store; when the last part
is in and verified, the server registers a model version whose `artifactUri`
is the stored prefix.

It is the model-side twin of [uploading a dataset directly](dataset-upload.md)
and runs on the same machinery: the same part protocol, the same resume, the
same refusals. What differs is the beginning (what the registry will say about
the model is declared with the files) and the end (a registered model, not a
validated dataset). The way back out has the shape of
[a dataset's download](dataset-download.md).

This page is the contract. It is complete: a client can be written from it
without reading the server. `rmsctl models upload` and `rmsctl models download`
are clients of it.

- [At a glance](#at-a-glance)
- [What may be uploaded](#what-may-be-uploaded)
- [Endpoints](#endpoints): [start](#1-start) · [status](#2-status) · [list](#3-open-uploads) · [part](#4-send-one-part) · [finish](#5-finish) · [cancel](#6-cancel)
- [From upload to registered model](#from-upload-to-registered-model)
- [Resuming](#resuming)
- [The stored model](#the-stored-model): [in the registry](#in-the-registry) · [file list](#7-the-file-list) · [one file](#8-one-file) · [deleting](#deleting)
- [Errors](#errors)
- [Limits and configuration](#limits-and-configuration)
- [What the server guarantees](#what-the-server-guarantees)
- [Clients](#clients)

## At a glance

```
POST /api/models/uploads                                    declare the model and its files → 201 { uploadId, chunkSize, files[] }
PUT  /api/models/uploads/:id/files/:fileId/parts/:n         one part, raw body              → 200   (repeat; any order; re-send freely)
GET  /api/models/uploads/:id                                what the server holds           → 200 { state, files[].receivedParts }
POST /api/models/uploads/:id/finish                         every part is sent              → 202   (409 lists what is missing)
GET  /api/models/uploads/:id   (poll)                       until state is completed | failed
POST /api/models/uploads/:id/cancel                         stop and remove everything
GET  /api/models/uploads                                    uploads that are not models yet

GET  /api/models/versions/:id/files?limit=&after=           the stored files of a model     → 200 { files[], nextCursor }
GET  /api/models/versions/:id/files/content?path=…          one file, raw bytes             → 200, or 206 for a Range
```

All paths are under the API base (`https://<host>/api`). Requests are
authenticated exactly like every other `/api/models` request (`Authorization:
Bearer <token>`; nothing on an instance with sign-in disabled). Starting,
sending, finishing and cancelling are writes — a viewer is refused with `403`.
An upload, and a model, of another organization answers `404`.

No request carries more than one part (32 MiB by default, never above 64 MiB)
and no request waits on long server-side work, so the API works behind a proxy
that caps bodies at 100 MB and cuts long requests. **The size of a file does
not matter to any single request:** a 4.99 GB shard is 149 parts of 32 MiB.

**The upload id is the model's id.** Until the upload completes there is no
model version — an unfinished, failed or cancelled upload is never in the
registry and can never be picked for a deployment. When it completes, the
model version is registered under the id the upload had.

## What may be uploaded

Every file you declare. A checkpoint has no fixed layout, so nothing is
filtered by name: the client decides what belongs to the model
(`rmsctl models upload --exclude` leaves files out). Paths are **relative to
the checkpoint directory**, with forward slashes, and are stored exactly so
under the model's prefix.

A path is refused (`INVALID_PATH`, the whole request) when it is absolute,
contains a backslash, a control character, a drive letter, or an empty, `.` or
`..` segment, or is longer than 1024 characters. The same path twice is
`DUPLICATE_PATH`; a path that is a file and also a directory of another is
`INVALID_PATH`. An empty file is allowed (one part of zero bytes).

## Endpoints

### 1. Start

```
POST /api/models/uploads
Content-Type: application/json
```

```jsonc
{
  "name": "GR00T N1.7 AppleToPlate g11",   // required, 1–200 characters
  "version": "g11-step-5000",              // required, 1–100 characters
  "modelType": "vla",                      // optional: "vla" (default) | "rl_policy"
  "baseModel": "groot_n1_7",               // optional: pi0 | pi0_6 | openvla | groot | groot_n1_7 | smolvla
  "datasetId": "9b7c63ca-…",               // optional: the dataset it was trained on; must exist here
  "trainingMetrics":   { "final_loss": 0.0264, "steps": 5000 },       // optional JSON objects,
  "validationMetrics": { "success_rate": 0.52, "eval_episodes": 50 }, // at most 64 kB each
  "notes": "5000 steps, lr 1e-4, batch 128, seed 42",                 // optional, at most 4000 characters
  "chunkSize": 33554432,                   // optional: a part size smaller than the server's
  "files": [                               // required: every file you intend to send
    { "path": "config.json", "size": 2147 },
    { "path": "model-00001-of-00002.safetensors", "size": 4990519232,
      "sha256": "cb378fd8…" }              // sha256 optional, 64 hex characters, whole file
  ]
}
```

`baseModel` is the foundation model the checkpoint was fine-tuned from, one of
the models this platform trains (`groot_n1_7` is GR00T N1.7, `groot` its
predecessor). Leave it out for a model that has none of them as its base — it
is never guessed. `name` + `version` must not already belong to a registered
model that is not archived.

**201 Created**

```jsonc
{
  "uploadId": "fe89db46-d44b-4edc-8794-cfe95facb611",   // the model version's id once it completes
  "state": "uploading",
  "name": "GR00T N1.7 AppleToPlate g11",
  "version": "g11-step-5000",
  "storage": "rustfs",              // or "local" on a server without an object store
  "chunkSize": 33554432,            // bytes per part — use THIS value, not your own
  "totalBytes": 6918209810,
  "files": [                        // `id` is what part URLs use
    { "id": 0, "path": "config.json", "size": 2147, "partCount": 1 },
    { "id": 6, "path": "model-00001-of-00002.safetensors", "size": 4990519232, "partCount": 149 }
  ],
  "idleTimeoutSeconds": 21600,
  "expiresAt": "2026-11-13T21:45:00.000Z"
}
```

Refusals: `400 INVALID_NAME | INVALID_VERSION | INVALID_MODEL_TYPE |
INVALID_BASE_MODEL | INVALID_METRICS | INVALID_REQUEST | INVALID_MANIFEST |
INVALID_PATH | DUPLICATE_PATH | INVALID_CHUNK_SIZE`, `404 DATASET_NOT_FOUND`,
`409 MODEL_VERSION_EXISTS`, `409 UPLOAD_IN_PROGRESS` (an upload of this name
and version is already open; body has its `uploadId` — resume or cancel it),
`413 UPLOAD_TOO_LARGE | TOO_MANY_FILES |
FILE_TOO_LARGE`, `507 INSUFFICIENT_STORAGE` (body has `totalBytes` and
`freeBytes`), `503 STORAGE_UNAVAILABLE`. Nothing is created when a start is
refused.

### Parts

A file of `size` bytes has `partCount = max(1, ceil(size / chunkSize))` parts,
numbered from 1. Part `n` is **always** the bytes
`[(n-1) × chunkSize, min(n × chunkSize, size))` of the file — every part but
the last is exactly `chunkSize` bytes, the last is the remainder. An empty file
has one part of zero bytes, which still has to be sent.

### 2. Status

```
GET /api/models/uploads/:id
```

**200 OK**

```jsonc
{
  "uploadId": "fe89db46-…",
  "state": "uploading",             // uploading | processing | completed | failed | cancelling
  "name": "GR00T N1.7 AppleToPlate g11", "version": "g11-step-5000",
  "modelType": "vla", "baseModel": "groot_n1_7", "datasetId": "9b7c63ca-…",
  "storage": "rustfs",
  "chunkSize": 33554432,
  "totalBytes": 6918209810, "receivedBytes": 268435456,
  "totalFiles": 15, "completedFiles": 1,
  "readyToFinish": false,           // true when every part of every file is held
  "files": [
    { "id": 6, "path": "model-00001-of-00002.safetensors", "size": 4990519232, "partCount": 149,
      "complete": false,            // the file is in place at its final path
      "receivedParts": [1, 2, 3] }  // part numbers the server holds with the right length
  ],
  "modelVersionId": null,           // the registered model once state is "completed"
  "error": null,                    // why assembling or verifying failed, when state is "failed"
  "createdAt": "…", "lastActivityAt": "…",
  "expiresAt": "…"                  // when an idle or failed upload is removed; null otherwise
}
```

While `state` is `uploading`, `receivedParts` is read from the store itself
(S3 `ListParts` and the object listing), not from a counter — it is the truth
after either side restarted. A multi-part file reads `complete: false` with
all its parts listed until `finish` assembles it.

`404 NOT_FOUND` — no such upload (or not yours); after a cancel it is gone.

### 3. Open uploads

```
GET /api/models/uploads        → 200 { "uploads": [ { …the status fields without chunkSize, received… and files… } ] }
```

Every upload that is not a registered model yet — `uploading`, `processing`,
`failed`, `cancelling` — newest first. A completed upload is not listed: it is
a model (`GET /api/models/versions`).

### 4. Send one part

```
PUT /api/models/uploads/:id/files/:fileId/parts/:partNumber
Content-Type: application/octet-stream        (required — anything else is 415)
Content-Length: <exact length of this part>   (required — chunked bodies are 411)
X-Chunk-Sha256: <64 hex characters>           (optional — SHA-256 of this part's bytes)

<raw bytes of the part>
```

**200 OK** `{ "uploadId": "…", "fileId": 6, "partNumber": 3, "size": 33554432, "sha256": "<what the server stored>" }`

Exactly the dataset upload's part request — the same handler: parts in any
order and in parallel, a re-sent part replaces the earlier copy, a part is
stored whole or not at all, a mismatching `X-Chunk-Sha256` keeps nothing
(`422 CHECKSUM_MISMATCH`). Part requests are exempt from the API rate limits;
the server streams at most `MODEL_UPLOAD_MAX_CONCURRENT_PARTS` (default 4) at
once and answers one more with `503 UPLOAD_BUSY` and `Retry-After: 2`. The
refusals are the table in
[dataset-upload.md](dataset-upload.md#3-send-one-part), unchanged, with
`404 NOT_FOUND` for an unknown upload.

### 5. Finish

```
POST /api/models/uploads/:id/finish        (no body)
```

**409 `UPLOAD_INCOMPLETE`** while anything is missing — the upload stays open,
and the body names it (`missingFiles`, `missingBytes`, `missing: [{ fileId,
path, missingParts }]`, first 50 files).

**202 Accepted** when everything is there:

```json
{ "uploadId": "fe89db46-…", "state": "processing", "modelVersionId": null, "message": "…" }
```

`finish` is idempotent: again while the server works it answers `202`
(`processing`), afterwards `200` with `state: "completed"` and the
`modelVersionId`. `409 UPLOAD_NOT_ACCEPTING` — the upload failed or was
cancelled.

### 6. Cancel

```
POST /api/models/uploads/:id/cancel        (no body)
```

**200 OK** `{ "uploadId": "…", "status": "cancelled", "message": "…" }`

Parts being received are stopped, every open multipart upload is aborted,
every stored object (or local file) is deleted, and the upload itself is
removed. Allowed while `state` is `uploading`, `failed` or `cancelling`.

`409 UPLOAD_PROCESSING` — `finish` was accepted; wait. `409 UPLOAD_COMPLETED`
(body has `modelVersionId`) — it is a model now:
[delete the model](#deleting) instead.

## From upload to registered model

After `finish` is accepted the server works in the background and no more
parts are accepted:

1. multi-part files are assembled into single files (S3
   `CompleteMultipartUpload`);
2. every file is checked to be in the store with its declared size, and every
   file that declared a `sha256` is read back and compared;
3. the model version is registered — id = the upload's id, `sourceKind:
   "uploaded"`, `deploymentStatus: "staging"`, `artifactUri` = the stored
   prefix, with the name, version, base model, dataset, metrics and notes of
   the start request and the total size and file count of what was stored.

Poll `GET /api/models/uploads/:id` every second or two:

| `state` | Meaning |
| --- | --- |
| `uploading` | parts are being accepted |
| `processing` | finish accepted; assembling and verifying |
| `completed` | **done** — `modelVersionId` is in the registry |
| `failed` | assembling or verifying failed; `error` says why (for example a sha256 mismatch naming the file). Nothing was registered. The parts are kept until the upload is cancelled or its idle time runs out |

Reading a multi-gigabyte file back for its checksum takes as long as the
store reads it: about 6 s for the 6.9 GB checkpoint this was built for against
a store on a local NVMe disk, and correspondingly longer on a networked
volume. Do not put a short timeout on the poll.

## Resuming

Keep the `uploadId`. After any interruption — the client crashed, the network
dropped, the server restarted:

1. `GET /api/models/uploads/:id`
2. for every file, send each part number in `1..partCount` that is not in
   `receivedParts`, using the `chunkSize` from that response;
3. `POST …/finish`.

A part that was in flight when the connection died was not kept and shows as
missing. Nothing has to be re-sent that the status reports as received. An
upload that receives no part for `idleTimeoutSeconds` (6 hours by default) is
removed like a cancelled one, and so is a failed one left alone that long.

## The stored model

### In the registry

A completed upload is an ordinary model version — `GET /api/models/versions`
lists it, `PATCH` renames or links it, a deployment can roll it out. What it
adds to the row:

```jsonc
// GET /api/models/versions/:id
{
  "modelVersion": {
    "id": "fe89db46-…", "name": "GR00T N1.7 AppleToPlate g11", "version": "g11-step-5000",
    "sourceKind": "uploaded",                   // beside training | imported | derived
    "modelType": "vla", "baseModel": "groot_n1_7",
    "datasetId": "9b7c63ca-…", "notes": "…",
    "artifactUri": "s3://production-models/uploads/fe89db46-…/",   // file:///…/ on local disk
    "artifactSizeBytes": 6918209810, "artifactFileCount": 15,
    "trainingMetrics": { "final_loss": 0.0264 }, "validationMetrics": { "success_rate": 0.52 },
    "deploymentStatus": "staging", "…": "…"
  },
  "evaluation": { "…": "…" },
  "trainedOnDataset": { "id": "9b7c63ca-…", "name": "Apple to Plate — NVIDIA GR00T reference" },
  "storage": { "uploadId": "fe89db46-…", "storage": "rustfs", "filesRemovedAt": null }
}
```

`baseModel`, `datasetId`, `notes`, `artifactSizeBytes` and `artifactFileCount`
are on every model version and `null` where they do not apply — a model this
server trained states its base model and dataset through its training job, and
a model that only points somewhere else stores nothing here.
`trainedOnDataset` is `null` when the model names no dataset or the dataset is
gone (`datasetId` is a plain id, not a relation: deleting the dataset never
touches the model). `storage` is `null` for a model that was not uploaded to
this instance.

### 7. The file list

```
GET /api/models/versions/:id/files?limit=1000&after=<nextCursor of the previous page>
```

**200 OK**

```jsonc
{
  "modelVersionId": "fe89db46-…",
  "artifactUri": "s3://production-models/uploads/fe89db46-…/",
  "storage": "rustfs",
  "totalBytes": 6918209810,         // of the whole model, not of this page
  "fileCount": 15,
  "limit": 1000,
  "files": [                        // ascending byte order of path, each file once across the pages
    { "path": "config.json", "size": 2147, "sha256": "7d06d0da…" },   // sha256 null when the upload declared none
    { "path": "model-00001-of-00002.safetensors", "size": 4990519232, "sha256": "cb378fd8…" }
  ],
  "nextCursor": null                // a string while there are more pages; pass it as `after`
}
```

`limit` is 1–1000 (default 1000). The list is what the upload declared and the
server verified when it finished: sizes always, checksums when declared.

### 8. One file

```
GET /api/models/versions/:id/files/content?path=model-00001-of-00002.safetensors
Range: bytes=52428800-            (optional)
```

`path` is a `path` from the file list, URL-encoded as a query value. The
answer is a dataset file's
([dataset-download.md](dataset-download.md#2-one-file)), from the same code:
`200` with the whole file or `206` with the window, `Content-Type:
application/octet-stream`, `Accept-Ranges: bytes`, `Content-Length`,
`Content-Range` on a `206`, and `X-Content-Sha256: <whole-file hash>` when the
list carries one. One range per request (`bytes=N-M`, `bytes=N-`, `bytes=-N`);
`416 RANGE_NOT_SATISFIABLE` with `Content-Range: bytes */<size>` otherwise.
`HEAD` answers the headers without opening the file. The bytes are streamed
from the store through the API server — never a redirect to the object store,
never a file held in memory — and a client that goes away has its store stream
cancelled and given back.

To download a whole model: page the list, fetch each file into a temporary
name, continue an interrupted one with `Range: bytes=<bytes you have>-`, and
compare length and SHA-256 before giving it its real name.

### Deleting

`DELETE /api/models/versions/:id` archives a model — the row stays, because
deployments, evaluations and lineage point at it (`409` while a deployment of
it is unfinished or a skill runs it). **For a model uploaded to this instance
it also removes the stored files**, which is not undoable:

```json
{ "id": "fe89db46-…", "outcome": "archived", "storedFilesRemoved": true, "freedBytes": 6918209810 }
```

The files go only after the archive was accepted, so a model that may not be
archived keeps them. Afterwards `storage.filesRemovedAt` is set, the file list
and the files answer `410 ARTIFACT_REMOVED`, and the archived row still says
what was once stored. Deleting it again is harmless.

Such a model stays archived: `PATCH /api/models/versions/:id` with a
`deploymentStatus` other than `archived` answers `409 ARTIFACT_REMOVED`,
because a rollout could otherwise pick a model with nothing behind its
`artifactUri`. Upload the checkpoint again to use it — the name and version
of an archived model are free.

## Errors

Every refusal is JSON:

```json
{ "error": "<a sentence a person can act on>", "code": "<STABLE_CODE>", "…context fields…": "…" }
```

Branch on `code` (or the status), never on the sentence. Besides the codes
listed per endpoint:

| Status | `code` | Meaning |
| --- | --- | --- |
| 404 | `NOT_FOUND` | no such upload / model version (or not yours) |
| 404 | `NO_STORED_FILES` | the model was not uploaded to this instance: its `artifactUri` points somewhere else |
| 404 | `FILE_NOT_FOUND` | the model has no file at `path`; body has `path` |
| 410 | `ARTIFACT_REMOVED` | the stored files were removed when the model was deleted; body has `filesRemovedAt` |
| 400 | `INVALID_PATH` / `INVALID_LIMIT` / `INVALID_CURSOR` | `path` is not a plain relative path / `limit` is not 1–1000 / `after` is not a `nextCursor` |
| 416 | `RANGE_NOT_SATISFIABLE` | the range starts at or past the end; body has `size` |
| 502 | `STORE_ERROR` | the store refused a part, or failed before the first byte of a file; retry |
| 503 | `STORAGE_UNAVAILABLE` / `STORAGE_TIMEOUT` | the object store is down or did not answer in time; `Retry-After` header |
| 500 | `UPLOAD_ERROR` | an unexpected server fault; retry — nothing is half-applied |

`401`/`403` come from authentication, `429` from the API rate limits on
everything but the part requests ([Rate limiting](deployment.md#rate-limiting)).
Worth retrying with a pause: `429`, `502`, `503`, `400 PART_INTERRUPTED`,
`422 CHECKSUM_MISMATCH` (re-read the bytes), and any network error.

## Limits and configuration

Server environment variables (all optional):

| Variable | Default | Meaning |
| --- | --- | --- |
| `MODEL_UPLOAD_CHUNK_BYTES` | `33554432` (32 MiB) | Bytes per part, and the largest part accepted. Clamped to 5 MiB – 64 MiB. A client may ask for a smaller one (≥ 5 MiB) at start, never a larger. |
| `MODEL_UPLOAD_MAX_BYTES` | `68719476736` (64 GiB) | The most one upload may declare (`413 UPLOAD_TOO_LARGE`). |
| `MODEL_UPLOAD_MAX_FILES` | `2000` | Files per upload (`413 TOO_MANY_FILES`). |
| `MODEL_UPLOAD_IDLE_MINUTES` | `360` | An upload with no part for this long is removed, and so is a failed one. Checked every 5 minutes. |
| `MODEL_UPLOAD_MAX_CONCURRENT_PARTS` | `4` | Model parts streamed at once (`503 UPLOAD_BUSY` beyond); counted apart from dataset parts. |
| `MODEL_UPLOAD_DIR` | `server/data/uploaded-models` | Where checkpoints go on a server **without** RustFS. |
| `DATASET_UPLOAD_STORE_CAPACITY_BYTES` | unset | Total size of the object store — one store, one number, read by both uploads. S3 does not report free space; with this set, an upload larger than capacity minus what **all** buckets hold is refused at start (`507 INSUFFICIENT_STORAGE`). On local disk the free space of the volume is always checked. |

**Size the store for the model.** A checkpoint is one or two orders of
magnitude larger than a dataset's tables: a GR00T N1.7 finetune is 6.9 GB. An
instance whose store is smaller than the checkpoint plus what it already holds
answers the start with `507` — grow the volume (and the capacity variable with
it) first.

**A single file** may have at most 10,000 parts: 320 GiB at the default part
size, 48 GiB at the 5 MiB minimum.

**Slow links.** One part has to arrive within the proxy's request timeout: a
32 MiB part in 100 s needs about 2.7 Mbit/s of uplink, in 15 s about 18 Mbit/s.
On a slower link ask for a smaller `chunkSize` at start (`rmsctl models upload
--chunk-size 8M`).

**Where the bytes go.** With RustFS configured, into the `production-models`
bucket under `uploads/<upload id>/`, as the tree the client sent — a loader
that reads a directory can read the prefix. While RustFS is configured but
unreachable, start answers `503 STORAGE_UNAVAILABLE`; the server never falls
back to its own disk. Without RustFS, into `MODEL_UPLOAD_DIR/<upload id>/`.

## What the server guarantees

- **Nothing in the registry until it is whole.** The model version is created
  after every file was assembled and verified, never before. A failed upload
  registers nothing.
- **Bounded memory.** A part is piped to the store as it is read, a file is
  piped from the store as it is served; neither is ever held in memory.
- **Nothing outside the model.** Paths are validated at start and parts are
  addressed by file id. A file is served only when its `path` is in the
  model's own list; the path never reaches the store as given.
- **No leaked storage.** Cancel, the idle reaper and deleting the model abort
  every open multipart upload and delete every object under the prefix. The
  stale-multipart sweep leaves the uploads of running sessions alone.
- **Restart-safe.** The session is a database row and the received parts are
  read from the store. An upload continues after a server restart; one that
  was between `finish` and the registry is taken up again at startup and is
  registered exactly once. A store that joined a large file but lost its
  answer is recognised by the file being there.
- **One organization.** An upload and its model belong to the organization
  that started it, also when the server finishes it after a restart.

## Clients

**`rmsctl`** (the [CLI](https://github.com/RaaSaaR-org/rmsctl)):

```bash
rmsctl models upload <dir> --version <v> [--name N] [--base-model groot_n1_7] [--dataset <id>] \
    [--metrics k=v|file.json]… [--eval-metrics k=v|file.json]… [--notes "…"] [--exclude <glob>]… --yes
rmsctl models upload-status [<id>]      # one upload, or every open one
rmsctl models upload-cancel <id> --yes
rmsctl models list | show <id> | files <id>
rmsctl models download <id> [--out <dir>] [--resume]
rmsctl models delete <id> --yes         # archives, and removes the stored files
```

Running `models upload` again with the same directory resumes it; every part
carries its SHA-256 and every file a whole-file SHA-256 the server compares
after assembling and a download compares again.

**The app.** Build → Models lists an uploaded model with its base model, size
and the source "Uploaded directly"; its details show the dataset it was
trained on (a link), notes, metrics and the stored files, and uploads that are
still on their way appear above the table. Archiving an uploaded model says
that its files are deleted. The app has **no upload dialog for models** —
checkpoints are multi-gigabyte directories on training machines, and the CLI
is the way in.
