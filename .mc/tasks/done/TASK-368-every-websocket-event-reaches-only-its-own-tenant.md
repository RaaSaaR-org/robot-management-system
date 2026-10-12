---
id: "TASK-368"
aliases: ["TASK-368"]
title: "Every WebSocket event reaches only its own tenant"
slug: "every-websocket-event-reaches-only-its-own-tenant"
status: "done"
priority: 1
owner: "huhn511"
projects: []
customers: []
tags: ["core", "multi-tenancy", "security"]
sprint: ""
parent: ""
depends_on: ["[[TASK-366]]"]
spe: 3
effort: "medium"
due_date: ""
created: "2026-10-12"
updated: "2026-10-12"
---

# Every WebSocket event reaches only its own tenant

## Description

TASK-366 (PR #389) made robot telemetry and status on `/api/a2a/ws` reach only
identified sockets of the robot's tenant. Every other event family still reached
every signed-in user of every tenant: alerts, incidents, training jobs, dataset
validation and import progress, processes, robot tasks without a robot, E-stops,
digital twins and twin zones, teleop sessions, deployments and A2A conversation
tasks. With multi-tenancy on, tenant B's dashboard received tenant A's training
progress, incidents and E-stops.

## Details

**Current state (on the TASK-366 branch):** `server/src/websocket/index.ts`
subscribes to every service and calls `deliver(message)` (identified sockets, no
tenant) for all families except robot events, which go through `deliverForRobot`
with a cached robot → tenant lookup (`RobotTenantResolver` in `eventFanout.ts`).
There is only one WebSocket server in `server/src`; approvals have no WebSocket
event.

### Server

- `server/src/websocket/eventTenancy.ts` (new, pure): the entity whose `tenantId`
  routes each event family (`eventTenantKey.*`, keys `<entity>:<id>`), and
  `eStopEventFor`, which cuts a fleet/zone E-stop spanning several tenants down to
  the robots one socket may observe (counts recomputed).

  | family | routed by |
  | --- | --- |
  | `task_event` (A2A) | Conversation (contextId), else the A2A Task's conversation |
  | `alert_*` | the robot for robot alerts (the row is deleted on dismiss), else Alert |
  | `process:*`, `step:*` | ProcessInstance |
  | `task:*` | RobotTask |
  | `incident:*` | Incident (incident.id or notification.incidentId) |
  | `training:job:*` | TrainingJob |
  | `dataset:*` | Dataset |
  | `session:*`, `twin:*`, `twinZone:*` | DigitalTwin |
  | `teleop:*` | the session's robot |
  | `deployment:*` | Deployment, else robot |
  | robot, agent mode, sensor scans, work assignment | Robot (unchanged) |
  | `safety:estop` | each affected robot, sliced per socket |

- `server/src/websocket/tenantLookups.ts` (new): reads the tenant behind a key with
  Prisma under `runAsPlatform`. A row that is gone answers the unresolved tenant
  (super-admins only); a missing robot keeps TASK-366's rule (no tenant).
- `server/src/websocket/eventFanout.ts`: `RobotTenantResolver` generalised to a
  bounded `TenantResolver` (10 000 answers, oldest dropped; not-found not cached);
  `deliverEventPerSocket` for per-socket payloads.
- `server/src/websocket/index.ts`: one `deliverFor(message, key)` for every family.

No family is platform-wide; an event whose entity cannot be named or found reaches
super-admins only. Multi-tenancy off and `AUTH_DISABLED=true` behave as before.

### Key files

- `server/src/websocket/eventTenancy.ts`, `server/src/websocket/tenantLookups.ts`
- `server/src/websocket/eventFanout.ts`, `server/src/websocket/index.ts`
- `docs/multi-tenancy.md`

## Acceptance Criteria

- [x] With multi-tenancy on, each event family reaches only identified sockets of
      the owning tenant and super-admins (tested per family).
- [x] A cross-tenant fleet E-stop gives each tenant only its own robots.
- [x] An event whose entity is gone reaches super-admins only.
- [x] Multi-tenancy off / `AUTH_DISABLED=true`: every identified socket gets every
      event, as before (existing tests unchanged).

## Test Strategy

`server/src/websocket/__tests__/eventTenancy.test.ts` (keys per family, E-stop
slicing), `eventFanout.test.ts` (bounded resolver, per-socket delivery) and
`index.test.ts` "with multi-tenancy on" (end-to-end routing per family with a
mocked tenant table). Gates: server typecheck and vitest.

## Notes

Stacked on PR #389 (TASK-366). Limitation: a delete event (a non-robot alert
dismissed, a dataset deleted) for an entity no earlier event of this server process
routed finds no row and reaches super-admins only; the tenant's lists catch up on
their next fetch.
