# Uploading a dataset directly

A LeRobot dataset directory (v2.x or v3.0) on your machine can be sent straight
into a NeoDEM instance — no Hugging Face repository in between. The client
sends the directory **file by file, each file in bounded parts, through the API
server**, which streams every part into the instance's dataset store. The
dataset ends in exactly the state a full Hugging Face import ends in, so the
dataset page, the episode browser, the video player, statistics and training
all work on it unchanged.

This page is the contract. It is complete: a client can be written from it
without reading the server.

- [At a glance](#at-a-glance)
- [What may be uploaded](#what-may-be-uploaded)
- [Endpoints](#endpoints): [start](#1-start) · [status](#2-status) · [part](#3-send-one-part) · [finish](#4-finish) · [cancel](#5-cancel)
- [Following the dataset to its verdict](#following-the-dataset-to-its-verdict)
- [Resuming](#resuming)
- [Errors](#errors)
- [Limits and configuration](#limits-and-configuration)
- [What the server guarantees](#what-the-server-guarantees)
- [The older archive upload](#the-older-archive-upload)

## At a glance

```
POST /api/datasets/uploads                                   declare the files      → 201 { datasetId, chunkSize, files[] }
PUT  /api/datasets/:id/upload/files/:fileId/parts/:n         one part, raw body     → 200   (repeat; any order; re-send freely)
GET  /api/datasets/:id/upload                                what the server holds  → 200 { files[].receivedParts }
POST /api/datasets/:id/upload/finish                         every part is sent     → 202   (409 lists what is missing)
GET  /api/datasets/:id/upload   (poll)                       until status is ready | failed
POST /api/datasets/:id/upload/cancel                         stop and remove everything
```

All paths are under the API base (`https://<host>/api`). Requests are
authenticated exactly like every other `/api/datasets` request (`Authorization:
Bearer <token>`; nothing on an instance with sign-in disabled). Starting an
upload needs the same role as creating a dataset — a viewer is refused with
`403`. Every later call names a dataset id and is scoped to the caller's
organization: an id that belongs to another organization answers `404`.

No request carries more than one part (32 MiB by default, never above 64 MiB)
and no request waits on long server-side work, so the API works behind a proxy
that caps bodies at 100 MB and requests at 100 s.

## What may be uploaded

Paths in the manifest are **relative to the dataset root** — the directory
that contains `meta/` and `data/` — with forward slashes.

| Accepted | |
| --- | --- |
| `meta/**` | every file under `meta/` |
| `data/**/*.parquet` | the episode tables |
| `videos/**/*.mp4` | camera video (optional) |
| `images/**` | camera frames of `dtype: image` features (optional) |

These are the same rules the Hugging Face importer selects by. Any other file
you declare (`README.md`, `.gitattributes`, …) is **not an error**: it is
listed under `ignored` in the start response and you do not upload it.

Required, or the start request is refused with `NOT_A_LEROBOT_DATASET`:

- `meta/info.json` (not empty)
- at least one `data/**/*.parquet`
- v3.0: at least one `meta/episodes/**/*.parquet`
- v2.x: `meta/episodes.jsonl` (or `meta/episodes.json`)

Leaving out `videos/` and `images/` is allowed. The dataset is then recorded as
a tables-only (`importMode: "metadata"`) dataset and validation does not count
the missing camera files against it — the same as a metadata-only import.

A path is refused (`INVALID_PATH`, the whole request) when it is absolute,
contains a backslash, a control character, a drive letter, or an empty, `.` or
`..` segment, or is longer than 1024 characters.

## Endpoints

### 1. Start

```
POST /api/datasets/uploads
Content-Type: application/json
```

```jsonc
{
  "name": "g1-dex3-bottle-sorting-sim",   // required, 1–200 characters
  "description": "Recorded 2026-11-10",   // optional
  "robotTypeId": "…",                     // optional; see "Robot type" below
  "info": { … },                          // required: the parsed contents of meta/info.json
  "chunkSize": 33554432,                  // optional: a part size smaller than the server's
  "files": [                              // required: every file you intend to send
    { "path": "meta/info.json", "size": 7406 },
    { "path": "videos/observation.images.head/chunk-000/file-000.mp4", "size": 208492163,
      "sha256": "9f2c…" }                 // sha256 optional, 64 hex characters, whole file
  ]
}
```

`info` must carry `codebase_version` (`v2.*` or `v3.*`), `robot_type`, a
positive `fps` and a non-empty `features`. The body is ordinary JSON and is
limited to 10 MB (roughly 60,000 files; the default file cap is 20,000).

**Robot type.** Without `robotTypeId` the server does what the importer does:
it looks for a registered robot type that matches `info.robot_type` *and* the
widths `info.features.action.shape[0]` / `info.features["observation.state"].shape[0]`,
and creates one with those widths when none fits. A dataset whose widths
differ from the seeded type of the same robot therefore gets its own type
(named, for example, `unitree_g1_dex3 (action 31, state 31)`) instead of
failing validation on a dimension mismatch. With `robotTypeId`, the widths
must match that type or the request is refused (`ROBOT_DIMENSION_MISMATCH`).

**201 Created**

```jsonc
{
  "datasetId": "2efecc18-3db8-4fbc-895d-d1bdb982b886",
  "status": "uploading",            // the dataset's status
  "state": "uploading",             // the upload's state
  "robotTypeId": "c5f6ef18-…",
  "storage": "rustfs",              // or "local" on a server without an object store
  "chunkSize": 33554432,            // bytes per part — use THIS value, not your own
  "totalBytes": 446100758,          // sum of the accepted files
  "files": [                        // the accepted files; `id` is what part URLs use
    { "id": 0, "path": "meta/info.json", "size": 7406, "partCount": 1 },
    { "id": 5, "path": "videos/observation.images.head/chunk-000/file-000.mp4",
      "size": 208492163, "partCount": 7 }
  ],
  "ignored": [ { "path": "README.md", "reason": "not part of a LeRobot dataset tree (…)" } ],
  "idleTimeoutSeconds": 21600,
  "expiresAt": "2026-11-13T16:00:00.000Z"
}
```

The dataset exists from this moment (`GET /api/datasets/:id`, status
`uploading`) and appears in the dataset list.

Refusals: `400 INVALID_NAME | INVALID_REQUEST | INVALID_INFO |
UNSUPPORTED_VERSION | INVALID_MANIFEST | INVALID_PATH | DUPLICATE_PATH |
NOT_A_LEROBOT_DATASET | INVALID_CHUNK_SIZE | ROBOT_DIMENSION_MISMATCH |
UNKNOWN_ROBOT_DIMS`, `404 ROBOT_TYPE_NOT_FOUND`, `413 UPLOAD_TOO_LARGE |
TOO_MANY_FILES | FILE_TOO_LARGE`, `507 INSUFFICIENT_STORAGE`, `503
STORAGE_UNAVAILABLE`. Nothing is created when a start is refused.

### Parts

A file of `size` bytes has `partCount = max(1, ceil(size / chunkSize))` parts,
numbered from 1. Part `n` is **always** the bytes
`[(n-1) × chunkSize, min(n × chunkSize, size))` of the file — so every part but
the last is exactly `chunkSize` bytes, and the last is the remainder. An empty
file has one part of zero bytes, which still has to be sent.

### 2. Status

```
GET /api/datasets/:id/upload
```

**200 OK**

```jsonc
{
  "datasetId": "2efecc18-…",
  "state": "uploading",             // uploading | processing | completed | failed | cancelling
  "status": "uploading",            // the dataset's status: uploading | validating | ready | failed
  "storage": "rustfs",
  "chunkSize": 33554432,
  "totalBytes": 446100758,
  "receivedBytes": 88960993,
  "totalFiles": 7,
  "completedFiles": 5,
  "readyToFinish": false,           // true when every part of every file is held
  "files": [
    { "id": 5, "path": "videos/…/file-000.mp4", "size": 208492163, "partCount": 7,
      "complete": false,            // the file is in place at its final path
      "receivedParts": [1, 2] }     // part numbers the server holds with the right length
  ],
  "lastActivityAt": "2026-11-13T10:00:00.000Z",
  "expiresAt": "2026-11-13T16:00:00.000Z",   // null once state is not "uploading"
  "importError": null               // { phase, error, failedAt, sink } when the dataset failed
}
```

While `state` is `uploading`, `receivedParts` is read from the store itself
(S3 `ListParts` and the object listing), not from a counter — it is the truth
even after the server or the client restarted. A multi-part file reads
`complete: false` with all its parts listed until `finish` assembles it.

`404 NOT_FOUND` — no such dataset (or not yours). `404 NO_UPLOAD` — the dataset
was not created by a direct upload. After a cancel the dataset is gone: `404`.

### 3. Send one part

```
PUT /api/datasets/:id/upload/files/:fileId/parts/:partNumber
Content-Type: application/octet-stream        (required — anything else is 415)
Content-Length: <exact length of this part>   (required — chunked bodies are 411)
X-Chunk-Sha256: <64 hex characters>           (optional — SHA-256 of this part's bytes)

<raw bytes of the part>
```

The body is the raw bytes: not JSON, not `multipart/form-data`, no encoding.
`fileId` is the `id` from the start response; `partNumber` starts at 1.

**200 OK**

```json
{ "datasetId": "2efecc18-…", "fileId": 5, "partNumber": 3, "size": 33554432,
  "sha256": "<sha256 the server computed over what it stored>", "fileComplete": false }
```

- Parts may be sent **in any order** and **in parallel** (see the concurrency
  limit below).
- Sending a part again is harmless: it replaces the earlier copy. A part is
  either stored whole or not at all — a request that is cut off leaves nothing.
- With `X-Chunk-Sha256`, a part whose bytes do not match is **not kept** and
  the answer is `422 CHECKSUM_MISMATCH` with `expected` and `actual`; send it
  again. (An earlier good copy of that same part is gone too — the status
  lists the part as missing until it is re-sent.) Without the header nothing is compared, but the `sha256` in the
  response lets the client compare.
- Part requests are exempt from the general API rate limit. The server streams
  at most `DATASET_UPLOAD_MAX_CONCURRENT_PARTS` (default 4) parts at once,
  across all uploads; one more is answered `503 UPLOAD_BUSY` with a
  `Retry-After: 2` header — wait and send the same part again.

Refusals (all before the body is read, except the last three):

| Status | `code` | Meaning |
| --- | --- | --- |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | `Content-Type` is not `application/octet-stream` |
| 411 | `LENGTH_REQUIRED` | no `Content-Length`; body has `expectedSize` |
| 400 | `PART_SIZE_MISMATCH` | `Content-Length` is not this part's exact length; body has `expectedSize` |
| 413 | `PART_SIZE_MISMATCH` | as above, and the declared length is over 64 MiB; the connection is closed |
| 400 | `INVALID_CHECKSUM` | `X-Chunk-Sha256` is not 64 hex characters |
| 404 | `NOT_FOUND` / `NO_UPLOAD` | no such dataset / it has no direct upload |
| 404 | `UNKNOWN_FILE` / `UNKNOWN_PART` | `fileId` or `partNumber` is not in the manifest |
| 409 | `UPLOAD_NOT_ACCEPTING` | the upload was finished, failed or cancelled; body has `state` |
| 503 | `UPLOAD_BUSY` | too many parts in flight; `Retry-After` header |
| 503 | `STORAGE_UNAVAILABLE` | the object store is down; retry later |
| 400 | `PART_INTERRUPTED` | the request ended before the part was complete; nothing kept |
| 422 | `CHECKSUM_MISMATCH` | bytes do not match `X-Chunk-Sha256`; nothing kept |
| 502 | `STORE_ERROR` | the store refused the part; send it again |

### 4. Finish

```
POST /api/datasets/:id/upload/finish        (no body)
```

The server asks the store whether every part of every manifest file is held
with its declared length.

**409 `UPLOAD_INCOMPLETE`** when anything is missing — the upload stays open:

```jsonc
{ "error": "1 of 7 files are not fully uploaded (64.0 MB missing). Send the missing parts, then finish again.",
  "code": "UPLOAD_INCOMPLETE",
  "missingFiles": 1, "missingBytes": 67108864,
  "missing": [ { "fileId": 5, "path": "videos/…/file-000.mp4", "missingParts": [6, 7] } ] }  // first 50 files
```

**202 Accepted** when everything is there:

```json
{ "datasetId": "2efecc18-…", "state": "processing", "status": "uploading", "message": "…" }
```

From here the server works in the background and no more parts are accepted.
A part request that was already arriving when finish was accepted — the first
copy of a part you re-sent after a timeout — is still stored and answered 200;
the server waits for it before assembling:

1. multi-part files are assembled into single files (S3
   `CompleteMultipartUpload`);
2. every file is checked to be in the store with its declared size, and every
   file that declared a `sha256` is read back and compared;
3. the dataset goes to `validating` and runs the same validation an import
   ends with: structure, episode and frame counts, robot-type widths,
   statistics, quality score;
4. the dataset ends `ready`, or `failed` with a reason.

`finish` is idempotent: called again while that runs it answers `202` with
`state: "processing"`, and after it `200` with `state: "completed"`.
`409 UPLOAD_NOT_ACCEPTING` — the upload failed or was cancelled.

### 5. Cancel

```
POST /api/datasets/:id/upload/cancel        (no body)
```

**200 OK** `{ "datasetId": "…", "status": "cancelled", "message": "…" }`

Parts being received are stopped, every open multipart upload is aborted,
every stored object (or local file) is deleted, and **the dataset itself is
deleted** — a cancelled upload leaves nothing, in the store or in the list.
Allowed while `state` is `uploading`, `failed` or `cancelling` (calling it
again after a failure midway completes it).

`409 UPLOAD_PROCESSING` — `finish` was accepted; wait for the verdict, then
delete the dataset. `409 UPLOAD_COMPLETED` — use `DELETE /api/datasets/:id`.

`DELETE /api/datasets/:id` on a dataset whose upload is still open does the
same cleanup first, and on a finished uploaded dataset removes all its
objects, as it does for an imported one.

## Following the dataset to its verdict

Poll `GET /api/datasets/:id/upload` (or `GET /api/datasets/:id`) every second
or two after `finish`:

| upload `state` | dataset `status` | Meaning |
| --- | --- | --- |
| `uploading` | `uploading` | parts are being accepted |
| `processing` | `uploading` | finish accepted; assembling and verifying |
| `completed` | `validating` | handed to validation |
| `completed` | `ready` | **done** — the dataset is valid and usable |
| `completed` | `failed` | validation rejected it; `GET /api/datasets/:id` carries the report under `validation.report` |
| `failed` | `failed` | assembling or verifying failed; `importError.error` says why (for example a sha256 mismatch naming the file) |

A failed dataset keeps its files so the report can be read; remove it with
`DELETE /api/datasets/:id`.

The upload also reports on the surfaces a Hugging Face import uses:

- `GET /api/datasets/:id/import/log` — the activity lines (`Upload of "…"
  started`, `Received <file>`, `Assembled …`, `Validation passed`, `Upload
  finished`) and the last progress frame. Held in memory: after a server
  restart `retained` is `false`.
- WebSocket events `dataset:created`, `dataset:import:progress` (`status:
  "uploading"`, `phase: "uploading" | "storing" | "validating"`, `progress`
  0–100, `downloadedBytes` = bytes received, `totalBytes`, `completedFiles`,
  `totalFiles`), `dataset:import:log`, `dataset:import:completed`,
  `dataset:import:failed`, `dataset:validation:*`, and `dataset:deleted` after
  a cancel.

## Resuming

Keep the `datasetId`. After any interruption — the client crashed, the network
dropped, the server restarted:

1. `GET /api/datasets/:id/upload`
2. for every file, send each part number in `1..partCount` that is not in
   `receivedParts`, using the `chunkSize` from that response;
3. `POST …/finish`.

A part that was in flight when the connection died was not kept and shows as
missing. Nothing has to be re-sent that the status reports as received. An
upload that receives no part for `idleTimeoutSeconds` (6 hours by default) is
removed like a cancelled one; any received part pushes `expiresAt` out again.

## Errors

Every refusal is JSON:

```json
{ "error": "<a sentence a person can act on>", "code": "<STABLE_CODE>", "…context fields…": "…" }
```

Branch on `code` (or the status), never on the sentence. Besides the codes
listed per endpoint: `401`/`403` from authentication, `429` from the general
rate limit on the non-part endpoints (100 requests a minute per client in
production), and `500 UPLOAD_ERROR` for an unexpected server fault (retry;
nothing is half-applied).

Worth retrying with a pause: `429`, `502 STORE_ERROR`, `503 UPLOAD_BUSY`,
`503 STORAGE_UNAVAILABLE`, `400 PART_INTERRUPTED`, `422 CHECKSUM_MISMATCH`
(re-read the bytes), and any network error on a part.

## Limits and configuration

Server environment variables (all optional):

| Variable | Default | Meaning |
| --- | --- | --- |
| `DATASET_UPLOAD_CHUNK_BYTES` | `33554432` (32 MiB) | Bytes per part, and the largest part accepted. Clamped to 5 MiB – 64 MiB. A client may ask for a smaller one (≥ 5 MiB) at start, never a larger. |
| `DATASET_UPLOAD_MAX_BYTES` | `10737418240` (10 GiB) | The most one upload may declare (`413 UPLOAD_TOO_LARGE`). |
| `DATASET_UPLOAD_MAX_FILES` | `20000` | Files per upload (`413 TOO_MANY_FILES`). |
| `DATASET_UPLOAD_STORE_CAPACITY_BYTES` | unset | Total size of the object store. S3 does not report free space; with this set, an upload larger than capacity minus what the buckets hold is refused at start (`507 INSUFFICIENT_STORAGE`). On local disk the free space of the volume is always checked. |
| `DATASET_UPLOAD_IDLE_MINUTES` | `360` | An upload with no part for this long is removed. Checked every 5 minutes. |
| `DATASET_UPLOAD_MAX_CONCURRENT_PARTS` | `4` | Parts streamed at once (`503 UPLOAD_BUSY` beyond). |
| `DATASET_UPLOAD_DIR` | `server/data/uploaded-datasets` | Where datasets go on a server **without** RustFS. |

A single file may have at most 10,000 parts (320 GiB at the default part size).

**Slow links.** One part has to arrive within the proxy's request timeout. At
100 s that needs about 2.7 Mbit/s of uplink for a 32 MiB part; on a slower
link, ask for a smaller `chunkSize` at start (5 MiB needs about 0.42 Mbit/s).

**Where the bytes go.** With RustFS configured, into the `training-datasets`
bucket under a fresh `<uuid>/` prefix, which becomes the dataset's
`storagePath` — the layout an import writes. While RustFS is configured but
unreachable, start answers `503 STORAGE_UNAVAILABLE`; the server never falls
back to its own disk. Without RustFS (local development), into
`DATASET_UPLOAD_DIR/<uuid>/`; a v3.0 dataset stored this way needs the curation
Python environment to be browsed (see `CLAUDE.md`), which is why a deployment
uses RustFS.

## What the server guarantees

- **Bounded memory.** A part is piped to the store as it is read; the server
  never holds a part, let alone a file, in memory. Back-pressure from the store
  slows the client's socket.
- **Nothing outside the dataset.** Paths are validated at start and parts are
  addressed by file id, so no later request carries a path at all.
- **No leaked storage.** Cancel, delete, and the idle reaper abort every open
  multipart upload and delete every object. The stale-multipart sweep leaves
  the uploads of running sessions alone, however old.
- **Restart-safe.** The session is a database row and the received parts are
  read from the store. An upload continues after a server restart; one that
  was between `finish` and validation is taken up again at startup.

## The older archive upload

`POST /api/datasets` (without `storagePath`) followed by
`POST /api/datasets/:id/upload/initiate` and `…/upload/complete` still exists
and is unchanged: it hands out a presigned PUT URL for one archive, which the
server then unpacks onto its own disk. It only works where the client can
reach the object store's own address and is what the app's upload dialog
uses today. A dataset that a direct upload is filling refuses those two calls
with `409`.
