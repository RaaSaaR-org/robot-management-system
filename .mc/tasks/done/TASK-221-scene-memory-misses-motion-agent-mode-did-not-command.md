---
id: TASK-221
aliases:
- TASK-221
title: Scene memory misses motion Agent Mode did not command — and five smaller navigation follow-ups from the TASK-194 review
slug: scene-memory-misses-motion-agent-mode-did-not-command
status: done
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
updated: 2026-08-27
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

**Status (2026-08-27): all six implemented on `fix/agent-mode-nav-followups`,
with one residue left open on purpose.** Each item carries its own **Done** note
below, including the corrections the adversarial review forced. The residue is
under item 1 ("Left open, deliberately"): an uncommanded drive that takes no
control lock and reaches a `goto` before anything pulls controller state is
still invisible, bounded by 15 s of mirror interval plus 2 s of pose-cache age.
It is stated in the navigator's pre-flight-look comment as a latency, not
glossed as a "sampling window". Item 3's benchmark was run on `gemma4:e4b`
(`gemma4:e2b` is not installed here) and is recorded under item 3: the fold-on
and fold-off runs are byte-identical, because this model never produces the
`turn + walk` shape the fold consumes.


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

**Done (2026-08-27).** Both candidate fixes shipped, because neither covers the
other's half. `SceneMemoryStore` gained `noteOdometryM(x, y)` — a MEASURED
account of the same window `noteTranslationM` describes in commanded metres,
kept as a high-water mark of the displacement from the pose the robot looked
from. The two are never summed: `hasMovedSinceObservation()` takes the larger,
so a stage that was commanded and measured counts once, a base that fell short
still counts the commanded metres, and metres nobody commanded show up with no
command to cover them. Two feeds supply it — `BlockExecutor.refreshYaw`, which
already awaited `loco.odometry()` and threw the position away, and
`AgentModeController.notePolledOdometry`, which samples the hardware client's
cached base pose — and the lock hook wipes the scene outright when teleop or VLA
takes control. The two routes motion takes are covered by different mechanisms,
and the distinction matters for what is left open below: a driver who TAKES the
control lock is covered by the wipe, and one who does not (a shove, the handheld
remote, a direct sidecar POST) by the measured feeds.

**Two defects the adversarial review found in the first cut, both fixed here,
both reproducing `Arrived at "table" after 0 stages` with the target 4.55 m
away:**

- *The first fix of a window RE-ANCHORED instead of expiring.* `noteOdometryM`
  returned early whenever it had no anchor to measure against — the state after
  a `look` merged with no odometry behind it, and `/loco/odom` answering null is
  routine (2 s timeout, null on any hiccup), not a fault. Seed a look through
  that hiccup, let odometry recover, push the base four metres with nobody
  holding the lock, and the first fix to land BECAME the anchor and expired
  nothing. Now that fix expires: a window that opened with no fix behind it is
  UNMEASURED, not zero, and unmeasured is reported as moved until the next look
  re-opens the window at a pose the store knows. The verdict deliberately waits
  for a fix rather than being pronounced at the merge, so a robot whose sidecar
  has no `/loco/odom` at all behaves exactly as it did before odometry fed this
  store instead of paying a look on every `goto`.

  *As first cut, this only ever fired ONCE per store* — `lastOdomM` is never
  nulled after the first fix, so `merge()` and `clear()` re-anchored on it
  unconditionally and every later window looked measured whether or not
  odometry had spoken across it. Same failure, later in the run: fix at (0,0),
  look A, `/loco/odom` starts timing out, the base is shoved to (4,0) and look
  B merges there but SILENTLY keeps (0,0) as its anchor, the base is shoved
  back, odometry recovers at (0,0), and `odomFromAnchorM` is 0 with the target
  4.55 m away — `Arrived at "table" after 0 stages` again (N1). Fixed by a
  monotonic sequence counter over accepted fixes: `SceneMemoryStore` records
  the count when it opens a window (`reopenOdomWindow`, called from `merge` and
  `clear`) and adopts `lastOdomM` only when the count has advanced since, which
  is exactly "a fix arrived since the last look". No clock, no threshold. An
  anchorless window is therefore reachable at any point in a store's life, not
  just before its first fix; the unmeasured verdict still waits for the next
  fix, for the reason above.
- *The pose-poll half was inert without a place graph.* It read
  `RobotStateManager.getPlaceBelief()`, which answers null outright when no
  place graph is loaded (`onPoseSample` returns on the same condition, so the
  belief is never populated). That is not a sampling window — it is the steady
  state of every robot nobody has surveyed, and on all of them a shove, the
  handheld remote or a direct sidecar POST stayed invisible. It now reads the
  controller's `getPose()` — the hardware client's cached base pose, refreshed
  on the same 2 s `/state` poll with or without a map — so it answers on an
  unmapped robot too. A displacement is the same number in either frame, and a
  `CachedBasePose` is odometry or it is absent, which retires the old
  `poseSource === 'declared'` guard. That guard was written to keep an
  operator's re-anchor out of the arithmetic and could never have done it:
  `RobotStateManager.declarePlace()` (`src/robot/state.ts`) deliberately leaves
  `poseSource` at whatever odometry last said — a human declares a PLACE, not a
  position — so no re-anchor ever presented itself as `'declared'`. What made it
  harmless is that the same method carries `poseM` through untouched, so the
  displacement is zero either way. The lock guard stays — the cached pose is up
  to 2 s old and would re-expire a look the agent has already redone
  mid-navigation.

**Left open, deliberately, and written into the navigator's pre-flight-look
comment rather than glossed as a "sampling window":** `notePolledOdometry` is
not a poll of its own. It rides `syncPlace()`, which is pull-driven
(`getState`, `getScene`, `sceneMarkdown`, `selfState`, `memoryDigest`,
`plannerSceneSummary`, `plannerSceneTargets`); the only self-driving caller in
the process is `remirrorState()` via `livenessState()` → `getState()`,
rate-limited to `MIRROR_REPUSH_INTERVAL_MS` = 15 s. The 2 s is
`HardwareClient`'s `/state` cadence and bounds how OLD a fix is, not how often
the store hears one. And Agent Mode claims the control lock BEFORE it plans, so
the feed is muted from the claim onwards and a `goto` cannot make up a fix it
missed. So an uncommanded drive that takes no lock and is followed by a command
before anything pulls controller state is still invisible, and still ends at
stage 0 — bounded by 15 s of mirror interval plus 2 s of cache age. Closing it
means subscribing to `HardwareClient.onPoseSample` instead of sampling on pull.

**Tests.** `__tests__/scene-memory.test.ts` (the two accounts, the high-water
rule, the unmeasured window and the no-odometry robot that must not pay for it),
`__tests__/navigator.test.ts` (both 0-stage arrivals, teleop and odometry-down),
`__tests__/control-owner.test.ts` (the lock hook, and the pose feed on a robot
with NO place graph). Two existing fixtures now seed an odometry fix before the
look they merge by hand, which is the order production works in —
`observeAndMerge` refreshes the pose on its way into every merge.


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

**Done (2026-08-27).** The first option, made explicit in the type:
`VisionEntity.bearingDeg` is now OPTIONAL and the `: 0` fallback is gone — an
entity the model placed neither by `x` nor by `bearingDeg` carries no bearing at
all. There is no in-band number that can mean "I do not know which way": every
finite value is a direction, and 0 is the most expensive one to invent, being
the only one that needs no correction turn.

The drop propagates exactly as far as a direction is needed and no further:

- `BlockExecutor.observeAndMerge` no longer hands an unplaced entity to the
  range sensor. It builds the cone list from the placed bearings only and walks
  the readings with its own cursor, so an unplaced sighting consumes nothing —
  the old code aimed a cone at 0°, measured whatever the robot was facing, and
  stored that metre wearing `distanceSource: 'lidar'`.
- `SceneMemoryStore.merge` refuses to store a row without one, so nothing
  downstream can steer on it, and `observedSeq` does not move for it — which
  leaves the last look that COULD place that label standing, correctly
  unconfirmed, instead of being overwritten by a fabricated 0.
- `dedupeByLabel`/`moreCentral` rank a placed instance above an unplaced one
  whatever else the two carry. Reading an absent bearing as 0 had made the
  unplaceable instance the MOST central of the pair, so it won the label and the
  frame's real, well-placed door was thrown away for it.
- `Navigator.projectGoal` now takes a stored `SceneEntity` rather than an
  `ObservedEntity`: a stored row always has a world bearing, and only
  `scene.get` feeds it, so the narrower type costs nothing and makes an unplaced
  sighting unprojectable by construction. `goto` on such a label refuses with
  the honest "not in the scene memory" it already had.

What deliberately does NOT change: the sighting itself survives in the
`VisionObservation`. That the robot SAW a person is real whether or not it can
say which way, and the idle watcher greets on `personVisible` alone — so an
unplaced entity still counts towards `personVisible` and towards the
`currentView` label fallback.

**Tests.** `__tests__/vision.test.ts` — `:175` (`x: null`) and `:194` (an `x` in
pixels) now assert the entity carries NO `bearingDeg` (`.not.toHaveProperty`)
rather than 0; `:107` (`x: 0.5` really is 0°) is untouched and green. A new case,
*counts an UNPLACED sighting towards personVisible and currentView*, pins the
paragraph above — it was documented on `VisionEntity.bearingDeg` and asserted
nowhere, so widening the drop to "skip the entity entirely" would have walked a
visitor past an unplaced greeting with the suite still green.
`__tests__/scene-memory.test.ts` covers the merge refusal and the dedupe rank;
`__tests__/navigator-executor.test.ts` covers the whole chain end to end (one
cone, aimed at the table; the door absent from the store and from the summary;
`goto "door"` refused without the base moving).


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
walk 3 m" will not produce. *(Overstated — see the third correction below.)*

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

**Done (2026-08-27).** `PlannerInput` gained `sceneTargets?: readonly
PlannerSceneTarget[]` — the same rows as numbers, next to the prose, reaching
nothing in the prompt — supplied by
`AgentModeController.plannerSceneTargets()` from `scene.listEntities()`.
`foldTurnWalkIntoGoto` (`planner.ts`) runs over the model's answer next to
`enforceTurnDirection`: an adjacent `turn` + forward `walk` whose two numbers
both belong to one scene row becomes a single `goto` to that row's label.
Tolerances are 12° and 0.5 m, sized off what the summary prints (whole degrees,
one decimal metre) and defended in a comment at the constants; the fold refuses
an ambiguous match rather than choosing a destination by array order, and
matches only the RELATIVE bearing, never the world bearing the summary prints.
`scripts/planner-bench.ts` now passes `sceneTargets` too, so it benches the
planner the controller actually drives.

**Three corrections to the description above, found while implementing it:**

- *"the clearance EXPIRES … which makes the clamp a no-op"* is **stale**.
  TASK-208 shipped a third clamp in `BlockExecutor.walk()` — a clearance the
  robot has turned away from means UNKNOWN AHEAD and caps the walk at
  `UNKNOWN_DISTANCE_STAGE_M = 1.0 m`. So `turn 96° + walk 4.4 m` was a blind
  1 m dash at a door 4.4 m away, not an unclamped 4.4 m run: a wrong-shaped
  plan, not a collision path. The fold is still the right repair — it replaces
  the dash with a staged, re-bearing, re-looking approach — but the item's
  severity was overstated.
- The same staleness applies to the TASK-208 reference this item asks to
  annotate: `.mc/tasks/done/TASK-208-…md:54-55` had already stopped being true
  when TASK-208 itself merged. The note left there says so and points at both
  changes.
- *"a coincidence a genuine 'turn left and walk 3 m' will not produce"* is
  **false as written**, and was never a property of the plan shape — only of one
  scene. All four rows of the bench's reference room (`scripts/planner-bench.ts`)
  miss a "turn 90, walk 3" pair, which is what made the claim look true; a room
  holding anything at roughly 90° and roughly 3 m folds it, and
  `foldTurnWalkIntoGoto([turn(90), walk(3)], [whiteboard at 88° / 3.3 m])`
  returns `['goto']`. No tolerance that tolerates the rounding this repair
  exists to catch could rule that out, so the windows were left at 12° / 0.5 m
  and the reason moved to where it actually holds: because the fold matches the
  RELATIVE bearing, a wrong fold still ends within 12° of the heading and 0.5 m
  of the range the operator named — the windows bound their own worst case — and
  the robot gets there staged and re-bearing rather than blind. The constants'
  comment now says that instead, and
  `__tests__/planner.test.ts` pins the whiteboard case so tightening them has to
  be a deliberate act.

**Benchmark: run on `gemma4:e4b` — and it measures nothing about this fix.**
`GET localhost:11434/api/tags` lists `gemma4:12b`, `gemma4:e4b`,
`qwen3.6:latest`, `qwen3-vl:8b`; none of `planner-bench.ts`'s four
`DEFAULT_MODELS` (`gemma4:e2b`, `gemma4:latest`, `qwen2.5vl:7b`, `gpt-oss:20b`)
is installed, so the A/B below is on `gemma4:e4b` — a different model, and
labelled as one.

The before/after was taken by stubbing out the one `foldTurnWalkIntoGoto` call
in `planner.ts` and re-running the same 18 cases × 3 repeats (2026-08-27):

| fold | plans that would do the right thing | open-loop dashes | fallbacks | repair passes |
|---|---|---|---|---|
| off (before) | 51/54 (94%) | 0 | 0 | 3 |
| on (after)   | 51/54 (94%) | 0 | 0 | 3 |

**The two runs are byte-identical — same md5.** That is not a broken A/B, it is
the finding: `gemma4:e4b` never emits the `turn + walk` pair the fold consumes
on any of these 18 commands, so the fold never fires. Every fold-enabled run
logs zero `[AgentMode/Planner] folded turn …` lines, and that grep is the check
to run before trusting any future bench A/B on this fix.

Two cautions for whoever reads these numbers next:

- **Deterministic within a session, not across them.** An earlier session's
  pair — fold on and fold off, same code, same model — both read 48/54 with 3
  open-loop dashes; today's pair both read 51/54 with 0. Treat the absolute
  number as a session-local reading, not a regression baseline.
- **A CUDA-OOM'd run still prints a full table.** One earlier run read 39/54
  with 9 "honest fallbacks" purely because llama-server was dying under memory
  pressure. `grep -c "out of memory"` the output before believing any row.

The `turn 96° + walk 4.4 m` shape is therefore pinned deterministically
instead, by `__tests__/planner-scene-targets.test.ts` and the
`foldTurnWalkIntoGoto` cases in `__tests__/planner.test.ts` — that, not the
bench, is where the fold's behaviour is actually held.


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

**Done (2026-08-27).** `robot-agent/tsconfig.scripts.json` covers
`scripts/**/*.ts` (extends the base config, `noEmit`, `rootDir` widened to the
package root so the `src/` files reached through the imports are not reported
as outside it), and `npm run typecheck` now runs it after `tsc --noEmit`, so
the rot is loud in every gate rather than only when somebody remembers.
`npm run bench:planner` added. `vitest.config.ts` picks up
`scripts/**/*.test.ts`, and `scripts/planner-bench.test.ts` grades the bench's
own two rules.

**The item paid for itself on the first run.** `tsc -p tsconfig.scripts.json`
failed immediately: the bench typed `Case.check` and `openLoopDashes` on
`AgentBlock[]`, but `Planner.plan` answers `PlannedBlock[]` — no `id`, no
`status`, because nothing has executed them. It only ever worked because the
bench reads `kind` and `params` and nothing else. Fixed to `PlannedBlock`.

`openLoopDashes` is now counted per case — every forward `walk` in a case
flagged `approach: true` — instead of "within 0.06 m of a distance the summary
printed". The old rule missed `walk 4 m` at the 4.4 m door (the exact shape item
3 is about) AND scored the legitimate `walk 2.95 m` of `walk-2m` as a dash.
Dash counts either side of this change are not comparable, which is why the
header prints the rule with the number. The header also names the models and
records `AGENT_PLANNER_THINKING` (read back off `config`, since only the exact
string `"true"` enables it).

**Bench smoke run, `gemma4:e4b`** — labelled as a different model, per item 3:
18 cases × 3 repeats = 51/54 (94%), 0 open-loop dashes, 0 fallbacks, 3 repair
passes, 0.5 s median, only `scan` failing 3/3. The fold-on/fold-off A/B is
recorded under item 3; it comes out byte-identical because the fold never fires
on these cases.


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

**Done (2026-08-27).** `__tests__/navigator-executor.test.ts` — four cases over
a world whose fake loco client integrates `(vx, vy, omega, durationS)` into a
pose and reports that pose back as odometry, a fake camera that reports the
bearing the geometry implies, and a real `RangeSensor` over a synthetic LiDAR
arc. Nothing in the harness talks to scene memory: every bearing, metre and
staleness signal the navigator acts on has to come out of `BlockExecutor`.

BOTH things the item named are tripwired, and each was verified by hand —
delete the line, watch the failure, restore:

- `driveFor` dropping `noteTranslationM` → *does not arrive on a distance the
  executor has since walked the robot away from* fails on its first
  expectation, because the table stored at 0.55 m is inside `ARRIVAL_M` and the
  pre-flight look is the only thing that replaces that metre.
- generated blocks dropping `measured` → the converge case asserts stage
  accounting: every generated `walk` comes back with `measured.distanceM ≥
  CONTACT_STALL_M` (the exact test `stagesThatMoved` applies) and the sum equals
  the metres the world's own odometer recorded. Deleting `measured: { distanceM:
  moved }` from `BlockExecutor.walk`'s success outcome fails it with
  `TypeError: actual value must be number or bigint, received "undefined"`.
  That deletion left all four cases green before this assertion existed: the
  navigator reads `walk.measured?.distanceM ?? null` and a `null` is "no
  odometry", which it is written to forgive, so the loss was silent.

The other two cases cover item 1's teleop half and item 2's unplaced entity at
the executor level.


### Robot Agent — 6. NIT: doc drift on `yawDegOverride`

`robot-agent/src/agent-mode/scene-memory.ts:406-408` says `yawDegOverride` is
"Passed explicitly by `scan_room`, which reads a fresh yaw per step".
`block-executor.ts` passes `undefined` and relies on `refreshYaw`. One of the
two has to change; the comment is the cheap end.

**Key files:** `robot-agent/src/agent-mode/scene-memory.ts`.

**Done (2026-08-27).** The comment changed, not the parameter. `merge()`'s doc
now says that NO production caller passes `yawDegOverride`: the only one that
exists — `BlockExecutor.observeAndMerge`, the funnel behind both `look` and
every `scan_room` step — passes `undefined` and lets the default stand, because
its `refreshYaw` has just written the measured odometry yaw into the store.
`scan_room` does read a fresh yaw per step, but through that call, not through
this parameter. The parameter stays for a caller holding an observation the
store's current yaw does not describe; today only the tests are one. The
forward-clearance comment below it, which justified itself with the same false
claim about `scan_room`, was corrected in the same terms.

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
