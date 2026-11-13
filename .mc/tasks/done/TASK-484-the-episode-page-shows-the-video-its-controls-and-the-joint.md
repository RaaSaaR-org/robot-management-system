---
id: "TASK-484"
aliases: []
title: "The episode page shows the video, its controls and the joint chart together, and the controls tell the truth after switching episodes"
slug: "the-episode-page-shows-the-video-its-controls-and-the-joint"
status: "done"                # backlog | todo | in-progress | review | done | cancelled
priority: 1                   # 1=critical, 2=high, 3=medium, 4=low
owner: "claude"
projects: []
customers: []
tags: ["datasets", "ui"]
sprint: ""
parent: ""
depends_on: []
spe: 8
effort: "high"
due_date: "2026-11-16"
created: "2026-11-13"
updated: "2026-11-13"
---

# The episode page shows the video, its controls and the joint chart together, and the controls tell the truth after switching episodes

## Description

Found in a hands-on browser test of the demo instance on 2026-11-13 (Chromium and
Firefox, three imported datasets). The episode page
(`app/src/features/training/pages/DatasetEpisodesPage.tsx`) is the page the demo on
2026-11-16 spends most of its time on, and it could not be presented:

**(a) The controls lied after an episode switch.** Playing at 2× and clicking another
episode left the new video paused at 0:00 at 1× while the button showed Pause and
"2×" stayed highlighted; clicking the highlighted 2× did nothing. `isPlaying` was
never reset or re-applied when the episode changed, and the speed reached the
`<video>` only when the speed *state* changed.

**(b) The page could not be watched.** The play/seek bar was below the fold on first
load at every viewport tested (top at 812 px on 1280×720, 898 px on 1440×900,
1144 px on 1920×1080); the joint chart started 450 px further down, so nobody could
see the frame cursor move while seeing the video; the statistics panel sat about
2000 px down.

**(c) Small things on the same page.** The clock floored the playhead (19.67 s read
0:19 under a rounded total); the chart's cursor was missing at t = 0 and at the very
end; a seven-channel joint group reused a colour at half opacity; the first load
asked for `…/video/observation.images.wrist` — a guess made before the dataset row
had arrived — and got a 404; the Curate "End frame" placeholder and the chart's
"N samples" showed the previous episode's numbers while the next one loaded.

## Decisions

- **An episode switch keeps playing, at the chosen speed.** It is what a presenter
  stepping through episodes wants. What the viewer asked for (play, speed) lives in
  one hook and is put back on every `<video>` when it has loaded; whatever stops
  playback for real — the end, a failed load, a refused `play()`, a pause the
  browser makes — comes back to the same place. An episode opened after one that
  *ended* waits for Play. Another dataset starts paused.
- **One screen, measured, not guessed.** From `lg` up the stage (episode list, video
  with the transport bar, joint chart) is exactly as tall as the window has left
  under the page header, with a 380 px floor and a 900 px cap. Under 540 px of
  stage the chart sits beside the video; from 540 px it sits under it. Beside
  needs width: a window narrower than 1280 px always stacks, and the stage is
  then at least 620 px tall — a short scroll at 1024×768 rather than a chart
  squeezed into a 200 px column.
- **Everything else is a tab under the stage**, state in `?tab=`: Curate (default),
  Annotations, Task progress (when the episode has a reward curve), Episode
  discussion, Statistics, Views, Dataset discussion. The one-line robot-type
  verdict stays outside the tabs, directly under the stage — it is a status, and a
  status behind a tab is a status nobody reads.
- **The cursor is drawn over the chart, not inside it.** Redrawing fourteen lines for
  every time update is what made playback stutter; the lines are now drawn once per
  episode and group, and the cursor glides between two updates.
- **Ten channel colours, as tokens** (`--chart-channel-1…10`, `chartChannelColor()`),
  separate from `chartColors.series`, whose first and fifth colour are both mint.

## Acceptance Criteria

- [x] Playing at 2× and opening another episode: the new episode plays at 2×, the
      button shows Pause and 2× is highlighted — state and elements agree.
- [x] After the video ends the button shows Play and the clock reads total / total;
      the next episode opened then waits for Play.
- [x] A primary video that fails to load leaves the button on Play; with every
      camera in a codec the browser refuses, Play and Seek are disabled.
- [x] Clicking the highlighted speed applies it again.
- [x] At 1280×720, 1440×900 and 1920×1080, for one and for two cameras, the episode
      list, the video(s), the transport bar and the joint chart with its cursor are
      inside the first screen; four cameras tile 2×2 in the same space.
- [x] Below `lg` the page is one column and everything is reachable by scrolling;
      no horizontal overflow at 390 px.
- [x] Curate, Annotations, Episode discussion, Statistics, Views and Dataset
      discussion are tabs under the stage; `?tab=` opens one directly.
- [x] The clock shows tenths on both sides (`0:19.7 / 0:19.7`) and never runs past
      the total.
- [x] The chart cursor is on the chart at t = 0 and at the very end.
- [x] A seven-channel group has seven different colours, none at reduced opacity.
- [x] No video URL is built before the dataset row has arrived; a dataset whose
      camera is `ego_view` never requests `observation.images.wrist`.
- [x] While the next episode loads, the "End frame" placeholder is that episode's
      frame count, a typed trim range is cleared, and no sample count is shown.

## Notes

- Verified in Chromium and Firefox at 1280×720, 1440×900, 1920×1080 and 390×844
  against a local server holding the full `nvidia/GR00T-N1.7-AppleToPlate` import
  (AV1, one camera, 43-wide). Two and four cameras were exercised by serving the
  same video under extra camera keys.
- The joint chart still opens on the group that moves most in the episode on
  screen (`mostActiveGroup`, TASK-476) — "left arm" on both apple datasets — and
  keeps the viewer's own pick across episodes. That was already the meaningful
  group; nothing changed there.
- `DatasetExpectationsPanel` moved from above the stage to directly under it.
- The social e2e specs open the page with `?tab=discussion`.
