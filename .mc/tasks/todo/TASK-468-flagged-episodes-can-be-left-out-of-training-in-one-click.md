---
id: "TASK-468"
aliases: []
title: "Flagged episodes can be left out of training in one click"
slug: "flagged-episodes-can-be-left-out-of-training-in-one-click"
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

# Flagged episodes can be left out of training in one click

## Description

On the dataset page an operator flags bad episodes and assumes they are left
out. "Train on this dataset" still trains on all of them, and nothing says so.
The way to drop them exists but is buried: Create view → pick the source
"Everything not flagged" → name it → create, then write it to disk. The
2026-10-31 sim rehearsal flagged an episode and found no direct path. This task
adds a one-click "View without flagged" on the dataset page and makes the
training wizard say when a selected dataset has flagged episodes.

Branch: `feat/task-468-flagged-episodes-can-be-left-out-of-training-in-one-click`.

## Details

### Current state

Checked on `main` at `a600c27e`.

- `app/src/features/training/pages/DatasetEpisodesPage.tsx`:
  - `:80` and `:160-162`: `flaggedMap` from the episodes' `flagged`;
  - `:282-290`: the flag toggle (`trainingApi.flagEpisode`,
    `PATCH /api/datasets/:id/episodes/:index/flag`);
  - `:386-388`: `flaggedIndices`;
  - `:489-495`: the header's Create view; `:501`: Train on this dataset;
  - `:652-662`: `CreateViewModal` with `flaggedEpisodes={flaggedIndices}`.
- `app/src/features/training/components/CreateViewModal.tsx:97-104`: the source
  "Everything not flagged" (`selectionFromFlags(allEpisodes, flagged)`), shown
  only when flags exist and not preselected.
- `app/src/features/training/api/datasetViewsApi.ts:7-11`: the client resolves
  selections itself and does not call the server's `from-flags`.
- Server `POST /api/datasets/:id/views/from-flags`
  (`server/src/routes/dataset-views.routes.ts:173-200`) has no app caller, and
  it reads `reviewDecision` (`keep` / `remove`), not the flag:
  `server/src/services/DatasetService.ts:2559-2585`. A UI flag sets
  `reviewDecision: null` (`server/src/repositories/DatasetEpisodeFlagRepository.ts:73`),
  so `decision: 'remove'` would keep a just-flagged episode. **Do not use that
  route for this**; the client-side selection is the right one.
- `app/src/features/training/components/jobs/wizard/ReviewStep.tsx`: the review
  step says nothing about flags.
- Writing a view of an agent's v3.0 dataset to disk fails today; TASK-458 (open)
  fixes it. This task only creates the view.

### Frontend

- Dataset page: when at least one episode is flagged, a secondary button
  "View without flagged (N)" next to Create view. One click creates the view
  with `selectionFromFlags(allEpisodes, flaggedIndices)` and the name
  "<dataset> without flagged", through the same create call `CreateViewModal`
  uses, then shows it in the views section with a toast linking to it.
- Flag control tooltip: "Flagged episodes are still trained. Use View without
  flagged to leave them out."
- Training wizard, review step: for each selected dataset with flagged
  episodes, a warning line "N flagged episodes of <dataset> will be trained",
  with a link to that dataset page. Read the count from the episodes response
  the page already uses (`flagged` per episode) or add `flaggedCount` to the
  dataset list response, whichever is the smaller change.

### Key files

- `app/src/features/training/pages/DatasetEpisodesPage.tsx`
- `app/src/features/training/components/CreateViewModal.tsx` (reuse
  `selectionFromFlags`; move it to a util if needed)
- `app/src/features/training/components/jobs/wizard/ReviewStep.tsx`
- `app/src/features/training/api/datasetViewsApi.ts`
- `server/src/routes/datasets.routes.ts` (only if `flaggedCount` is added)

## Acceptance Criteria

- [ ] With two flagged episodes, "View without flagged (2)" creates a view of the
  others in one click, and the view lists them.
- [ ] Without flags the button is not shown.
- [ ] The wizard's review step warns about flagged episodes in a selected
  dataset, and says nothing when there are none.
- [ ] The server's `from-flags` route is not called.
- [ ] Vitest covers the button, the selection and the warning.

## Test Strategy

- App vitest: `DatasetEpisodesPage` with flags (button shown, create called with
  the right selection) and without (no button); `ReviewStep` with a flagged
  dataset.
- On `sim-g1-edu-dev` after a session: flag one episode, click the button, and
  check the view's episodes.

## Notes

- Found in the 2026-10-31 sim rehearsal ("Flag, star rating and comments do not
  exclude episodes from training").
- Workaround: Delete episode (a new revision), or tick the good episodes →
  Create view → Write to disk (needs TASK-458 on a v3.0 dataset), and train on
  that.
- Ratings and comments stay notes; they do not exclude anything.
