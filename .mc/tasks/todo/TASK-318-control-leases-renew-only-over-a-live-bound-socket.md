---
id: "TASK-318"
aliases: []
title: "Control leases renew only over a live bound socket"
slug: "control-leases-renew-only-over-a-live-bound-socket"
status: "review"
priority: 2
owner: "huhn511"
projects: []
customers: []
tags: [core, compliance, safety]
sprint: ""
parent: "[[TASK-313]]"
depends_on: ["[[TASK-315]]", "[[TASK-317]]"]
spe: 5
effort: "medium"
due_date: ""
created: "2026-09-30"
updated: "2026-09-30"
---

# Control leases renew only over a live bound socket

## Description

Add renewal to the server lease authority: a renew succeeds only for the current
unexpired generation, re-checks the user's role, and requires the agent to report
a live bound control socket. Expired or refused leases are fenced on the agent,
and every holder transition is published to observers without secrets.

## Details

### Current state

- TASK-317: `ControlLeaseService` (`server/src/services/ControlLeaseService.ts`),
  `RobotControlLease` row (`generation`, `leaseIdHash`, `state`, `expiresAt`,
  `issuedAt`), routes in `server/src/routes/control-lease.routes.ts`.
- TASK-314/315: agent `POST …/control-lease/renew {generation, ttlMs}` →
  `{renewed:true, bound:boolean}` or 409 `not_installed|expired`;
  `bound` is true while a teleop socket is bound to that generation.
- Server WS fan-out: `server/src/websocket/index.ts` (`broadcast`).
- Users: Prisma `User` holds the current role; the JWT role may be stale.

### Server

- `POST /api/v1/robots/:id/control-lease/renew {leaseId, generation}`
  (`memberOrAbove`):
  1. Re-read the user from the DB; missing, disabled or role below `member` →
     fence (below) and 403 `{code:'not_authorized'}`.
  2. Conditional update where robot + generation + hash + userId match,
     `state:'held'` and `expiresAt > now` → new `expiresAt`. Count 0 → 409
     `{code:'lease_lost'}` (late renew never resurrects).
  3. Agent `renew`. 409 → fence, 409 `lease_lost`. Unreachable → keep the DB
     expiry as is (agent expires on its own), 503 `agent_unconfirmed`.
     `bound:false` while `now - issuedAt > ttlMs` → fence, 409
     `{code:'transport_lost'}`.
  4. 200 `{generation, expiresAt, ttlMs, renewEveryMs}`.
- **Fence** helper: row → `stopping`, agent `release`, row → `released`
  (`unconfirmed` if the agent does not ack).
- **Expiry sweeper** (`setInterval` every `renewEveryMs`, started in the server
  bootstrap, `unref()`): rows `held` with `expiresAt < now` → fence → `expired`.
  Safe to run on every replica: it only acts through the same conditional
  updates.
- **Observer events:** on every transition broadcast
  `{type:'control_lease', robotId, state, generation, holder:{userId,
  displayName}, expiresAt}` through `server/src/websocket/index.ts` to clients
  of the robot's tenant only. No `leaseId`, no hash.
- **Audit:** renewal loss (`lease_lost`, `transport_lost`, `not_authorized`,
  expiry) via `ComplianceLogService`, no secrets.

**Key files**
- `server/src/services/ControlLeaseService.ts`
- `server/src/routes/control-lease.routes.ts`
- `server/src/websocket/index.ts`
- server bootstrap that starts background jobs (where `server/src/jobs/` jobs are started)
- `server/src/services/__tests__/ControlLeaseService.renew.test.ts` (new)
- `docs/api.md`

## Acceptance Criteria

- [ ] Renew of the current generation extends `expiresAt`; renew after expiry →
      409 `lease_lost` and the row stays expired.
- [ ] Demoting the user to `viewer` in the DB makes the next renew 403 and
      fences the lease on the mock agent.
- [ ] Mock agent reporting `bound:false` past the first TTL → 409
      `transport_lost` and a `release` call to the agent.
- [ ] Mock agent answering 409 (agent restarted) → fence, `lease_lost`.
- [ ] Sweeper fences a lease nobody renews within TTL, on either of two service
      instances, exactly once.
- [ ] Observers of the robot's tenant receive each transition; observers of
      another tenant receive nothing; no payload contains `leaseId` or the hash.

## Test Strategy

Vitest with fake timers, SQLite test DB, mock agent client; a WS broadcast test
with two tenants.
