---
id: "TASK-395"
aliases: []
title: "The server keeps a control lease whose agent reports a bound socket"
slug: "the-server-keeps-a-control-lease-whose-agent-reports-a-bound"
status: "done"
priority: 1
owner: "huhn511"
projects: []
customers: []
tags: ["core", "teleop", "safety"]
sprint: ""
parent: ""
depends_on: []
spe: 1
effort: "low"
due_date: ""
created: "2026-10-17"
updated: "2026-10-17"
---

# The server keeps a control lease whose agent reports a bound socket

## Description

Every "Take control" from the Meta Quest ended in `heartbeat_lost` about 5 s later.
The robot agent reports a bound control socket as a count, the server read only a
boolean, so it fenced every lease after the first TTL window. The server must read
the agent's count as bound.

## Details

**Current state (before the fix):**

- The robot agent's `POST /api/v1/robots/:id/control-lease/renew`
  (`robot-agent/src/api/rest-routes.ts`, ~line 2280) answers
  `{ renewed: true, bound: result.bound }`, where the lease registry's `bound()`
  returns a `number` — how many sockets are bound to the lease.
- The server's HTTP agent port `httpControlLeaseAgent.renew` in
  `server/src/services/ControlLeaseService.ts` mapped that to
  `bound: answer.bound === true`, so the agent's `1` read as unbound.
- After the first TTL window (5 s) `ControlLeaseService.renew()` requires a bound
  socket, so it fenced the lease with `transport_lost`; the agent revoked it and the
  Quest operator saw `heartbeat_lost` ~5 s after every "Take control".

### Server

- Add exported `isBound(bound: unknown): boolean` to
  `server/src/services/ControlLeaseService.ts`: `true` for a boolean `true` or a
  finite number > 0; everything else (0, `false`, missing, `null`, a string, `NaN`,
  `Infinity`, negatives) fails closed as unbound.
- `httpControlLeaseAgent.renew` uses `isBound(answer.bound)`; the answer type is
  `bound?: boolean | number`.

**Key files:**

- `server/src/services/ControlLeaseService.ts` — modify
- `server/src/services/__tests__/ControlLeaseService.agentPort.test.ts` — create

## Acceptance Criteria

- [x] `isBound` is true for `1`, `2`, `true` and false for `0`, `false`, `undefined`, `null`, `'1'`, `NaN`
- [x] `httpControlLeaseAgent.renew` against an agent answering `{ renewed: true, bound: 1 }` returns `{ ok: true, bound: true }`
- [ ] A held lease stays held past the first TTL window while the Quest socket is bound (live re-check on the real G1 still pending when this file was written)

## Test Strategy

- `server/src/services/__tests__/ControlLeaseService.agentPort.test.ts` tests
  `isBound` and drives `httpControlLeaseAgent.renew` against a local
  `node:http` server (bound `1`, `0`, `true`, missing, no `renewed`, 409). Run
  against the pre-fix `ControlLeaseService.ts`, the `bound: 1` renew case fails
  (`bound: false`).
- The existing control-lease suites (`ControlLeaseService.test.ts`,
  `ControlLeaseService.renew.test.ts`, `control-lease-routes.test.ts`,
  `control-lease-app-audit.test.ts`) still pass.

## Notes

- Before the fix, a live CDP trace of the app showed the lease go held → bound →
  5 renews → `stopping`/`revoked` at ~5.3 s.
