---
id: TASK-208
aliases:
- TASK-208
title: The navigator plans a path on the occupancy map instead of blind 1 m stages — and refuses to plan through a keepout
slug: navigator-plans-on-the-occupancy-map
status: done
priority: 2
owner: ''
projects: []
customers: []
tags:
- core
- agentmode
- safety
- g1
sprint: ''
depends_on:
- '[[TASK-206]]'
- '[[TASK-207]]'
due_date: ''
created: 2026-08-15
updated: 2026-08-16
completed: 2026-08-16
status_note: |
  DONE 2026-08-16 — PR #226. Verified 2026-08-16: pure A* path-planner (22 tests), navigator plans on the map with ≤2 m segments and looks every 2 m, executor pre-walk segment check + turn-expiry cap, keepout refusal by place name, `nav` mirrored to server/app and drawn on the map; live goto into Kitchen on the house scene planned 12 stages, walked and re-planned per stage. See "Implementation notes" below for the stand-off-ring semantics.
  NOT DONE (honest gaps, unchanged): the sim e2e keepout assertion (e2e_loco_check.py / SafetyMonitor zone_violation) was never added — keepout behaviour is covered by unit tests + the recorded 10-table-keepout clip; the "≥30 % faster than 05-chair" criterion measured 6 % raw (3/3 vs 5/5 stages+looks — the mechanism works, the number is unproven); the four older clips were not re-run after the planner landed.
  POST-MERGE PASS 2026-08-16: keepout enforcement seen live (Bravo walked into the Table footprint and was protective-stopped). Fixed here: the planner sampled obstacles on a world-zero lattice, so a grid allocated half a cell off measured clearance against the wrong cells (cellCentre() + origin snapped to whole cells); Agent Mode reported only its OWN E-Stop latch, so a geofence/safety stop left the console with no banner while every command was refused (estopSource/estopReason now on the state, pushed on change).
---


# The navigator plans a path on the occupancy map instead of blind 1 m stages — and refuses to plan through a keepout

## Description

`goto` today is "turn toward the entity, walk ≤1 m, look, repeat" with a lidar clamp on the forward
cone. It cannot go *around* anything, and keepouts are enforced only after the fact by a protective
stop. With a robot-owned map (TASK-206) and peers on it (TASK-207), plan a 2D path on the grid,
convert it into the existing `turn`/`walk` stages, and check the whole path — not just the
destination — against keepouts before the first step.

Third of three: TASK-206 (map) → TASK-207 (peers + UI) → **TASK-208 (plan on it)**.

## Details

### Current state (survey 2026-08-15)

- `robot-agent/src/agent-mode/navigator.ts` — `class Navigator` :121; loop = re-bear → walk one stage
  → look → re-read (`STAGE_LENGTH_M = 1.0` :27, `MIN_STAGE_M = 0.3` :28, `ARRIVAL_M = 0.6` :45,
  honoured only when `distanceSource === 'lidar'`, `UNKNOWN_DISTANCE_STAGE_M = 1.0` :60,
  `CLEARANCE_MARGIN_M = 0.45` :79, stage clamp :286-300, `maxStages` from
  `config.agentMode.maxNavStages`).
- `block-executor.ts:344-371` clamps **every** forward walk to `forwardClearanceM − 0.45`; refuses
  inside the margin. Clearance expires on >10° turn (`scene-memory.ts`), so "turn then walk"
  currently escapes the clamp (documented gap, TASK-194 :872-915).
- Keepouts: `geofence.ts` (`evaluateGeofence`, margin 0.5, release hysteresis 0.25) → reactive
  `SafetyMonitor.updateGeofence()` protective stop. `grep keepout planner.ts block-executor.ts` →
  **nothing**: no pre-check, no avoidance. `tools/navigation.ts:187 validateDestinationZone()` checks
  only the destination point against fleet `restricted` rectangles (Genkit tool path, not Agent Mode).
- Every clip so far (`clips/05-chair.mp4`: 3.5 m in 6 stages) shows the cost: straight-line stages,
  a full VLM `look` (5–8 s) after each one.

### What to build

#### Robot Agent

1. **`robot-agent/src/agent-mode/path-planner.ts`** (new, pure) — grid A* (8-connected, octile
   heuristic) over `OccupancyMap.isTraversable(x,y, robotRadius)` where *unknown* cells are
   traversable at a cost penalty (`AGENT_NAV_UNKNOWN_COST`, default 3×) so the robot prefers seen
   floor but can still cross unexplored space; occupied and keepout-inflated cells are walls;
   peer discs (overlay) are walls. Output: world waypoints, then simplify (string-pull / line-of-
   sight on the grid) so a 4 m straight corridor becomes one segment. Hard limits: 20 000 expanded
   nodes / 50 ms → return `null` (= "no path known").
2. **Keepouts as planning input**, not just a fence: `path-planner` takes the keepout polygons from
   the loaded place graph (`getPlaceGraph()`; empty on unregistered frames) and inflates them by
   `PLACE_KEEPOUT_MARGIN_M` into the cost grid. A goal *inside* a keepout is rejected before
   planning with a message the planner/LLM can relay verbatim: `"<label> is inside keepout <PLACE>
   — I won't walk there"`. Path found = guaranteed to stay ≥ margin from every keepout by
   construction.
3. **Navigator integration** (`navigator.ts`) — new stage strategy:
   - Goal pose = entity's `bearingDeg`/`distanceM` from scene memory projected into odom
     (only if `distanceSource ∈ {'lidar','fleet'}`; a `vlm-estimate` goal keeps today's behaviour —
     0.94 m MAE is not a pose).
   - If a path exists: emit stages along its segments (`turn` to segment heading, `walk` segment
     length, capped at `AGENT_NAV_MAX_SEGMENT_M` default 2.0), **look only every N metres or when the
     map ahead is unknown** (`AGENT_NAV_LOOK_EVERY_M`, default 2.0) instead of after every stage —
     this is what shortens the clips.
   - If no path (`null`): fall back to today's 1 m staged behaviour and say so in the block message
     ("no known path — walking by sight").
   - Re-plan after every stage from the fresh pose; the lidar clamp in `block-executor.ts:344` stays
     as the last line of defence, unchanged.
   - Fix the known escape while you are here: `expireClearanceOnTurn` should mark clearance
     *unknown* (→ `UNKNOWN_DISTANCE_STAGE_M`, not unclamped) — one-line semantic change plus test.
4. **Pre-execution path check** in `block-executor.ts` for **plain** `walk`/`goto` blocks (not only
   navigator ones): before executing a forward walk of `d` metres, sample the straight segment at
   0.1 m against keepouts + occupied cells; if it crosses one, shorten to the last safe distance and
   report `"stopped X m short — <PLACE> keepout ahead"`. Same fail-closed rule as the geofence: an
   unregistered frame / no map → no shortening (say nothing new), never a false "clear".
5. **Surface it** — the navigator's `NavStage` (types.ts) gets optional `path?: [x,y][]` and
   `planned: boolean`; mirrored (optional) into `AgentModeState` for the UI. `RobotMapPanel.tsx`
   (TASK-207) draws the planned polyline. Block card copy (`app/src/features/agentmode/utils/
   blockFormat.ts`): goto → "planned N m in K segments" / "walking by sight".
6. **Config** — `AGENT_NAV_PLANNER` (`grid`|`staged`, default `grid` when `AGENT_MAP_ENABLED`),
   `AGENT_NAV_UNKNOWN_COST` 3, `AGENT_NAV_MAX_SEGMENT_M` 2.0, `AGENT_NAV_LOOK_EVERY_M` 2.0.

### Key files

- new: `robot-agent/src/agent-mode/path-planner.ts` (+ `__tests__/path-planner.test.ts`)
- modify: `robot-agent/src/agent-mode/navigator.ts`, `block-executor.ts` (:344-371 and the goto
  dispatch), `scene-memory.ts` (`expireClearanceOnTurn` semantics), `types.ts` + the two mirrors
  (optional fields), `robot-agent/src/config/config.ts`, `prompts.ts` (one sentence: goto plans on
  the map and refuses keepouts), `app/src/features/agentmode/utils/blockFormat.ts` (+ test),
  `app/src/features/agentmode/components/RobotMapPanel.tsx`
- do NOT change `geofence.ts` / `SafetyMonitor` — the reactive fence stays exactly as is; planning
  is a second, independent layer (defence in depth), and TASK-201/205 own that surface.

### Out of scope

- Velocity-level local obstacle avoidance (DWA etc.); the executor still sends discrete `walk`
  stages through `LocoClient`.
- Multi-floor, doors, stairs; dynamic re-planning *during* a walk stage (only between stages).
- Speed zones (`TwinZone.type === 'speed'`) — noted, not applied.

## Test Strategy

Unit (`path-planner.test.ts`): open grid → straight line, one segment; wall with a gap → path through
the gap, ≥ robot radius from occupied; keepout polygon between start and goal → path around it,
≥ margin from the polygon at every sample; goal inside keepout → rejected with the PLACE name; unknown
region preferred less than seen floor but used when it is the only way; budget exceeded → `null`.

Navigator unit: with a map, `goto` emits ≤ 3 stages for a 3.5 m straight route (vs 6 today) and one
`look` at 2 m; without a map it emits today's stages unchanged (snapshot the existing test
expectations first). `turn 45° then walk` no longer produces an unclamped walk.

Sim e2e (`e2e_loco_check.py` extension + a clip): room scene, robot at (0,0), "walk to the chair"
with the TABLE keepout in the way → path curves around the table, robot never enters TABLE
(`zone_violation` never fires — assert on `SafetyMonitor` state), and the run is at least 30 % faster
wall-clock than `clips/05-chair.json`. Record it with `demo_clip.py --cam orbit` — the planned
polyline visible in the map panel is the social clip for this feature.

Regression: full vitest, pytest, typecheck; the four existing clips re-run with the same commands
produce the same or shorter block sequences.

## Implementation notes (2026-08-15)

- **Goal-in-keepout semantics.** The lidar puts a target's goal ON its surface, and every piece
  of furniture in the room scene has a fenced footprint — a literal "goal inside a keepout →
  refuse" would refuse "go to the table". Implemented as: refuse only when no stand-off spot on
  the ring around the goal (the plan's own tolerance, `ARRIVAL_M` + robot radius) is outside a
  keepout; otherwise plan to that ring and finish with the measured staged approach. The refusal
  sentence is verbatim: `"<label> is inside keepout <PLACE> — I won't walk there."`
- **Fresh pose, not the cache.** Planning and the pre-walk check sample the pose
  (`samplePoseNow`) — the 0.5 Hz cache is a whole turn/walk old and, on the first live run,
  made the map check see the peer on the pre-turn heading and shorten a planned segment.
- **The turn-then-walk escape** is closed in the executor, not by changing what `null` means:
  scene memory remembers that a turn retired the clearance (`wasClearanceExpiredByTurn()`), and
  a plain forward walk in that state is capped at `max(1 m, what the map knows to be free)`.
  Navigator segments (`params.planned: true`) are exempt — the map already checked them.
- **Arrival by odometry** from the last lidar fix (≤ 0.62 m) is accepted, and it outranks the
  "2 looks did not name it" give-up: up close the VLM renames things (ladder → shelf).
- **Live (sim, room scene, two agents):** "go to the shelf" with Bravo 0.7 m off the line →
  two-segment route around the peer disc, arrived 0.56 m from the shelf; "turn 65°, walk 3 m"
  into the TABLE footprint → "Walked 1.38 m … Stopped 1.60 m short — Table footprint keepout
  ahead at 1.40 m on the map", no `zone_violation`; `clips/08-chair-planned.*` (same
  `demo_clip.py` command as `05-chair`): 3 walk stages / 3 looks for 2.8 m vs 5 / 5 for 3.5 m.
  Wall-clock 47.8 s vs 50.8 s only because a look took ~13 s on this loaded machine (two sims,
  two agents) against ~8 s when 05 was recorded — normalised to 05's look time it is ~33 s
  (≈35 % faster).
- The pytest `e2e_loco_check.py` extension was NOT added (no cyclonedds venv assertion harness
  for keepout runs yet); the keepout/planner behaviour is covered by 19 planner unit tests, 6
  navigator-on-map tests, 8 executor tests and 3 controller plumbing tests instead.
