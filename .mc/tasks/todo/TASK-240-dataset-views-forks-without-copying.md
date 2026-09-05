---
id: TASK-240
aliases:
- TASK-240
title: Dataset views — fork a dataset by selecting episodes, not by copying bytes
slug: dataset-views-forks-without-copying
status: "review"
priority: 2
owner: "huhn511"
projects: []
customers: []
tags:
- core
- training
- curation
sprint: ''
parent: ""
depends_on: []
spe: 8
effort: ""
due_date: ''
created: 2026-09-04
updated: "2026-09-05"
status_note: 'Written 2026-09-04. Independent of TASK-238/234 — it touches the data
  side, not the model side — but TASK-242 needs both.'
---

# Dataset views — fork a dataset by selecting episodes, not by copying bytes

## Description

An agent testing twenty data variations must not write twenty copies of a
dataset. A "fork" should be a named, frozen episode selection over a parent
dataset: zero bytes copied, resolved to real files only when a run needs them.

## Details

### Current state

- **Curation copies everything.** `server/curation/curate.py` is
  non-destructive by writing a whole new dataset directory — its README says
  *"every edit writes a new dataset revision directory and leaves the source
  untouched"* — including copying and renumbering every per-episode camera
  video and re-encoding trimmed ones with ffmpeg. Correct, and far too expensive
  to do per experiment arm.
- **No lineage on datasets.** `Dataset` (`server/prisma/schema.prisma`) has no
  `parentId`, no fork field. `sourceRevision` records the HF commit of an
  *imported* repo, not a local derivation.
- **Episode-level judgements already exist**, both keyed on
  `(datasetId, episodeIndex)` with no Episode table: `DatasetEpisodeFlag`
  (operator `keep | remove | pending`) and `EpisodeReward` (reward-model
  `score`, `success`, per-frame `curve`). These are exactly the inputs a
  selection should be built from.
- **Mixtures already reference many datasets.** `TrainingJobDataset` +
  `MixtureMemberInput` (`server/src/types/mixture.types.ts`) give a job N
  datasets with weights, and `CompatibilityReport` judges whether they can train
  together. A view inherits every compatibility axis from its parent, so this
  machinery keeps working unchanged.

### Design decision (settled)

A view is a **`Dataset` row**, not a separate model. It carries
`kind = 'view'`, a `parentDatasetId`, and a selection; `storagePath` is empty.
Every existing foreign key — `TrainingJob.datasetId`, `TrainingJobDataset`,
`Dataset.skillId`, the export manifest — keeps working with no second code
path. The cost of that choice is one hard rule: **resolution lives in exactly
one place.** If three call sites each learn to walk `parentDatasetId`, they will
drift.

### Server

**Schema** (`server/prisma/schema.prisma`), on `Dataset`:

- `kind String @default("materialized")` — `materialized | view`
- `parentDatasetId String?` + self-relation (`parent` / `derived`), indexed
- `selectionJson String?` — JSON `DatasetSelection` (below)
- `frozenAt DateTime?` — set the first time a training job cites this view
- `materializedPath String?` — set only if the view was ever written to disk

**Types** (new `server/src/types/dataset-view.types.ts`):

```ts
/** One episode of the parent, optionally trimmed. */
export interface SelectedEpisode {
  episodeIndex: number;      // index in the PARENT
  start?: number;            // inclusive frame, default 0
  end?: number;              // exclusive frame, default episode length
}

export interface DatasetSelection {
  /** Explicit list, resolved against the parent at creation time. */
  episodes: SelectedEpisode[];
  /** How this selection was arrived at — for the UI and the audit trail. */
  origin:
    | { kind: 'manual'; note?: string }
    | { kind: 'flags'; decision: 'keep' | 'remove' }
    | { kind: 'reward'; rewardType: 'robometer' | 'topreward'; minScore: number }
    | { kind: 'agent'; actorId: string; rationale: string };
}
```

The selection is stored **resolved**, never as a live query. A view built from
"reward >= 0.7" must not change meaning when a later reward job rewrites the
scores — that is the difference between a reproducible experiment arm and a
result nobody can explain a month later. `origin` records the rule for humans;
`episodes` is the truth.

**Resolver** (new `server/src/services/DatasetViewService.ts`) — the one place:

- `resolve(datasetId): { rootDatasetId, episodes: SelectedEpisode[] }` — walks
  `parentDatasetId` to the root and composes the selections. A view of a view
  composes by mapping child indices through the parent's list; frame ranges
  intersect. Guard against cycles and cap depth.
- `derivedCounts(selection)` — `demonstrationCount`, `totalFrames`,
  `totalDuration` for the view row, computed from the parent's episode metadata
  so the card shows real numbers without opening a file.
- `freeze(datasetId)` — idempotent, sets `frozenAt`.
- `materialize(datasetId, outputPath)` — the escape hatch: shells out to the
  existing `curate.py delete/trim` to write real files, sets
  `materializedPath`. Only used when a consumer genuinely cannot take an
  episode filter.

**Freeze on cite.** `TrainingJobService` calls `freeze()` for every view a job
references, at submission. A frozen view rejects edits with a 409 whose message
names the citing job; the UI offers "duplicate as new view" instead. This is
copy-on-write at the metadata level.

**Routes** (new `server/src/routes/dataset-views.routes.ts`, mounted under
`/api/datasets`):

- `POST /api/datasets/:id/views` — create a view. Body `{ name, description?,
  selection }`. Validates every `episodeIndex` against the parent's
  `demonstrationCount` and every frame range against episode length.
- `GET /api/datasets/:id/views` — views derived from this dataset
- `POST /api/datasets/:id/views/from-flags` — convenience: build a selection
  from `DatasetEpisodeFlag` (`keep`, or everything not `remove`)
- `POST /api/datasets/:id/views/from-rewards` — from `EpisodeReward` above a
  threshold
- `POST /api/datasets/views/:id/materialize` — force files on disk
- `DELETE /api/datasets/views/:id` — refuses when frozen

**Consumers.** Every path that reads dataset files must go through
`DatasetViewService.resolve` first:

- `DatasetService.toResponse` — a view reports derived counts and its parent's
  `validation`/`qualityBreakdown`; it must NOT claim its own validation, because
  nothing validated it.
- `server/src/services/lerobot/datasetCompatibility.ts` (used by `TrainingJobService`) — compare on the resolved root's axes.
- `TrainingRunExportService` — a manifest for a run citing a view must state the
  root `uri` plus the selection, so a cluster that cannot reach this server can
  still reproduce the arm. Add `selection` to `TrainingRunManifestDataset` and
  keep `portable` honest: a view of a `file://` parent is not portable either.

### Frontend

- `DatasetCard` / `DatasetList`: a view is visibly a view — parent name, episode
  count as "142 of 400 episodes", a lock when frozen.
- Dataset detail: a "Views" section listing derived views, and a "Create view"
  action from the episode table with the current selection.
- `DatasetEpisodesPage` (`app/src/features/training/pages/DatasetEpisodesPage.tsx`):
  multi-select episodes → "Create view from selection". This is where the flags
  and reward scores already are, so the selection is made where the evidence is
  visible.

### Key files

- `server/prisma/schema.prisma`
- `server/src/types/dataset-view.types.ts` (new)
- `server/src/services/DatasetViewService.ts` (new)
- `server/src/routes/dataset-views.routes.ts` (new)
- `server/src/app.ts` (route mounting, see `app.use('/api/datasets', ...)` at line 285)
- `server/src/services/DatasetService.ts`
- `server/src/services/TrainingJobService.ts`
- `server/src/services/TrainingRunExportService.ts`
- `server/src/types/mixture.types.ts`
- `app/src/features/training/components/DatasetCard.tsx`
- `app/src/features/training/pages/DatasetEpisodesPage.tsx`

## Acceptance Criteria

- [ ] Creating a view writes no files and no bytes under `storagePath`
- [ ] A view of a view resolves to the correct root episode set, with frame
      ranges intersected
- [ ] A cycle in `parentDatasetId` is refused rather than hanging
- [ ] Submitting a training job that cites a view sets `frozenAt`; a later edit
      returns 409 naming the job
- [ ] A view can be used as a mixture member and the compatibility report is
      computed against the root's axes
- [ ] `from-rewards` produces a selection that does not change when the reward
      scores are recomputed afterwards
- [ ] The export manifest for a run citing a view states root uri + selection
- [ ] A view reports its parent's validation and never claims its own
- [ ] `materialize` produces a dataset directory byte-equivalent to running
      `curate.py delete` with the same episode list

## Test Strategy

- **Unit (vitest, server):** resolver composition over three levels; frame-range
  intersection; cycle and depth guards; freeze idempotency and the 409;
  `derivedCounts` against a known parent; selection validation rejecting an
  out-of-range `episodeIndex`; manifest shape for a view.
- **Pytest (`CURATION_PYTHON`, `server/curation/tests/`):** materialize equals
  `curate.py delete` output — build a synthetic dataset with
  `make_synthetic_dataset.py`, create a selection, materialize, compare episode
  counts, frame indices and recomputed stats.
- **Manual:** create a view from flags on a real imported dataset, start a
  training job on it, confirm no new directory appears under the storage root.

## Notes

Explicitly out of scope: making LeRobot itself accept the episode filter
in-process. Until that lands, a run on a view materializes once and caches
`materializedPath` — which is still one copy per *used* view instead of one per
*created* view, and the agent creates far more than it uses.

### Two defects the last acceptance criterion caught — 2026-09-05

The ninth criterion ("materialize produces a dataset directory byte-equivalent to running
`curate.py delete` with the same episode list") was the only one no gate covered: it had been
read, not executed. Writing the pytest the Test Strategy asks for found two real bugs, both
reproduced against a real 6-episode dataset.

**`resolve` and `materialize` disagreed about episode order.** `resolve` built a view's list in
*selection* order; `materialize` produced *ascending root* order, because that is how
`curate.py delete` renumbers survivors. A selection of `[{5}, {1}]` resolved as lengths
`[65, 61]` and materialized as `[61, 65]`. So a view-of-a-view resolved child index 0 to a
different episode than the directory a training run actually reads, and a UI episode number did
not address the episode it named. Resolved in favour of parent order — `curate.py`'s ascending
numbering is the one written to disk, and selection order carried no information beyond the
order somebody clicked.

**A stale `demonstrationCount` silently shipped unselected episodes.** The delete complement
came from the database column and was never checked against the dataset on disk. With six
episodes on disk and a row claiming four, a selection of `{0, 2}` materialized to
`[60, 62, 64, 65]` — four episodes for a two-episode selection, two of them selected by nobody.
`curate.py` cannot catch it: it validates the indices it is *told* to delete and has no way to
know what was meant to be kept. It now reads the root's own `meta/info.json` and refuses with
both numbers named, because whichever is right, a selection validated against a row that does
not describe the files was validated against nothing.

The second is the worse of the two: silent, and the result is wrong training data inside
something the system calls a frozen, reproducible experiment arm — the one guarantee this
feature exists to make.
