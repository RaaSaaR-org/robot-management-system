---
id: "TASK-328"
aliases: []
title: "The agent loads its site's places through its binding"
slug: "the-agent-loads-its-site-s-places-through-its-binding"
status: "todo"
priority: 3
owner: "huhn511"
projects: []
customers: []
tags: [core, robot-agent, server]
sprint: ""
parent: "[[TASK-274]]"
depends_on: ["[[TASK-327]]"]
spe: 5
effort: "high"
due_date: ""
created: "2026-09-30"
updated: "2026-09-30"
---

# The agent loads its site's places through its binding

## Description

A robot agent learns its places from the twin it is bound to (`Robot.twinId`, via
`GET /api/robots/:id/places`), and a **sim** robot treats that twin graph as
registered — its pose is in the twin frame by construction — so place membership and
keepouts work for it. Real robots stay unregistered (alignment is TASK-325). Epic
TASK-274.

## Details

### Current state

- `robot-agent/src/robot/state.ts` `initPlaceAwareness()` (~`:465-530`): two sources —
  `appConfig.place.graphPath` (`PLACE_GRAPH_PATH`, `config.ts:1008`) wins, else
  `appConfig.place.twinId` (`PLACE_TWIN_ID`, `config.ts:1012`) fetched through
  `robot-agent/src/agent-mode/place-graph-source.ts` (fetch
  `/api/digital-twins/:id/places/_index.json`, disk cache, background refresh). With
  neither set it does nothing.
- `robot-agent/src/agent-mode/place-frame.ts:44-90` `assessFrameRegistration(graph)`:
  a graph with `frame.twinId` or `frame.kind !== 'sim'` is UNREGISTERED → place and
  geofence answer "unknown" (TASK-201 warning "not aligned — fence not enforcing").
- The server (after TASK-327) serves `GET /api/robots/:id/places` → the bound twin's
  graph (frame `kind: 'site'`, `twinId` set), 404 `{error:'robot has no site'}` when
  unbound. The seeded "Demo Warehouse" twin's origin equals the MuJoCo warehouse
  sim's world origin.
- Whether the agent runs a simulator vs real hardware is already known in config
  (see how `SimulationEngine` vs `HardwareClient` is chosen in `state.ts`/`config.ts`).

### Robot Agent

- Third place source, lowest precedence: `PLACE_GRAPH_PATH` > `PLACE_TWIN_ID` >
  binding. When neither env var is set, fetch `GET {serverUrl}/api/robots/{robotId}/places`
  with the agent's service auth; reuse `place-graph-source.ts` (generalise its URL
  builder, keep the disk cache and background refresh; cache key per robot). A 404
  "no site" is not an error: place stays unknown, log once at info. Re-fetch on the
  existing refresh cadence so a Site change in the UI is picked up without restart.
- Frame registration: add an explicit input to `assessFrameRegistration`, e.g.
  `assessFrameRegistration(graph, { poseFrame: 'twin' | 'odom' })`. A sim robot
  declares `poseFrame: 'twin'` (the sim world origin is the twin origin); then a graph
  with `twinId` is `{ registered: true, how: 'sim-twin-origin' }`. Real hardware keeps
  today's result verbatim. Keep the file's reasoning comments accurate.
- Surface the registration outcome where the TASK-201 warning already reads it (no new
  UI): a real robot bound to a twin shows "not aligned — fence not enforcing".
- Report it to the platform: `RobotLocation` gains `siteAligned?: boolean` (true only
  when a twin-bound graph is registered), set by the agent in
  `robot-agent/src/robot/types.ts`, carried by the server's `RobotLocation`
  (`server/src/services/RobotManager.ts:73`) and the app robot type
  (`app/src/features/robots/types/robots.types.ts`). The site map (TASK-331) plots
  only robots with `siteAligned === true`.

### Key files

- `robot-agent/src/robot/state.ts`, `robot-agent/src/agent-mode/place-graph-source.ts`,
  `robot-agent/src/agent-mode/place-frame.ts`, `robot-agent/src/config/config.ts`
  (doc comments), their `__tests__`.

## Acceptance Criteria

- [ ] With no `PLACE_*` env and the robot bound to Demo Warehouse, the agent loads the
      twin's places via `/api/robots/:id/places`; unbinding leaves place unknown
      without errors; precedence `PLACE_GRAPH_PATH` > `PLACE_TWIN_ID` > binding holds.
- [ ] A sim robot's twin-bound graph is registered; `location.place` resolves (e.g.
      `STAGING` at the origin) and the geofence enforces keepouts.
- [ ] `location.siteAligned` is true for the bound sim robot and false/absent otherwise, visible in `GET /api/robots/:id`.
- [ ] A real-hardware robot bound to the same twin stays UNREGISTERED with the
      existing warning text.
- [ ] The server being unreachable at boot still boots from the disk cache.
- [ ] robot-agent typecheck + vitest pass.

## Test Strategy

Vitest: source precedence (three combinations); 404 "no site" handling; disk-cache
boot with fetch failing; `assessFrameRegistration` for sim+twin (registered),
hardware+twin (unregistered, same reason text), sim+sim-kind (unchanged).
Sim check: MuJoCo warehouse sim + agent, bind via Robots → Site, `roboctl status`
shows a place.
