---
id: "TASK-451"
aliases: []
title: "A recorded dataset carries the stats lerobot-train needs"
slug: "a-recorded-dataset-carries-the-stats-lerobot-train-needs"
status: "in-progress"         # backlog | todo | in-progress | review | done | cancelled
priority: 1                   # 1=critical, 2=high, 3=medium, 4=low
owner: "claude"
projects: []
customers: []
tags: ["core"]
sprint: ""
parent: ""
depends_on: []
spe: 2
effort: "low"
due_date: ""
created: "2026-10-31"
updated: "2026-10-31"
---

# A recorded dataset carries the stats lerobot-train needs

## Description

A dataset the robot agent records cannot be trained with stock `lerobot-train`:
`meta/stats.json` holds only `mean/std/min/max` for `observation.state` and
`action`. lerobot fails before step 1 on the missing camera entries, and pi05
fails on the missing quantiles. The writer must emit the stats keys lerobot
reads, so a recording goes straight into training.

## Details

### Current state

`robot-agent/src/recording/lerobot-writer.ts` writes `meta/stats.json` (near the
end of `writeLeRobotV3`) with exactly two entries, `observation.state` and
`action`, each `{mean, std, min, max}` from `computeFeatureStats`. Two stock
LeRobot failures follow (reproduced on the real dataset `e09646cc` and the sim
dataset `0ec0e6a5`; consumer is `lerobot-pi05/lerobot/src/lerobot`):

1. `datasets/factory.py` (~127-130): with `use_imagenet_stats=True` (the default,
   `configs/default.py:36`) it does
   `dataset.meta.stats[key][stats_type] = IMAGENET_STATS[...]` for every camera
   key (`meta.camera_keys` = every feature with dtype `video` or `image`). The key
   is not in `stats.json`, so this raises
   `KeyError: 'observation.images.cam_right_high'`.
2. pi05 (`policies/pi05/configuration_pi05.py:72-77`) normalises STATE and ACTION
   with `QUANTILES`; `processor/normalize_processor.py` (~386-391) raises
   `QUANTILES normalization mode requires q01 and q99 stats`.

lerobot v3's own writer (`datasets/compute_stats.py`) emits per feature `min`,
`max`, `mean`, `std`, `count` (shape `[1]`) and the quantiles of
`DEFAULT_QUANTILES = [0.01, 0.10, 0.50, 0.90, 0.99]`, keyed
`f"q{int(q * 100):02d}"` → `q01`, `q10`, `q50`, `q90`, `q99`. Image stats are
channel-first `[3, 1, 1]` in `[0, 1]`.

### Robot Agent

- `computeFeatureStats` also returns `count: [n]` and the per-column quantiles
  `q01`, `q10`, `q50`, `q90`, `q99`, computed exactly from the sorted column with
  linear interpolation (numpy's default). `mean/std/min/max` stay exactly as they
  are. An empty input gives `count: [0]` and empty quantile arrays.
- `stats.json` gains one entry per camera feature `observation.images.<key>`
  (every `dtype: 'video'` feature `buildInfo` declares): ImageNet constants, not
  measured — `mean [[[0.485]],[[0.456]],[[0.406]]]`,
  `std [[[0.229]],[[0.224]],[[0.225]]]`, `min [[[0]],[[0]],[[0]]]`,
  `max [[[1]],[[1]],[[1]]]`, `count [totalFrames]`. No image quantiles are
  invented. The comment above the write says what is written and why.
- Nothing else changes: dataset layout, `info.json`, parquet columns.

### Key files

- `robot-agent/src/recording/lerobot-writer.ts`
- `robot-agent/src/recording/__tests__/lerobot-writer.test.ts`

## Acceptance Criteria

- [x] `computeFeatureStats` returns `count` and `q01/q10/q50/q90/q99` of the
      column width, matching numpy's linear-interpolation quantiles on a
      hand-made input; `mean/std/min/max` are unchanged.
- [x] Every `dtype: 'video'` feature in `info.json` has a `stats.json` entry with
      `[3][1][1]` `mean/std/min/max` and `count: [total_frames]`.
- [x] `observation.state` and `action` in `stats.json` carry `count` and all five
      quantile keys.
- [x] Loading `stats.json` the way lerobot's `load_stats` does (JSON → numpy)
      gives every camera key the stats the imagenet loop writes into, and
      `q01`/`q99` of the joint width for state and action.

## Test Strategy

- vitest (`robot-agent/src/recording/__tests__/lerobot-writer.test.ts`): known
  quantiles on a small hand-made input; the written tree's `stats.json` has an
  entry per video feature with the right shapes and count, and state/action carry
  `count` plus every quantile key at the joint width.
- A numpy-only check (no lerobot venv exists on the dev box) that loads a
  freshly written `stats.json` as `load_stats` does and runs the factory's
  imagenet loop plus the pi05 `q01/q99` presence check; output goes in the PR's
  test evidence.
