---
id: TASK-221
aliases:
- TASK-221
title: Scene memory misses motion Agent Mode did not command — and five smaller navigation follow-ups from the TASK-194 review
slug: scene-memory-misses-motion-agent-mode-did-not-command
status: todo
priority: 2
owner: ''
projects: []
customers: []
tags:
- core
- agentmode
- g1
sprint: ''
depends_on:
- '[[TASK-194]]'
due_date: ''
created: 2026-08-25
updated: 2026-08-25
---


# Scene memory misses motion Agent Mode did not command — and five smaller navigation follow-ups from the TASK-194 review

## Description

An independent read of PR #214 (2026-08-01) found eight items in the Agent Mode
navigation stack. One was fixed before that PR merged, two are robot-day
observations that belong to the hardware bring-up, and the remaining six are
still open in shipped, released code — the first of them a live defect that can
make the robot report *"Arrived at table after 0 stages"* without moving.
TASK-194 was closed on 2026-08-25 and they are carried here so they stay
visible.

## Details

### Current state

All six were re-checked against `main` on 2026-08-25 and all six still hold.
They are independent of each other and can ship separately, in any order; item
1 is the only one with a user-visible failure and should go first.


### Robot Agent — 1. HIGH: scene memory only expires distances for motion Agent Mode itself commanded

`SceneMemoryStore` invalidates the distances it holds when the robot
translates, and the ONLY producer of that signal is
`robot-agent/src/agent-mode/block-executor.ts:635`
(`this.deps.scene.noteTranslationM(...)` in `driveFor`).
`SceneMemoryStore.clear()` (`robot-agent/src/agent-mode/scene-memory.ts:587`)
has no caller in `src/` at all — only `__tests__/scene-memory.test.ts:578`.

So any motion that does not pass through the block executor is invisible to the
scene: Quest teleop, a direct `POST` to the G1 sidecar, a VLA rollout, someone
pushing the robot. The failure, end to end:

1. `look` — "table" is stored at 0.55 m, `distanceSource: 'lidar'`;
2. an operator takes the teleop lock, drives 4 m away, releases it;
3. "geh zum Tisch" → `hasMovedSinceObservation()` answers **false**, so the
   navigator's pre-flight look is skipped, and `goto` returns
   *"Arrived at table after 0 stages"* having moved nothing.

The same skip desyncs yaw, so the first stage is sized by a clearance measured
down a heading the robot has since left.

The hole is documented in place — `robot-agent/src/agent-mode/navigator.ts:648-655`
states it rather than claiming coverage — so this is a known gap, not a
surprise, and the comment must be updated (or deleted) by whoever closes it.

Two candidate fixes, roughly 20-40 lines either way:

- track `odom.x` / `odom.y` in `BlockExecutor.refreshYaw`
  (`robot-agent/src/agent-mode/block-executor.ts:908` — it already awaits
  `loco.odometry()`, which returns `{ x, y, yaw, source }`, and keeps only the
  yaw) and feed the measured delta to `SceneMemoryStore.noteTranslationM`, so
  the store learns about motion from odometry instead of from commands. Note
  `refreshYaw` only runs when Agent Mode itself acts, so this alone still misses
  a teleop drive that no block follows — it wants a periodic pose read, or the
  lock hook below; and/or
- call `SceneMemoryStore.clear()` when the control lock leaves `'agent'` —
  `robot-agent/src/agent-mode/control-owner.ts` owns the lock, and
  `agent-mode-controller.ts` is where the two meet.

The first is the better answer on its own (it also fixes the yaw desync); the
second is cheap insurance and independently defensible — what the robot saw
while somebody else was driving is not something it looked at.

**Key files:** `robot-agent/src/agent-mode/block-executor.ts` (`refreshYaw`
`:908`, `driveFor` `:635`), `robot-agent/src/agent-mode/scene-memory.ts`
(`noteTranslationM` `:346`, `clear` `:587`),
`robot-agent/src/agent-mode/navigator.ts` (the pre-flight look and its comment),
`robot-agent/src/agent-mode/control-owner.ts`,
`robot-agent/src/agent-mode/agent-mode-controller.ts`.


### Robot Agent — 2. MED: `vision.ts` fabricates bearing 0 for an entity it cannot place

`robot-agent/src/agent-mode/vision.ts:135-140`: when neither `x` nor
`bearingDeg` is usable the parser falls back to `bearingDeg = 0`, because
`VisionEntity` has no "unplaced" state to fall back to instead.

For `goto` that is arguably worse than the older bug it replaced (a fabricated
+52.65°): 0° needs no correction turn, gets lidar-ranged straight ahead — at
the wall — is then stored with `distanceSource: 'lidar'`, and can end a
navigation nose-to-wall while every provenance field says the number was
measured.

Fix: drop the entity, or carry `bearingKnown: false` (the identifier exists
nowhere in `robot-agent/src/` today) and have `observeAndMerge` skip ranging it
and the navigator refuse to steer on it. About 30 lines.

Note that two existing tests encode the wrong invariant and must change with
it: `robot-agent/src/agent-mode/__tests__/vision.test.ts:175` (`x: null`) and
`:194` (an `x` answered in pixels). Both currently assert `bearingDeg === 0` for
an entity with no position. `:107` is a different, correct case (`x: 0.5` really
is 0°) and must keep passing.

**Key files:** `robot-agent/src/agent-mode/vision.ts`,
`robot-agent/src/agent-mode/scene-memory.ts` (the `VisionEntity` → stored-entity
merge), `robot-agent/src/agent-mode/navigator.ts`,
`robot-agent/src/agent-mode/__tests__/vision.test.ts`.


### Robot Agent — 3. MED: a turn greater than 10° followed by a walk escapes the forward clamp

`block-executor.ts` clamps every forward walk to `forwardClearanceM − 0.45` and
refuses inside the margin — but the clearance EXPIRES on a turn past the yaw
tolerance (`scene-memory.ts`), which makes the clamp a no-op for exactly the
plan shape that matters. `goto-door` fails 3/3 on `gemma4:e2b` as
`turn 96° + walk 4.4 m`. A prompt rule aimed at it was benched and reverted as
noise (51/54 → 51/54, 6 → 5 dashes), so the deterministic repair is the open
option:

when a `turn` matches an entity's relative bearing **and** the following `walk`
matches that same entity's distance, fold the pair into one `goto`. Two
independent numbers off one scene row is a coincidence a genuine "turn left and
walk 3 m" will not produce.

This needs `PlannerInput` to carry structured scene targets, which
`agent-mode-controller.ts` can supply from `scene.listEntities()`. It is the
largest item here and the only one that touches the planner's input contract.

This gap is cited as a stable reference by a task that is already closed —
`.mc/tasks/done/TASK-208-navigator-plans-on-the-occupancy-map.md:54-55` ("turn
then walk currently escapes the clamp (documented gap)") — so closing it means
that line stops being true; leave a note where the reference can be followed.

**Key files:** `robot-agent/src/agent-mode/planner.ts` (`PlannerInput`),
`robot-agent/src/agent-mode/agent-mode-controller.ts`,
`robot-agent/src/agent-mode/block-executor.ts`,
`robot-agent/src/agent-mode/scene-memory.ts`.


### Robot Agent — 4. NIT: `scripts/planner-bench.ts` cannot rot loudly

`robot-agent/scripts/planner-bench.ts` sits outside `robot-agent/tsconfig.json`
(`"include": ["src/**/*"]`) and outside vitest's glob, so it can drift against
`Planner` / `SceneMemoryStore` with nothing to catch it. There is no
`robot-agent/tsconfig.scripts.json` and no `bench:planner` script in
`robot-agent/package.json`.

Add both (about 10 lines). While in there, two things the bench itself gets
wrong and that make an A/B less useful than it looks: `openLoopDashes` matches
only within 0.06 m of a known scene distance, so a `walk 4 m` aimed at the 4.4 m
door is invisible to it; and it inherits `AGENT_PLANNER_THINKING` from the
environment without recording it. Both belong in the printed header.

**Key files:** `robot-agent/tsconfig.scripts.json` (create),
`robot-agent/package.json`, `robot-agent/scripts/planner-bench.ts`.


### Robot Agent — 5. NIT: nothing drives `Navigator` against a real `BlockExecutor`

`robot-agent/src/agent-mode/__tests__/navigator.test.ts` runs against
`makeWorld` (`:95`), a hand-written model that re-derives bearings and calls
`noteTranslationM` itself; `BlockExecutor` appears in that file only in
comments. `navigator-place.test.ts` and `navigator-planned.test.ts` use the same
stand-in.

The model is good, and that is the problem: if `driveFor` stopped calling
`noteTranslationM`, or generated blocks stopped carrying `measured`, all of
those tests would stay green. One integration test that wires a real
`BlockExecutor` (with a fake loco client) into `Navigator` and asserts a
navigation converges is the tripwire — and it is the test item 1 above would
otherwise need reinventing.

**Key files:** `robot-agent/src/agent-mode/__tests__/` (new file, e.g.
`navigator-executor.test.ts`), `robot-agent/src/agent-mode/block-executor.ts`,
`robot-agent/src/agent-mode/navigator.ts`.


### Robot Agent — 6. NIT: doc drift on `yawDegOverride`

`robot-agent/src/agent-mode/scene-memory.ts:406-408` says `yawDegOverride` is
"Passed explicitly by `scan_room`, which reads a fresh yaw per step".
`block-executor.ts` passes `undefined` and relies on `refreshYaw`. One of the
two has to change; the comment is the cheap end.

**Key files:** `robot-agent/src/agent-mode/scene-memory.ts`.

## Test Strategy

Per item, and each one should fail before its fix:

1. **Scene memory / uncommanded motion** — a unit test on the
   navigator + scene store: store an entity at 0.55 m, move the robot 4 m
   WITHOUT going through `driveFor` (drive the pose source directly, as a
   teleop session would), then run `goto`. It must take the pre-flight look and
   must not report an arrival at stage 0. If the fix takes the control-lock
   route instead, add a `control-owner` test that leaving `'agent'` clears the
   scene.
2. **Unplaced entity** — `vision.test.ts:175` and `:194` change from
   "bearing is 0" to "the entity carries no bearing" (dropped, or
   `bearingKnown: false`), plus a navigator test that refuses to steer on one
   and never ranges it. `:107` must stay green unchanged.
3. **Turn-then-walk** — a planner/executor test on the
   `turn 96° + walk 4.4 m` shape: with a scene row for the door at that bearing
   and that distance, the pair folds into one `goto` and the walk is clamped by
   the clearance; a genuine "turn left and walk 3 m" with no matching row does
   NOT fold. Re-run `scripts/planner-bench.ts` on `gemma4:e2b` and record the
   before/after in this file.
4. **planner-bench** — `npx tsc -p robot-agent/tsconfig.scripts.json` is clean
   and `npm run bench:planner` runs; the printed header names the model and
   `AGENT_PLANNER_THINKING`.
5. **Navigator × BlockExecutor** — the new integration test converges, and
   deleting the `noteTranslationM` call in `driveFor` makes it fail (check that
   by hand once; it is the whole point of the test).
6. **Doc drift** — no test; read `merge()`'s callers and make the comment say
   what they do.

Whole-suite gate for any of them:
`cd robot-agent && npm run typecheck && npx vitest run src/agent-mode`.
The `sim_g1_dds` pytest stage needs `SIM_PYTHON` and reports SKIPPED without it
— a green `test-all.sh` does not mean it ran.

## Notes

- Origin: the PR #214 review of 2026-08-01, recorded in
  `[[TASK-194]]` under "Follow-ups from the PR #214 review". Nothing here is an
  original TASK-194 acceptance criterion; they are all post-merge findings on
  code that has shipped and been released (v2026.08.09).
- One item from that review was fixed inside PR #214 before it merged (a VLM
  distance guess could decide contact-arrival) and is not repeated here.
- **Two items were deliberately NOT carried here.** Both are robot-day
  observations that need the G1 on the bench rather than a desk fix, and they
  belong to `[[TASK-169]]` (lab bring-up):
  - LOW — dropping the `MIN_STAGE_M` floor is partly defeated by
    `MIN_DURATION_S`: `walkToCommand` floors duration at 0.2 s, so a 0.001 m
    stage still commands ~0.08 m. No collision path (well inside the 0.45 m
    margin), but a 0.1 m stage on a real base often measures ~0 m, and with
    `stagesThatMoved === 0` a `goto` to something 0.7 m away can fail outright.
  - LOW — `forwardClearance` is blind inside 0.35 m, and blind reads as
    unclamped: "unknown because too near" and "unknown because too far" have
    opposite costs and are the same `null` today. Backstopped by
    arrival-by-contact.
- Priority 2 is for item 1 only. Items 4-6 are nits and would be priority 4 on
  their own; they are here so the review's tail is not lost, not because they
  are urgent.
