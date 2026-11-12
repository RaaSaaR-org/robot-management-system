---
id: "TASK-476"
aliases: []
title: "A GR00T dataset shows its joint groups and its statistics"
slug: "a-gr00t-dataset-shows-its-joint-groups-and-its-statistics"
status: "done"                # backlog | todo | in-progress | review | done | cancelled
priority: 1                   # 1=critical, 2=high, 3=medium, 4=low
owner: "claude"
projects: []
customers: []
tags: ["core"]
sprint: ""
parent: ""
depends_on: []
spe: 5
effort: "medium"
due_date: "2026-11-16"
created: "2026-11-13"
updated: "2026-11-13"
---

# A GR00T dataset shows its joint groups and its statistics

## Description

GR00T-style LeRobot v2.1 datasets — `nvidia/GR00T-N1.7-AppleToPlate` and our own
`ycchen0106/g1-apple-to-plate` — put one placeholder name on each 43-wide vector in
`meta/info.json` (`names: ["observation_to_policy"]` / `["action_from_policy"]`). The episode
page's joint chart therefore drew one line under one meaningless label. The real layout is in
`meta/modality.json` (state/action groups with start/end indices: left_leg 0-6, right_leg 6-12,
waist 12-15, left_arm 15-22, right_arm 22-29, left_hand 29-36, right_hand 36-43), which the
import already downloads and nothing read.

The same datasets ship `meta/episodes_stats.jsonl` (one stats row per episode) instead of
`meta/stats.json`. Validation only looked for `stats.json`, so they were stored with empty
statistics and a `MISSING_STATS` warning, and `GET /api/datasets/:id/stats` answered
`hasStats: false`. The app had no place that showed dataset statistics at all.

## Acceptance Criteria

- [x] On the episode page of a dataset with `meta/modality.json`, every channel of the joint
      chart is labelled by body part and index (`left_arm[3]`), and the viewer picks which joint
      group is drawn instead of getting all 43 channels at once.
- [x] The episode page has a statistics panel: min, max, mean and std per channel of the state
      and the action vector, by joint group when the dataset names its groups.
- [x] A v2.1 dataset with `meta/episodes_stats.jsonl` and no `stats.json` validates without
      `MISSING_STATS`; its statistics are the per-episode ones aggregated as LeRobot does
      (count-weighted mean, std pooled through total variance, min of mins, max of maxes).
- [x] A dataset imported before this change gets its statistics on the first request, without a
      re-import or a re-validation.
- [x] Both work for a dataset in RustFS and for one on local disk.
- [x] A dataset without `modality.json` or without statistics renders as before: the chart on
      its `info.json` names, the panel saying there are none.

## Notes

### What was built

- `server/src/services/lerobot/datasetMeta.ts` — `aggregateEpisodeStats(jsonl)` and
  `parseModality(json, info)`, pure functions over file text. The aggregation mirrors
  `aggregate_feature_stats` in `lerobot/datasets/compute_stats.py`; image statistics keep their
  `[[[r]], [[g]], [[b]]]` nesting and their own sample count. `parseModality` keeps only the
  entries that index the vector itself — an action entry with `original_key`
  (`effort_left_leg` → `action.effort_left_leg`, 0..6) indexes another column — and drops a
  group past the declared width or overlapping an earlier one.
- `validateDatasetStructure` aggregates `meta/episodes_stats.jsonl` when there is no
  `stats.json`. `stats.json` wins when both exist. `MISSING_STATS` remains for a dataset with
  neither; a file with no usable row is `BAD_STATS`.
- `DatasetService.getStats` aggregates the file once for a row whose `statsJson` is empty and
  writes the result back, so the three datasets already on the live instance need nothing done
  to them. `DatasetService.getModality` + `GET /api/datasets/:id/modality` read
  `meta/modality.json` through `openDatasetTree`, the same local-or-RustFS reader validation
  uses; `modality: null` when the file is absent, 503 when the store does not answer.
- App: `JointChartPanel` takes `groups` and shows a joint-group switch; it opens on the group
  that moves most in the episode on screen (a standing G1's legs barely move) and keeps the
  viewer's choice across episodes. `DatasetStatsPanel` is new, below the episode grid.

### Decisions

- **Modality is read on request, not stored on the row.** It is a 2.6 kB file; storing it would
  need a column and a migration, or a foreign key inside `infoJson`, which is written back out
  as `info.json` on export.
- **One group at a time** in both the chart and the table. The chart palette has six colours;
  a seventh series (G1 arms and hands are seven wide) repeats one and is drawn fainter.
- **No statistics panel on a view.** A view is a selection of its parent's episodes, and the
  parent's dataset-wide statistics are not the view's.

### Verified

Against the full local import of `nvidia/GR00T-N1.7-AppleToPlate` (402 episodes): validation
reports no `MISSING_STATS`, the aggregated count is 171 625 — `total_frames` — and mean, std,
min and max of channel 15 match an independent computation over the same file. The episode
page was opened against that dataset at 1440 and 390 wide.

### Not done

- The validation report stored on an already-imported dataset still lists `MISSING_STATS` until
  the dataset is validated again (`POST /api/datasets/:id/validate`).
- Demo mode answers both routes with "none": the demo dataset names its joints in `info.json`
  and has no statistics to show.
