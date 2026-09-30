---
id: "TASK-335"
aliases: []
title: "Zone E-stop and the site map work against a live sim robot"
slug: "zone-e-stop-and-the-site-map-work-against-a-live-sim-robot"
status: "done"
priority: 2
owner: "huhn511"
projects: []
customers: []
tags: [core, server, app]
sprint: ""
parent: ""
depends_on: ["[[TASK-274]]"]
spe: 1
effort: "low"
due_date: ""
created: "2026-09-30"
updated: "2026-09-30"
---

# Zone E-stop and the site map work against a live sim robot

## Description

The end-to-end check of epic TASK-274 on the Mac (MuJoCo warehouse sim, G1 EDU agent
bound to the seeded "Demo Warehouse") found two defects the unit tests could not see,
plus one layout glitch. Fix them.

## Details

### Current state (found live, 2026-09-30)

1. **Zone E-stop answers 500 after it stopped the robots.**
   `POST /api/safety/zones/:id/estop` on the `CHARGING-A` TwinZone latched the sim
   robot's E-stop (`triggeredBy: "zone"`), then answered
   `{"error":"Failed to trigger zone E-stop"}`. Cause:
   `server/src/services/SafetyService.ts` `triggerZoneEStop` awaits
   `alertService.createAlert({ sourceId: zoneId })`, and `Alert.sourceId` is a foreign
   key to `Robot` (`server/prisma/schema.prisma`, model `Alert`) — Prisma throws
   "Foreign key constraint violated". The fleet E-stop passes `sourceId: 'fleet'`, fails
   the same way, and only survives because its alert is fire-and-forget (the alert is
   silently lost).
2. **The site map lists an aligned sim robot as "not aligned — fence not enforcing".**
   `GET /api/robots/:id` serves the live cache (`location.siteAligned: true`,
   `frame.kind: "sim"`), but `GET /api/robots` (`RobotManager.listRobots`) serves the
   DB row, which never persists `siteAligned`/`frame`. `app/src/features/fleet/components/SiteMap.tsx`
   (`groupSiteRobots`) reads the list, so the robot is never plotted until a websocket
   update happens to carry the field.
3. In the "Not aligned" list the robot name truncated to one character next to the
   long status tag.

### Server

- `SafetyService.ts`: zone and fleet E-stop alerts carry no `sourceId`; the zone alert
  is non-blocking like the fleet one (a performed E-stop must not report failure
  because an alert could not be written); the zone id moves into the message.
- `RobotManager.ts`: `listRobots` lays a connected robot's live `location` over the
  stored row (`withLiveLocation`). The row stays the tenant-scoped source of which
  robots exist.

### Frontend

- `SiteMap.tsx` `RobotGroup`: name above the tag, not squeezed beside it.

### Key files

- `server/src/services/SafetyService.ts`, `server/src/services/__tests__/SafetyService.test.ts`
- `server/src/services/RobotManager.ts`, `server/src/services/__tests__/RobotManager.test.ts`
- `app/src/features/fleet/components/SiteMap.tsx`

## Acceptance Criteria

- [x] A zone E-stop that stops a robot answers 200 with `successCount: 1`, and a
      "Zone Emergency Stop" alert is written.
- [x] A failing alert write does not fail the zone E-stop (unit test).
- [x] `GET /api/robots` carries `siteAligned`/`frame` for a connected robot, not for a
      disconnected one (unit test); the bound sim robot is plotted on Fleet → Map.
- [x] server + app typecheck and the touched vitest suites pass.

## Test Strategy

Unit: `SafetyService.test.ts` (alert rejected → E-stop still succeeds, no `sourceId`),
`RobotManager.test.ts` (live location overlay). Live: scratch SQLite server + MuJoCo
warehouse sim + warehouse-profile agent bound to "Demo Warehouse"; zone E-stop on
`CHARGING-A` answers 200 and latches the robot; Fleet → Map plots the robot inside
`CHARGING-A`.

## Notes

The general problem — `Alert.sourceId` is a Robot FK but task, incident and
notification-workflow alerts put other ids there — is TASK-337.
