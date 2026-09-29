---
id: "TASK-313"
aliases: []
title: "Robot-wide per-user control leases"
slug: "robot-wide-per-user-control-leases"
status: "todo"
priority: 2
owner: "huhn511"
projects: []
customers: []
tags: [core, compliance, safety]
sprint: ""
parent: ""
depends_on: []
spe:
effort: ""
due_date: ""
created: "2026-09-30"
updated: "2026-09-30"
---

# Robot-wide per-user control leases

## Description

Today any number of clients can drive the same robot at once: every
`/ws/keyboard-teleop` socket claims the `teleop` class and the refcount admits
it, with no user, session or generation attached. This epic makes human motion
authority an **exclusive, fenced, expiring lease per `(tenantId, robotId)`**,
granted by the server across all replicas and enforced by the robot agent at the
point every motion command is admitted. Everything ships behind two flags that
default **off**, so existing shared-teleop behaviour is unchanged until an
operator turns them on. Source: GitHub issue #323 (spec handoff from the vrhq
repo, TASK-008 there).

Decision record: [`docs/records/TASK-313-robot-wide-per-user-control-leases.md`](../../../docs/records/TASK-313-robot-wide-per-user-control-leases.md)

## Details

### Current state (facts, checked on `main` at 77cc8ff0)

- `robot-agent/src/agent-mode/control-owner.ts` — `ControlOwnerLock` arbitrates
  `idle | teleop | vla | agent`. `claim('teleop')` always succeeds, preempts
  `agent`/`vla`, and a second `teleop` claim increments a holder refcount. No
  identity of any kind is recorded. Process-local singleton `controlOwnerLock`.
- `robot-agent/src/api/keyboard-teleop.ts` — claims `teleop` **on socket
  connect** (line ~302), sends `{type:'control', owner, preempted}`, and on close
  stops the base it drove and releases one holder. The socket is
  **unauthenticated**; it is routed by the upgrade dispatcher in
  `robot-agent/src/index.ts`.
- The app connects **directly to the agent** for teleop
  (`app/src/features/robots/components/tabs/TeleopTab.tsx`, `getWsBaseUrl` →
  agent base URL), not through the server. So the server cannot be the
  enforcement point; the agent must be.
- Other motion ingress on the agent: `robot-agent/src/api/bilateral-teleop.ts`
  (WS), and REST in `robot-agent/src/api/rest-routes.ts`: `/robots/:id/command`,
  `/skills/execute`, `/vla/start`, `/evaluation/run`, `/tasks`,
  `/agent-mode/command|tour|patrol`. `vla` claims the lock in
  `robot-agent/src/robot/state.ts` (~line 2040).
- Server→agent service auth exists: `AGENT_MEMORY_TOKEN` bearer
  (`server/src/services/agentServiceAuth.ts`), checked on the agent by
  `personalDataGate` in `rest-routes.ts` (bearer or loopback, refuses
  cross-origin browser calls).
- Server auth: JWT `AuthUser {id, role, tenantId}`, roles
  `super-admin | owner | member | viewer`, helpers `memberOrAbove` /
  `viewerOrAbove` in `server/src/middleware/auth.middleware.ts`; row-level tenancy
  via `tenantContext.ts` and Prisma `$extends` (`docs/multi-tenancy.md`).
- Shared state across server replicas: the Prisma database (PostgreSQL in
  production) is mandatory; NATS KV (`server/src/messaging/kv-stores.ts`) is
  **optional** and disabled when absent.
- Agent boot lineage and atomic persistence exist:
  `robot-agent/src/agent-mode/incarnations.ts`, `robot-agent/src/utils/atomic-file.ts`
  (files under `robot-agent/data/`).
- Audit: `server/src/services/ComplianceLogService.ts` (`logAccess`,
  `logSafetyAction`).

### Architecture (decided — see record)

```
browser ──JWT──▶ server (any replica) ──conditional UPDATE──▶ DB row per robot
                    │  (generation++, lease secret hashed)
                    └─ AGENT_MEMORY_TOKEN ─▶ agent  POST …/control-lease/install
                                               (fences old generation, stops base,
                                                acks) ◀── only then: lease "held"
browser ──raw leaseId + generation──▶ agent WS {bind}  (motion admitted only
                                                        on a bound socket)
browser ─renew 1 Hz─▶ server ─recheck role, conditional UPDATE─▶ agent renew
                                                    (answers bound: true|false)
```

- **Authority store:** one `RobotControlLease` row per robot in the Prisma DB.
  Acquire/renew/release are single conditional `UPDATE`s (plus a unique-key
  `create` for the first lease of a robot), so two replicas racing get exactly
  one winner. NATS KV is not used — it is optional, and "fail closed" cannot rest
  on an optional dependency.
- **Enforcement point:** the robot agent. It keeps the one installed lease
  (`generation`, `sha256(leaseId)`, `sessionId`, `userId`, `displayName`,
  local deadline) and a **persisted generation high-water mark**; an install with
  a generation ≤ high-water is refused. Restart installs nothing, so every prior
  lease is dead after an agent restart.
- **Credential:** `leaseId` is 128 random bits, returned once to the acquiring
  client. The server stores and forwards only its SHA-256; the client presents
  the raw value on the agent socket. Never logged on either side.
- **Clock:** the server sends the agent a *relative* `ttlMs`; the agent sets its
  deadline on its own monotonic clock. Network delay can only shorten authority,
  never extend it. The browser clock is never used for admission.
- **Transport health:** the agent answers every renew with whether a socket is
  currently bound to that generation; the server refuses renewal of a lease with
  no bound socket once the first TTL window has passed. Presence, telemetry and
  unrelated browser activity cannot renew.
- **Joining:** additional input views (VR, gamepad) join by binding with the same
  `leaseId` + generation — holding the secret is the explicit join. A second tab
  of the same user without the secret is an observer.
- **Autonomy:** human teleop keeps its preemption of `agent`/`vla`, but under
  enforcement it happens at **bind**, not connect, and the base is stopped before
  the bind is acknowledged. While a lease is held, autonomous motion starts are
  refused. No human preempts another human.
- **E-stop** is independent: accepted from any socket or authorized caller,
  bound or not, and no lease operation resets it.
- **Flags, default off:** `CONTROL_LEASES_ENABLED` (server — exposes the
  capability and routes) and `CONTROL_LEASE_REQUIRED` (agent — enforces). With
  both off, behaviour is byte-identical to today.
- **Defaults:** TTL 5 s, renew every 1 s (from #323; provisional, see Open
  questions). Acquire: `memberOrAbove`. Observe: `viewerOrAbove`.

### Children

| Task | Slice | spe | Blocked by |
| ---- | ----- | --- | ---------- |
| TASK-314 | Agent lease registry + service-gated install/renew/release/observe | 5 | — |
| TASK-315 | Keyboard teleop drives only on a lease-bound socket | 5 | 314 |
| TASK-316 | Other agent motion ingress honours the lease | 5 | 314 |
| TASK-317 | Server grants one lease per robot across replicas | 5 | 314 |
| TASK-318 | Renewal, expiry, role revocation, observer events | 5 | 315, 317 |
| TASK-319 | Teleop console + VR acquire, renew and release | 5 | 318 |
| TASK-320 | Data-collection input views drive under the lease | 3 | 319 |

Out of scope: the vrhq (HQ) client/bridge integration — that lives in the vrhq
repo and consumes the capability this epic publishes; administrative forced
takeover (optional per #323, not planned — see Open questions).

## Acceptance Criteria

- [ ] All seven children are `done`.
- [ ] With both flags off, the existing teleop, VR, Agent Mode and VLA test suites
      pass unchanged.
- [ ] With both flags on, automated tests show exactly one generation can command
      in each #323 case: simultaneous acquisition from two server instances,
      same-user competing tabs, direct-agent bypass (unbound socket, raw REST),
      cross-tenant denial, observer (viewer) denial, role revocation, expiry and
      late renewal, dropped socket, agent restart, delayed command/release after
      handover.
- [ ] E-stop from a non-holder works while a lease is held; no lease operation
      clears an E-stop latch.
- [ ] Lease secrets never appear in logs, audit records or observer payloads.

## Test Strategy

Each child carries its own unit/integration tests with mock agents (#323 asks for
mock agents for automated commands). The epic closes on the union above; physical
stop behaviour on hardware is measured separately and is not claimed by this epic.

## Open questions (user-owned)

1. **TTL / renew timing.** 5 s / 1 s adopted provisionally from #323; confirm
   against real deployment latency (split-host, Wi-Fi robots) before enabling.
2. **Who may acquire.** Default `super-admin | owner | member`; `viewer` denied.
   Should a narrower "operator" permission exist?
3. **Administrative forced takeover.** Not planned. Wanted? It needs its own
   authorization, reason, audit and notification.
4. **Rollout.** When (if ever) should the flags default on, and should a
   deployment with leases enabled refuse legacy clients that never bind?
5. **Autonomous starts while no lease is held** stay admitted (the lease governs
   humans). Should enforced mode instead require a lease for API-started
   VLA/agent runs too?

## Notes

- 2026-09-30: grilled and planned unattended from #323 (user absent); every
  decision above was taken by the agent and is marked so in the record.
