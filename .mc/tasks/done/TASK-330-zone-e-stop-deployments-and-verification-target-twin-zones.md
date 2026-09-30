---
id: "TASK-330"
aliases: []
title: "Zone E-stop, deployments and verification target twin zones"
slug: "zone-e-stop-deployments-and-verification-target-twin-zones"
status: "done"
priority: 3
owner: "huhn511"
projects: []
customers: []
tags: [core, server, app, compliance]
sprint: ""
parent: "[[TASK-274]]"
depends_on: ["[[TASK-327]]"]
spe: 5
effort: "medium"
due_date: ""
created: "2026-09-30"
updated: "2026-09-30"
---

# Zone E-stop, deployments and verification target twin zones

## Description

The three server features that select robots "in a zone" — zone E-stop, deployment
`targetZones` and verification `robotScope: 'zone'` — take `TwinZone` ids and match a
robot by the place it reports (`location.place`) on the twin it is bound to
(`Robot.twinId`), instead of the flat fleet `Zone` and `location.zone`. Epic TASK-274.

## Details

### Current state

- `server/src/services/SafetyService.ts:416-460` `triggerZoneEStop(zoneId, …)` reads
  `zoneService.getZone(zoneId)` and filters `robot.location?.zone === zone.name`.
  Route `POST /api/safety/zones/:id/estop` (`server/src/routes/safety.routes.ts:175`).
  App caller: `app/src/features/safety/api/safetyApi.ts:105`, store
  `safetyStore.ts:264`, hook `useSafety.ts:141` (no zone picker UI depends on the
  id kind; the site map, TASK-331, will call it with a TwinZone id).
- `server/src/services/DeploymentService.ts:620-625` matches
  `deployment.targetZones.includes(robot.location.zone)`. `targetZones` is a JSON
  string array (`schema.prisma` ~`:2607`, `VLARepository.ts:394,1353`). App shows them
  in `app/src/features/deployment/components/DeploymentOverview.tsx:86`.
- `VerificationSchedule.robotScope` (`'all' | 'robot' | 'zone'`,
  `server/src/types/oversight.types.ts:74`) + `scopeId` are stored but a `'zone'`
  scope is not resolved anywhere in `server/src/services/`; the app shows
  `Zone <scopeId>` (`app/src/features/oversight/components/VerificationsPanel.tsx:29`).
- `RobotLocation.place` (`server/src/services/RobotManager.ts:80`) is the place id the
  agent reports (from its twin-bound graph after TASK-328). `Robot.twinId` exists
  (TASK-327). `TwinZoneService`, `TwinPlaceGraphService` (place id = `metadata.placeId`
  or slug of the name), and `findContainingPlace` (TASK-326,
  `server/src/services/twinPlaceGeometry.ts`).

### Server

- One shared matcher, e.g. `robotIsInTwinZone(robot, zone)` in
  `server/src/services/twinPlaceGeometry.ts`: true when `robot.twinId === zone.twinId`
  and `robot.location.place` equals the zone's place id. Robots whose place is `null`
  (unbound, unaligned, unknown) never match.
- `triggerZoneEStop` reads the zone via `TwinZoneService` (404-style error when
  missing), stops every non-offline robot the matcher selects, and returns the zone
  name + twin id in `ZoneEStopResult`. Update the route doc comment.
- `DeploymentService`: `targetZones` holds TwinZone ids; filter with the matcher
  (resolve the zones once per selection pass). Validate ids on deployment create.
- Verification: a `'zone'` schedule's `scopeId` is a TwinZone id; resolve the robot set
  with the matcher where schedules pick robots (add the resolution in
  `OversightService` if it is missing — `'robot'` and `'all'` show the pattern).

### Frontend

- `DeploymentOverview.tsx` and `VerificationsPanel.tsx` display the TwinZone name
  (lookup through `app/src/features/digitaltwin/api` twin-zone API), falling back to
  the id.

### Key files

- `server/src/services/SafetyService.ts`, `server/src/routes/safety.routes.ts`,
  `server/src/services/DeploymentService.ts`, `server/src/services/OversightService.ts`,
  `server/src/services/twinPlaceGeometry.ts`, their tests
  (`SafetyService.test.ts`, deployment and oversight tests)
- `app/src/features/deployment/components/DeploymentOverview.tsx`,
  `app/src/features/oversight/components/VerificationsPanel.tsx`

## Acceptance Criteria

- [ ] `SafetyService` no longer imports `zoneService`; zone E-stop with a TwinZone id
      stops only non-offline robots bound to that twin whose `location.place` is the
      zone's place; unknown id → error.
- [ ] Deployment robot selection with `targetZones: [<TwinZone id>]` picks only
      robots in that place.
- [ ] A verification schedule with `robotScope: 'zone'` resolves robots the same way.
- [ ] No server code reads `location.zone`.
- [ ] Deployment and verification views show TwinZone names.
- [ ] Server + app typecheck and vitest pass.

## Test Strategy

Vitest: matcher (bound+in place, other twin, place null); zone E-stop selection;
deployment selection; verification scope resolution. App: name display with fallback.
