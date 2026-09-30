---
id: "TASK-333"
aliases: []
title: "location.place is a robot's only answer to where it is"
slug: "location-place-is-a-robot-s-only-answer-to-where-it-is"
status: "review"
priority: 3
owner: "huhn511"
projects: []
customers: []
tags: [core, robot-agent, server, app]
sprint: ""
parent: "[[TASK-274]]"
depends_on: ["[[TASK-329]]", "[[TASK-330]]"]
spe: 5
effort: "medium"
due_date: ""
created: "2026-09-30"
updated: "2026-09-30"
---

# location.place is a robot's only answer to where it is

## Description

Remove `RobotLocation.zone` end to end — agent, server, app — so `location.place`
(from the twin-bound place graph) is the single answer to "where is this robot",
with the smallest containing place winning when zones overlap. The simulator stops
inventing zones and the `'Warehouse A'` default goes. Epic TASK-274.

## Details

### Current state

- `robot-agent/src/robot/types.ts:92-98` — `RobotLocation` has both `zone` and `place`.
- `robot-agent/src/robot/SimulationEngine.ts` (478 lines): `zoneCache` (`:55`),
  `setZoneCache` (`:123`), zone tracking writing `location.zone` (`:131-180`, gated
  when a place resolver is active), `cachedChargingStation … zone: 'charging'`
  (`:159`); uses `robot-agent/src/robot/zoneUtils.ts` (`isPointInZone`).
  `robotStateManager.setZoneCache` in `robot-agent/src/robot/state.ts:~1674`.
  After TASK-329 nothing feeds the zone cache any more.
- `robot-agent/src/config/config.ts:45,48,828,830,1058`: `initialLocation.zone`
  (`INITIAL_ZONE`, default `'Warehouse A'`), `zoneCacheTtlMs` (`ZONE_CACHE_TTL_MS`).
- Other agent readers: `agent-mode/peers.ts:34,132` (peer `zone`),
  `agent/agent-executor.ts`, `robot/CommandExecutor.ts`, `safety/SafetyMonitor.ts`,
  `cli/src/utils/output.ts`, tests `robot/__tests__/simulation-zone-authority.test.ts`,
  `state-durable-safety.test.ts`. The `zone_violation` safety stop is the keepout
  geofence and **stays** (it is about keepout places, not the removed field).
- `robot-agent/src/agent-mode/place-resolver.ts:613-637` `findPlace()`: picks the
  deepest-margin match (comment says graphs are non-overlapping and cites the fleet
  `Zone` floor rule).
- Server: `RobotLocation.zone` (`server/src/services/RobotManager.ts:78`),
  `server/src/types/deployment.types.ts:227`. After TASK-330 nothing server-side reads it.
- App: `app/src/features/robots/types/robots.types.ts:158,329,349,557`,
  `robots/components/RobotDetailPanel.tsx:171`, `robots/components/tabs/InfoTab.tsx:54`,
  `fleet/hooks/useFleetStatus.ts:169`, `fleet/types/fleet.types.ts:117`.

### Robot Agent

- `place-resolver.ts findPlace()`: among containing places on the floor, the
  **smallest polygon area** wins (twin zones may overlap — a CHARGING-A inside a
  hall room); ties fall back to the deepest margin. Rewrite the comment.
- Delete `RobotLocation.zone`, `SimulationEngine` zone cache/tracking/`setZoneCache`,
  `state.ts setZoneCache`, `zoneUtils.ts` (+ its tests), `zoneCacheTtlMs`,
  `INITIAL_ZONE` and the `'Warehouse A'` default, peer `zone`. The sim's charging
  station becomes `{ x, y, place: <charging place id or null> }`.
  `simulation-zone-authority.test.ts` is rewritten or deleted accordingly.
- `.env.example` files and dev profiles: drop `INITIAL_ZONE` / `ZONE_CACHE_TTL_MS`.

### Server

- Remove `zone` from `RobotLocation` and deployment types.

### Frontend

- Remove `zone` from robot/fleet types; `RobotDetailPanel`, `InfoTab` (row label
  "Place"), `useFleetStatus` and `formatLocation` (`robots.types.ts:557`) show
  `location.place`.

### Key files

Listed in Current state; `git grep -n "location\.zone\|\.zone\b\|INITIAL_ZONE\|zoneUtils\|setZoneCache"`
is the checklist.

## Acceptance Criteria

- [x] `RobotLocation` has no `zone` field in agent, server or app; `git grep -n
      "INITIAL_ZONE\|zoneUtils\|setZoneCache\|Warehouse A" -- robot-agent server app`
      finds nothing.
- [x] With overlapping places (a small one inside a big one), `location.place` reports
      the small one while inside it.
- [x] The sim robot still reports a place at boot and after moves; the keepout
      `zone_violation` stop still fires.
- [x] App robot views show the place.
- [x] Typecheck + vitest pass in all three components.

## Test Strategy

Vitest: place-resolver smallest-area on overlap and tie-break; SimulationEngine no
longer writes a zone; config without `INITIAL_ZONE`; app views render `place`.
Sim check: `roboctl status` shows `place:` and no zone.
