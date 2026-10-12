---
id: "TASK-375"
aliases: ["TASK-375"]
title: "Delete events reach their tenant after a server restart"
slug: "delete-events-reach-their-tenant-after-a-server-restart"
status: "review"
priority: 2
owner: "huhn511"
projects: []
customers: []
tags: ["core", "multi-tenancy"]
sprint: ""
parent: ""
depends_on: []
spe: 2
effort: "low"
due_date: ""
created: "2026-10-12"
updated: "2026-10-12"
---

# Delete events reach their tenant after a server restart

## Description

TASK-368 routes every event on `/api/a2a/ws` by the tenant of the entity it names,
read from the database and cached. A delete event names a row that is already gone
when the event is routed: with a warm cache it still works, but right after a server
restart (or once the entry was evicted) the lookup finds nothing, answers the
unresolved tenant, and only super-admins get the event. The tenant's own users see a
deleted dataset or alert disappear only on refresh. `robot_unregistered` was worse:
the router forgets the robot's cached tenant on every (un)registration, and a robot
that is not in the database answers "no tenant", so the event reached every tenant.

## Details

**Current state:** `server/src/websocket/index.ts` `deliverFor(message, key)` peeks
the `TenantResolver` cache (`eventFanout.ts`) and otherwise calls `lookupTenant`
(`tenantLookups.ts`), which reads `tenantId` from the row a key names. Delete-type
emits that reach the socket:

| event | emitted by | routed by (before) |
| --- | --- | --- |
| `dataset:deleted` | `DatasetService.delete` | the Dataset row — gone |
| `alert_deleted` | `AlertService.deleteAlert` | the robot (robot alerts), else the Alert row — gone |
| `robot_unregistered` | `RobotManager.unregisterRobot` | the Robot row — gone → "no tenant" (everyone) |

No other delete emits a socket event: incidents, processes, robot tasks, digital
twins, deployments, conversations, teleop sessions and bulk alert clears delete
silently; `twinZone:deleted` is routed by its twin and `scan:deleted` by its robot,
both of which outlive the deleted row.

### Server

- The deleting service reads the row's tenant **before** the delete and carries it
  on the event as an optional `tenantId?: string | null` (`DatasetEvent`,
  `AlertEvent`, `RobotEvent`). It is only ever set by the server from the database,
  never from a request; `undefined` on every other event.
- `alertRepository.tenantOf(id)` and `datasetRepository.tenantOf(id)` return the
  row's `tenantId` (`undefined` when there is no row, `null` for a row without a
  tenant). `RobotManager` takes it from the cached/DB `RegisteredRobot.tenantId`.
- `deliverFor(message, key, carried?)` delivers by `carried` when it is set and
  falls back to the key lookup otherwise; everything genuinely unknown stays
  super-admin-only. The robot event payload strips `tenantId` (routing data, not
  payload).
- Doc table in `server/src/websocket/eventTenancy.ts`; `docs/multi-tenancy.md`
  live-events section.

### Key files

- `server/src/websocket/index.ts`, `server/src/websocket/eventTenancy.ts`
- `server/src/services/AlertService.ts`, `server/src/services/DatasetService.ts`,
  `server/src/services/RobotManager.ts`, `server/src/types/dataset.types.ts`
- `server/src/repositories/AlertRepository.ts`, `server/src/repositories/VLARepository.ts`
- `docs/multi-tenancy.md`

## Acceptance Criteria

- [x] With an empty tenant cache and the row gone, `dataset:deleted`,
      `alert_deleted` and `robot_unregistered` reach a same-tenant member socket and
      super-admins, and not another tenant's socket or an anonymous one.
- [x] A carried tenant wins over a key lookup and is not part of the payload sent
      to clients.
- [x] `DatasetService.delete`, `AlertService.deleteAlert` and
      `RobotManager.unregisterRobot` read the tenant before the row is deleted and
      put it on the event.
- [x] Events without a carried tenant are routed exactly as before (fail-closed for
      anything unknown).
- [x] `eventTenancy.ts` and `docs/multi-tenancy.md` describe the carried tenant.

## Test Strategy

- `server/src/websocket/__tests__/index.test.ts`: multi-tenancy block, delete events
  whose key the lookup cannot resolve, carrying `tenant-a`; a carried tenant
  overriding a lookup that would say `tenant-b`.
- `AlertService.test.ts`, `DatasetService.test.ts`, `RobotManager.test.ts`: the event
  carries the tenant read before `delete`.
- `cd server && npm run typecheck && npx vitest run`.

## Notes
