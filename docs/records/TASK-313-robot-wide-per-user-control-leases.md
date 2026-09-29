# TASK-313 — Robot-wide per-user control leases

**Date:** 2026-09-30
**Task:** `.mc/tasks/todo/TASK-313-robot-wide-per-user-control-leases.md`
**Source:** GitHub issue #323 (spec handoff from vrhq TASK-008)
**Hand-off:** `/plan` — epic, split into TASK-314 … TASK-321

Immutable once committed. Later changes of mind get their own record.

## How this was decided

The session ran **unattended**: the user asked for open issues to be triaged and
worked "without me". No interview took place. Every decision below was taken by
the agent, is marked **Owner: agent (unattended)**, and is open to override; the
ones the agent judged genuinely user-owned were listed as open questions and
were resolved only provisionally. Nothing here overrides a user statement — none
existed beyond the issue text.

**Addendum 2026-09-30 — user answers.** The user then answered the five open
questions. The answers confirm D8, D10 and D11 and settle the rollout in D9;
none reverses a decision, so they are recorded here rather than in a new
record. See *Resolved questions*.

## What prompted it

Issue #323: a `{type:'control', owner:'teleop'}` reply from the agent does not
prove exclusive per-user control, because every teleop socket joins the
refcounted `teleop` class. The issue asks for exactly one active command session
per `(tenantId, robotId)`, across replicas, tabs and transports, with fencing
generations, expiry, fail-closed behaviour, and E-stop independence.

## Facts established before any decision was taken

| Fact | Why it mattered |
| ---- | --------------- |
| Teleop sockets go **browser → agent directly** (`TeleopTab.tsx` `getWsBaseUrl` → agent URL); the server is not in the command path | D2: the agent must be the enforcement point |
| `/ws/keyboard-teleop` is **unauthenticated** and claims `teleop` **on connect** | D4, D7: the lease secret becomes the socket credential; claim moves to bind |
| Server→agent service auth exists (`AGENT_MEMORY_TOKEN`, `personalDataGate` refuses cross-origin browsers) | D3: installs ride an existing trusted channel; browsers cannot install |
| Prisma DB is mandatory and shared by all replicas; NATS KV is optional | D1 |
| The agent already persists boot lineage atomically (`incarnations.ts`, `atomic-file.ts`) | D5: a persisted generation high-water is cheap and has a pattern |
| Several frontend views (keyboard, VR, gamepad, simulated VR) legitimately stream to one robot for one operator — that is why the refcount exists | D6: joining must survive, but explicitly |
| Autonomous `agent`/`vla` are already refused by `ControlOwnerLock` while `teleop` holds | D8: only the window before bind needs a new guard |

## Decisions

### D1 — Authority store

**Chosen:** one `RobotControlLease` row per robot in the Prisma database,
mutated only by conditional `UPDATE`s (and a unique-key create).
**Rejected:** NATS KV compare-and-swap — correct primitive, but NATS is optional
in this platform and "fail closed" cannot depend on an optional service.
Also rejected: agent-only arbitration — it cannot see users or tenants.
**Owner:** agent (unattended).

### D2 — Where commands are admitted

**Chosen:** the robot agent enforces; the server grants. A lease is usable only
after the agent acked the install of its generation.
**Rejected:** proxying teleop through the server — adds latency to a 30–50 Hz
stream and a new failure point, and direct clients would still bypass it.
**Owner:** agent (unattended).

### D3 — Credential shape

**Chosen:** opaque 128-bit `leaseId` returned once to the client; server and
agent store only its SHA-256; the client presents it on the agent socket.
**Rejected:** a signed JWT lease verified by the agent — it would need a new
shared signing key and still needs server-pushed revocation, so it adds a secret
without removing a call.
**Owner:** agent (unattended).

### D4 — Clock

**Chosen:** server sends a relative `ttlMs`; the agent's deadline is on its own
monotonic clock. **Rejected:** absolute `expiresAt` on the agent — trusts
cross-host clock sync on a safety path. Browser clock is never used.
**Owner:** agent (unattended).

### D5 — Restart fencing

**Chosen:** agent persists a generation high-water mark; restart installs
nothing; installs at or below the mark are refused; an unreadable mark refuses
all installs. Server generation lives in the DB row, so server restarts cannot
reissue a generation. **Rejected:** keeping the installed lease across agent
restart — #323 requires restart to invalidate authority.
**Owner:** agent (unattended).

### D6 — Joining input views

**Chosen:** additional views join by binding with the same `leaseId` +
generation; holding the secret is the explicit join. **Rejected:** one socket
per lease — breaks the keyboard+VR+gamepad operator setup the refcount exists
for. Also rejected: user-level sharing — #323 says same-user tabs compete.
**Owner:** agent (unattended).

### D7 — Transport-bound renewal

**Chosen:** the agent answers renew with `bound`; the server refuses renewal
with no bound socket after the first TTL window. **Rejected:** server-only
renewal — the server cannot see the direct browser→agent socket, so a crashed
tab's other tab could keep a lease alive.
**Owner:** agent (unattended).

### D8 — Autonomy and preemption

**Chosen:** human teleop keeps preempting `agent`/`vla`, but at **bind**, with
the base stop awaited before the bind is acknowledged; while a lease is held,
REST motion starts are refused; with no lease held they stay admitted.
**Rejected:** requiring a lease for autonomous starts too — changes how
Agent Mode, patrols and VLA runs are started, which is a product decision
(question 5, now under *Resolved questions*).
**Owner:** agent (unattended); **confirmed by the user 2026-09-30**
(Resolved question 5).

### D9 — Rollout

**Chosen:** two flags: `CONTROL_LEASES_ENABLED` (server) and
`CONTROL_LEASE_REQUIRED` (agent). Off = today's behaviour byte for byte.
Staged rollout: both stay default off while TASK-315 … TASK-320 land; TASK-321
then flips `CONTROL_LEASES_ENABLED` to default **on**. `CONTROL_LEASE_REQUIRED`
stays default **off** — enforcement is opt-in per deployment. When an operator
turns `CONTROL_LEASE_REQUIRED` on, legacy clients that never bind a lease are
refused motion outright with an explicit error code (`lease_required` on
sockets, per TASK-315/316); there is no warn-only or grace mode.
**Rejected:** a single flag — server and agent deploy separately, and the agent
must be able to enforce before any client can acquire is advertised. Also
rejected: a warn/grace period for legacy clients under enforcement — a lease
that only warns proves nothing.
**Owner:** agent (unattended) for the two-flag shape; **user, 2026-09-30** for
the staged default-on and the outright refusal (Resolved question 4).

### D10 — Numbers and roles

**Chosen:** TTL 5 s, renew 1 s (from #323), client local deadline
`ttl − 2 × renew`; acquire `memberOrAbove`, observe `viewerOrAbove`.
**Rejected:** a longer TTL for flaky Wi-Fi — expiry is a final bound on
authority, not a stop deadline, but it should still be as short as the network
allows. **Owner:** agent (unattended); **numbers and roles confirmed by the
user 2026-09-30** — no narrower "operator" permission (Resolved questions 1, 2).

### D11 — Scope

**Chosen:** RMS backend, agent and RMS app only. vrhq integration stays in vrhq.
Administrative forced takeover is **not planned** (optional in #323).
**Owner:** agent (unattended); **confirmed by the user 2026-09-30** (Resolved
question 3).

## Resolved questions

Asked unattended as open questions; answered by the user on 2026-09-30.

1. **TTL / renew timing.** Confirmed: TTL 5 s, renew every 1 s. (2026-09-30)
2. **Who may acquire.** `member` is the floor (`memberOrAbove`); no separate
   "operator" permission. (2026-09-30)
3. **Administrative forced takeover.** Not wanted; stays out of scope.
   (2026-09-30)
4. **Rollout.** Both flags stay default off while TASK-315 … TASK-320 land;
   TASK-321 then flips `CONTROL_LEASES_ENABLED` (server) to default on.
   `CONTROL_LEASE_REQUIRED` (agent) stays default off, opt-in per deployment.
   When it is on, legacy clients without a bound lease are refused motion
   outright with an explicit error code — no warn/grace mode. (2026-09-30)
5. **Autonomous starts.** VLA, Agent Mode and patrol starts stay admitted
   while no lease is held and are refused while another user holds one; they
   do not need a lease of their own. (2026-09-30)

## Plan

TASK-314 agent registry → TASK-315 keyboard teleop binding, TASK-316 other
ingress, TASK-317 server authority → TASK-318 renewal/expiry/events → TASK-319
teleop console + VR → TASK-320 data-collection inputs → TASK-321
`CONTROL_LEASES_ENABLED` on by default.
