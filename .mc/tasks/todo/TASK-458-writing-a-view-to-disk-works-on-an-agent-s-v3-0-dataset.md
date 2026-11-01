---
id: "TASK-458"
aliases: []
title: "Writing a view to disk works on an agent's v3.0 dataset"
slug: "writing-a-view-to-disk-works-on-an-agent-s-v3-0-dataset"
status: "todo"                # backlog | todo | in-progress | review | done | cancelled
priority: 3                   # 1=critical, 2=high, 3=medium, 4=low
owner: "claude"
projects: []
customers: []
tags: [core]
sprint: ""
parent: ""
depends_on: []
spe: 3
effort: "medium"
due_date: ""
created: "2026-10-31"
updated: "2026-10-31"
---

# Writing a view to disk works on an agent's v3.0 dataset

## Description

A View of an agent-recorded dataset (for example, the takes minus the bad
ones) fails to materialize ("write to disk") with the opaque error
`'chunk_index'`. `DatasetViewService.materialize` hands the raw v3.0 tree to
`curate.py`'s v2.1 reader. Trim and delete on the dataset page already go
through `resolveLocalView`, which converts a v3.0 tree to a readable v2.1 view.
This task makes materialize resolve its root the same way, and makes a layout
`curate.py` cannot read fail with a clear code instead of a Python `KeyError`.

Branch: `fix/task-458-writing-a-view-to-disk-works-on-an-agent-s-v3-0-dataset`.

## Details

### Current state

Checked on `main` at `a600c27e`.

- `server/src/services/DatasetViewService.ts`:
  - `:422-445`, `materialize(datasetId, outputPath, options)`: the backend is
    `options?.backend ?? 'native'` (`:442`);
  - `:508-527`: delete and trim steps run
    `episodeCurationService.deleteEpisodes` and `trimEpisode` with that backend;
  - `:533`: the first step's source is `root.storagePath`, the root dataset's
    directory as it is, a v3.0 tree for every agent dataset;
  - `:500-505`: the `lerobot` backend refuses trims (`V3_TRIM_UNSUPPORTED`).
- `server/src/services/DatasetCurationService.ts:284-330`, `resolveSource` /
  `viewOf`, is the model: `resolveLocalView(dir)`
  (`server/src/services/lerobot/LocalDatasetView.ts:227`) converts a v3.0 tree
  to a cached v2.1 view and returns `{ root, sourceVersion, converted }`.
  `NOT_A_DATASET` passes the directory through; any other `DatasetViewError`
  becomes a `CurationError` with the reason.
- `app/src/features/training/api/datasetViewsApi.ts:63-71`, `materializeView`:
  never passes a backend (and already sets `timeout: 0`).
- `server/src/services/EpisodeCurationService.ts:147-170`, `run`: a failed
  `curate.py` becomes `curate.py failed: <error>`. For a v3.0 tree the error is
  `'chunk_index'`, a `KeyError` text.
- `CURATION_LEROBOT_PYTHON` is commented out in `server/.env` on the lab PC, and
  no lerobot>=0.6 venv exists there, so picking the `lerobot` backend is no way
  out.
- Reproduced in scratch on 2026-10-31: `curate.py delete --dataset <sim agent
  dataset 07affc6b> --episodes 0` gave `{"ok": false, "error": "'chunk_index'"}`.

### Server

- `materialize`: resolve `root.storagePath` through `resolveLocalView` before
  the first step, with the same error mapping as `resolveSource` (a
  `DatasetViewError` other than `NOT_A_DATASET` becomes a `DatasetViewError`
  with its code and the directory). Share one helper with
  `DatasetCurationService` rather than copying `viewOf`.
- `readDatasetEpisodeLengths` (`:479`) keeps reading the original root; check
  that the v2.1 view's episode order matches it, and assert that in a test.
- `curate.py`: when the dataset's `info.json` says `codebase_version` v3.0 (or
  a required v2.1 key is missing), answer `{"ok": false, "code":
  "UNSUPPORTED_LAYOUT", "error": "… is a v3.0 dataset; curate.py reads v2.1 — resolve a view first"}`
  instead of a `KeyError`. `EpisodeCurationService.run` already carries `code`.
- The materialized copy is v2.1, like a curated revision today. TASK-455 owns
  making both v3.0; note it in the method's comment.

### Key files

- `server/src/services/DatasetViewService.ts`
- `server/src/services/DatasetCurationService.ts` (share the view helper)
- `server/curation/curate.py`
- `server/src/__tests__/dataset-view-service.test.ts`
- `server/curation/tests/test_view_materialize.py`

## Acceptance Criteria

- [ ] Materializing a View whose root is a v3.0 agent dataset writes the
  selected episodes (and frame windows) and registers the path.
- [ ] A v2.1 root behaves as before.
- [ ] A root that cannot be converted answers the view resolver's code and
  reason, not `'chunk_index'`.
- [ ] `curate.py` on a raw v3.0 tree answers `UNSUPPORTED_LAYOUT`.

## Test Strategy

- Curation pytest (`server/curation/.venv`): in `test_view_materialize.py`,
  build a v3.0 dataset with `make_synthetic_dataset.py --version v3.0`, convert
  it the way `resolveLocalView` does, delete one episode and trim one, and check
  the counts. Run `curate.py delete` on the raw v3.0 tree and assert
  `UNSUPPORTED_LAYOUT`.
- Server vitest (`dataset-view-service.test.ts`): with `resolveLocalView`
  stubbed, assert that the first step's source is the view's root; a
  `DatasetViewError` surfaces with its code.

## Notes

- Found by the 2026-10-31 pre-session bug hunt (data hunt, finding 6).
- Workaround: do not materialize. Train from the original v3.0 dataset with the
  view's episode list. The training-run export manifest carries
  `selection.episodes`, and `LeRobotDataset(episodes=[...])` takes it.
