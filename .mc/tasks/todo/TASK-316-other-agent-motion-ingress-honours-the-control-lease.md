---
id: "TASK-316"
aliases: []
title: "Other agent motion ingress honours the control lease"
slug: "other-agent-motion-ingress-honours-the-control-lease"
status: "in-progress"
priority: 2
owner: "huhn511"
projects: []
customers: []
tags: [core, safety]
sprint: ""
parent: "[[TASK-313]]"
depends_on: ["[[TASK-314]]"]
spe: 5
effort: "medium"
due_date: ""
created: "2026-09-30"
updated: "2026-09-30"
---

# Other agent motion ingress honours the control lease

## Description

Close the bypasses around the teleop socket: with `CONTROL_LEASE_REQUIRED` on,
the bilateral teleop socket needs a bound lease like keyboard teleop, and no
REST route may start robot motion while a human holds the lease. Flag off:
unchanged.

## Details

### Current state

- `robot-agent/src/api/bilateral-teleop.ts` — leader-arm → follower-arm WS,
  sends actions to the hardware sidecar; no lease, unauthenticated.
- Motion-starting REST routes in `robot-agent/src/api/rest-routes.ts`:
  `POST /robots/:id/command`, `/skills/execute`, `/vla/start`, `/vla/resume`,
  `/evaluation/run`, `/tasks`, `/agent-mode/command`, `/agent-mode/tour`,
  `/agent-mode/patrol`. `vla`/`agent` claims go through `controlOwnerLock`
  (`robot-agent/src/agent-mode/control-owner.ts`; `vla` claim in
  `robot-agent/src/robot/state.ts` ~line 2040), which refuses them while
  `teleop` holds — but not in the window where a lease is held and no socket
  has bound yet, and `/command`/`/tasks` must be checked for whether they claim
  at all.
- Registry: `controlLease.observe()` from TASK-314 (`state`, `displayName`).

### Robot Agent — only when `config.controlLease.required` is true

- **Shared guard** `robot-agent/src/control-lease/motion-guard.ts`:
  `refuseIfLeaseHeld(res): boolean` — when `observe().state === 'held'`, answer
  409 `{code:'control_lease_held', holder:{displayName, userId}, message}` and
  return true. Apply it at the top of every route listed above.
- **Stop/abort/E-stop routes are never guarded** (`/vla/stop`, `/vla/pause`,
  `/skills/abort`, `/agent-mode/*/abort`, `/safety/estop*`,
  `/agent-mode/estop*`) — stopping is always allowed.
- **Bilateral teleop:** same `{bind:{leaseId, generation}}` contract as
  TASK-315; unbound action frames are dropped with `{type:'error',
  code:'lease_required'}`; fence/expire stops forwarding immediately. Reuse
  whatever bind helper TASK-315 extracted; if it left none, extract
  `robot-agent/src/control-lease/socket-binding.ts` here and use it in both.
- Autonomous starts while **no** lease is held stay admitted (epic decision; an
  open question for the user).

**Key files**
- `robot-agent/src/control-lease/motion-guard.ts` (new)
- `robot-agent/src/api/rest-routes.ts`
- `robot-agent/src/api/bilateral-teleop.ts`
- `robot-agent/src/api/__tests__/control-lease-ingress.test.ts` (new)

## Acceptance Criteria

- [ ] Flag on + lease held: every listed start route returns 409
      `control_lease_held` naming the holder and starts nothing.
- [ ] Flag on + lease held: stop, abort and E-stop routes still succeed.
- [ ] Flag on: bilateral action frames from an unbound socket never reach the
      sidecar client; a bound socket's do; fence stops them.
- [ ] Flag on + no lease: autonomous routes behave as today.
- [ ] Flag off: existing route and bilateral tests pass unmodified.

## Test Strategy

Route tests with a stub registry state; a `ws` client test for bilateral with a
stubbed sidecar client.
