---
id: "TASK-471"
aliases: []
title: "A take's dropped ticks show in its timeline instead of being compressed out"
slug: "a-take-s-dropped-ticks-show-in-its-timeline-instead-of-being"
status: "backlog"             # backlog | todo | in-progress | review | done | cancelled
priority: 3                   # 1=critical, 2=high, 3=medium, 4=low
owner: "claude"
projects: []
customers: []
tags: [core]
sprint: ""
parent: ""
depends_on: []
spe: 5
effort: "high"
due_date: ""
created: "2026-10-31"
updated: "2026-10-31"
---

# A take's dropped ticks show in its timeline instead of being compressed out

## Description

The robot agent's recorder skips a tick it cannot serve (teleop not engaged,
the previous frame still in flight, a late event loop) and counts it as
dropped. The frames written are numbered densely and stamped `i/fps`, so a run
of drops in the middle of a take becomes a jump between two "consecutive"
frames. In the 2026-10-31 sim rehearsal, episode 1 had 11 frame-to-frame state
jumps above 0.1 rad, the largest 0.495 rad in 33 ms: velocities a policy would
learn and the robot cannot do. Leading drops (before anyone drove) are
harmless; gaps inside a take are not. This task makes those gaps visible and
keeps them out of training data.

**Status `backlog`: a design choice is open.** LeRobot derives every timestamp
as `i/fps` and checks it (`check_timestamps_sync`, tolerance 1e-4 s), and a row
must land on the video frame it was taken from; so writing real capture
timestamps into `timestamp` would make LeRobot refuse the dataset. Decide one
of:

- **A. Split at gaps.** A run of more than N dropped ticks inside a take ends
  the episode and opens a new one in the same take. Uniform timestamps stay
  true inside each episode. Cost: one take becomes several episodes.
- **B. Keep the episode, record the gaps.** Write each gap (frame index, ticks
  missed) into `neodem-episodes.json`, and optionally a per-frame
  `observation.capture_time_s` feature; the quick check shows "N gaps (longest
  X ms)" and offers Trim around them. Cost: training still sees the jumps
  unless someone trims.
- **C. Fill the gaps.** Repeat the last frame for each dropped tick (counted as
  `repeated`). Timing stays true, but the policy sees held poses that never
  happened.

Write the choice and N (if A) here, then set the task to `todo`.

Branch: `fix/task-471-a-take-s-dropped-ticks-show-in-its-timeline-instead-of-being`.

## Details

### Current state

Checked on `main` at `a600c27e`.

- `robot-agent/src/recording/EpisodeRecorder.ts`:
  - `:1003-1009`, `missTicks()`: late ticks count as drops and are skipped,
    never replayed;
  - `:1040-1049`: `drop('behind: …')` and `drop('teleop is not engaged')`;
  - `:1164-1169`, `drop()`: increments `episode.dropped` only; where in the
    take the drop fell is not kept;
  - `:355-366`: the design notes (integer fps, `i/fps`, drops are counted,
    never bursts).
- `robot-agent/src/recording/lerobot-writer.ts:445-458`: rows are written with
  `timestamp: i / fps` and `frame_index: i`.
- `robot-agent/src/recording/episode-quick-check.ts:19-24`, `:132-138`: the
  `dropped_frames` warning compares `(dropped + repeated) / wanted` with a
  ratio; it does not tell a leading drop from a gap.
- The takes list and the quick check show "N dropped" per take.

### Robot Agent

- Whatever the choice: record each drop's position (the index of the next
  captured frame) so leading drops (before the first frame) are told apart from
  gaps (after it). Report `gaps` and `longestGapTicks` per episode in the take
  report and `neodem-episodes.json`.
- Then the chosen behaviour (A, B or C) in `EpisodeRecorder` and
  `lerobot-writer`.

### Frontend

- The quick check and the takes list show gaps separately from leading drops,
  e.g. "3 gaps · longest 400 ms". Leading drops stay "N dropped before the
  first frame" and raise no warning.

### Key files

- `robot-agent/src/recording/EpisodeRecorder.ts`
- `robot-agent/src/recording/lerobot-writer.ts`
- `robot-agent/src/recording/episode-quick-check.ts`
- `robot-agent/src/recording/__tests__/EpisodeRecorder.test.ts`
- `server/src/services/teleoperation/liveState.ts` (pass the new fields)
- `app/src/features/datacollection/components/console/TakesList.tsx`
- `app/src/features/datacollection/components/session/QuickCheckCard.tsx`

## Acceptance Criteria

- [ ] The decision is written here.
- [ ] A take with 10 leading drops and no gap reports 0 gaps and no warning.
- [ ] A take with a 12-tick gap in the middle reports 1 gap of 12 ticks, and
  the quick check says so.
- [ ] The written dataset follows the decision and still loads in LeRobot v3
  (`LeRobotDataset` with the default timestamp check).
- [ ] Robot-agent vitest covers leading drops, a gap, and the writer.

## Test Strategy

- Robot-agent vitest with a fake clock: drop ticks before the first frame and
  in the middle; assert the report and the written rows.
- Load the written dataset with `server/curation/.venv` (pyarrow) and, for A or
  B, with `lerobot` if available; check `timestamp` against `frame_index / fps`.
- On `sim-g1-edu-dev`: a take where teleop disengages for a second mid-take.

## Notes

- Found in the 2026-10-31 sim rehearsal ("Dropped ticks are compressed out of a
  take's timeline"). Confidence there was "possible": the jumps are
  consistent with gaps, not proven to be them; the first step of this task
  confirms it from the drop positions.
- Workaround: discard takes whose row shows a large dropped count, except drops
  before the operator engaged.
- Related: TASK-464 (the dock's drop reason and the degraded flag).
