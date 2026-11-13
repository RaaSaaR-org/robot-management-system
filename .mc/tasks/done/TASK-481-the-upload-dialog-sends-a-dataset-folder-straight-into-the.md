---
id: "TASK-481"
aliases: []
title: "The Upload dialog sends a dataset folder straight into the instance's storage"
slug: "the-upload-dialog-sends-a-dataset-folder-straight-into-the"
status: "done"                # backlog | todo | in-progress | review | done | cancelled
priority: 1                   # 1=critical, 2=high, 3=medium, 4=low
owner: "claude"
projects: []
customers: []
tags: ["datasets", "storage", "app", "core"]
sprint: ""
parent: ""
depends_on: ["[[TASK-480]]"]
spe: 8
effort: "high"
due_date: "2026-11-16"
created: "2026-11-13"
updated: "2026-11-13"
---

# The Upload dialog sends a dataset folder straight into the instance's storage

## Description

On the Datasets page, **New dataset → Upload files** opens `DatasetUploadModal`, which
still uses the presigned-archive flow: it creates a row, asks for a presigned PUT URL
signed against the object store's own address and PUTs one `.tar.gz`/`.zip` there. On the
hosted instance that address is in-cluster, so the dialog cannot work — and it is the
only way for a user without the CLI to get the G1 + Dex3 bottle-sorting dataset onto the
instance for the demo on 2026-11-16.

TASK-480 merged the direct upload API (`docs/dataset-upload.md` is its contract). This
task makes the dialog a client of it: pick a LeRobot dataset **folder**, see what is in
it, send it file by file in bounded parts through the API, and end on the dataset's row
going through validation to ready.

## Details

### Current state

- `app/src/features/training/components/DatasetUploadModal.tsx` — four-step wizard
  (details → archive file → validating → result) on `trainingApi.createDataset`,
  `initiateUpload`, `completeUpload` and an XHR PUT to the presigned URL.
- `app/src/features/training/api/trainingApi.ts` — `initiateUpload`, `completeUpload`.
- `app/src/features/training/store/trainingStore.ts` — `initiateUpload`,
  `completeUpload`, `uploadProgress`, `uploadError`: used by nothing but their own tests.
- `app/src/features/training/components/DatasetList.tsx` — a dataset in `uploading` shows
  a bare status tag.
- In `VITE_DEMO_MODE` the Datasets page renders `DemoFeaturePlaceholder`, so the dialog
  cannot be reached in the demo build and no MSW handler answers an upload route.

### Decisions

- **A folder, not an archive.** `<input type="file" webkitdirectory>` and drag-and-drop of
  a folder (`DataTransferItem.webkitGetAsEntry`, `readEntries` until empty) — both exist
  in Chrome, Edge, Firefox and Safari. The dataset root is wherever `meta/info.json`
  sits, so picking the folder itself or its parent both work.
- **Only what the server stores is declared.** The manifest lists `meta/**`,
  `data/**/*.parquet`, `videos/**/*.mp4`, `images/**`; everything else (a `README.md`, a
  `.DS_Store`) is counted as "not uploaded" in the dialog and never sent, so a stray file
  with an odd name cannot get the whole start refused with `INVALID_PATH`.
- **Checked before a byte is sent.** `meta/info.json` is read in the browser: version,
  robot, episodes, frames, fps, cameras, state/action widths, size. The server's own
  start rules are applied client-side (`info.json` present and valid, `v2.*`/`v3.*`, at
  least one data parquet, the episode index for the version) and a folder that fails one
  says which and cannot be uploaded. Declared cameras without video files is a warning:
  the upload is tables-only.
- **8 MiB parts, 3 in parallel.** The dialog asks for `chunkSize: 8 MiB` (the server
  allows smaller than its 32 MiB, never below 5 MiB): one part then crosses a 100 s proxy
  timeout at 0.7 Mbit/s, and three parts in flight hold 24 MiB — each part is
  `File.slice`d, read once, hashed (`X-Chunk-Sha256`, when the page is a secure context)
  and sent as that same buffer.
- **Retries follow the contract's list, as the reference client (`rmsctl`) reads it.**
  `503 UPLOAD_BUSY` waits `Retry-After` and does not count as a failure; `429`,
  `502 STORE_ERROR`, `503 STORAGE_UNAVAILABLE`, `400 PART_INTERRUPTED`,
  `422 CHECKSUM_MISMATCH`, `500 UPLOAD_ERROR`, a proxy's 5xx and a network error on a part
  are re-sent with exponential backoff (1 s doubling, capped at 30 s, never shorter than
  `Retry-After`), six attempts per part; everything else stops the upload at once and
  aborts the parts in flight. `start` is never re-sent after a network error (it may have
  created the dataset). `finish` answering `409 UPLOAD_INCOMPLETE` sends what it lists
  and finishes again (three rounds).
- **A failed upload is resumed, not restarted.** "Try again" asks the server what it
  holds (`GET /:id/upload`) and sends only the missing parts.
- **Closing the dialog does not stop the upload.** It runs in a store outside the dialog.
  The dialog says so, the close button reads "Continue in background", the top bar shows
  a chip with the percentage that reopens the dialog from any page, the dataset's row
  shows the same bar, and leaving the tab asks first. Stopping is its own button
  ("Cancel upload", confirmed) and calls the server's cancel, which deletes everything.
  One upload at a time.
- **It ends on the row.** When `finish` is accepted the dialog closes; the row shows
  "Verifying" and "Validating" and then ready, and a toast says how it ended.
- **Robot type optional.** As in the import dialog the select defaults to auto-detect,
  which is what gets the 31-wide bottle dataset its own type instead of a dimension
  mismatch.
- **The archive endpoints stay on the server**; the app code that called them goes.

### Frontend

- `app/src/features/training/upload/lerobotFolder.ts` — files from an input or a drop,
  the dataset root, the manifest, the summary and the problems.
- `app/src/features/training/upload/uploadEngine.ts` — retry classes, backoff, the part
  plan, the parallel sender.
- `app/src/features/training/api/datasetUploadApi.ts` — start, status, part (XHR, for
  upload progress), finish, cancel; refusals as `UploadRefusal` with code and context.
- `app/src/features/training/store/datasetUploadStore.ts` — the one running upload:
  progress per file and overall, rate, ETA, error, resume, cancel, the verdict poll.
- `app/src/features/training/components/DatasetUploadModal.tsx` — rewritten.
- `app/src/features/training/components/UploadActivity.tsx` — the top-bar chip.
- `app/src/features/training/components/DatasetList.tsx` — the row's bar.
- `app/src/features/training/pages/DatasetsPage.tsx`, `app/src/components/layout/TopBar.tsx`.
- Removed: `trainingApi.initiateUpload` / `completeUpload`, the store's `initiateUpload`
  / `completeUpload` / `uploadProgress` / `uploadError`, `UploadInitiateResponse`.
- `docs/dataset-upload.md` — the app is a client of this contract now.

### Demo build

Unchanged behaviour: the Datasets page is a placeholder there, the dialog is not
mounted, and the top-bar chip renders nothing without a running upload, so no upload
request can leave a demo page and the MSW handlers need no upload routes.

## Test Strategy

- vitest: folder inspection (root detection, manifest rules, every problem), the engine
  (classification, backoff, part ranges, at most three in flight, busy/transient/fatal,
  rollback of progress, incomplete finish), the dialog (summary before upload, wrong
  folder blocked, refusal shown with code and context, close keeps uploading, cancel).
- `npx tsc`, `npx vitest run`, `npm run build` and the `VITE_DEMO_MODE=true` build.
- Real run: server from `main` against a throwaway RustFS, the app dev server, Playwright
  uploading `/mnt/data/rms-demo/g1-dex3-bottle-sorting-sim` through the dialog to ready,
  then an episode with both camera videos playing.

## Acceptance Criteria

- [x] The dialog takes a LeRobot dataset folder through a directory picker and through drag-and-drop of a folder
- [x] Before anything is sent it shows version, episodes, frames, cameras, fps and size read from `meta/info.json`, and a folder that is not a LeRobot dataset is flagged and cannot be uploaded
- [x] Files go up in `File.slice` parts, at most three requests at once, re-sent with backoff only for the refusals the contract calls transient
- [x] Overall and per-file progress, rate and time left are shown while it runs
- [x] Cancel removes the upload on the server; closing the dialog keeps it running, visibly (dialog text, top-bar chip, the row)
- [x] After finish the dataset's row shows validation and then ready
- [x] Name, description and robot type can be set; a server refusal is shown with its sentence, code and context
- [x] The presigned-archive client code is gone from the app; the server endpoints are untouched
- [x] Demo build and its Playwright gate still pass
- [x] Real run against RustFS with the bottle dataset: ready, both camera videos play (see Notes)

## Notes

### Real run (2026-11-13)

Throwaway `rustfs/rustfs:1.0.0` in docker with a hand-made `training-datasets` bucket,
the server built from `main` (`NODE_ENV=production`, so the rate limit was on; SQLite;
NATS unreachable, validation in-process), the app dev server proxying `/api` to it, and a
Playwright script driving the dialog with
`/mnt/data/rms-demo/g1-dex3-bottle-sorting-sim`. Between the app and the server sat a TCP
proxy capping each connection at 8 MB/s, so the upload took about 20 s instead of 2 and
the progress could be looked at.

- **Folder check.** The dataset's `videos/` subfolder: "This folder cannot be uploaded —
  No meta/info.json in this folder…", Upload disabled. The dataset folder: LeRobot v3.0,
  80 episodes, 55,695 frames, 30 fps, 2 cameras (head, wrist), 425 MB (the app's binary
  units; 446,100,758 bytes), 7 files to upload, `README.md` counted as staying behind.
- **Upload.** 58 part requests of 8 MiB, never more than 3 in flight (counted from the
  browser's own request events). Overall bar, rate and time left, per-file bars. "Continue
  in background" closed the dialog; the row showed `11% · 51.0 MB / 425 MB` and the top
  bar the same percentage; the chip reopened the dialog on the running upload.
- **Verdict.** The dialog closed when finish was accepted; the row read "Verifying the
  files", then `Ready` 1.8 s later: 80 episodes, 55,695 frames, robot type
  `unitree_g1_dex3 (action 31, state 31)`, `validation.valid: true`, no errors, quality 85.
  Bucket: exactly 7 objects, 446,100,758 bytes, 0 pending multipart uploads.
- **Episode.** Opened from the row; both `<video>` elements (head, wrist; 640×480,
  `readyState` 4) advanced `currentTime` by 3.0 s in 3 s of wall time.
- **Cancel** at 122 MB of 425 MB: confirmed, the row disappeared, `GET /api/datasets`
  empty, bucket 0 objects and 0 pending multipart uploads.
- **A refusal from the real server.** Picking the seeded 43-wide "Unitree G1 EDU (Dex3-1)"
  for the 31-wide dataset: "Robot type … expects action/state 43/43; dataset declares
  31/31." with `ROBOT_DIMENSION_MISMATCH (HTTP 400)`, the form still filled in.
- **Browsers.** The whole run passed in Playwright's Firefox and Chromium. WebKit could
  not be launched on this machine (missing system libraries), so **Safari is untested**;
  the dialog uses only `webkitdirectory`, `webkitGetAsEntry`, `File.slice`,
  `XMLHttpRequest` and `crypto.subtle`, all of which Safari has. Dropping a folder is
  covered by the component test with File-and-Directory-Entries stand-ins, not by a real
  drag from a file manager.

Also looked at: the dialog at 390 px and in the light theme.

### Gates

`npx tsc`, `npx vitest run` (299 files, 3,917 tests), `npm run build`, and
`npx playwright test` — which builds with `VITE_DEMO_MODE=true` and runs the demo gate —
275 passed. No server change.

The first CI run failed three dialog tests that passed locally: CI runs the app's tests
on Node 20, where `crypto.subtle.digest` rejects a buffer from the test realm, and the
engine treated that as a network failure and went into backoff. Reproduced with Node 20
and fixed in the engine rather than the test, since both halves were wrong in a browser
too: a checksum that cannot be computed now sends the part without `X-Chunk-Sha256`
(the header is optional), and a failure that happened in the browser — a file moved or
deleted after it was picked — stops the upload at once and names the file instead of
being retried six times. The real run above was repeated on the final code (Firefox and
Chromium, same numbers); the parts carry `X-Chunk-Sha256` there.

### Review (2026-11-13)

An independent pass re-ran the dialog against a throwaway RustFS in Chromium (dark) and
Firefox (light), with the proxy killed mid-upload: the stopped state named the part and
`NETWORK_ERROR`, "Try again" sent only the missing parts (38 of 58 in one run, 2 in the
other, none stored twice), cancel left no row, no object and no pending multipart upload.
Three defects were found in `datasetUploadStore.ts` and fixed with tests:

- Deleting the dataset from its row while this tab uploaded it left a "Upload stopped"
  chip, an error toast ("Dataset not found") and a dialog offering "Try again" for a
  dataset that no longer existed. A `404 NOT_FOUND` / `NO_UPLOAD` on a part, on finish or
  on the resume's status now ends the upload ("Upload ended") instead.
- A finish that a cancel overtook was reported as a failed upload for the moment until
  the cancel answered.
- When finish was accepted just before a cancel arrived, two loops polled for the verdict.

Gates after these: `npx tsc`, `npx vitest run` and `npm run build` in `app/`; CI on the PR.

### Left for later

- An upload interrupted by closing or reloading the tab cannot be resumed from the
  browser (file handles do not survive); it stays as an `uploading` row until it is
  deleted or the server's idle timeout (6 h) removes it. Re-picking the folder to resume
  it would need the row to offer that.
- One upload at a time per tab.
