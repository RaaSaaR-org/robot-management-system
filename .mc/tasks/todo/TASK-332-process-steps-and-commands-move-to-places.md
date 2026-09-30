---
id: "TASK-332"
aliases: []
title: "Process steps and commands move to places"
slug: "process-steps-and-commands-move-to-places"
status: "review"
priority: 3
owner: "huhn511"
projects: []
customers: []
tags: [core, server, app]
sprint: ""
parent: "[[TASK-274]]"
depends_on: ["[[TASK-327]]"]
spe: 5
effort: "medium"
due_date: ""
created: "2026-09-30"
updated: "2026-09-30"
---

# Process steps and commands move to places

## Description

A process "Move to" step stores a **place reference** (twin id + place id) picked from
a digital twin, not frozen coordinates of a fleet zone, and the server resolves it
when the step runs. The command console's named locations come from the robot's site
places instead of `/api/zones/named-locations`. Epic TASK-274.

## Details

### Current state

- `app/src/features/processes/components/CreateProcessModal.tsx` (347 lines): "Move to
  zone" steps pick from `useZones()` (`:80`, options `:114-116`, `selectZone`
  `:126-140`) and bake the zone **centre coordinates** into
  `actionConfig.location` (comment at `:43-47`); `zoneId` is form-local.
- `server/src/services/ProcessManager.ts:~340-360` copies `step.actionConfig` into a
  robot task; `TaskDistributor` assigns it; the agent's
  `robot-agent/src/robot/TaskQueue.ts:318-325` runs `move_to_location` with
  `actionConfig.location` (a `RobotLocation` with x/y).
- `app/src/features/command/api/commandApi.ts:31-60` `fetchNamedLocations()` calls
  `zoneApi.getNamedLocations()` (`/api/zones/named-locations`), used by
  `getLocationByName` (`:172`) for NL "move to X" with a known `robotId`.
- `server/src/services/CommandInterpreter.ts:165,514` prompts for "named zones" and
  sets `config.zoneName`.
- After TASK-327: `Robot.twinId`, `GET /api/robots/:id/places` (place graph JSON:
  `places[]` with `id`, `name`, `placeType`, `polygon` metres, `keepout`), twin
  places at `GET /api/digital-twins/:id/places/_index.json`.

### Server

- Step config shape for `move_to_location`: `actionConfig.place = { twinId, placeId }`
  (keep accepting legacy `actionConfig.location` for existing processes).
- `ProcessManager`, when it creates the robot task for such a step: load the twin's
  place graph via `TwinPlaceGraphService`, compute the place polygon centroid and set
  `actionConfig.location = { x, y, place: placeId }` on the task (the step keeps the
  reference). Unknown place or keepout place → the step fails with a clear message.
  Restrict assignment to robots whose `twinId === place.twinId` (pass as a
  `requiredTwinId` in `actionConfig`, honoured in `TaskDistributor` next to
  `excludeRobotIds`).
- Validate `actionConfig.place` on process create/update (twin exists, place id in
  its graph, not a keepout).
- `CommandInterpreter`: prompt speaks of places; `config.zoneName` → `config.placeName`.

### Frontend

- `CreateProcessModal.tsx`: a site picker (twins) + a place picker (non-keepout places
  of that twin's graph); the step stores `actionConfig.place`. Label "Move to place".
  Remove the `useZones` import and `zoneId` draft field.
- `commandApi.ts`: `fetchNamedLocations(robotId)` reads `GET /api/robots/:id/places`
  and maps place id/name (lower-cased) → centroid; cache per robot; drop the
  `zoneApi` import. No site → only `home`.

### Key files

- `server/src/services/ProcessManager.ts`, `server/src/services/TaskDistributor.ts`,
  `server/src/services/CommandInterpreter.ts`, process routes/validation, tests
  (`ProcessManager.test.ts`, `CommandInterpreter.test.ts`)
- `app/src/features/processes/components/CreateProcessModal.tsx`,
  `app/src/features/command/api/commandApi.ts`, their tests

## Acceptance Criteria

- [ ] A new process "Move to place" step saves `actionConfig.place = { twinId, placeId }`
      and no coordinates.
- [ ] Running it creates a robot task with the place centroid in
      `actionConfig.location`, assigned only to a robot bound to that twin.
- [ ] A step referencing a missing or keepout place is rejected on save and fails
      cleanly if the place disappears later.
- [ ] `CreateProcessModal.tsx` and `commandApi.ts` no longer import from
      `@/features/fleet` zone modules.
- [ ] Server + app typecheck and vitest pass.

## Test Strategy

Vitest: ProcessManager resolves a place ref to a centroid task and sets the twin
requirement; TaskDistributor honours it; validation rejects keepout/missing places;
legacy `location` steps still run. App: CreateProcessModal stores a place reference;
commandApi resolves a name from the robot's places.
