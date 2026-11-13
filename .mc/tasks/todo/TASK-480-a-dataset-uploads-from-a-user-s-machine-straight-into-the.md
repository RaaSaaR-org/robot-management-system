---
id: "TASK-480"
aliases: []
title: "A dataset uploads from a user's machine straight into the instance's storage"
slug: "a-dataset-uploads-from-a-user-s-machine-straight-into-the"
status: "review"              # backlog | todo | in-progress | review | done | cancelled
priority: 1                   # 1=critical, 2=high, 3=medium, 4=low
owner: "claude"
projects: []
customers: []
tags: ["datasets", "storage", "api"]
sprint: ""
parent: ""
depends_on: []
spe: 8
effort: "high"
due_date: "2026-11-16"
created: "2026-11-13"
updated: "2026-11-13"
---

# A dataset uploads from a user's machine straight into the instance's storage

## Description

A dataset has to get from a user's machine into a NeoDEM instance **without going
through Hugging Face**. The owner called this crucial for the demo on 2026-11-16: the
G1 + Dex3 bottle-sorting dataset (LeRobot v3.0, 80 episodes, 55,695 frames, two ~210 MB
videos, 446 MB) is to be put on the demo instance this way.

The upload that exists cannot do it:

- `POST /api/datasets/:id/upload/initiate` hands the client a presigned PUT URL signed
  against `RUSTFS_ENDPOINT`. On a cluster that is the in-cluster address
  (`http://neodem-rustfs:9000`) — unreachable from a browser or a CLI outside it.
- It expects **one archive**, which `completeUpload` unpacks to `DATASET_UPLOAD_DIR` on
  the server pod's ephemeral disk. A LeRobot v3.0 tree cannot be served from there: the
  server image has no python/pyarrow/ffmpeg for the v3→v2.1 view converter.

The Hugging Face importer does it right: it writes the tree file by file into the RustFS
bucket under a fresh prefix, sets `storagePath` to that prefix, and the remote readers
serve v2.1 and v3.0 natively from the bucket, video Range requests included. A directly
uploaded dataset has to end in exactly that state.

### What is built

An upload API under `/api/datasets` by which a client sends a LeRobot directory **file by
file, each file in bounded parts, through the API server**, which streams them into the
dataset store. Contract: `docs/dataset-upload.md`.

| | |
| --- | --- |
| `POST /uploads` | declare name, `info` (the parsed `meta/info.json`), optional robot type, and the file manifest; everything is checked before a byte is sent |
| `PUT /:id/upload/files/:fileId/parts/:partNumber` | one part as a raw `application/octet-stream` body, piped to the store as it is read |
| `GET /:id/upload` | which parts the **store** holds — the resume point |
| `POST /:id/upload/finish` | refuses while anything is missing; otherwise assembles, verifies and validates in the background |
| `POST /:id/upload/cancel` | aborts open multipart uploads, deletes everything written and the dataset row |

### Decisions

- **Through the server, not presigned.** The only address every client can reach is the
  API. Constraints of the live deployment (Cloudflare + Envoy: 100 MB body, ~100 s per
  request; one 1 Gi pod) shape the rest: a part is 32 MiB by default and never above
  64 MiB, and no request waits on long work.
- **Parts are addressed by file id and part number, never by path.** The manifest is
  validated once at start (relative POSIX paths, no `..`, the importer's
  `selectRepoFiles` rules); after that no request carries a path. Part `n` always covers
  the same bytes, so re-sending one is idempotent by construction.
- **The store is the record of what arrived.** S3 `ListParts` for open multipart uploads
  and the object listing for the rest (the staging directory, locally). No database
  write per chunk, nothing recorded as received that the store does not hold, and an
  upload survives a restart of the server as well as of the client. The session row
  (`DatasetUpload`, one new table) holds only the manifest, the part size, the multipart
  upload ids and the state.
- **Files larger than one part are S3 multipart uploads**, opened at start so two parts
  of one file can never each open their own; everything else is a single streamed PUT.
- **The importer's own pipeline after the bytes are stored.** The block that moves an
  import to `validating`, queues or runs validation and says how it ended was extracted
  from `HuggingFaceImportService.runImport` into `validateStoredDataset`, and both the
  import and the upload call it. The robot type is resolved by the importer's
  `resolveRobotTypeId`.
- **Robot type for the bottle dataset.** `unitree_g1_dex3` at 31/31 against the seeded
  43/43 "Unitree G1 EDU (Dex3-1)": the importer's matcher already filters by width and
  creates `unitree_g1_dex3 (action 31, state 31)` when no registered type fits, and that
  name is pinned by its tests (TASK-353). It was checked and left as it is; the upload
  reuses it, so the dataset ends `ready` rather than failing on a dimension mismatch.
- **Cancel and expiry delete the dataset row too.** A dataset nothing was ever stored for
  is not a failed dataset. Idle uploads are reaped by a timer run through
  `runInBackground` (TASK-433).
- **The stale-multipart sweep (TASK-379) learns which uploads are still running**, or it
  would abort the parts of an upload that is resumed after more than 24 hours.
- **The presigned-archive endpoints stay.** They are not dead — the app's upload dialog
  uses them. They now refuse (409) a dataset that a direct upload is filling.

Out of scope: the app. `DatasetUploadModal` still uses the archive flow; clients for the
new API (browser dialog, CLI) are written from the contract in separate tasks.

## Acceptance Criteria

- [x] `POST /api/datasets/uploads` validates the manifest up front — required LeRobot files, allowed paths only, path traversal refused, total size against `DATASET_UPLOAD_MAX_BYTES` and against free storage where the store reports it (local disk always; RustFS with `DATASET_UPLOAD_STORE_CAPACITY_BYTES`) — and rejects with a stable `code` and an actionable sentence; a refusal creates nothing
- [x] Without `robotTypeId` the robot type is matched or created as the importer does; the 31-wide bottle dataset ends `ready` and valid on `unitree_g1_dex3 (action 31, state 31)`
- [x] A part is a raw binary body, streamed to the store with back-pressure; the server enforces the part size (default 32 MiB, never above 64 MiB) and verifies `X-Chunk-Sha256` when sent, keeping nothing of a part that fails
- [x] `GET /:id/upload` reports the parts the store holds; re-sending a part is harmless; an interrupted upload continues after a client restart and after a server restart
- [x] `POST /:id/upload/finish` answers 409 with the missing parts while incomplete; otherwise answers at once, assembles multipart files, verifies sizes and declared sha256s, then runs the importer's validation; the dataset's status is observable by polling and ends `ready` or `failed` with a readable reason
- [x] Progress and log lines go to the import activity log and the `dataset:import:*` events, so `GET /:id/import/log` works for an upload
- [x] Cancel aborts multipart uploads and deletes everything written; uploads idle beyond `DATASET_UPLOAD_IDLE_MINUTES` are reaped the same way
- [x] Deleting an uploaded dataset removes its objects; deleting one whose upload is still open also aborts its multipart uploads
- [x] Without RustFS the same API writes to the local dataset directory
- [x] Tenant scoping and permission as for creating a dataset: every call resolves the Dataset row through the tenant-scoped repository first; a viewer is refused on all four write routes
- [x] The presigned-archive endpoints still work and refuse a dataset a direct upload is filling
- [x] Contract documented in `docs/dataset-upload.md` and referenced from the README
- [x] End to end against a real RustFS with the real bottle dataset (see Notes)

## Notes

### End-to-end run (2026-11-13)

Throwaway `rustfs/rustfs:1.0.0` in docker, the built server (`node --max-old-space-size=768
dist/index.js`, `NODE_ENV=production`, so the 100-a-minute rate limit was on), SQLite,
NATS unreachable (validation in-process), a throwaway Node client with 32 MiB parts and
per-part plus per-file sha256, `/mnt/data/rms-demo/g1-dex3-bottle-sorting-sim`
(7 files accepted, `README.md` ignored, 446,100,758 bytes, 19 parts).

- Interrupted after 9 parts with the connection cut halfway through the 10th; the cut
  part was not kept (status: 5 files + parts 1–4 of the head video, 2 multipart uploads
  open). The **server was then restarted as well**; status read the same from the store.
  The client resumed with the 10 missing parts and finished.
- Dataset `ready`, `validation.valid: true`, no errors or warnings, LeRobot v3.0,
  80 episodes / 55,695 frames (episode list: 80 entries summing to 55,695 frames),
  observed state/action width 31/31, quality score 85, stats present.
- Frames for episodes 0, 40 and 79: 200 with 830 / 818 / 609 frames.
- Video Range requests for both cameras, episodes 0 and 79: `206` with the right
  `Content-Range` against 208,492,163 and 215,778,466 bytes.
- Bucket after finish: exactly 7 objects, 446,100,758 bytes, 0 pending multipart uploads.
  After `DELETE /api/datasets/:id`: 0 objects, 0 pending multipart uploads.
- Cancel mid-upload (14 of 19 parts sent): before 5 objects + 2 pending multipart
  uploads, after 0 + 0; dataset and upload answer 404. `DELETE` mid-upload: the same.
- Against real RustFS also: a part with a wrong `X-Chunk-Sha256` is answered 422 and
  not listed afterwards (multipart part and single object); wrong length 400; JSON
  content type 415; chunked body 411; finish while incomplete 409 with the missing
  parts; six parts sent at once → four stored, two answered 503 with `Retry-After: 2`.
- **Memory (RSS of the server process):** 205 MB idle after start; 261 MB peak during the
  interrupted half; 305 MB peak for the resumed half including the sha256 read-back of
  all 446 MB and validation. Thirteen further full uploads in one process (5.8 GB, at
  ~300 MB/s over loopback) plateaued at 389 MB with a peak of 416 MB — no growth after
  the fourth.
- **Without RustFS** (same script, `DATASET_UPLOAD_DIR` in scratch): interrupted and
  resumed the same way, dataset `ready` and valid with 80 / 55,695, parts staged outside
  the tree and gone after finish, cancel and delete leave no file. Browsing the episodes
  of a locally stored **v3.0** dataset answers 503 `DEPS_MISSING` on a machine without
  the curation Python environment — the existing local-view limitation, and the reason
  a deployment stores in RustFS.

### Gates

Server typecheck, vitest (full suite) and build; the Prisma migration replayed onto a
clean Postgres 16 with `prisma migrate diff --exit-code` reporting no drift. The app is
not touched.
