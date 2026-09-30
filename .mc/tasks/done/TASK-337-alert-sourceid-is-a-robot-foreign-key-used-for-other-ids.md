---
id: "TASK-337"
aliases: []
title: "Alert sourceId is a robot foreign key used for other ids"
slug: "alert-sourceid-is-a-robot-foreign-key-used-for-other-ids"
status: "done"
priority: 3
owner: "huhn511"
projects: []
customers: []
tags: [core, server]
sprint: ""
parent: ""
depends_on: []
spe: 2
effort: ""
due_date: ""
created: "2026-09-30"
updated: "2026-09-30"
---

# Alert sourceId is a robot foreign key used for other ids

## Description

`Alert.sourceId` is declared as a foreign key to `Robot`, but callers store task,
incident and workflow ids in it, so those alerts fail to write with "Foreign key
constraint violated". Make `sourceId` polymorphic: drop the foreign key and read
the id according to `Alert.source`. Decisions:
`docs/records/TASK-337-alert-source-id-polymorphic.md`.

## Details

### Current state

- `server/prisma/schema.prisma`, model `Alert`: `sourceId String?` with
  `robot Robot? @relation(fields: [sourceId], references: [id], onDelete: SetNull)`
  (since the initial schema, commit 62e62938), and `alerts Alert[]` on `Robot`.
- Callers that pass a non-robot id and therefore fail on SQLite and PostgreSQL:
  `server/src/services/AlertService.ts` `createTaskAlert` (`sourceId: taskId`),
  `server/src/services/IncidentService.ts` (`sourceId: incident.id`),
  `server/src/services/NotificationWorkflowService.ts` (`'notification-workflow'`).
  Zone/fleet E-stop hit the same wall and were fixed locally in TASK-335 (#361) by
  dropping `sourceId`.
- Nothing reads `alert.robot` or `robot.alerts`; the stale-alert sweep
  (`AlertService.sweepStaleAlerts`) already looks robots up by `sourceId` for
  `source: 'robot'` alerts.

### Server

- Remove the `robot` relation from `Alert` and `alerts` from `Robot`; keep the
  `sourceId` column and its index. Comment the column as polymorphic.
- Migration `server/prisma/migrations/20260930220000_task_337_alert_source_id_polymorphic/`
  (PostgreSQL): `DROP CONSTRAINT IF EXISTS "Alert_sourceId_fkey"`.
- `SafetyService.triggerZoneEStop`: set `sourceId: zoneId` again; the fleet
  E-stop keeps none (no single entity).
- Rejected: stop passing non-robot ids (loses the link); a separate `robotId`
  column (redundant with `source` + `sourceId`).

### Key files

- `server/prisma/schema.prisma`, the migration above,
  `server/src/services/SafetyService.ts`,
  `server/src/repositories/__tests__/AlertRepository.integration.test.ts` (new).

## Acceptance Criteria

- [x] Task, incident, notification-workflow and zone alerts are written
      (integration test against SQLite with foreign keys on).
- [x] Robot alerts still link to their robot (lookup by `sourceId` where
      `source` is `robot`).
- [x] Zone E-stop alerts carry the zone id in `sourceId`.

## Test Strategy

Integration test through `AlertRepository.create` against a real SQLite database
pushed from the schema, one case per caller payload plus a robot alert; it fails
with "Foreign key constraint violated" on the old schema.
