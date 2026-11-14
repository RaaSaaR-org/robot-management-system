---
id: "TASK-507"
aliases: []
title: "The robot page shows the whole robot on the first screen at 1280x720, the joint legend lists every joint and the episode tag covers no camera"
slug: "the-robot-page-shows-the-whole-robot-on-the-first-screen-at"
status: "in-progress"         # backlog | todo | in-progress | review | done | cancelled
priority: 2                   # 1=critical, 2=high, 3=medium, 4=low
owner: "claude"
projects: []
customers: []
tags: ["robots", "datasets", "episode-viewer", "demo", "ui", "core"]
sprint: ""
parent: ""
depends_on: []
spe: 3
effort: "medium"
due_date: "2026-11-16"
created: "2026-11-14"
updated: "2026-11-14"
---

# The robot page shows the whole robot on the first screen at 1280x720, the joint legend lists every joint and the episode tag covers no camera

## Description

The demo on 2026-11-16 is shown from https://neodem.emai.dev, often on a
1280x720 projector. A post-deploy check of the live build (d2c63b55) found four
layout points on the robot and dataset pages: the G1's legs below the fold, an
empty band under the SimBot-01 live model, a joint cut off the chart legend and
the episode tag over a camera picture. App only; no behaviour change.

## Details

### Current state

- `app/src/features/robots/components/tabs/OverviewTab.tsx`: the live model
  stage is a fixed `lg:h-[440px]`. Its top sits at ~374 px for an online robot
  and ~452 px under the offline banner, so at 1280x720 the robot's legs are
  below the fold. The panel is stretched to the height of the controls column
  (Skill, Quick actions, Odometry ≈ 700 px for SimBot-01), leaving ~170 px of
  empty panel under the stage.
- `app/src/features/robots/components/RobotOfflineBanner.tsx`: for a robot a
  supervisor covers it stacks the message, the readiness reason and
  "Start robot side" (~147 px, more with failing rows).
- `app/src/features/training/components/datasets/TrajectoryPanels.tsx`: an
  unpaired legend (GR00T's `left_shoulder_pitch` … `left_wrist_yaw`) is capped
  at three lines; seven joints take four, so `left_wrist_yaw` scrolls out of
  sight with no hint.
- `app/src/features/training/components/datasets/EpisodeViewer.tsx`: the
  "Episode N · i of M" tag is absolutely positioned over the camera grid's top
  right, which is the wrist camera's picture on a two-camera dataset at 1920
  wide and the head camera's at 1280.

### Frontend

- Live model stage on `lg`: `clamp(300px, 100dvh - 398px, 640px)` for an online
  robot, `clamp(300px, 100dvh - 476px, 640px)` for an offline one (the banner
  sits above it). The panel is `xl:self-start`, so it is as tall as its stage
  and the stage fills it. Narrow screens keep 280 / 340 px.
- Offline banner: with a supervisor, on `lg` the message, the readiness reason
  and Start robot side share one row; failing readiness rows wrap below. New
  `inline` prop on the compact `RobotReadinessPanel` variant does the row
  layout; the VR launcher's compact panel is unchanged. "Start the robot side
  below" becomes "here", since it is beside the message on a wide screen.
- Joint legend: 14 px lines and 2 px row gap, capped at four lines
  (`3.875rem`) for paired and unpaired legends alike: seven joints, or seven
  pairs and their key, fit whole; the paired legend gets 14 px shorter, the
  unpaired one 2 px taller.
- Episode tag: its own row above the cameras (`viewer-header`), never over a
  picture, for one camera and for several.

### Key files

- `app/src/features/robots/components/tabs/OverviewTab.tsx`
- `app/src/features/robots/components/RobotOfflineBanner.tsx`
- `app/src/features/robots/components/readiness/RobotReadinessPanel.tsx`
- `app/src/features/training/components/datasets/TrajectoryPanels.tsx`
- `app/src/features/training/components/datasets/EpisodeViewer.tsx`
- tests next to each under `__tests__/`

## Acceptance Criteria

- [x] At 1280x720 and 1440x900 the whole G1 is visible without scrolling on
      the Overview tab of an online robot (SimBot-01) and an offline one
      (demo-g1-dex3); all information and controls stay present.
- [x] A supervised offline robot's banner keeps the message, the reason and
      Start robot side in one row on a wide screen (147 px → 71 px in the
      demo build).
- [x] SimBot-01's live model panel has no empty band under the stage.
- [x] At 1280x720 the GR00T left-arm legend lists all seven joints, the plot
      keeps its height (96 px before and after).
- [x] The episode tag covers no camera picture on the NVIDIA (one camera) and
      bottle (two cameras) datasets at 1280x720, 1440x900 and 1920x1080.

## Test Strategy

- Vitest: `OverviewTab` stage classes (online / offline) and `xl:self-start`;
  `RobotOfflineBanner` row layout only with a supervisor;
  `RobotReadinessPanel` compact `inline` row vs column; legend line cap;
  episode tag in its own header row before every video.
- Screenshots at 1280x720, 1440x900, 1920x1080 before and after, from a local
  Vite dev server proxied read-only to the live API (robots `sim-robot-001`,
  `demo-g1-dex3`; datasets NVIDIA GR00T AppleToPlate, Bottle Sorting) and from
  the MSW demo build for a supervised offline robot (`demo-generic-001`).

## Notes

- The panel is no longer stretched to the controls column. At 1440x900 the
  SimBot-01 live model panel therefore ends ~110 px above the Odometry card,
  outside the panel instead of an empty band inside it. Filling the whole
  column would put the robot's legs below the fold at 1280x720 again, which
  the first criterion rules out.
