---
id: "TASK-228"
aliases: []
title: "The robot must arrive close enough to grasp — odometry alone cannot"
slug: "the-robot-must-arrive-close-enough-to-grasp"
status: "todo"
priority: 2
owner: ""
projects: []
customers: []
tags: ["core", "sim", "agent-mode"]
sprint: ""
depends_on: ["[[TASK-227]]"]
due_date: ""
created: "2026-08-29"
updated: "2026-08-29"
---

# The robot must arrive close enough to grasp — odometry alone cannot

## Description

The factory scene's standing spot has about **0.013 m of reach margin** at the
worst corner of the apple's jitter box. An 8.4 m crossing at the measured
0.11 m/s with ~2°/s of yaw drift will not land inside that. Walking to a
manipulation pose is currently an open-loop bet on dead reckoning.

## Where this stands

TASK-227 fixed two of the three parts and this is the third:

- Heading is now closed-loop (`block-executor.ts`, segmented walk + `turnGain`).
- The standing spot is derived and genuinely reachable — 0.476 m shoulder-to-apple
  in the crouched stance against a 0.550 m budget, checked at both stance heights
  and all four jitter corners.
- **Position is still open-loop.** `isaac_odom.py` measures yaw from the sim's
  quaternion; x and y are dead-reckoned by integrating commanded velocity, and the
  measured tracking ratio is ~0.11 m/s against 0.3 commanded. So the robot does not
  know where it is, only which way it is facing.

Scene memory cannot close this either: it stores `label + bearing + distance`
keyed by lower-cased label, with no 3-D pose (`scene-memory.ts`).

## Details

Three approaches, in preference order.

### 1. A visually-servoed final approach (preferred)
A block that closes on the *table* rather than on odometry: observe, estimate
bearing and range to the table edge, step, re-observe, until within tolerance.
The bearing half is already trustworthy — `bearingFromImageX` measures 7.2° MAE
against 131° when the VLM is asked for degrees directly (`vision.ts:89-93`). Range
is the weak axis; the LiDAR cone in `range.ts` is the obvious source, and
`distanceSource` already distinguishes `lidar` from `vlm-estimate`.

Needs: a new block kind (follow the `vla_skill` plumbing in TASK-226 — three
mirrored type files and every allow-list, two of which fail open), and a decision
about what it servos on when the table is out of frame.

### 2. Widen the margin
Move the apple toward the table's near edge, or raise `GRASP_REACH_BUDGET` if the
arm genuinely supports it. Cheap, but note the reference MJCF scene reaches its own
apple with the arm essentially straight (0.531 m against a 0.533 m straight-arm
knuckle), so there is less headroom here than it looks.

### 3. Place the robot for the manipulation phase
Reset the base to the spot before the `vla_skill` block and film walk and grasp as
two measured segments. Honest if labelled, and it is what the TASK-226 live test
already specifies. The least interesting outcome and should not become permanent.

## Test Strategy

Offline: extend `verify_factory_scene_offline.py` with a check that states the
arrival tolerance the scene requires, so the requirement is recorded rather than
implied. Unit-test any new block in the `block-executor.test.ts` style with a fake
base that integrates translation along the current heading.

Live: ten walked approaches from the spawn pose; record final `(x, y, yaw)` and the
shoulder-to-apple distance. The measure of success is the distribution, not one run.

## Acceptance Criteria

- [ ] The arrival error distribution over ≥10 walked approaches is recorded
- [ ] The robot reaches a pose from which the Dex3 can close on the apple, repeatably
- [ ] Whatever closes the loop reports its own residual honestly, as `walk` now does
- [ ] The scene verifier states the arrival tolerance it assumes
