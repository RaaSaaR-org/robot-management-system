---
id: "TASK-274"
aliases: []
title: "Two zone systems describe the same idea"
slug: "two-zone-systems-describe-the-same-idea"
status: "todo"
priority: 3
owner: "huhn511"
projects: []
customers: []
tags: [core, server, app]
sprint: ""
parent: ""
depends_on: ["[[TASK-273]]"]
spe:
effort: ""
due_date: ""
created: "2026-09-12"
updated: "2026-09-30"
---

# Two zone systems describe the same idea

## Description

`TwinZone` becomes the only zone model. The flat fleet `Zone` table, `/api/zones`,
the SVG FleetMap and the zone seed are removed; every reader — navigation, E-stop,
deployments, verification, processes, `roboctl`, the dashboard — moves to the
digital twin's zones and the places derived from them. The goal is one digital twin
where the room is visible, zones are drawn and named in it, and those zones say
where a robot is or mark where it must not go.

Decision record: `docs/records/TASK-274-two-zone-systems-describe-the-same-idea.md`.
This is an **epic** — run `/plan` on it. Frame alignment (robot odometry vs twin
frame) is deliberately out of scope and filed as TASK-325.

## Details

### Current state (verified 2026-09-30)

- `server/prisma/schema.prisma:502` — `model Zone`: `name`, `floor`, `type`
  (`operational | restricted | charging | maintenance`), `bounds` JSON
  `{ x, y, width, height }` in map units (no metres, no frame), tenant-scoped,
  unique on `(tenantId, name, floor)`.
- `server/prisma/schema.prisma:247-251` — the `TwinZone` comment says "do NOT merge
  with the fleet `Zone`". `model TwinZone` at `:252` (`twinId`, `name`, `type`
  `keepout | workcell | charging | speed | room`, `points` polygon in metres,
  `minZ/maxZ`, `color`, `metadata`); `model DigitalTwin` at `:172`.
- `server/src/routes/zone.routes.ts` mounted at `server/src/app.ts:288`
  (`/api/zones`, incl. `GET /named-locations`, `GET /at-point`), backed by
  `ZoneService` / `ZoneRepository`. `server/src/database/seedZones.ts` seeds 8
  zones, called from `server/src/index.ts:64`.
- Zone readers on the server: `SafetyService.triggerZoneEStop`
  (`server/src/services/SafetyService.ts:416-440`, route
  `POST /safety/zones/:id/estop` at `server/src/routes/safety.routes.ts:175`);
  deployment `targetZones` (`schema.prisma:2607`,
  `server/src/services/DeploymentService.ts:621-623`); `VerificationSchedule.robotScope`
  `'zone'` (`schema.prisma:1364`); zone events broadcast from
  `server/src/websocket/index.ts:213-214`.
- TwinZone readers: `TwinZoneService`, `server/src/routes/twin.routes.ts` (zone CRUD
  ~`:390-458`), `TwinPlaceGraphService` (`places/_index.json`, frame
  `kind: 'site'` + `twinId`; `PLACE_ZONE_TYPES` at `:41` holds only `room` and
  `keepout`), `TwinExportService` (Nav2 keepout, VDA5050),
  `SimulationService.ts:1054` (sim `zones.json`).
- App: `app/src/features/fleet/` — `api/zoneApi.ts`, `store/zoneStore.ts`,
  `hooks/useZones.ts`, `components/{FleetMap,ZoneConfigPanel,ZoneEditor,ZoneFormModal,ZoneOverlay}.tsx`
  (`FleetMap.tsx:21` `SCALE = 10` pixels per map unit). Other `useZones`
  consumers: `app/src/features/dashboard/pages/DashboardPage.tsx:36,116-118`,
  `app/src/features/processes/components/CreateProcessModal.tsx:80` (bakes zone
  centre coordinates into move steps), `app/src/features/command/api/commandApi.ts:42`
  (named locations). The twin side lives in `app/src/features/digitaltwin/`
  (`twinZoneApi`, `twinZoneStore`, `ZoneAuthoringOverlay`, `ZoneVolumes`,
  `ZonePanel`, `TwinZoneFormModal`, `LivePoses`, `TwinViewer`) plus
  `app/src/features/agentmode/components/RobotMapPanel.tsx`.
- Robot agent: `robot-agent/src/tools/navigation.ts` fetches `/api/zones` (`:90`),
  derives named locations from zone centres (`:44-70`), refuses `restricted` zones
  (`:219-237`, used at `:333-340`); `robotStateManager.setZoneCache`
  (`robot-agent/src/robot/state.ts:1674`) feeds `SimulationEngine` zone tracking
  (`robot-agent/src/robot/zoneUtils.ts`); `RobotLocation.zone` and `.place` both
  exist (`robot-agent/src/robot/types.ts:92-98`); `INITIAL_ZONE` defaults to
  `'Warehouse A'` (`robot-agent/src/config/config.ts:828`); agent card mentions
  zones (`robot-agent/src/agent/agent-card.ts:78`); `roboctl move --zone`
  (`robot-agent/cli/src/commands/control.ts:39`).
- Agent Mode already reads twin places: `PLACE_TWIN_ID` (`config.ts:1012`),
  `PLACE_GRAPH_PATH` (`:1008`, wins when set), `place-graph-source.ts`,
  `place-resolver.ts`, geofence in `agent-mode/geofence.ts` and `SafetyMonitor.updateGeofence`.
  `robot-agent/src/agent-mode/place-frame.ts:44-90` marks any graph with a `twinId`
  (or `kind != 'sim'`) as UNREGISTERED, so the geofence answers "unknown" for it.
- Zone names must map to safe place ids: `SAFE_PLACE_ID`
  (`robot-agent/src/agent-mode/workspace.ts:73`) is mirrored by
  `ROBOT_SAFE_PLACE_ID` on the server.
- A draft `DigitalTwin` with no scan is allowed; `ZoneAuthoringOverlay.deriveWorldBounds`
  falls back to a 12 m square around `worldOrigin`, so zones can be drawn without a scan.

### Scope rule: which robots see zones

Zone membership, named locations and keepouts are active only for robots whose
pose is declared in the twin frame — the sim today. A real robot bound to a twin
shows "not aligned — fence not enforcing" through the existing TASK-201 warning
and is listed beside the site map, not plotted. Alignment is TASK-325.

### Server

- **Remove** `model Zone` from `server/prisma/schema.prisma` with a migration that
  drops the table (rows carry no frame; nothing to carry over). Note the breaking
  change for the release notes.
- **Remove** `server/src/routes/zone.routes.ts`, its mount in `server/src/app.ts`,
  `ZoneService`, `ZoneRepository`, their interfaces/types/tests, and
  `server/src/database/seedZones.ts` + its call in `server/src/index.ts`.
- **Rewrite** the comment at `schema.prisma:247-251`: TwinZone is the only zone model.
- **TwinZone names**: unique per twin, case-insensitive, enforced in the DB (e.g. a
  normalised `nameKey` column with `@@unique([twinId, nameKey])`); replaces the old
  `(tenantId, name, floor)` rule — floor belongs to the twin. Every name must map to
  a safe place id (`ROBOT_SAFE_PLACE_ID`); reject names that cannot.
- **`Robot.twinId`**: new nullable FK to `DigitalTwin` (`onDelete: SetNull`), settable
  through the robot update API; exposed on the robot DTO.
- **Places**: extend `PLACE_ZONE_TYPES` in `server/src/services/TwinPlaceGraphService.ts`
  so `room`, `workcell`, `charging` and `keepout` are places (zone type becomes the
  place kind; only `keepout` is a keepout). `speed` stays behaviour-only. Provide a
  server-side "which place contains this point" helper — smallest containing zone
  wins on overlap — reused by E-stop and deployments.
- **Robot → twin binding for the agent**: an endpoint the robot agent can call to get
  its bound twin's place graph (e.g. `GET /api/robots/:id/places` resolving
  `Robot.twinId`, or the existing twin places route keyed from the robot).
- **Zone E-stop**: `POST /api/safety/zones/:id/estop` takes a `TwinZone` id and stops
  every aligned robot bound to that twin whose `location.place` (or pose) is inside
  it; `SafetyService.triggerZoneEStop` reads `TwinZoneService`.
- **Deployments**: `targetZones` stores TwinZone ids (or place ids) and
  `DeploymentService.ts:~621` matches against the robot's `location.place`.
- **VerificationSchedule** `robotScope: 'zone'` resolves against TwinZone ids.
- **Processes**: move steps store a place reference (twin id + place id), not frozen
  centre coordinates; the process executor resolves it at run time.
- **WebSocket**: drop `zoneService.onZoneEvent` in `server/src/websocket/index.ts`;
  twin zone events (`TwinZoneEvent`) are the only zone events.
- **Seed**: a "Demo Warehouse" draft `DigitalTwin` whose zones match
  `robot-agent/hardware/sim_evaluator/places/places.warehouse.json` (STAGING,
  CHARGING-A, CROSS-AISLE, AISLE-1..3, DOCK-1 as places; RACK-A, RACK-B,
  DOCK-1-EDGE as keepouts), with the sim robot bound to it, so `npm run dev` +
  `roboctl move` + the sim work out of the box. Idempotent.

### Frontend

- **Remove** from `app/src/features/fleet/`: `api/zoneApi.ts`, `store/zoneStore.ts`,
  `hooks/useZones.ts`, `components/FleetMap.tsx`, `ZoneConfigPanel.tsx`,
  `ZoneEditor.tsx`, `ZoneFormModal.tsx`, `ZoneOverlay.tsx`, their exports and tests.
- **Site map** (new, e.g. `app/src/features/fleet/components/SiteMap.tsx`): the Fleet
  "Map" tab becomes a site map — site picker (remembers the last site per viewer),
  top-down twin view reusing the digitaltwin top-down rendering, zones + live robot
  poses, click a zone → zone E-stop (with confirm). Robots with no site or not
  aligned are listed beside the map, not plotted.
- `DashboardPage.tsx` reuses the site map component, sized small.
- **Robots tab → "Site"**: a picker that sets `Robot.twinId`.
- `CreateProcessModal.tsx`: "Move to" steps pick a place from the twin (store a place
  reference); `commandApi.ts` named locations come from the places of the robot's twin.
- `TwinZoneFormModal` surfaces the per-twin, case-insensitive name uniqueness error.
- Deployment and verification forms that pick zones pick TwinZones.

### Robot Agent

- `robot-agent/src/tools/navigation.ts`: stop fetching `/api/zones`; named locations
  are the places of the bound twin (via the server binding; `PLACE_TWIN_ID` stays a
  local dev/sim override, `PLACE_GRAPH_PATH` still wins). The restricted-zone refusal
  becomes a keepout-place refusal; update the tool description.
  `move "Charging Station"`-style requests resolve because charging zones are places.
- Remove `RobotLocation.zone` (`robot-agent/src/robot/types.ts`); `location.place` is
  the single answer, smallest containing zone on overlap. Remove `setZoneCache`,
  `SimulationEngine` zone tracking and `robot-agent/src/robot/zoneUtils.ts` (or
  replace with place-membership from the place graph).
- Remove the `INITIAL_ZONE` / `'Warehouse A'` default (`config.ts:828`).
- `robot-agent/src/agent/agent-card.ts`: describe places, not zones.
- Place membership and keepouts stay gated by `place-frame.ts`. The one addition: a
  sim robot declares that its pose is in the twin frame (the sim world origin is the
  twin origin — true for the seeded Demo Warehouse), so a twin graph fetched for a
  sim robot counts as registered. Everything else stays UNREGISTERED; aligning real
  robots and lifting the gate for them is TASK-325.

### CLI / Docs

- `robot-agent/cli/src/commands/control.ts`: `--zone` becomes `--place` (a place
  name/id); `move "<place>"` resolves through the place graph.
- Update `CLAUDE.md` roboctl examples and `robot-agent/cli/README.md` ("Warehouse A"
  → a Demo Warehouse place such as "CHARGING-A"); `docs/api.md` drops `/api/zones`
  and documents `Robot.twinId` and the zone E-stop's new id semantics.
- Release notes: breaking — `/api/zones` and the `Zone` table are gone.

## Plan (2026-09-30)

Children, in implementation order (`parent: "[[TASK-274]]"`):

1. TASK-326 Twin zones are uniquely named places — spe 3
2. TASK-327 A robot is bound to a site — spe 5 (after 326)
3. TASK-328 The agent loads its site's places through its binding — spe 5 (after 327)
4. TASK-329 A robot moves to a place by name and refuses keepouts — spe 5 (after 328)
5. TASK-330 Zone E-stop, deployments and verification target twin zones — spe 5 (after 327)
6. TASK-331 The fleet map is a site map — spe 8 (after 328, 330)
7. TASK-332 Process steps and commands move to places — spe 5 (after 327)
8. TASK-333 location.place is a robot's only answer to where it is — spe 5 (after 329, 330)
9. TASK-334 The fleet Zone model and /api/zones are removed — spe 5 (after 331, 332, 333)

Planning note: the seed creates the Demo Warehouse twin only; the sim robot is bound
through the Robots → Site picker (robots are registered at runtime, not seeded), as
the Test Strategy's step 2 already does.

## Acceptance Criteria

- [ ] `model Zone` is gone from `server/prisma/schema.prisma`; a migration drops the
      table; `git grep -n "api/zones"` over `server/ app/ robot-agent/` finds no caller.
- [ ] `ZoneService`, `ZoneRepository`, `zone.routes.ts`, `seedZones.ts` and the fleet
      `zoneApi`/`zoneStore`/`useZones`/`FleetMap`/`Zone*` components are deleted.
- [ ] The schema comment above `TwinZone` states it is the only zone model.
- [ ] Creating a second TwinZone named `aisle-1` on a twin that has `AISLE-1` is
      rejected by the database; the same name on another twin is accepted.
- [ ] `Robot.twinId` exists (nullable FK), is settable from the Robots tab "Site"
      picker, and the agent fetches its twin's places through it; `PLACE_TWIN_ID`
      and `PLACE_GRAPH_PATH` keep working as overrides in that order.
- [ ] `room`, `workcell`, `charging` and `keepout` zones appear in the place graph with
      the zone type as kind; `speed` zones do not.
- [ ] `RobotLocation.zone` no longer exists; `location.place` names the smallest
      containing place when zones overlap.
- [ ] `roboctl move "CHARGING-A"` (and the agent's `move` tool) drives the sim robot
      to that place; a move whose target lies in a keepout place is refused with the
      keepout's name.
- [ ] Zone E-stop, deployment `targetZones`, verification `robotScope: 'zone'` and
      process "Move to" steps reference TwinZones/places; a process step stores a
      place reference, not coordinates.
- [ ] Fleet "Map" tab shows a site map with site picker (remembers the last site),
      zones and live robots; clicking a zone offers E-stop; unbound or not-aligned
      robots are listed beside the map. The dashboard shows the same component small.
- [ ] A real (non-sim) robot bound to a twin shows the TASK-201 "not aligned — fence
      not enforcing" warning and is not plotted.
- [ ] `npm run dev` on a fresh dev DB seeds the "Demo Warehouse" twin matching
      `places.warehouse.json`; the old 8 zones and `'Warehouse A'` default are gone.
- [ ] `CLAUDE.md`, `robot-agent/cli/README.md` and `docs/api.md` no longer mention
      "Warehouse A" or `/api/zones`.
- [ ] `./scripts/test-all.sh` passes.

## Test Strategy

**Unit (vitest):**
- Server: TwinZone case-insensitive uniqueness per twin; `TwinPlaceGraphService` emits
  room/workcell/charging/keepout places with kinds and skips speed; smallest-containing
  place on overlap; zone E-stop selects only aligned robots bound to the twin inside
  the zone; deployment `targetZones` matching by place; `Robot.twinId` update + SetNull
  on twin delete; Demo Warehouse seed is idempotent.
- Robot agent: navigation resolves a place name from the bound twin's graph; keepout
  refusal; override precedence `PLACE_GRAPH_PATH` > `PLACE_TWIN_ID` > `Robot.twinId`;
  `location.place` smallest-wins.
- App: site map renders zones and plots only aligned robots; lists the others; site
  picker remembers the last site; Robots tab Site picker calls the robot update API;
  CreateProcessModal stores a place reference.

**Sim check (MuJoCo on the Mac):**
1. Fresh dev DB → server starts and seeds "Demo Warehouse".
2. Start the MuJoCo G1 sim with the warehouse scene and the agent; bind the sim robot
   to Demo Warehouse via Robots → Site (`Robot.twinId`), no `PLACE_TWIN_ID` set.
3. `roboctl move "CHARGING-A"` → the robot walks there; `roboctl status` reports
   `place: CHARGING-A`.
4. Ask to move into `RACK-A` → refused, naming the keepout.
5. Fleet → Map: pick Demo Warehouse; the robot is plotted live on the twin with the
   zones; clicking its zone and confirming E-stop stops it.
