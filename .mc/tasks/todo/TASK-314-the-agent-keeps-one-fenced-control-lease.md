---
id: "TASK-314"
aliases: []
title: "The agent keeps one fenced control lease"
slug: "the-agent-keeps-one-fenced-control-lease"
status: "todo"
priority: 2
owner: "huhn511"
projects: []
customers: []
tags: [core, safety]
sprint: ""
parent: "[[TASK-313]]"
depends_on: []
spe: 5
effort: "medium"
due_date: ""
created: "2026-09-30"
updated: "2026-09-30"
---

# The agent keeps one fenced control lease

## Description

Give the robot agent a registry that holds exactly one installed control lease,
refuses stale generations (also across restarts), expires it on its own clock,
and exposes service-gated REST to install, renew, release and observe it. Purely
additive: nothing consults the registry yet, so robot behaviour does not change.

## Details

### Robot Agent

**New `robot-agent/src/control-lease/control-lease.ts`** — class
`ControlLeaseRegistry` + process singleton `controlLease`.

State:

```ts
interface InstalledLease {
  generation: number;          // strictly increasing
  leaseIdHash: string;         // sha256 hex of the client's raw leaseId
  sessionId: string;
  userId: string;
  displayName: string;
  tenantId: string | null;
  deadline: number;            // performance.now()-based, local clock only
  state: 'held' | 'expired' | 'released';
}
```

Methods (all synchronous, injectable `now()` for tests):

- `install({generation, leaseIdHash, sessionId, userId, displayName, tenantId, ttlMs})`
  → refuses (`{ok:false, code:'stale_generation', highWater}`) when
  `generation <= highWater`. Otherwise: fences the current lease (state →
  `released`, emits `fenced`), installs the new one, persists the new high-water
  **before** returning ok.
- `renew({generation, ttlMs})` → ok only if `generation` is the installed one,
  state `held` and not past its deadline (a late renew never resurrects:
  `code:'expired'`). Returns `{ok, bound}` where `bound` comes from
  `setBoundCount()` below.
- `release({generation})` → idempotent; a release for any generation other than
  the installed one is a no-op (`{ok:true, released:false}`) — a delayed release
  cannot revoke a successor. Emits `fenced` when it did release.
- `verify(rawLeaseId, generation)` → `true` only for the installed, `held`,
  unexpired generation with a matching hash (constant-time compare).
- `setBoundCount(generation, n)` / `bound()` — the teleop socket (TASK-315)
  reports how many live sockets are bound; this child only stores it.
- `observe()` → `{enforced, state: 'none'|'held'|'expired'|'released', generation,
  userId, displayName, sessionId, expiresInMs, bound}` — **never** the hash.
- `subscribe(cb)` → events `{type:'installed'|'renewed'|'fenced'|'expired', generation}`.
- A timer at the deadline flips `held` → `expired` and emits `expired`. The
  registry emits; it does not itself move hardware.
- On `fenced` and `expired`, the wiring in `index.ts` sends a zero-TTL stop
  (`hardwareClient.locoMove(0, 0, 0, 0)`), the same call `keyboard-teleop.ts`
  makes on socket close.

Persistence: high-water generation in
`robot-agent/data/control-lease-<ROBOT_ID>.json`, written with
`atomicWriteFileSync` (`robot-agent/src/utils/atomic-file.ts`), path resolved like
`incarnations.ts` does. On construction: read high-water; installed lease =
none (restart kills all authority). A corrupt/unreadable file → refuse every
install until an operator fixes it (fail closed), and say so in `observe()`
(`state:'none'`, `error:'high_water_unreadable'`).

**Config:** `CONTROL_LEASE_REQUIRED` in `robot-agent/src/config/config.ts`
(boolean, default `false`) → `config.controlLease.required`; reported as
`enforced` by `observe()`. Nothing else reads it in this child.

**REST** in `robot-agent/src/api/rest-routes.ts`, all behind the existing
`personalDataGate` (bearer `AGENT_MEMORY_TOKEN` or loopback, refuses cross-origin
browsers) so a browser can never install a lease itself:

| Route | Body | Success | Refusal |
| ----- | ---- | ------- | ------- |
| `POST /api/v1/robots/:id/control-lease/install` | `{generation, leaseIdHash, sessionId, userId, displayName, tenantId, ttlMs}` | 200 `{installed:true, generation, fencedGeneration}` | 409 `{code:'stale_generation', highWater}`; 400 on bad body; 503 `{code:'high_water_unreadable'}` |
| `POST …/control-lease/renew` | `{generation, ttlMs}` | 200 `{renewed:true, bound}` | 409 `{code:'not_installed'|'expired'}` |
| `POST …/control-lease/release` | `{generation}` | 200 `{released:boolean}` | 400 on bad body |
| `GET …/control-lease` | — | 200 `observe()` | — |

Validate: `generation` positive safe integer, `leaseIdHash` 64 hex chars,
`ttlMs` integer 500–60000, strings ≤ 200 chars. `:id` must equal `ROBOT_ID`
(404 otherwise, like sibling routes). Never log `leaseIdHash`.

**Key files**
- `robot-agent/src/control-lease/control-lease.ts` (new)
- `robot-agent/src/control-lease/__tests__/control-lease.test.ts` (new)
- `robot-agent/src/api/rest-routes.ts`
- `robot-agent/src/api/__tests__/control-lease-routes.test.ts` (new)
- `robot-agent/src/config/config.ts`
- `robot-agent/src/index.ts` (wire fence/expire → zero stop)

## Acceptance Criteria

- [ ] Install with generation ≤ high-water returns 409 `stale_generation`; with a
      higher one it fences the previous lease and emits `fenced`.
- [ ] High-water survives a new `ControlLeaseRegistry` on the same file; after
      "restart" nothing is installed and the old generation cannot be installed
      or renewed.
- [ ] Renew after the deadline returns 409 `expired`; the lease stays expired.
- [ ] Release with a stale generation does not touch the installed lease.
- [ ] `verify` rejects wrong secret, wrong generation, expired and released leases.
- [ ] Deadline expiry emits `expired` without any call; fence/expire trigger one
      zero-velocity stop in `index.ts` wiring (tested with a stubbed client).
- [ ] Routes refuse a cross-origin browser request and a wrong bearer (same
      behaviour as other `personalDataGate` routes); `GET` never contains the hash.
- [ ] With `CONTROL_LEASE_REQUIRED` unset, every existing robot-agent test passes
      unchanged.

## Test Strategy

Vitest with fake timers and an injected clock for the registry; supertest-style
route tests the way `robot-agent/src/api/__tests__/` already builds the router;
a temp dir for the persistence file. `npm run typecheck` and `npx vitest run` in
`robot-agent/`.
