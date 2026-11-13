---
id: "TASK-496"
aliases: []
title: "A dataset's stored files can be listed and fetched byte for byte, so a dataset can be downloaded back from the instance"
slug: "a-dataset-s-stored-files-can-be-listed-and-fetched-byte-for"
status: "done"                # backlog | todo | in-progress | review | done | cancelled
priority: 2                   # 1=critical, 2=high, 3=medium, 4=low
owner: "claude"
projects: []
customers: []
tags: ["datasets", "storage", "core"]
sprint: ""
parent: ""
depends_on: []
spe: 5
effort: "medium"
due_date: "2026-11-16"
created: "2026-11-13"
updated: "2026-11-13"
---

# A dataset's stored files can be listed and fetched byte for byte, so a dataset can be downloaded back from the instance

## Description

The bottle-robot sessions push their LeRobot datasets to the instance with
`rmsctl datasets upload` to free local disk. There was no way to get one back:
the API serves episodes, frames and per-episode video windows, but nothing
lists what is stored for a dataset or hands out a stored file as it is. This
adds the two read-only endpoints `rmsctl datasets download <id>` needs —
a paginated file manifest and a raw file GET with `Range` — for datasets that
arrived by direct upload and by Hugging Face import alike, without Hugging
Face in the path.

## Details

### Current state (before this task)

- A direct upload (`services/datasetUpload/`, TASK-480) and a Hugging Face
  import (`services/HuggingFaceImportService.ts`) both store a dataset as
  `<storagePath><relative path>`: objects under a `<uuid>/` prefix of the
  `training-datasets` bucket (legacy: `datasets`), or — on a server without
  RustFS — files under `DATASET_UPLOAD_DIR/<uuid>/`. Same layout either way.
- `routes/datasets.routes.ts` reads that prefix for the episode browser
  (`rustfsDatasetStore`, the video route) but exposes no listing and no raw
  file. `GET /:id/episodes/:index/video/:camera` is the only byte stream, and
  it only resolves camera mp4 paths.
- `utils/streamResponse.ts` (`sendStream`, TASK-491) is the one way a route
  pipes a store body: it cancels the open and destroys the stream however the
  client leaves, so S3 sockets are never leaked.
- `middleware/rateLimit.ts` has a separate dataset-browsing budget
  (`RATE_LIMIT_MEDIA_MAX`) keyed on a path regex.

### Server

- `server/src/services/DatasetFilesService.ts` (new)
  - `locateDatasetFiles(dataset)` → `{storage:'rustfs', bucket, base}` or
    `{storage:'local', root}`. Refuses a view (`409 DATASET_IS_VIEW`), a
    dataset still `uploading`/`importing` (`409 DATASET_NOT_READY`), an empty
    `storagePath` or prefix with no objects (`409 NO_STORED_FILES`), RustFS
    down (`503 STORAGE_UNAVAILABLE`). A local `storagePath` is a column a
    member can fill in, so it must pass `confineToRoots(defaultDatasetRoots())`
    — the rule Hub publishing goes by — else `403 DATASET_PATH_NOT_ALLOWED`.
  - `listDatasetFiles(id, location, {after, limit})` → one page in byte order
    of path. RustFS: one `ListObjectsV2` with `StartAfter` (added to
    `ListOptions` in `storage/rustfs-client.ts`); entries not after the cursor
    are dropped, and a truncated page that advances nothing is a `502
    STORE_ERROR` rather than a loop. Local: walk of regular files, symlinks
    neither listed nor followed. Each entry: `path`, `size`, `etag` (object
    store only), `sha256` when the dataset's completed `DatasetUpload` session
    declared one (the server verified those at finish).
  - `statDatasetFile(location, path)` → `{size, etag?, open(range, signal)}`;
    `404 FILE_NOT_FOUND`. Local files are resolved with `realpath` and must be
    a regular file inside the root with no symlink on the way.
  - `checkFilePath` reuses the upload's `unsafePathReason`.
- `server/src/routes/dataset-files.routes.ts` (new), mounted on
  `/api/datasets` behind `protect`, ahead of the main dataset router
  (`server/src/app.ts`):
  - `GET /:id/files?limit=&after=` → `{datasetId, storage, limit, files, nextCursor}`
  - `GET|HEAD /:id/files/content?path=` → `application/octet-stream`,
    `Accept-Ranges`, `ETag`, `200` / `206` + `Content-Range` / `416
    RANGE_NOT_SATISFIABLE`. The body goes through `sendStream`; a store
    timeout is `503 STORAGE_TIMEOUT` with `Retry-After`, a stream that fails
    before its first byte `502 STORE_ERROR`. Never a presigned redirect.
- `server/src/middleware/rateLimit.ts`: `/files` and `/files/content` join the
  dataset-browsing budget.

### rmsctl (separate repo, RaaSaaR-org/rmsctl)

`rmsctl datasets download <dataset-id> [--out <dir>]` is the client: bounded
parallel files (default 4), `.rmsctl-part` files renamed once size (and
SHA-256, when listed) match, `--resume` / `--force` for a non-empty directory,
`Range` continuation after a dropped connection, non-zero exit on any failure.

### Key files

- `server/src/services/DatasetFilesService.ts` (new)
- `server/src/routes/dataset-files.routes.ts` (new)
- `server/src/routes/__tests__/dataset-files-routes.test.ts` (new)
- `server/src/app.ts`, `server/src/middleware/rateLimit.ts`,
  `server/src/middleware/__tests__/rateLimit.test.ts`,
  `server/src/storage/rustfs-client.ts`
- `docs/dataset-download.md` (new — the contract), `docs/dataset-upload.md`,
  `docs/api.md`, `docs/deployment.md`, `docs/README.md`, `README.md`,
  `CLAUDE.md`, `server/AGENTS.md`

## Acceptance Criteria

- [x] `GET /api/datasets/:id/files` lists every stored file of a dataset with
      its relative path and size, paginated by cursor, each file exactly once.
- [x] `GET /api/datasets/:id/files/content?path=` serves the file's bytes;
      `Range` answers `206` with the right `Content-Range`, an out-of-bounds
      range `416`, `HEAD` opens nothing.
- [x] Works for a directly uploaded dataset and for a Hugging Face import (in
      RustFS), and for a dataset in the local dataset directory.
- [x] A client that leaves before the store answered or mid-file has its store
      stream cancelled and destroyed.
- [x] A path cannot leave the dataset: `..`, absolute paths, symlinks out of a
      local dataset and local directories outside the dataset roots are refused.
- [x] Both endpoints count against the dataset-browsing rate-limit budget.
- [x] Documented in `docs/dataset-download.md` and `docs/api.md`.

## Test Strategy

- `server/src/routes/__tests__/dataset-files-routes.test.ts` — 38 cases against
  a mocked store and a real temp directory: listing (uploaded, imported, legacy
  bucket, paging, a store that ignores `StartAfter`), refusals, whole file /
  range / 416 / HEAD / empty file, stream failure and timeout, the two
  client-drop orderings on a real HTTP server, local symlink and root
  confinement.
- `server/src/middleware/__tests__/rateLimit.test.ts` — the new paths are
  dataset browsing; `/files/other` is not.
- End to end, local server built from this branch + throwaway
  `rustfs/rustfs:1.0.0`, with `rmsctl` from RaaSaaR-org/rmsctl
  `feat/datasets-download`:
  - `g1-dex3-bottle-sorting-sim` (v3.0, 8 files, 446.1 MB, two ~210 MB mp4s):
    `rmsctl datasets upload` → `rmsctl datasets download` → `diff -r` against
    the source: identical (only the source's `README.md`, which an upload never
    sends, is not in the copy). SHA-256 of all 8 files verified.
  - the same download killed with SIGKILL while both videos were partly on
    disk, then `--resume`: 311.2 MB of 446.1 MB fetched, `diff -r` identical.
  - `lerobot/pusht` imported from Hugging Face (`includeVideos: true`, 6 files,
    7.7 MB) → `rmsctl datasets download` → `diff -r` against the same files
    fetched from the Hub at the imported revision: identical.
  - server without RustFS (`DATASET_UPLOAD_DIR`): a 7-file, 43.9 MB tables-only
    dataset uploaded and downloaded, `diff -r` identical.

## Notes

- Not deployed: the demo instance (build `sha-19da473`) does not have these
  routes until its image is bumped; `rmsctl datasets download` says so there
  ("this server has no dataset download API").
- `etag` is passed through as the store reports it (an MD5 only for objects
  stored in one piece); clients compare it, never compute it.
- A dataset imported in metadata-only mode lists only what was stored — its
  videos stay on the Hub and are not proxied by these routes.
