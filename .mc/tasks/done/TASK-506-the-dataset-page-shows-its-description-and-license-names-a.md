---
id: "TASK-506"
aliases: []
title: "The dataset page shows its description and license, names a G1's joints, shows when a video buffers and moves the chart where no video plays"
slug: "the-dataset-page-shows-its-description-and-license-names-a"
status: "done"                # backlog | todo | in-progress | review | done | cancelled
priority: 2                   # 1=critical, 2=high, 3=medium, 4=low
owner: "claude"
projects: []
customers: []
tags: ["datasets", "episode-viewer", "demo", "ui", "core"]
sprint: ""
parent: ""
depends_on: []
spe: 4
effort: "medium"
due_date: "2026-11-16"
created: "2026-11-14"
updated: "2026-11-14"
---

# The dataset page shows its description and license, names a G1's joints, shows when a video buffers and moves the chart where no video plays

## Description

A second review of the live instance (https://neodem.emai.dev, build
`5a66bda4`, 2026-11-14) before the demo day of 2026-11-16 found four gaps on
the dataset episode page (`/datasets/:id/episodes`), the page the dataset part
of the demo is told from. All four are in the app; this task closes each with
the smallest change. No server, robot-agent or data change.

## Details

### Current state

1. **Description and license are never shown.** The server returns
   `description` and `sourceLicense` on every dataset
   (`server/src/repositories/VLARepository.ts:197`), and three Hub-sourced
   datasets carry a license (`cc-by-4.0`, `apache-2.0`). The page header
   (`app/src/features/training/pages/DatasetEpisodesPage.tsx`) shows counts,
   status, LeRobot version and provenance only; `sourceLicense` is not even in
   the app's `Dataset` type.
2. **The G1 apple datasets' trajectory legend reads `left_arm[0]`…`left_arm[6]`.**
   GR00T exports name all 43 channels `observation_to_policy` /
   `action_from_policy`, which `realChannelNames()` rightly rejects, so
   `channelLabels()` in
   `app/src/features/training/components/datasets/episodeFormat.ts` falls back to
   group and index from `meta/modality.json` (`left_leg` 6, `right_leg` 6,
   `waist` 3, `left_arm` 7, `right_arm` 7, `left_hand` 7, `right_hand` 7).
   The joint order inside those groups is known in this repo:
   `robot-agent/hardware/sim_evaluator/envs/g1_apple_env.py` (the AppleToPlate
   modality layout), `robot-agent/src/vla/action-contracts.ts`
   (`G1_APPLE_STATE_JOINT_NAMES`), `robot-agent/hardware/sim_g1_dds/joints.py`
   and `robot-agent/src/recording/dex3-layout.ts`. The Dex3-1 hands are not
   mirrors: left is thumb, middle, index; right is thumb, index, middle.
3. **No buffering indicator.** `CameraCell` in
   `app/src/features/training/components/datasets/EpisodeViewer.tsx` shows a
   spinner while a video's first answer is awaited, but nothing when a playing
   video stalls mid-episode (`waiting`) on a slow link.
4. **Nothing moves where no camera can play.** Both apple datasets are AV1;
   Safari without a hardware AV1 decoder cannot play them. `EpisodeViewer`
   then disables Play and Seek (`nothingPlayable`), and the clock in
   `app/src/features/training/hooks/useEpisodePlayback.ts` only follows the
   primary `<video>`'s `timeupdate`, so the trajectory cursor stays at 0:00.

### Frontend

1. Render `dataset.description` under the page header, clamped to two lines
   (full text on hover), and `sourceLicense` as a neutral tag in the meta row,
   just before the provenance line, for datasets that have them. Add
   `sourceLicense` to `Dataset`.
2. In `channelLabels()`, when info.json gives no real names and the groups are
   exactly the seven GR00T G1 43-DOF groups with those widths, label each
   channel with the G1 29-DOF + Dex3-1 joint name from the repo's tables above.
   Any other layout keeps group and index.
3. In `CameraCell`, a `waiting` event from a playing video shows a small
   spinner over that camera (`pointer-events-none`) once the stall has lasted
   300 ms, cleared on `playing`, `canplay` or `seeked`.
4. When no camera can play (every declared codec refused by the browser), the
   page passes `videoless` to `useEpisodePlayback`; Play then runs a
   `requestAnimationFrame` clock at the chosen speed up to the episode's
   metadata duration, Seek sets the time directly, and `EpisodeViewer` no longer
   disables the two controls. The codec notice adds that Play and Seek still
   move the joint chart's cursor. The video clock is untouched: the timer only
   runs while no `<video>` is mounted.

### Key files

- `app/src/features/training/pages/DatasetEpisodesPage.tsx`
- `app/src/features/training/types/training.types.ts`
- `app/src/features/training/components/datasets/episodeFormat.ts`
- `app/src/features/training/components/datasets/EpisodeViewer.tsx`
- `app/src/features/training/components/datasets/videoCodec.ts`
- `app/src/features/training/components/datasets/datasetFormat.ts`
- `app/src/features/training/hooks/useEpisodePlayback.ts`
- tests next to each under `__tests__/`

## Acceptance Criteria

- [x] The NVIDIA and SO-101 datasets show their description (two lines at most)
      and a `License:` tag; the bottle dataset shows its description and no tag.
- [x] On both G1 apple datasets the left-arm legend reads `left_shoulder_pitch`…
      `left_wrist_yaw`, the left-hand legend `left_hand_thumb_0`…`left_hand_index_1`
      in the Dex3 order; the bottle dataset's names are unchanged.
- [x] A playing video that fires `waiting` shows a spinner over its camera that
      lets clicks through and goes on `playing` / `canplay` / `seeked`.
- [x] With every camera's codec refused, Play and Seek are enabled and move the
      trajectory cursor; the notice says to use Chrome or Firefox. Nothing
      changes where a camera can play.
- [x] Unit tests cover each change; app typecheck and vitest pass.

## Test Strategy

Vitest for `channelLabels`, the buffering spinner, the video-less clock (fake
`requestAnimationFrame`) and the header. Screenshots at 1280×720 and 1440×900
of the NVIDIA, G1 apple and bottle datasets against a local preview build
proxied to the live API (read-only GETs). WebKit for the AV1 path where it runs.

## Notes

- The license tag sits before the provenance line, not after it: after it, it
  wrapped onto a row of its own at 1280×720 and pushed the transport bar 10 px
  below the fold on the NVIDIA dataset. Before it, the header has the same rows
  as without a license, and the transport bar ends at 703 of 720 px on all
  three datasets (883 of 900 at 1440×900), as on the live build.
- The joint table differs from the one the review proposed: the review gave
  both Dex3-1 hands as thumb, middle, index. The right hand is thumb, index,
  middle (`sim_g1_dds/joints.py`, `recording/dex3-layout.ts`,
  `g1_apple_env.py`, which checked it against the AppleToPlate data ranges).
- WebKit (Playwright WPE 26.5) runs on this host only with system libraries
  extracted from Ubuntu debs into a scratch directory and a launcher that adds
  them to `LD_LIBRARY_PATH`. Its `canPlayType` refuses AV1 (and H.264, for
  want of GStreamer plugins here), so every dataset takes the video-less path
  there: Play moved the clock and the chart cursor from 0:00.0 to 0:02.0 in
  two seconds on all three, at both sizes.
- Chromium, NVIDIA episode 0 at 1 Mbps / 400 ms: the buffering spinner showed
  in 7 of 40 half-second samples while the clock crept to 0:09.6; unthrottled,
  the video path plays as before.
