---
id: TASK-209
aliases:
- TASK-209
title: "`goto` a place by name — the robot walks INTO a room it has never seen, planning on its map — plus the explore-and-remember demo video"
slug: goto-a-place-by-name-and-the-memory-demo
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
- '[[TASK-208]]'
due_date: ''
created: 2026-08-16
updated: 2026-08-16
completed: 2026-08-16
status_note: |
  DONE 2026-08-16 — PR #227. Verified 2026-08-16: `goto {"place"}` → Navigator.navigateToPlace (centroid / deepest interior point, staged planned walking, by-sight fallback, honest stop), resolvePlaceByName with a one-sentence "known places" refusal, planner vocabulary line, entity XOR place, memory question → speak. Live on the house scene: "walk into the kitchen" planned on the map and arrived (place chip → Kitchen). Demo clip `robot-agent/hardware/sim_g1_dds/clips/demo-task209-explore-and-remember.mp4` exists locally (clips/ is gitignored — publish it as a release asset if the video is a deliverable).
  FIXED IN REVIEW (9523325/08c5aff): the status-rail PlaceChip said "Place unknown" before the first look (scene snapshot null) while the map said "Hallway" — the state now carries the belief at the top level and is pushed on every place change, so the rail follows the robot through doorways.
  POST-MERGE PASS 2026-08-16: `walk into the kitchen` re-run live (12 stages planned on the map, arrived 0.60 m from the centre). Fixed here: `goto <entity>` aborted on the first refused stage that `goto place` treats as a re-plan point (two refusals tolerated); the goto card read "planned 0.0 m in 0 segments" after arrival, because the navigator's last re-plan is from the goal itself.
---


# `goto` a place by name — the robot walks INTO a room it has never seen, planning on its map — plus the explore-and-remember demo video

## Description

`goto` could only target something the camera had seen (`{"entity": "table"}`). "Walk into the
kitchen" therefore needed a `scan_room`, a lucky VLM label and line of sight. The place graph
already gives the robot rooms as polygons; let `goto {"place": "Kitchen"}` plan a route to a room's
centre on the occupancy map (TASK-208), walk it in stages, discover the doorway on the way, and
say "Arrived in Kitchen" once the pose is inside. Then record the demo the feature exists for: one
robot explores the whole house, its camera / map / durable memory in three panes, and it still
knows what it was told after a restart.

## Details

### Robot Agent

- `src/agent-mode/navigator.ts` — `navigateToPlace(place)`: goal = `placeGoal()` (area centroid, or
  the deepest interior point for a concave room); loop = plan on the map → turn onto the first
  segment → walk ≤ `AGENT_NAV_MAX_SEGMENT_M` (planned) → look every `AGENT_NAV_LOOK_EVERY_M` /
  across unknown floor; no path yet → one bounded stage BY SIGHT towards the centre under the
  executor's clamps, then re-plan (the map grew). Arrival = pose inside the polygon by
  `PLACE_ENTRY_MARGIN_M` (0.3, the resolver's hysteresis) and within `PLACE_ARRIVAL_M` (1.0) of the
  centre, or inside and stalled (furniture on the centre). Progress is measured on the REMAINING
  PLANNED LENGTH while a path exists (leaving the kitchen for the living room first walks away from
  the living room). Empty map at start → one `look` first (its lidar frame restores the persisted
  map) instead of a blind stage. Keepout places refused by name; a fenced centre refused naming
  the fence.
- `agent-mode-controller.ts` — `runGoto()` dispatches `params.place` → `resolvePlaceByName()`
  against the graph (registered frame only), lists the known places on a miss; `knownPlacesLine()`
  injects `Places on the map (use goto with "place" …): Hallway (here), Kitchen, …` into the
  planner prompt.
- `place-resolver.ts` — `resolvePlaceByName()` (id/name, any case, `-`/`_` as spaces, articles
  ignored, unique substring).
- `planner.ts` / `prompts.ts` — `goto` takes `entity` XOR `place`; block reference + rules; a
  QUESTION about memory ("what do you remember about this room?") is a `speak` from the injected
  notes, never a `remember` (measured with gemma4:e2b: it re-filed the note).
- `path-planner.ts` — the pre-walk `checkStraightSegment` classifies by the same cell centre the
  planner does, and the disc boundary is rounded IN with a tolerance: the two once disagreed by one
  ulp on the hallway crate (plan said free, check said "obstacle 0.20 m ahead", three identical
  re-plans, robot stood still).
- `config.ts` — `AGENT_NAV_PATH_MARGIN_M` (default 0.05) on top of the footprint radius for
  planning: a path string-pulled 0.353 m past the arch post was refused by the executor's 0.35 m
  lidar corridor. 0.10 already found no path through the 1.1 m (mapped 1.0 m) doorways.
- `occupancy-map-keeper.ts` — `getMap()` restores the persisted map on first read once the boot id
  is known, so a restarted agent answers `/map` and plans before it has moved.
- `hardware/sim_evaluator/mjcf/g1_dex3_house_scene.xml` — the crate moves from in front of the
  workshop door (0.63 m channel < 0.70 m footprint: no route into the workshop at all) to
  mid-hallway. `sim_node.py` — `POST /sim/reset-pose {"body": "<static prop>", x, y, yaw}`
  re-places a scene prop.
- `hardware/sim_g1_dds/demo_clip.py` — `--layout memory` (camera / map / memory panes, `MemLog`
  samples `MEMORY.md`, place notes and the journal), `--map-window`, `--places` (room outlines),
  `--card`, `--concat`.

### Frontend

- `app/src/features/agentmode/utils/blockFormat.ts` — a `goto` with `place` reads "into Kitchen".

## Test Strategy

- `navigator-place.test.ts` (12): through the doorway never the wall, arrival near the centre,
  already-there, keepout / fenced-centre refusals, needs the planner, discovery (by sight → planned
  once the map knows the door), a route that first leads away, look-before-plan on an empty map,
  honest stop when blocked; `resolvePlaceByName`, `placeGoal`.
- `nav-plumbing.test.ts` (+3): dispatch by name, unknown name lists places, unregistered frame.
- `planner.test.ts` (+2), `path-planner.test.ts` (+1 plan/check agreement),
  `occupancy-map-keeper.test.ts` (restore on read), app `blockFormat.test.ts`.
- Live: `clips/demo-task209-explore-and-remember.mp4` — kitchen (7 stages, 5.0 m, through the
  yellow door), remember, one command "explore the living room, the bedroom and the workshop …
  come back to the kitchen" (4 legs, ~8 m each, all arrived), restart, "what do you remember about
  this room?" → "I remember that the sink is at the right end of the counter here".
