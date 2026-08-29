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

## Measured on the live rig — 2026-08-30

The rig now runs end to end (TASK-229 + TASK-230), so the arrival problem could be
measured rather than argued about. Robot spawned at `table_front` via
`NEODEM_ROBOT_SPAWN`, GR00T Recipe A serving on :8000, 200 rollout steps.

**The chain works.** Observation (43 joints from `rt/lowstate` + both Dex3 topics,
8 ms old, complete) -> `/predict` -> the 31-dim action contract -> the manip inlet
-> Isaac. Every step reported `applied=28 ignored=3`, the three ignored being the
waist keys the wholebody provider parks. `thumb_1` swept [0.0682, 0.2055] rad --
exactly the decoder's measured OPEN and CLOSE endpoints, so the grip code is being
decoded once and reaching the hand.

**Base stability, three regimes, ground truth from the sim's own pose line:**

| regime | displacement |
| --- | --- |
| idle, no arm commands, 30 s | **0.4 mm** |
| the policy's own reaching, 100 steps | **8 mm** (and *toward* the table) |
| one large hand-authored arm command | **306 mm** |

The robot held `(10.2404, 5.8536) yaw 1.5511` to four decimals for 10,000 steps,
then moved only once arms were commanded, with `cmd=[0,0,0,0.80]` throughout --
no velocity was ever asked for. The legs come from `policy.onnx` and are unaware
of the arm targets, so a large CoM shift is answered by stepping.

**What this means for arrival.** 306 mm is ~10x the grasp margin and put the apple
out of reach; 8 mm is nothing. So the arrival budget is not threatened by the
policy's own motion -- it is threatened by any LARGE arm command, and by the
approach walk. The reach-feasible standing region, measured by executing
`grasp_reach()` on a 1 cm grid at the authored heading against
`GRASP_REACH_BUDGET = 0.55`:

  x [9.810, 10.730] (0.920 m wide), y [5.800, 6.440] (0.640 m deep)

with the authored spot at reach 0.5152, margin +0.0348 m. The table's near face at
y = 6.00 clips it, so the standable-and-feasible band is **y in [5.80, 6.00]** --
0.20 m deep and 0.92 m wide. It is far more forgiving in x than in y.

**Consequence for option 3.** Placing the robot for the manipulation phase is now
cheap (`NEODEM_ROBOT_SPAWN=table_front`) and measurably lands inside the band. It
remains the least interesting outcome, but it is no longer a stand-in for an
unmeasured thing: the residual after a walked approach is what needs measuring,
and the band above is the target it has to hit.

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
