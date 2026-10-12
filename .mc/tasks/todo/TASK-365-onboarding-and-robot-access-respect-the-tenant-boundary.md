---
id: "TASK-365"
aliases: ["TASK-365"]
title: "Onboarding and robot access respect the tenant boundary"
slug: "onboarding-and-robot-access-respect-the-tenant-boundary"
status: "in-progress"
priority: 1
owner: "claude"
projects: []
customers: []
tags: ["core", "multi-tenancy", "security"]
sprint: ""
parent: ""
depends_on: []
spe: 3
effort: "medium"
due_date: ""
created: "2026-10-12"
updated: "2026-10-12"
---

# Onboarding and robot access respect the tenant boundary

## Description

Two tenant-isolation holes found by running the production chart on k3d with
auth and `MULTI_TENANCY_ENABLED=true`: onboarding a tenant puts its first owner
into the super-admin's tenant instead of the new one, and any tenant can read,
command and "delete" another tenant's robot by id.

## Details

**Current state**

- `server/src/services/TenantService.ts` `onboard()` creates the tenant, then
  the owner with `tenantId: tenantRow.id`, inside `prisma.$transaction`. The
  call comes from a super-admin request, which runs in DEFAULT (or the
  impersonated tenant). The tenant-isolation extension
  (`server/src/database/client.ts`) stamps the request's tenant over every
  `create`, so the owner lands in DEFAULT. Measured on k3d: the demo seed's
  `demo@emai.dev` and an owner onboarded through the Organizations wizard both
  had `tenantId = "default"`; the TopBar showed "Default Organization" and the
  Organizations table counted the owner under Default, 0 users under the new
  tenant. `starterResources.cloneRobots` has the same fault.
- `server/src/services/RobotManager.ts` keeps one process-wide `robotCache`
  (robot id → connection). `getRobot`, `getRegisteredRobot` (used by command,
  telemetry and every proxy route), `unregisterRobot` and
  `getConnectedAgents` answer from it before any tenant-scoped query. Measured
  on k3d with tenant B's owner token against tenant A's robot `g1-01`:
  `GET /api/robots/g1-01` 200, `GET .../telemetry` 200,
  `POST .../command {"type":"stop"}` 200 (executed on the robot), and
  `DELETE /api/robots/g1-01` 200 — the row survived (the extension's delete
  guard refused) but the cache entry was dropped, so tenant A's live
  connection vanished.

**Server**

- `onboard()` runs its transaction under `runAsPlatform`, so the explicit
  `tenantId`s are written as given.
- `RegisteredRobot` carries the row's `tenantId` (repository mappers and
  `registerRobot`). A `cachedFor(id)` helper returns a cache entry only when
  there is no tenant scope or the entry's tenant matches; every request-facing
  lookup goes through it. `unregisterRobot` deletes the row first and drops
  the cache entry only when that delete succeeded.

**Key files**

- `server/src/services/TenantService.ts`
- `server/src/services/RobotManager.ts`
- `server/src/repositories/RobotRepository.ts`
- `server/src/__tests__/tenant-boundary.integration.test.ts` (new)

## Acceptance Criteria

- [x] An owner onboarded by a super-admin (in DEFAULT or impersonating another
      tenant) belongs to the new tenant; cloned robot templates do too.
- [x] With a tenant scope, `getRobot`, `getRegisteredRobot`, `sendCommand`,
      `getTelemetry` and `getConnectedAgents` do not see another tenant's
      robot; `unregisterRobot` returns false and leaves its live entry alone.
- [x] Without a tenant scope (multi-tenancy off, startup, jobs) behaviour is
      unchanged.

## Test Strategy

- `server/src/__tests__/tenant-boundary.integration.test.ts` drives the real
  client singleton (isolation extension included) against a temp SQLite
  database; 6 of its 7 cases fail on `main`.
- k3d (production chart, auth on, `MULTI_TENANCY_ENABLED=true`): onboarded
  owner counted under the new tenant; tenant B gets 404 on tenant A's robot
  GET/telemetry/command/delete, tenant A still commands it.

## Notes

- Registering another tenant's agent URL still answers a bare 500 (the robot id
  is the primary key, so the create collides). No takeover happens; a clearer
  409 is a follow-up.
