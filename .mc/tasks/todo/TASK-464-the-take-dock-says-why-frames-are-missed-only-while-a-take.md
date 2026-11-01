---
id: "TASK-464"
aliases: []
title: "The take dock says why frames are missed, only while a take captures, and keeps the quick check"
slug: "the-take-dock-says-why-frames-are-missed-only-while-a-take"
status: "todo"                # backlog | todo | in-progress | review | done | cancelled
priority: 2                   # 1=critical, 2=high, 3=medium, 4=low
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

# The take dock says why frames are missed, only while a take captures, and keeps the quick check

## Description

The take dock's blocker "Frames are being missed. The robot agent is
unreachable; retrying." is hard-coded. In the 2026-10-31 sim rehearsal the agent
was reachable; the real reason was "teleop is not engaged" (a take started
before anyone drove). The blocker is also sticky: the agent's
`consecutiveDrops` resets only on a captured frame, so after Stop the degraded
flag stays true between takes, the blocker keeps the dock slot, and the quick
check (Short, No motion, Discard) never shows. It stayed through takes 1 to 3.
This task shows the real drop reason, shows the blocker only while a take
captures, and resets the counter at every take boundary.

Branch: `fix/task-464-the-take-dock-says-why-frames-are-missed-only-while-a-take`.

## Details

### Current state

Checked on `main` at `a600c27e`.

- Robot agent, `robot-agent/src/recording/EpisodeRecorder.ts`:
  - `:63`: `DEGRADED_AFTER_CONSECUTIVE_DROPS = 15`;
  - `:1164-1169`, `drop()`: `consecutiveDrops += 1`, `lastDropReason = reason`;
    `:1003-1009`, `missTicks()` does the same for late ticks;
  - `:1047-1049`: `drop('teleop is not engaged')` while no teleop is active;
  - `:1149`: `consecutiveDrops = 0` only after a captured frame;
  - `:578-579`: both reset only at session start;
  - `:624-645` `beginEpisode()` and `:648-668` `endEpisode()` touch neither;
  - `:1221-1222`: status `degraded: consecutiveDrops >= 15`, `lastDropReason`.
- Server, `server/src/services/teleoperation/liveState.ts:153-154`: copies
  `degraded` and `lastDropReason` into the live state.
- App:
  - `app/src/features/datacollection/types/datacollection.types.ts:178`:
    `LiveState.lastDropReason`;
  - `app/src/features/datacollection/pages/SessionDetailPage.tsx`:
    - `:621`: `degraded = !!(live?.degraded || recordingProgress?.degraded)`;
    - `:938-942`: `blockerKind` is `'degraded'` whenever `isRecording && degraded`
      (the session is recording, not the take);
    - `:1009-1013`: the fixed text "Frames are being missed." / "The robot agent
      is unreachable; retrying.";
    - `:275`: `capturing = sessionStatus === 'recording' && live?.phase === 'capturing'`;
  - `app/src/features/datacollection/components/console/TakeDock.tsx:53-60`
    (`dockSlotKind`: recovery over blocker over check) and `:122` (the check
    only between takes). A blocker between takes therefore hides the check.
- Overlap: TASK-434 (d) turns `lastDropReason` into words for the dock's
  readouts. This task owns the blocker, its timing and the agent's counter. Use
  one helper for the words (for example `dropReasonText()` in
  `app/src/features/datacollection/utils/`): whichever task lands second reuses
  the first's.

### Robot Agent

- `beginEpisode()` and `endEpisode()` reset `consecutiveDrops` to 0.
  `beginEpisode()` also clears `lastDropReason`; `endEpisode()` keeps it, since
  the take's report (`:807-808`, "no frames recorded — <reason>") reads it.

### Frontend

- `blockerKind` is `'degraded'` only while `capturing`, not while the session
  merely records.
- The blocker's text comes from `lastDropReason` through the shared helper:
  `teleop is not engaged` → "Nobody drives the robot yet. Take control and move.";
  `behind: …` and `late: …` → "The robot agent is busy; frames are late.";
  `agent_unreachable` → today's "The robot agent is unreachable; retrying.";
  anything else verbatim; null → "The recorder is missing frames." Never claim
  "unreachable" for another reason.
- Between takes the slot shows the quick check whenever there is one.

### Key files

- `robot-agent/src/recording/EpisodeRecorder.ts`
- `robot-agent/src/recording/__tests__/EpisodeRecorder.test.ts`
- `app/src/features/datacollection/pages/SessionDetailPage.tsx`
- `app/src/features/datacollection/utils/dropReason.ts` (new, unless TASK-434
  created it)
- `app/src/mocks/teleopTakesDemoHandlers.ts` (`:163` has the
  `agent_unreachable` fixture; add `teleop is not engaged`)
- `app/e2e/datacollection-takes.spec.ts`

## Acceptance Criteria

- [ ] After a take whose ticks dropped, `degraded` is false at Stop, and the
  next take starts with `consecutiveDrops` 0.
- [ ] Between takes the dock shows the quick check, never the degraded blocker.
- [ ] While a take captures with teleop not engaged, the blocker says nobody
  drives the robot, not that the agent is unreachable.
- [ ] An unknown reason shows verbatim; no reason shows the neutral sentence.
- [ ] Vitest covers the agent reset and the helper; a Playwright demo block
  covers the blocker during a take and the check after it.

## Test Strategy

- Robot-agent vitest: drop 20 ticks in a take (`isTeleopActive` false), end the
  take, assert `degraded` false and `lastDropReason` kept; begin the next take,
  assert both reset.
- App vitest: the helper's mapping; `blockerKind` with `capturing` false and
  `degraded` true gives no blocker.
- Playwright on `demo-session-takes`: the drop fixture shows the sentence while
  capturing, and the quick check after Stop.
- On `sim-g1-edu-dev`: start a take before taking control, read the sentence,
  take control, stop, and see the quick check.

## Notes

- Found in the 2026-10-31 sim rehearsal ("'Frames are being missed. The robot
  agent is unreachable' is wrong and sticky, and it hides the quick check").
- Workaround: judge each take from its takes-list row (frames, "N dropped",
  Short / No motion), and have the operator take control before Start take.
