---
id: "TASK-327"
aliases: []
title: "A robot is bound to a site"
slug: "a-robot-is-bound-to-a-site"
status: "done"
priority: 3
owner: "huhn511"
projects: []
customers: []
tags: [core, server, app]
sprint: ""
parent: "[[TASK-274]]"
depends_on: ["[[TASK-326]]"]
spe: 5
effort: "medium"
due_date: ""
created: "2026-09-30"
updated: "2026-09-30"
---

# A robot is bound to a site

## Description

Give every robot an optional site — the digital twin it works in — through a new
`Robot.twinId`, set from a "Site" picker in the Robots tab, and serve that twin's
place graph to the robot. Seed a "Demo Warehouse" twin that matches the sim's
warehouse scene so the flow works out of the box (epic TASK-274).

## Details

### Current state

- `server/prisma/schema.prisma:20` `model Robot` has no link to `DigitalTwin`
  (`model DigitalTwin` ~`:172`). Robots register at runtime via
  `POST /api/robots/register` (`server/src/routes/robot.routes.ts:22`); they are not
  seeded.
- `server/src/routes/robot.routes.ts` has **no** update route (only register, get,
  delete, command, telemetry, camera, pointcloud …). Robot state lives in
  `server/src/services/RobotManager.ts` (in-memory cache + DB).
- The place graph is served at `GET /api/digital-twins/:id/places/_index.json`
  (`server/src/routes/twin.routes.ts:479`, `TwinPlaceGraphService`). After TASK-326
  room/workcell/charging/keepout zones are places and names are unique per twin.
- `server/src/database/seedZones.ts` seeds 8 flat zones from `server/src/index.ts:64`
  (left alone here; TASK-333 removes it).
- The sim's scene places: `robot-agent/hardware/sim_evaluator/places/places.warehouse.json`
  — STAGING, CHARGING-A, CROSS-AISLE, AISLE-1..3, DOCK-1 (places) and RACK-A,
  RACK-B, DOCK-1-EDGE (keepouts), frame `kind: 'sim'`, metres.
- App Robots detail tabs: `app/src/features/robots/components/tabs/InfoTab.tsx`,
  pages in `app/src/features/robots/pages/`; twin list API in
  `app/src/features/digitaltwin/api/`.

### Server

- Schema: `Robot.twinId String?` with relation to `DigitalTwin`
  (`onDelete: SetNull`) + `@@index([twinId])`; back-relation `robots Robot[]` on
  `DigitalTwin`. Migration.
- `PATCH /api/robots/:id` with body `{ twinId: string | null }` (validate the twin
  exists and belongs to the same tenant; 404 otherwise). Use the same RBAC guard the
  other robot-mutating routes use (e.g. `DELETE /:id`). Updates DB + RobotManager
  cache; `twinId` is on the robot DTO (`RobotManager` type + `app` robot type).
- `GET /api/robots/:id/places` → the bound twin's place graph (same payload as
  `/api/digital-twins/:twinId/places/_index.json`, reuse `TwinPlaceGraphService`);
  404 with `{ error: 'robot has no site' }` when `twinId` is null. Must be reachable
  with the agent's service auth (same as other agent-called endpoints; see
  `server/src/__tests__/agent-endpoints-auth.test.ts`).
- Seed `server/src/database/seedDemoWarehouse.ts`, called from `server/src/index.ts`
  after `seedDefaultTenant()`: an idempotent draft `DigitalTwin` named
  "Demo Warehouse" (no scan, `worldOrigin` at 0,0) whose `TwinZone` rows reproduce
  `places.warehouse.json` 1:1 — name = place id, polygon = place polygon, type
  `keepout` for keepouts, `charging` for CHARGING-A, `room` otherwise, `metadata.placeType`
  from the file. Read the JSON at seed time (path relative to the repo) or inline it —
  either way a test asserts the two agree. Idempotent: skip if the twin exists.
- Binding the sim robot is done through the Site picker (no auto-binding at register
  time); document that in the seed file header.

### Frontend

- Robot detail Info tab (`InfoTab.tsx`) gets a "Site" row: a select of the tenant's
  digital twins + "No site", calling `PATCH /api/robots/:id`; add `updateRobotSite` to
  the robots API/store following the existing robots store pattern.

### Key files

- `server/prisma/schema.prisma`, migration, `server/src/routes/robot.routes.ts`,
  `server/src/services/RobotManager.ts`, `server/src/database/seedDemoWarehouse.ts` (new),
  `server/src/index.ts`
- `app/src/features/robots/components/tabs/InfoTab.tsx`, robots api/store/types

## Acceptance Criteria

- [ ] `Robot.twinId` exists (nullable FK, SetNull on twin delete) and is on the robot DTO.
- [ ] `PATCH /api/robots/:id {twinId}` binds/unbinds; unknown twin → 404.
- [ ] `GET /api/robots/:id/places` returns the bound twin's place graph; 404 when unbound.
- [ ] A fresh dev DB seeds exactly one "Demo Warehouse" twin whose zones match
      `places.warehouse.json`; a second boot adds nothing.
- [ ] The Info tab's Site picker binds a robot and the choice survives reload.
- [ ] Server + app typecheck and vitest pass.

## Test Strategy

Vitest: PATCH route (bind, unbind, unknown twin, RBAC); SetNull on twin delete;
`/robots/:id/places` bound/unbound; seed idempotency and 1:1 match against
`places.warehouse.json`. App: Site picker calls the API with the chosen twin id.
