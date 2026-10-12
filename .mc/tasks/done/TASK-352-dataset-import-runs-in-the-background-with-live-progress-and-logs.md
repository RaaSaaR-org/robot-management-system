---
id: "TASK-352"
aliases: ["TASK-352"]
title: "Dataset import runs in the background with live progress and logs"
slug: "dataset-import-runs-in-the-background-with-live-progress-and-logs"
status: "done"
priority: 2
owner: "huhn511"
projects: []
customers: []
tags: ["core", "datasets"]
sprint: ""
parent: ""
depends_on: []
spe: 5
effort: "medium"
due_date: ""
created: "2026-10-12"
updated: "2026-10-12"
---

# Dataset import runs in the background with live progress and logs

## Description

Importing a dataset from the Hugging Face Hub shows almost nothing in the
browser while it runs, and the import modal refuses Escape and the backdrop
until it finishes, so it blocks the whole view. The import should run in the
background — the operator closes the dialog and keeps working — with its
progress, a live log and a clear final success or error (with the reason)
visible from anywhere in the app.

## Details

### Current state

- `server/src/services/HuggingFaceImportService.ts` already runs the download
  detached: `importDataset` pins the revision, reads `info.json`, prepares the
  sink (503 on an unusable sink, #371), creates the row and returns the id
  while `runImport` continues. It emits `dataset:import:progress | completed |
  failed` on `datasetService`, which `server/src/websocket/index.ts` broadcasts.
  There is no log: only a percent and a file name, and nothing a page that
  attaches late can read back.
- `app/src/features/training/components/HFDatasetBrowserModal.tsx` opens its
  own WebSocket, shows a spinner + progress bar, and traps the operator in the
  modal while the import runs.

### Server

- `server/src/services/ImportActivityLog.ts` (new): in-memory, bounded ring of
  log lines (and the last progress frame) per dataset. Every line is broadcast
  as `dataset:import:log`. Held in memory on purpose: the row already persists
  status and `importError`; the log is lost on restart, and the route says so.
- `HuggingFaceImportService` writes log lines at each stage: revision pinned,
  info.json read, storage prepared, file list, each downloaded file, validation
  queued/run, finished, failed (phase + reason). Retry starts a fresh log.
- `GET /api/datasets/:id/import/log` returns `{ datasetId, status,
  importError, progress, lines, retained }` so a page that attaches late (or
  after a reload) backfills.
- The 503-on-unusable-sink refusal stays synchronous, before any job starts.

### Frontend

- `app/src/features/training/store/importJobsStore.ts` (new, Zustand + immer):
  tracked imports with status, phase, percent, current file, log lines, error.
- `app/src/features/training/hooks/useImportJobsFeed.ts` (new): one socket,
  mounted in the layout, open only while an import is active; backfills from
  the log route on (re)connect and polls it as a fallback; toasts the end.
- `app/src/features/training/components/ImportActivity.tsx` (new): top-bar
  button with a running count, opening a panel with progress, phase, the live
  log and the final reason.
- The HF modal closes right after the POST returns and hands the job to the
  tracker; Retry import and the dataset menu open the same panel.

### Key files

- `server/src/services/ImportActivityLog.ts`
- `server/src/services/HuggingFaceImportService.ts`
- `server/src/routes/datasets.routes.ts`
- `server/src/types/dataset.types.ts`, `server/src/websocket/index.ts`
- `app/src/features/training/store/importJobsStore.ts`
- `app/src/features/training/hooks/useImportJobsFeed.ts`
- `app/src/features/training/components/ImportActivity.tsx`
- `app/src/features/training/components/HFDatasetBrowserModal.tsx`
- `app/src/components/layout/TopBar.tsx`, `AppLayout.tsx`

## Acceptance Criteria

- [x] Starting an HF import closes the dialog at once; the operator can navigate away and keep working.
- [x] A top-bar indicator shows running imports; its panel shows phase, percent and live log lines.
- [x] The end is unmistakable: success, or failure with the phase and the reason.
- [x] A page that attaches late or reloads backfills the log and status from the server.
- [x] An unusable sink is still refused synchronously with 503 (#371).
- [x] Server vitest covers the log lifecycle (progress, success, failure with reason); app vitest covers the store and the panel.

GitHub #370 (reliable download progress), folded into this task:

- [x] A progress bar on the dataset row and in the import panel while a Hub import runs.
- [x] Distinct phases: reading metadata, downloading, validating — "downloaded" is not "valid"; the job stays running until the row is `ready` or `failed`, also with NATS.
- [x] Byte-based download progress (downloaded / total selected bytes) with a file-count fallback when the Hub does not size every file; counts beside the bar.
- [x] `GET /api/datasets/:id/progress` reports a running import's frame (it said `progress: 0` for the whole download); progress survives a reload, a reconnect and events that fired before the browser subscribed.
- [x] Indeterminate bar where nothing can be measured (metadata, validating, a frame a restart lost) — no fake 0 % or 100 %.
- [x] On failure the bar stops where it was, the persisted reason shows, and the panel offers Retry import.
- [x] A dropped connection mid-download (undici `terminated`) or a 5xx is retried per file with backoff instead of failing the import.

## Test Strategy

- Server vitest: `ImportActivityLog` ring bound and eviction; `HuggingFaceImportService` writes lines through success and failure; the log route.
- App vitest: `importJobsStore` event handling and backfill; `ImportActivity` panel rendering; the modal hands off and closes.
- #370 — server vitest (`HuggingFaceImportService.progress.test.ts`, the `/progress` route): multi-file metadata-only vs full import in bytes, file-count fallback, success, mid-download failure that keeps where the bar stopped, a `terminated` body retried and one that gives up. App vitest: reload mid-import restores phase/bytes/lines; NATS completion keeps the feed open through validation; server restart fails the job; `ImportProgress` and the list cell (indeterminate vs measured, frozen failed bar, Retry).
- Manual / E2E: import a small Hub dataset, close the dialog, watch the top-bar panel.

## Notes

- The log ring is in memory: after a server restart the status and failure reason survive (they are on the row), the lines do not (`retained: false`).
- `DatasetUploadModal` (file upload) is a separate flow and is out of scope.
- A validation that fails after an otherwise clean download used to be announced as `dataset:import:completed`; it is now `dataset:import:failed` (no-NATS path), and the app also turns a later `dataset:validation:failed` into a failed import (NATS path).
- #370 root cause of `progress: 0`: `GET /:id/progress` only read validation progress (`getUploadProgress`) and otherwise fell back to the row (`ready ? 100 : 0`); the import frames lived only on the socket and in `ImportActivityLog`. The route now answers with the import frame first.
- After a server restart an `importing` row has no process behind it; the app now fails such a job ("retry the import") rather than polling for ever. A `validating` one keeps waiting, since a NATS worker may still answer.
- Verified 2026-10-12 against a live server (SQLite, no NATS/RustFS): lerobot/svla_so101_pickplace and lerobot/svla_so100_pickplace (metadata only) imported in the background; the modal closed at once, the top-bar panel showed the 13-line log, and the log reloaded from `GET /import/log` after a page reload. 400 px width checked.
