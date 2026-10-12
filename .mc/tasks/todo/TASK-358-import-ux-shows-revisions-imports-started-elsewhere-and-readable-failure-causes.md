---
id: "TASK-358"
aliases: ["TASK-358"]
title: "Import UX shows revisions, imports started elsewhere and readable failure causes"
slug: "import-ux-shows-revisions-imports-started-elsewhere-and-readable-failure-causes"
status: "review"
priority: 2
owner: "claude"
projects: []
customers: []
tags: ["core", "datasets", "ux"]
sprint: ""
parent: ""
depends_on: []
spe: 5
effort: "medium"
due_date: ""
created: "2026-10-12"
updated: "2026-10-12"
---

# Import UX shows revisions, imports started elsewhere and readable failure causes

## Description

The system test of the production chart on k3d (`scripts/e2e-k3d/run.sh`, origin/main
31f1853c) walked the Hugging Face import flow end to end. Imports, the top-bar panel, retry
and the robot-type change all work, but the UI hides what an operator needs to tell imports
apart and to understand a failure: the revision of a pasted `/tree/v2.1` link is dropped, two
imports of one repo look identical, imports started over the API or in another tab never
reach the panel, and a storage outage reads as a long `File data/…parquet: write to rustfs
failed after 3 attempt(s): connect ECONNREFUSED …` whose cause is truncated away.

## Details

**Current state:** the import is started from
`app/src/features/training/components/HFDatasetBrowserModal.tsx` and followed by
`app/src/features/training/store/importJobsStore.ts` (fed by
`app/src/features/training/hooks/useImportJobsFeed.ts`, mounted in the layout) and the
top-bar `app/src/features/training/components/ImportActivity.tsx`. The dataset table is
`DatasetList.tsx` with `datasets/DatasetNameCell.tsx`; the dataset page is
`pages/DatasetEpisodesPage.tsx` with `datasets/DatasetExpectationsPanel.tsx`. The server's
`GET /api/datasets/:id/import/log` (`server/src/routes/datasets.routes.ts`) backfills the
panel; `server/src/services/lerobot/validateDataset.ts` writes the validation warnings.

### Frontend

1. **Revision from the link.** Parse `/tree/<rev>`, `/blob/<rev>/…` (and `/resolve/<rev>`)
   out of a pasted Hub URL, percent-decoded, into the Revision field; the hint shows
   `Repo: <repo>@<rev>`. One pure helper, `parseHubReference`, in
   `components/datasets/importFormat.ts`.
2. **Imports started elsewhere.** The store gains `discover()`: `GET
   /api/datasets?status=importing,validating`, following each Hub import quietly. The feed
   hook runs it on load and whenever the tab becomes visible. Dismissed imports are
   remembered (`dismissedIds`, bounded to 50, persisted) so a row a restart orphaned does not
   come back on every load; starting it again clears that.
3. **Revision and version everywhere.** `ImportJob` carries `revision` and `lerobotVersion`
   (from the modal's preview, the dataset row, or the log backfill). The panel shows
   `repo@<8-char sha>` and `LeRobot vX`; the dataset table's origin line reads
   `repo@sha · LeRobot vX`; the episodes page header shows both. The preview step says
   `Already imported at <rev>` when the repo is already here (and whether it is the same
   commit).
4. **Cause first.** `describeImportFailure` turns the server's transfer error into a
   headline — `Storage unreachable (ECONNREFUSED)`, `Hugging Face unreachable (ENOTFOUND)`,
   `Hugging Face refused access (HTTP 401)` — with the full sentence, file name included, in
   the tooltip. Used by the panel, the failure toast and the dataset table.
5. **One toast per import.** "Import running in the background" and the outcome share an id
   (`importToastId`), so the outcome replaces the stale toast in place.
6. **Expectations panel.** When the dataset is ready, the verdict passed and both widths
   match the robot type, the panel collapses to one line ("Matches <type> — state N, action
   N") with a button that opens the full panel.
7. **Polish.** The panel's log times and the expectations history use the shared
   `formatDateTime`; the status cell is `w-28` below `sm` so the table fits at 400 px.

### Server

- `GET /api/datasets/:id/import/log` also returns `sourceRevision` and `lerobotVersion`.
- `validateDataset` collects the camera files a metadata-only import did not fetch and emits
  ONE `VIDEO_NOT_IMPORTED` warning with a count (`N camera files (<first> and N-1 more) were
  not fetched: … importMode 'metadata' …`) instead of one per mp4.

### Key files

- `app/src/features/training/components/datasets/importFormat.ts` (new)
- `app/src/features/training/components/HFDatasetBrowserModal.tsx`
- `app/src/features/training/store/importJobsStore.ts`
- `app/src/features/training/hooks/useImportJobsFeed.ts`
- `app/src/features/training/components/ImportActivity.tsx`
- `app/src/features/training/components/DatasetList.tsx`
- `app/src/features/training/components/datasets/DatasetNameCell.tsx`
- `app/src/features/training/components/datasets/DatasetExpectationsPanel.tsx`
- `app/src/features/training/pages/DatasetEpisodesPage.tsx`, `pages/DatasetsPage.tsx`
- `app/src/features/training/types/training.types.ts`
- `server/src/routes/datasets.routes.ts`, `server/src/types/dataset.types.ts`
- `server/src/services/lerobot/validateDataset.ts`

## Acceptance Criteria

- [ ] Pasting `https://huggingface.co/datasets/lerobot/xarm_lift_medium/tree/v2.1` fills
      Revision with `v2.1` and shows `Repo: lerobot/xarm_lift_medium@v2.1`; the preview is
      requested at `v2.1`.
- [ ] An import started over the API appears in the top-bar panel after a reload, without
      visiting the datasets page; a dismissed one does not come back.
- [ ] The panel, the dataset table and the episodes header show the short commit and the
      LeRobot version; the preview warns `Already imported at <rev>` for a repo already here.
- [ ] A storage failure reads `Storage unreachable (ECONNREFUSED)` in the panel, the toast
      and the table; the full message with the file name is in the tooltip.
- [ ] The "running in the background" toast is replaced in place by the outcome.
- [ ] A dataset whose verdict passes shows the expectations panel as one line that expands.
- [ ] A metadata-only v2.1 import yields one `VIDEO_NOT_IMPORTED` warning with a count.
- [ ] The dataset table does not scroll the page sideways at 400 px.

## Test Strategy

- Vitest: `importFormat.test.ts` (link parsing, short revisions, failure headlines),
  `importJobsStore.test.ts` (toast id, cause in toast, meta from backfill, dismissals),
  `useImportJobsFeed.test.ts` (discover follows API-started imports, skips dismissed),
  `ImportActivity.test.tsx`, `HFDatasetBrowserModal.test.tsx`, `DatasetList.test.tsx`,
  `DatasetExpectationsPanel.test.tsx`.
- Server vitest: `validateDataset.test.ts` (one aggregated warning),
  `datasets-hf-routes.test.ts` (log route names revision and version).
- Manual: the k3d system-test cluster (`k3d-neodem-e2e`) with the app pointed at its server.
