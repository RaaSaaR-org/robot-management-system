---
id: "TASK-317"
aliases: []
title: "The server grants one control lease per robot across replicas"
slug: "the-server-grants-one-control-lease-per-robot-across-replicas"
status: "todo"
priority: 2
owner: "huhn511"
projects: []
customers: []
tags: [core, compliance, safety]
sprint: ""
parent: "[[TASK-313]]"
depends_on: ["[[TASK-314]]"]
spe: 5
effort: "medium"
due_date: ""
created: "2026-09-30"
updated: "2026-09-30"
---

# The server grants one control lease per robot across replicas

## Description

Add the server-side authority: an authenticated, tenant-scoped acquire / release
/ observe API backed by one database row per robot, where concurrent acquisitions
from any number of server replicas produce exactly one winner, and a lease only
becomes usable after the robot agent has installed its generation. Behind
`CONTROL_LEASES_ENABLED` (default off).

## Details

### Current state

- Auth: `authMiddleware` sets `AuthUser {id, role, tenantId}`; role helpers
  `memberOrAbove`, `viewerOrAbove` in `server/src/middleware/auth.middleware.ts`.
  Tenant scoping via `tenantContext.ts` + Prisma `$extends` (`docs/multi-tenancy.md`).
- Robot lookup: `robotManager.getRegisteredRobot(id)` (used by
  `POST /:id/camera/:name/ticket` in `server/src/routes/robot.routes.ts` — the
  closest pattern: authenticated route that mints a credential for one robot).
- Server→agent calls: `HttpClient` + `agentServiceAuthHeaders()`
  (`server/src/services/agentServiceAuth.ts`).
- Agent side (TASK-314): `POST /api/v1/robots/:id/control-lease/install|release`,
  `GET …/control-lease`, gated by `AGENT_MEMORY_TOKEN`.
- Audit: `ComplianceLogService.logAccess` / `logSafetyAction`.

### Server

**Prisma** (`server/prisma/schema.prisma` + a migration in
`server/prisma/migrations/`, following the latest one's naming):

```prisma
model RobotControlLease {
  robotId     String   @id
  tenantId    String?
  generation  Int      @default(0)
  leaseIdHash String?
  sessionId   String?
  userId      String?
  displayName String?
  state       String   @default("released") // installing|held|stopping|unconfirmed|released|expired
  issuedAt    DateTime?
  expiresAt   DateTime?
  updatedAt   DateTime @updatedAt
}
```

Check against the multi-tenancy extension whether it needs registering as
tenant-scoped; the row is always read with the robot's `tenantId` from the
registry, never from the request body.

**Service** `server/src/services/ControlLeaseService.ts`:

- `acquire(user, robotId, displayName)`:
  1. Resolve robot via registry in the caller's tenant (404 otherwise).
  2. Mint `leaseId = randomBytes(16).toString('base64url')`, `sessionId = uuid`.
  3. Atomic take: `updateMany({where:{robotId, OR:[{state:{in:['released','expired']}}, {expiresAt:{lt: now}, state:{not:'unconfirmed'}}]}, data:{generation:{increment:1}, state:'installing', …}})`;
     count 0 → 409 `{code:'lease_held', holder:{userId, displayName, expiresAt}}`.
     No row yet → `create` with generation 1; unique-violation (P2002) → 409.
  4. `POST` agent `install` with `{generation, leaseIdHash, sessionId, userId, displayName, tenantId, ttlMs}`.
     Ack → state `held`, `expiresAt = now + ttl`; return 201
     `{leaseId, generation, sessionId, ttlMs, renewEveryMs, expiresAt}` — the only
     time `leaseId` leaves the server. Agent 409/timeout/unreachable → state
     `unconfirmed`, 503 `{code:'agent_unconfirmed'}` (fail closed).
- `release(user, robotId, leaseId, generation)`: conditional update where
  generation + hash + userId match → `stopping` → agent `release` → `released`
  (agent failure → `unconfirmed`). Stale generation → 200 `{released:false}`.
- `observe(robotId)`: public holder fields only — never hash or secret.
- An `unconfirmed` row blocks new acquisitions until an explicit release or a
  successful agent `GET` shows no installed lease (a `recheck` in `acquire`).

**Routes** `server/src/routes/control-lease.routes.ts`, mounted under
`/api/v1/robots`:

| Route | Guard | |
| ----- | ----- | - |
| `GET /:id/control-lease` | `viewerOrAbove` | `{capability:{version:1, enabled, ttlMs, renewEveryMs}, holder}` |
| `POST /:id/control-lease` | `memberOrAbove` | acquire |
| `POST /:id/control-lease/release` | `memberOrAbove` | release |

Flag `CONTROL_LEASES_ENABLED` (default off): `GET` answers `enabled:false`; the
POSTs answer 404 `{code:'control_leases_disabled'}`. TTL `CONTROL_LEASE_TTL_MS`
(default 5000), renew `CONTROL_LEASE_RENEW_MS` (default 1000).

**Audit:** acquire, denial (409/403), release, unconfirmed → compliance log with
tenant, robot, user, session, generation. Never the lease secret or hash.

**Key files**
- `server/prisma/schema.prisma`, new migration
- `server/src/services/ControlLeaseService.ts` (new)
- `server/src/routes/control-lease.routes.ts` (new) + mount in `server/src/app.ts`
- `server/src/services/__tests__/ControlLeaseService.test.ts` (new)
- `server/src/__tests__/control-lease-routes.test.ts` (new)
- `docs/api.md` (the three routes)

## Acceptance Criteria

- [ ] Two `ControlLeaseService` instances on the same database acquiring the
      same robot concurrently: exactly one 201, the other 409 with the holder.
- [ ] Same user, two sessions: second acquire gets 409.
- [ ] Viewer gets 403; a user of another tenant gets 404.
- [ ] Mock agent refusing/unreachable → 503 `agent_unconfirmed`, row
      `unconfirmed`, next acquire refused until recheck clears it.
- [ ] Generation strictly increases across acquisitions and is what the mock
      agent received.
- [ ] Stale release (old generation) does not touch the current holder.
- [ ] `leaseId`/hash absent from `GET`, logs and audit entries (asserted).
- [ ] Flag off: POSTs 404, `GET` says `enabled:false`, all existing server tests
      pass.

## Test Strategy

Vitest against the SQLite test database the server tests already use; a mock
agent `HttpClient`. `npm run typecheck` and `npx vitest run` in `server/`.
