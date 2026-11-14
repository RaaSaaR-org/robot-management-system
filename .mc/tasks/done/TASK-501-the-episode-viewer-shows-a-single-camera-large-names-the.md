---
id: "TASK-501"
aliases: []
title: "The episode viewer shows a single camera large, names the episode it plays, keeps it in the address and says when a video is slow"
slug: "the-episode-viewer-shows-a-single-camera-large-names-the"
status: "done"                # backlog | todo | in-progress | review | done | cancelled
priority: 2                   # 1=critical, 2=high, 3=medium, 4=low
owner: "claude"
projects: []
customers: []
tags: ["datasets", "episode-viewer", "demo", "ui", "core"]
sprint: ""
parent: ""
depends_on: []
spe: 5
effort: "medium"
due_date: "2026-11-16"
created: "2026-11-14"
updated: "2026-11-14"
---

# The episode viewer shows a single camera large, names the episode it plays, keeps it in the address and says when a video is slow

## Description

A review of the live instance (https://neodem.emai.dev, 2026-11-14) two days
before the demo day of 2026-11-16 found six defects on the dataset episode
viewer, the page the dataset part of the demo is told from. All six are in the
app; this task fixes them with the smallest change each. No server, robot-agent
or data change.

## Details

### Current state (origin/main at `3074069c`)

1. **Single camera is a stamp at 1440×900.**
   `app/src/features/training/pages/DatasetEpisodesPage.tsx` chose the
   side-by-side stage only when the stage was shorter than `STACKED_FROM_PX`
   (540). At 1440×900 the stage is 580 px, so it stacked, the video row got
   3fr against the chart's `minmax(270px,2fr)`, and a 640×480 video was drawn
   324×243 inside an 894 px wide black box. At 1280×720 the same video was
   391×293: the smaller window showed the larger picture. The camera count was
   never considered.
2. **Nothing says which episode is playing.** `EpisodeViewer.tsx` had no
   episode label, and `EpisodeListPanel.tsx` never scrolled the selected row
   into view: with `?episode=401` the list showed episodes 0–9.
3. **The selected episode is not in the address.** `?episode=` was read once
   into a ref on mount; `selectEpisode` only set state. A reload returned to
   episode 0 and `?episode=9999` silently opened episode 0.
4. **Trim writes a new dataset with one click.** `handleTrim` called
   `trainingApi.trimEpisode` directly; delete already asked first.
5. **A stalled video request is a black box.** `CameraCell` mounted a bare
   `<video>`; "request sent, nothing back yet" was the one state without a
   notice.
6. **`/datasets/<id>` is the not-found page.** `app/src/App.tsx` only knew
   `/datasets/:datasetId/episodes` and `/datasets`.

### Frontend

- **Layout** (`DatasetEpisodesPage.tsx`): `side` is also chosen when the
  dataset has exactly one camera and the window is at least `SIDE_FROM_PX`
  (1280) wide. Two or more cameras keep the old rule, as does any window
  narrower than 1280.
- **Which episode** (`EpisodeViewer.tsx`, new optional `episode` prop): a tag
  at the top right of the camera grid, `Episode 401 · 402 of 402` — the index
  as the list names it (indices start at 0 and have gaps in a view), then the
  1-based place among the episodes. It names the episode on the stage (the
  settled one, TASK-492), not the one a held arrow key is passing.
  `EpisodeListPanel.tsx` scrolls its own list just far enough to show the
  selected row (`block: 'nearest'` semantics). It moves `scrollTop` of the list
  itself instead of calling `scrollIntoView`, which would also scroll the page
  when the list is partly off screen (for example when a curation suggestion
  is applied from the panel below).
- **Address**: `selectEpisode` and `applySuggestion` write `?episode=N` with
  `replace: true`, keeping the other parameters (`?tab=`). An `?episode=` the
  dataset does not have opens the first episode, rewrites the address to it and
  shows an info toast ("Episode 9999 is not in this dataset"). The requested
  episode is now tracked per dataset, so moving to another dataset inside the
  page no longer carries the first dataset's `?episode=` along. The page does
  not listen for later changes of `?episode=`: the address follows the
  selection, not the other way round (React Router applies the address in a
  transition, so a two-way sync could undo a click).
- **Trim** (`handleTrim`): the kit `confirm()` first — "Trim episode N?" with
  the range that is kept — same shape as delete.
- **Slow video** (`CameraCell` in `EpisodeViewer.tsx`): a spinner over the cell
  once a video (or its ticket) has been awaited for 400 ms, and after 8 s
  "Still loading" with the existing Retry handler. The cell counts as loaded on
  `loadedmetadata`, `loadeddata` or `canplay` for its URL and attempt, so it
  never returns on a seek (`waiting`/`seeking` are not listened to). The
  overlay is `pointer-events-none`; only its Retry button takes clicks. It is
  not shown during a rate-limit wait or over a failure notice, which have their
  own text.
- **Route** (`App.tsx`): `/datasets/:datasetId` redirects (replace) to
  `/datasets/:datasetId/episodes`, query string included.

### Key files

- `app/src/features/training/pages/DatasetEpisodesPage.tsx`
- `app/src/features/training/components/datasets/EpisodeViewer.tsx`
- `app/src/features/training/components/datasets/EpisodeListPanel.tsx`
- `app/src/App.tsx`
- `app/src/features/training/pages/__tests__/DatasetEpisodesPage.address.test.tsx` (new)
- `app/src/features/training/components/datasets/__tests__/EpisodeListPanel.test.tsx` (new)
- `app/src/features/training/components/datasets/__tests__/EpisodeViewer.test.tsx`
- `app/e2e/dataset-episode-address.spec.ts` (new), `app/e2e/curation.spec.ts`

## Acceptance Criteria

- [x] A one-camera dataset at 1440×900 and 1920×1080 uses the side-by-side
      stage and the picture is clearly larger than before; at 1280×720 it is
      unchanged. Two-camera datasets are unchanged at all three sizes.
- [x] The viewer names the episode on the stage and its place in the dataset.
- [x] Opening `?episode=401` shows row 401 in the list without scrolling by hand.
- [x] Selecting an episode writes `?episode=N` (replace); a reload opens it.
- [x] `?episode=9999` opens a valid episode, corrects the address and says so.
- [x] "Trim range" asks before it sends anything; Cancel sends nothing.
- [x] A video that has not answered shows a spinner, and "Still loading" with
      Retry after about 8 s; once loaded the overlay is gone, does not take
      clicks and does not return on a seek.
- [x] `/datasets/<id>` opens `/datasets/<id>/episodes`.

## Test Strategy

- `cd app && npx tsc && npx vitest run` — the new unit tests cover the layout
  by camera count and window size, the address writes and the fallback, the
  trim confirmation, the list scroll, the episode tag and the loading overlay.
- `cd app && npx playwright test e2e/dataset-episode-address.spec.ts e2e/curation.spec.ts`
  (demo build, MSW).
- In a browser against real data: build with `VITE_API_BASE_URL=/api`, serve
  with `VITE_PROXY_TARGET=<instance> npx vite preview`, open a one-camera and a
  two-camera dataset at 1280×720, 1440×900 and 1920×1080.

## Notes

Measured in headless Chromium against the live datasets, read-only (every
non-GET request was answered locally and never sent), origin/main vs. this
branch, picture size of the 640×480 single-camera video:

| Window | Before | After |
| ------ | ------ | ----- |
| 1280×720 | 391×293 (side) | 391×293 (side) |
| 1440×900 | 324×243 (stacked) | 478×359 (side) |
| 1920×1080 | 546×410 (stacked) | 740×555 (side) |

The two-camera dataset measured the same before and after at all three sizes.

Left out on purpose: the episode tag is not shown for a dataset without cameras
(the "No camera streams" panel is unchanged), and the task text of an episode
is not shown because the episodes endpoint does not return one (server change,
after the demo).
