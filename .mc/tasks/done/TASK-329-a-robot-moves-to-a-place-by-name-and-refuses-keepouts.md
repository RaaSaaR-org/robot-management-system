---
id: "TASK-329"
aliases: []
title: "A robot moves to a place by name and refuses keepouts"
slug: "a-robot-moves-to-a-place-by-name-and-refuses-keepouts"
status: "done"
priority: 3
owner: "huhn511"
projects: []
customers: []
tags: [core, robot-agent]
sprint: ""
parent: "[[TASK-274]]"
depends_on: ["[[TASK-328]]"]
spe: 5
effort: "medium"
due_date: ""
created: "2026-09-30"
updated: "2026-09-30"
---

# A robot moves to a place by name and refuses keepouts

## Description

The agent's `move` tool and `roboctl move "<place>"` resolve destinations from the
robot's place graph (loaded by TASK-328) instead of `/api/zones`, and refuse any
target that lies in a keepout place, naming it. Epic TASK-274.

## Details

### Current state

- `robot-agent/src/tools/navigation.ts` (454 lines): fetches `${serverUrl}/api/zones`
  (`fetchZones`, ~`:84-125`), derives named locations from AABB zone centres
  (`deriveNamedLocationsFromZones`, `:44-80`, with hard-coded `home` /
  `charging_station` fallbacks at `:35-36`), refuses `type === 'restricted'`
  zones (`validateDestinationZone`, `:219-237`, used at `:333-340`), exposes
  `clearZoneCache`. The move tool accepts `{x,y}` or `{zone}`.
- The place graph and resolver the agent already holds: `robotStateManager` place
  awareness (`robot-agent/src/robot/state.ts` `initPlaceAwareness` / `adoptPlaceGraph`),
  `robot-agent/src/agent-mode/place-resolver.ts`, keepout geofence in
  `robot-agent/src/agent-mode/geofence.ts`. Place polygons are metres; a place has
  `id`, `name`, `placeType`, `polygon`, `keepout`.
- Registration gate: `place-frame.ts` — when the graph is unregistered (real robot,
  TASK-325) places are unknown.
- `robot-agent/cli/src/commands/control.ts:35-54`: `move <x> <y> [--zone] [--floor]`
  — coordinates only. `robot-agent/src/agent/agent-card.ts:78` describes zones.
- Docs: `CLAUDE.md` (`roboctl move "Warehouse A"` at ~`:151`, `:159`),
  `robot-agent/cli/README.md:22`.

### Robot Agent

- `navigation.ts`: delete the `/api/zones` fetch, zone cache, AABB helpers and
  `clearZoneCache` (and its callers). Named destinations resolve against the current
  place graph: match place `id` case-insensitively, then `name`, then `placeType`
  (so "charging station" → the nearest `charging` place). The target point is the
  polygon centroid. Keep `home` → `(0,0)` as the only built-in alias.
- Keepout refusal: if the target point (named or `{x,y}`) lies inside a keepout place,
  return `success:false`, message `Cannot navigate to "<name>" — it is a keepout.`,
  field `keepout: <place id>`. When the graph is unregistered or absent, named
  destinations fail with a clear "no registered place graph" message and coordinate
  moves proceed as today (the geofence remains the safety layer).
- Update the tool description and `agent-card.ts` to speak of places.
- The move tool input: `{ place }` replaces `{ zone }`.

### CLI / Docs

- `control.ts`: `roboctl move <place>` or `roboctl move <x> <y>`; `--zone` becomes
  `--place`. A single non-numeric argument is a place name.
- `CLAUDE.md` and `robot-agent/cli/README.md`: "Warehouse A" → `"CHARGING-A"`.

### Key files

- `robot-agent/src/tools/navigation.ts` (+ tests), `robot-agent/src/agent/agent-card.ts`,
  `robot-agent/cli/src/commands/control.ts`, `robot-agent/cli/README.md`, `CLAUDE.md`,
  `robot-agent/src/utils/__tests__/platform-clients.test.ts` (drops the `/api/zones` case)

## Acceptance Criteria

- [x] `git grep -n "api/zones" robot-agent/` finds nothing.
- [x] `roboctl move "CHARGING-A"` (and the agent's move tool with `place: "charging-a"`)
      drives the sim robot to that place's centroid.
- [x] A move whose target is inside `RACK-A` is refused with a message naming `RACK-A`.
- [x] With no registered graph, a named move fails with an explicit message.
- [x] `CLAUDE.md` and `robot-agent/cli/README.md` no longer mention "Warehouse A".
- [x] robot-agent + cli typecheck and vitest pass.

## Test Strategy

Vitest over a fixture graph (use `places.warehouse.json`): id/name/placeType
resolution, case-insensitivity, centroid, keepout refusal for named and `{x,y}`
targets, unregistered graph. CLI parse test for `move <place>` vs `move <x> <y>`.
Sim check: bound sim robot, `roboctl move "CHARGING-A"`, then ask to move into RACK-A.
