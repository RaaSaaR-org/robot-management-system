---
id: "TASK-455"
aliases: []
title: "Dataset trim and delete write v3.0 revisions, and edits stack"
slug: "dataset-trim-and-delete-write-v3-0-revisions-and-edits-stack"
status: "backlog"             # backlog | todo | in-progress | review | done | cancelled
priority: 2                   # 1=critical, 2=high, 3=medium, 4=low
owner: "claude"
projects: []
customers: []
tags: [core]
sprint: ""
parent: ""
depends_on: []
spe: 8
effort: "high"
due_date: ""
created: "2026-10-31"
updated: "2026-10-31"
---

# Dataset trim and delete write v3.0 revisions, and edits stack

## Description

Trim and Delete episode on the dataset page cut frames exactly, but the
revision they write is LeRobot v2.1. Stock LeRobot v3 (`lerobot-pi05`,
`CODEBASE_VERSION` v3.0) refuses to load it with `BackwardCompatibilityError`,
so an edited dataset cannot be trained as it is. After an edit the page also
stays on the original dataset, so the next edit forks the original again and
only the last edit survives. The revision also drops the per-episode
`retarget_modes`, `dropped_frames` and `wall_duration_s`. This task makes
curated revisions v3.0 and makes edits stack.

**Status `backlog`: a design choice is open.** How a curated revision becomes
v3.0 is not decided (see "Open design choice"). The quick part (edits stack,
plus a badge) is decided and could ship first as its own child.

Branch: `fix/task-455-dataset-trim-and-delete-write-v3-0-revisions-and-edits-stack`.

## Details

### Current state

Checked on `main` at `a600c27e`.

- `server/src/services/DatasetCurationService.ts:16-34`: the file header
  records the TASK-217 decision. `curate.py` reads v2.1, so a v3.0 source is
  converted to a v2.1 view (`resolveLocalView`, `:303`), and "A CURATED
  REVISION OF A v3.0 DATASET IS WRITTEN AS v2.1". "Re-aggregating a curated
  revision back to v3.0 is its own task." This is that task.
- `DatasetCurationService.curate` (`:159-204`): resolves the source
  (`resolveSource`, `:284-330`), runs `episodeCurationService.trimEpisode` or
  `deleteEpisodes` with the `native` backend, then `registerRevision` writes a
  new Dataset row `<name> (curated)`, with lineage in `infoJson._curation`.
- `server/curation/curate.py:187-330`, `_rebuild`:
  - `new_info = dict(info)` (`:305`) copies the v2.1 view's `info.json`, so the
    output says `codebase_version: v2.1` with v2.1 path templates;
  - `meta/episodes.jsonl` (`:313-315`) is rewritten from the view's episode
    lines, which carry only `episode_index`, `tasks` and `length`. The agent
    writer's `retarget_modes`, `dropped_frames` and `wall_duration_s` columns
    are gone.
- `server/curation/curate.py:546`: a `lerobot` backend exists ("v3.0 via
  lerobot.datasets.dataset_tools"), but it cannot trim
  (`V3_TRIM_UNSUPPORTED`), and no lerobot>=0.6 venv exists on the lab PC
  (`CURATION_LEROBOT_PYTHON` is commented out in `server/.env`).
- `app/src/features/training/pages/DatasetEpisodesPage.tsx`:
  - `:292-298`, `recordOutcome`: sets a message and `newDataset`, and stays on
    the original;
  - `:300-336`, `handleDeleteEpisode` and `handleTrim`: both edit `datasetId`,
    the page's dataset, which is still the original;
  - `:587-593`: `CuratePanel`
    (`app/src/features/training/components/datasets/CuratePanel.tsx`) offers an
    "open new" button, `onOpenNew`, and only that button moves on to the
    revision.
- The writer's v3.0 layout to match:
  - `robot-agent/src/recording/lerobot-writer.ts:392` (`writeLeRobotV3`);
  - the episodes parquet with `meta/episodes/chunk_index` and `file_index`;
  - `tasks.parquet` with the pandas index (`writeTasksParquet`, `:336`).
- Reproduced in scratch on 2026-10-31, real dataset `e09646cc` (2026-10-17):
  converter + `curate.py trim` of episode 0 to [100, 400) gave 300 parquet rows
  and 300 video frames, exactly. `info.json` said v2.1, and lerobot-pi05's
  `check_version_compatibility` (`lerobot/datasets/utils.py:319`) raised.

### Open design choice

How a curated revision becomes v3.0. Pick one and record why:

1. A v3.0 writer in `curate.py`: after `_rebuild`, re-aggregate the v2.1 output
   into the agent writer's layout. That means one data file and one video file
   per camera, `meta/episodes` parquet with chunk/file indices and
   from/to timestamps, `tasks.parquet` with the pandas index, and stats. pyarrow
   and ffmpeg are already in the curation venv.
2. LeRobot's own v2.1 → v3.0 converter: needs a lerobot>=0.6 venv that the lab
   PC does not have, and makes curation depend on it.
3. A v3.0-native trim and delete that never goes through the v2.1 view.

Whichever is chosen, `_rebuild` (or its replacement) carries every extra
episode column through, not only `tasks` and `length`.

### Frontend (decided, the quick part)

- After a successful trim or delete, navigate to the new revision
  (`/datasets/<newDatasetId>/episodes`), with a toast naming it. The next edit
  then stacks on it. Keep "open new" for a path-mode edit that has no row.
- While a revision is still v2.1 (until the proper part lands), show a badge on
  it: "v2.1 · convert before training". Read it from the row's `lerobotVersion`
  or `infoJson.codebase_version`
  (`app/src/features/training/types/training.types.ts:135`).

### Server (the proper part, after the choice)

- `DatasetCurationService.registerRevision` (`:398`) registers the revision with
  `lerobotVersion: 'v3.0'` when the output is v3.0.
- Update the TASK-217 paragraph in the file header to the new decision.

### Key files

- `server/curation/curate.py`, `server/curation/tests/test_curate.py`
- `server/src/services/DatasetCurationService.ts`
- `server/src/services/EpisodeCurationService.ts`
- `app/src/features/training/pages/DatasetEpisodesPage.tsx`
- `app/src/features/training/components/datasets/CuratePanel.tsx`

## Acceptance Criteria

- [ ] After a trim or delete, the page shows the new revision, and a second edit
  produces a revision that contains both edits.
- [ ] A v2.1 revision shows the "convert before training" badge.
- [ ] (After the design choice) a trim or delete of a v3.0 dataset writes a v3.0
  revision whose `info.json`, episodes parquet and `tasks.parquet` match the agent
  writer's layout, and which LeRobot v3's loader opens.
- [ ] `retarget_modes`, `dropped_frames` and `wall_duration_s` survive an edit for
  every kept episode.
- [ ] The frame-exactness of today stays: N kept frames = N parquet rows = N video
  frames.

## Test Strategy

- Curation pytest (`CURATION_PYTHON`, the `server/curation/.venv`): build a
  v3.0 dataset with `make_synthetic_dataset.py --version v3.0`, trim and delete,
  and assert `codebase_version` v3.0, the v3.0 path templates, the extra episode
  columns, and row and frame counts per episode.
- If a lerobot>=0.6 interpreter is available, open the output with
  `LeRobotDataset(root=…)` (skip with a printed reason when it is not).
- App vitest: after a mocked trim, the page navigates to the new id; the badge
  renders for a v2.1 row.
- Playwright: extend `app/e2e/curation.spec.ts` to trim twice and read two
  edits in the second revision.

## Notes

- Found by the 2026-10-31 pre-session bug hunt (data hunt, finding 2).
- Workaround: remove bad takes during the session with Discard. Discarded takes
  are excluded at write time and the dataset stays v3.0. Choose takes for
  training with a View; it keeps the v3.0 original and exports an episode list.
  If you must trim, open each new revision before the next edit, and convert the
  last one to v3.0 before `lerobot-train`.
- Suggested split for `/plan`: the quick part (spe 2) first, the v3.0 output
  (spe 5) after the design choice.
