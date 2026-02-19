---
id: TASK-038
aliases:
- TASK-038
title: Zone Runtime Improvements (Robot Agent)
slug: zone-runtime-improvements-robot-agent
status: backlog
priority: 3
owner: ''
projects: []
customers: []
tags:
- core
sprint: ''
depends_on:
- "[[TASK-013]]"
due_date: ''
created: 2026-02-19
updated: 2026-02-19
---


# Zone Runtime Improvements (Robot Agent)

## Description
Fix zone overlap detection enforcement on the server and add real-time zone tracking with enter/exit events in the robot agent.

## Details
**Gaps identified from TASK-013 review — zone CRUD works but runtime zone behavior has gaps.**

### Current State
- Server: `server/src/repositories/ZoneRepository.ts` has a `findOverlappingZones()` method that works, but it is **commented out** in `server/src/services/ZoneService.ts` `validateCreateInput()` — zones can overlap without warning
- Robot: `robot-agent/src/tools/navigation.ts` validates destinations against restricted zones and caches zone data with TTL
- Robot: `robot-agent/src/robot/SimulationEngine.ts` (`SimulationEngine`) sets `state.location.zone` only at arrival (`s.location.zone = s.targetLocation.zone`), not during movement
- Robot: No zone enter/exit events are emitted during movement — no previous-zone tracking or boundary detection

### Server (`server/src/`)
- **Enable overlap detection**: Uncomment and wire `findOverlappingZones()` in `ZoneService.validateCreateInput()` and `validateUpdateInput()`. Return overlap warnings or errors when creating/updating zones that overlap with existing ones (allow operational zones to overlap, block restricted zone overlaps)
- File: `server/src/services/ZoneService.ts` — uncomment overlap check, add logic
- File: `server/src/repositories/ZoneRepository.ts` — verify `findOverlappingZones` works correctly with bounds JSON

### Robot Agent (`robot-agent/src/`)
- **Real-time zone tracking**: In `SimulationEngine.tick()`, after updating position, resolve the current zone by checking if the robot's `(x, y)` falls within any cached zone bounds. Update `state.location.zone` on every tick, not just at arrival
- **Zone enter/exit events**: Track `previousZone` in simulation state. When `currentZone !== previousZone`, emit events:
  - `zone_enter` event with zone id, name, type, timestamp
  - `zone_exit` event with zone id, name, type, timestamp
  - Send events via WebSocket to the server using existing alert/event infrastructure
- **Zone boundary helper**: Create a `isPointInZone(x, y, zone)` utility that checks if a point falls within a zone's bounds rectangle
- Files:
  - Modify: `robot-agent/src/robot/SimulationEngine.ts` — add zone tracking to `tick()`
  - Modify: `robot-agent/src/robot/telemetry.ts` — add zone event formatting
  - Modify: `robot-agent/src/api/websocket.ts` — emit zone events
  - Modify: `robot-agent/src/tools/navigation.ts` — share zone cache with simulation

## Test Strategy
Server: Test zone creation rejects overlapping restricted zones. Test overlapping operational zones are allowed. Robot: Test zone tracking updates during simulated movement. Test zone_enter event fires when robot crosses into a zone. Test zone_exit event fires when robot leaves a zone. Test rapid zone transitions don't produce duplicate events.

## Notes
**Architecture caveat:** The robot agent currently communicates to the server via REST only (no server-bound WebSocket). Zone events need to be sent either via a new REST endpoint on the server (e.g., `POST /api/robots/:id/events`) or piggybacked on the existing telemetry push. The task description says "via WebSocket" but this refers to the robot's outbound WS to connected clients, not to the server.

**Async zone fetching:** `SimulationEngine.tick()` is synchronous. Zone data from `navigation.ts` is fetched async with TTL caching. The zone cache must be shared or pre-loaded before the tick loop references it — avoid async calls inside `tick()`.
%% mc-links: [[TASK-013]] %%
