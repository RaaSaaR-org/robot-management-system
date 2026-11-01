---
id: "TASK-399"
aliases: []
title: "The controller trigger closes a Dex3 hand without its thumb hitting the fingers"
slug: "the-controller-trigger-closes-a-dex3-hand-without-its-thumb"
status: "done"
priority: 1
owner: "huhn511"
projects: []
customers: []
tags: ["core", "g1", "teleop", "vr", "dex3"]
sprint: ""
parent: ""
depends_on: []
spe: 1
effort: "low"
due_date: ""
created: "2026-10-17"
updated: "2026-10-17"
---

# The controller trigger closes a Dex3 hand without its thumb hitting the fingers

## Description

In the first real-robot VR session (2026-10-17) squeezing the Quest controller
trigger closed the G1's left Dex3 so far that the thumb drove into the index
finger, and three hand motors latched a fault. The trigger grasp must stop short
of any thumb-finger contact.

## Details

**Current state (before the fix).** The controller trigger drives
`gripPose(side, grip)` in `robot-agent/src/teleop/dexpilot.ts`: `thumb_0`
(rotation) stays at 0, every other Dex3 flexion joint moves toward its closing
limit times `GRIP_DEPTH`, which was `0.9`.

**What happened on the real G1.** After squeezing the trigger, three motors of
the LEFT Dex3 — wire indices 1, 2, 3: both thumb flexion joints and one finger
base — went into a latched fault: `HandState` `motor_state` mode 0,
`motorstate` `0x200`. They no longer respond until the robot restarts; the other
four motors of that hand still follow commands.

**Why.** An offline MuJoCo contact sweep of
`robot-agent/hardware/sim_evaluator/mjcf/g1_dex3_pickplace_scene.xml` sets the
hand to the `gripPose` shape at increasing depth (thumb_0 at 0, every other
thumb/index/middle joint at its closing limit times the depth), runs
`mj_forward`, and takes `mj_geomDistance` between every thumb geom and every
index/middle geom. Closest approach along the squeeze 0 → depth:

| depth | closest thumb-finger approach |
| ----- | ----------------------------- |
| 0.9   | 0.0 mm — `thumb_1_link` passes through `index_1_link` from about 0.7 on |
| 0.5   | 14.2 mm |

Identical on both hands. The sweep was a one-off scratch script (MuJoCo Python
bindings, ~35 lines) and is not checked in; the procedure above reproduces it.

### Robot Agent

- `GRIP_DEPTH` `0.9` → `0.5`, now exported, with the reason in its doc comment.
- Tests: two assertions adjusted for half travel, and a new test
  "closes at most half way, so the thumb never reaches the fingers (TASK-399)"
  that pins `GRIP_DEPTH <= 0.5` and checks every thumb/index/middle joint of
  `gripPose(side, 1)` on both hands stays within half its travel.

**Key files**

- `robot-agent/src/teleop/dexpilot.ts`
- `robot-agent/src/teleop/__tests__/dexpilot.test.ts`

## Acceptance Criteria

- [x] `gripPose(side, 1)` closes every Dex3 flexion joint at most half way on
      both hands.
- [x] The MuJoCo contact sweep leaves at least 10 mm between thumb and
      index/middle geoms along the whole squeeze (14.2 mm measured).
- [x] A full trigger still produces a real squeeze (index_1 beyond 40 % of its
      closing limit), not a twitch.

## Test Strategy

`cd robot-agent && npx vitest run src/teleop/__tests__/dexpilot.test.ts
src/api/__tests__/keyboard-teleop-wrists.test.ts` and `npm run typecheck`. On
the robot: squeeze the trigger fully and confirm the thumb stops clear of the
index finger and no `HandState` motor reports mode 0 / `0x200`.

## Notes

### Follow-up

- The real G1 must restart to clear the three latched left-hand motor faults;
  until then wire indices 1, 2, 3 of the left Dex3 do not respond.
- The right hand's silent driver is a separate issue: check it by reseating the
  right wrist connector.
