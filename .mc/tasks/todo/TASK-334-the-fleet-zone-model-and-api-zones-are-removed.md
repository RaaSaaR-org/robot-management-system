---
id: "TASK-334"
aliases: []
title: "The fleet Zone model and /api/zones are removed"
slug: "the-fleet-zone-model-and-api-zones-are-removed"
status: "in-progress"
priority: 3
owner: "huhn511"
projects: []
customers: []
tags: [core, server, app]
sprint: ""
parent: "[[TASK-274]]"
depends_on: ["[[TASK-331]]", "[[TASK-332]]", "[[TASK-333]]"]
spe: 5
effort: "low"
due_date: ""
created: "2026-09-30"
updated: "2026-09-30"
---

# The fleet Zone model and /api/zones are removed

## Description

With every reader moved to twin zones and places (TASK-329..333), delete the flat
fleet `Zone`: the table, `/api/zones`, its service, repository, seed, websocket
events, and the app's zone API/store/hooks/components. Breaking change. Last child
of epic TASK-274.

## Details

### Current state

- `server/prisma/schema.prisma:~502` `model Zone` (`name`, `floor`, `type`
  `operational|restricted|charging|maintenance`, `bounds` JSON, tenant-scoped,
  `@@unique([tenantId, name, floor])`); tenant back-relation on `Tenant`.
- `server/src/routes/zone.routes.ts` (261 lines) mounted at `server/src/app.ts:40,288`;
  `server/src/services/ZoneService.ts` (436), `server/src/repositories/ZoneRepository.ts`
  (324) + barrel exports + any interface in `server/src/interfaces/`;
  `server/src/database/seedZones.ts` called from `server/src/index.ts:~64`;
  `server/src/websocket/index.ts:11,213-220` subscribes `zoneService.onZoneEvent`.
  Multi-tenancy model lists may name `zone` (check `server/src/database/seedTenant.ts`
  and the Prisma `$extends` tenant model list — see `docs/multi-tenancy.md`).
- Server tests: `__tests__/zone-routes.test.ts`, `services/__tests__/ZoneService.test.ts`,
  `database/__tests__/zone-tenant-unique.integration.test.ts`, zone cases in
  `__tests__/agent-endpoints-auth.test.ts`, `__tests__/field-operations-role-routing.test.ts`,
  `websocket/__tests__/index.test.ts`, `services/__tests__/SafetyService.test.ts`.
- App: `app/src/features/fleet/api/zoneApi.ts` (+ `api/index.ts` export),
  `store/zoneStore.ts` (+ `store/index.ts`, `store/__tests__/zoneStore.test.ts`),
  `hooks/useZones.ts` (+ `hooks/index.ts`), `components/FleetMap.tsx`,
  `FleetMapPopover.tsx`, `FleetMapToolbar.tsx`, `RobotMarker.tsx` (if only FleetMap
  uses them), `ZoneConfigPanel.tsx`, `ZoneEditor.tsx`, `ZoneFormModal.tsx`,
  `ZoneOverlay.tsx`, `components/__tests__/ZonePermissions.test.tsx`, zone types in
  `fleet/types/fleet.types.ts`; MSW `app/src/mocks/handlers.ts:13,209-212`
  (`DEMO_ZONES`, `/api/zones`) and the mock data file.
- Docs: `docs/api.md:463` lists `/api/zones`.

### Server

- Remove `model Zone` and its relations; migration drops the table (rows carry no
  frame — nothing to migrate). Remove the route mount, route, service, repository,
  interfaces, types, seed + call, websocket subscription, and the tests above (or the
  zone cases within shared tests). Remove `zone` from tenant model lists if present.
- The schema comment above `TwinZone` stays as TASK-326 wrote it.

### Frontend

- Delete the modules listed above and their barrel exports and mocks. Keep anything
  `SiteMap` (TASK-331) still imports.

### Docs

- `docs/api.md`: drop `/api/zones`; document `PATCH /api/robots/:id` (`twinId`),
  `GET /api/robots/:id/places`, and that `POST /api/safety/zones/:id/estop` takes a
  TwinZone id.
- PR body carries a **Breaking** section: `/api/zones` and the `Zone` table are gone;
  zones are authored on a digital twin.

## Acceptance Criteria

- [ ] `model Zone` is gone; a migration drops the table.
- [ ] `git grep -n "api/zones" -- server app robot-agent docs/api.md CLAUDE.md` finds nothing.
- [ ] `ZoneService`, `ZoneRepository`, `zone.routes.ts`, `seedZones.ts`, fleet
      `zoneApi`/`zoneStore`/`useZones`/`FleetMap`/`Zone*` components are deleted.
- [ ] A fresh dev DB boots with only the Demo Warehouse twin — no fleet zones.
- [ ] `./scripts/test-all.sh` passes (all stages, interpreters set).

## Test Strategy

Full `./scripts/test-all.sh`. Then the epic's MuJoCo-on-Mac check (TASK-274 Test
Strategy): fresh DB, Demo Warehouse seeded, bind the sim robot via Robots → Site,
`roboctl move "CHARGING-A"`, refusal at RACK-A, Fleet → Map with zone E-stop.
