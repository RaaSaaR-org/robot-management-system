---
id: TASK-199
aliases:
- TASK-199
title: Heartbeat — the robot notices things while nobody is talking to it
slug: heartbeat-the-robot-notices-things-while-nobody-is-talking-to-it
status: todo
priority: 3
owner: ''
projects: []
customers: []
tags:
- core
- g1
- agentmode
- safety
sprint: ''
depends_on:
- '[[TASK-196]]'
- '[[TASK-197]]'
due_date: ''
created: 2026-08-02
updated: 2026-08-02
---


# Heartbeat — the robot notices things while nobody is talking to it

## Description

Make the robot **proactive without making it dangerous or annoying**. It notices that the battery
is low and it is three aisles from the charger; that it has been damped for ten minutes after an
E-Stop nobody reset; that its place estimate went stale; that a standing intent's trigger fired —
and it says so.

**It does not wander.** No self-initiated locomotion in v1. This is the pillar with the highest
blast radius, so it is scheduled last and its safety properties are structural, not prompted.

## Details

### Hard prerequisites

- **TASK-196** — a restarted robot currently comes back un-latched and un-damped. A heartbeat
  after a crash is the single most dangerous moment in the whole system. **This task must not
  ship before durable safety state.**
- **TASK-197** — trust tiering. *Mind Your HEARTBEAT!* (arXiv:2603.23064) found that unattended
  cycles are precisely where poisoned content enters persistent memory, and the attack is silent
  by construction: no error surfaces, outputs merely drift. Trust tiers are a prerequisite, not a
  follow-up.

### Design decisions (settled — do not re-litigate during implementation)

| Topic | Decision |
|---|---|
| Clock | **Ride the existing one.** Extend `agent-mode/idle-watcher.ts` into a pulse with pluggable checks. Do **not** add a timer — `index.ts:~326-351` shutdown depends on nothing holding the loop open, and IdleWatcher already has `unref()`, a re-entrancy guard, a 60 s log throttle and a public `tick()` for deterministic tests. |
| Two tiers | Tier 0 = pure predicates over cached state, every 3 s tick, **zero model calls**. Tier 1 = a bounded plan, only on a fired predicate. This is Hermes's `{"wakeAgent": false}` pre-run script and it is the reason a 24/7 robot does not need an expensive tick. |
| Allowed actions | `HEARTBEAT_ALLOWED_KINDS = ['look', 'speak', 'wait', 'remember']`, **filtered over the plan before execution**. A heartbeat cannot emit `walk`/`turn`/`goto`/`posture`/`wave` in v1. A filter, not a prompt rule — the exec-allowlist literature is explicit that lexical gating is defeatable. |
| Fail closed | Any error, any ambiguity ⇒ **the tick ends and the robot holds.** Hermes's goals loop fails *open* (judge error ⇒ continue); invert it. An embodied agent that continues on uncertainty is the failure mode. |
| No noise | A tier-1 tick that finds nothing worth saying writes `HEARTBEAT_OK` to the journal and **speaks nothing**. |
| No recursion | A heartbeat-initiated plan may not schedule further heartbeats or standing intents. One line, free, and it is the anti-runaway guard. |
| Default | `AGENT_HEARTBEAT_ENABLED=false`. Opt in per deployment. |
| Route | Every proactive plan goes through the **same** path as `onPersonAppeared`: `isIdleWatchEligible()` → `lock.claim('agent')` → `runPlan(plan, skipPlanning=true)`, plus `mayInitiate()` from TASK-196. No second execution path. |

### The two contradictions to resolve while implementing

**1. Fail-closed vs. a null-by-default input.** `hardware/HardwareClient.ts:~958 getLocoOdometry()`
has a 2 s timeout and returns `null` on any hiccup — a routine event. "Fail closed on unknown pose"
is right for the *heartbeat*, but if the same rule drives a geofence protective stop, the robot
protective-stops every time the sidecar drops a poll. The rule must be split:

> **Self-initiated action fails closed on unknown pose. A protective stop requires a *known* pose
> inside a keepout.**

**2. Tier 0 must actually be free.** "Place stale or unknown" is listed as a tier-0 predicate, but
place needs a pose and pose is an HTTP call. Read the **cached** pose from the existing 2 s
`HardwareClient` poll (TASK-195 already caches it) — never issue a request from a tier-0 tick.

### Robot Agent

**1. `src/agent-mode/idle-watcher.ts` — generalise to `checks[]`**

Keep `unref()`, the `ticking` guard, the 60 s log throttle and the held-forward absence clock
exactly as they are. They are correct; do not rewrite them.

**2. `src/agent-mode/heartbeat.ts` (NEW)**

Predicate registry + tier-1 plan builder + rate limiter.

Tier-0 predicates, all pure over cached state:

| Predicate | Fires when |
|---|---|
| `battery_low` | `batteryPct < AGENT_HEARTBEAT_BATTERY_PCT` |
| `damped_unattended` | `damped && !estopActive` for > 5 min |
| `place_lost` | place `null` or `stale` for > N min |
| `plan_failed_idle` | last plan failed and nothing has happened since |
| `crash_unacknowledged` | TASK-196 crash flag, no operator turn yet — **suppresses all other proactivity** |
| `intent_matched` | a standing intent's trigger matched |
| `workspace_write_failed` | TASK-197 write error |

Tier 1: at most one per `AGENT_HEARTBEAT_MIN_INTERVAL_MS` (default 300000), suppressed entirely
outside `AGENT_HEARTBEAT_ACTIVE_HOURS`.

**3. Standing intents — `src/agent-mode/intents.ts` (NEW)**

Prospective memory, and the right way to do "remind me". `workspace/intents.jsonl`:

```jsonc
{"id":"…","trigger":{"place":"AISLE-3"},"action":"speak",
 "text":"check whether the pallet still blocks the turn",
 "scope":"place","createdAt":"…","expiresAt":"…",
 "cooldownMs":86400000,"firesLeft":3,"state":"armed"}
```

Matching is **deterministic keyword/place comparison with cooldown and a fire budget — zero model
calls in the matching path**. So *"when you're next in the workshop, tell me if the ladder is still
blocking the door"* costs nothing per tick and cannot fire 400 times. Defaults: 24 h cooldown,
3 fires, 30-day expiry.

**4. Voice — do not talk over the operator**

The voice pipeline is **half-duplex** with a speaking-span refcount that mutes the mic
(see `voice-narrator.ts` and the `neodem/voice` contract). An unsolicited heartbeat utterance can
mute the microphone mid-operator-turn — in a system where **"stopp" is the stop word**.

A heartbeat may not speak while a voice turn is in flight, and must yield to one. Reuse
`narratePlanOutcome`'s subscribe-and-outlive-the-request pattern rather than inventing a path.

**5. Escalation channel.** Default to **journal-only**, and speak only when `personVisible`.
Speaking into an empty aisle is noise; a `ServerMirror` notification is what an absent operator
actually needs.

**6. Config — `src/config/config.ts:~241-280`**

`AGENT_HEARTBEAT_ENABLED` (default **false**), `_MIN_INTERVAL_MS`, `_ACTIVE_HOURS`,
`_BATTERY_PCT`, `_MOTION` (default **false**, reserved for v2).

### Key files

| File | Change |
|---|---|
| `robot-agent/src/agent-mode/idle-watcher.ts` | Generalise to `checks[]`, keep all existing guards |
| `robot-agent/src/agent-mode/heartbeat.ts` | NEW — predicates, tier-1 builder, rate limiter |
| `robot-agent/src/agent-mode/intents.ts` | NEW — deterministic matcher |
| `robot-agent/src/agent-mode/agent-mode-controller.ts` | `onPersonAppeared` (~`:937`) is the template; `isIdleWatchEligible` (~`:920`) is the gate, reused verbatim |
| `robot-agent/src/agent-mode/initiative.ts` | TASK-196's `mayInitiate()` — this is its first caller |
| `robot-agent/src/agent-mode/voice-narrator.ts` | Unsolicited-report path that yields to a live voice turn |
| `robot-agent/src/config/config.ts` | Five env vars |

## Test Strategy

**Unit (vitest) — `IdleWatcher.tick()` is already public, so every case is deterministic.**

- Each tier-0 predicate fires on its condition and **only** on its condition.
- A tier-0 tick with nothing firing performs **zero** model calls and **zero** HTTP calls.
- The allowed-kinds filter drops a `walk` block from a heartbeat plan — assert on the plan that
  reaches the executor, not on the prompt.
- Rate limiter: two firing predicates within the interval produce **one** tier-1 run.
- `ACTIVE_HOURS` suppresses entirely.
- Fail-closed: a null pose ⇒ tick ends, robot holds, reason logged.
- `crash_unacknowledged` suppresses all other proactivity until an operator turn.
- A heartbeat plan cannot create an intent or another heartbeat.
- A heartbeat-ingested VLM observation is journalled `untrusted` and **cannot** reach `MEMORY.md`.
- Intents: cooldown honoured, fire budget decrements, expiry disarms, matching issues no model call.
- A heartbeat does not speak while a voice turn is in flight.

**Integration (sim, no robot) — the demo.**

1. Drain the sim battery below the threshold. Wait.
2. The robot says **once** — not every 3 s — *"battery at 18% and I am in aisle 3, two aisles from
   the charger."*
3. Verify the TTS counter incremented exactly once (the technique from the voice work:
   `(Invoke-RestMethod http://localhost:8768/status).metrics.stages.tts.count`).
4. Arm an intent for `AISLE-1`, walk there by operator command, confirm it fires once and then
   respects its cooldown.
5. `kill -9` the agent, restart → it comes back latched (TASK-196) and **stays silent** until an
   operator turn.

## Out of scope — v2, explicitly gated

Self-initiated **motion** (`goto` a known place), behind `AGENT_HEARTBEAT_MOTION=true` **plus** an
operator-set allowance, gated on: battery, place known **and** fresh, geofence clear, and a spoken
announcement first. **Not before `zone_violation` (TASK-200) exists** — until there is an enforced
boundary, "the agent decided to walk somewhere" is a prompt-level hope.

Also out of scope: consolidation on the charging window. It is not free compute — on this box the
GPU serves the planner, the vision model and the voice stack, and a robot on the dock is precisely
where someone walks up and talks to it.
