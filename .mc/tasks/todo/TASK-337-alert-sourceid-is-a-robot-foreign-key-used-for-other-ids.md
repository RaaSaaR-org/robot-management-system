---
id: "TASK-337"
aliases: []
title: "Alert sourceId is a robot foreign key used for other ids"
slug: "alert-sourceid-is-a-robot-foreign-key-used-for-other-ids"
status: "backlog"
priority: 3
owner: "huhn511"
projects: []
customers: []
tags: [core, server]
sprint: ""
parent: ""
depends_on: []
spe:
effort: ""
due_date: ""
created: "2026-09-30"
updated: "2026-09-30"
---

# Alert sourceId is a robot foreign key used for other ids

## Description

`Alert.sourceId` is declared as a foreign key to `Robot`, but callers store task,
incident and workflow ids in it, so those alerts fail to write with "Foreign key
constraint violated". Make `sourceId` polymorphic (drop the FK, keep an optional
`robotId` relation) or stop passing non-robot ids.

## Details

### Current state

- `server/prisma/schema.prisma`, model `Alert`: `sourceId String?` with
  `robot Robot? @relation(fields: [sourceId], references: [id], onDelete: SetNull)`
  (since the initial schema, commit 62e62938).
- Callers that pass a non-robot id and therefore fail on SQLite and PostgreSQL:
  `server/src/services/AlertService.ts:354` (`sourceId: taskId`),
  `server/src/services/IncidentService.ts:159` (`sourceId: incident.id`),
  `server/src/services/NotificationWorkflowService.ts:418` (`'notification-workflow'`).
  Zone/fleet E-stop hit the same wall and were fixed locally in TASK-335 by dropping
  `sourceId`.
- Found by the TASK-274 end-to-end check (zone E-stop answered 500).

### Server

- Preferred: add `robotId String?` with the relation, drop the FK on `sourceId`
  (migration for PostgreSQL + SQLite), backfill `robotId = sourceId` where
  `source = 'robot'`; update readers of `alert.robot`.
- Add a test per caller that writes a real alert through the repository.

### Key files

- `server/prisma/schema.prisma`, a new migration under `server/prisma/migrations/`,
  `server/src/repositories/AlertRepository.ts`, the three services above.

## Acceptance Criteria

- [ ] Task, incident and notification-workflow alerts are written (integration test
      against SQLite).
- [ ] Robot alerts still link to their robot.

## Test Strategy

Integration test through `AlertRepository.create` with each `source` kind.
