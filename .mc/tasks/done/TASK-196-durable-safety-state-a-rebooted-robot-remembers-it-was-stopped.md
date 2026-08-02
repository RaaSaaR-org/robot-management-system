---
id: TASK-196
aliases:
- TASK-196
title: Durable safety state — a rebooted robot remembers it was stopped
slug: durable-safety-state-a-rebooted-robot-remembers-it-was-stopped
status: done
priority: 1
owner: ''
projects: []
customers: []
tags:
- core
- g1
- safety
- agentmode
sprint: ''
depends_on: []
due_date: ''
created: 2026-08-02
updated: 2026-08-02
status_note: 'CLOSED 2026-08-02 — merged as part of PR #216 (squashed to 4a9a7f2).
Exercised for real by an unclean restart during the 2026-08-02 warehouse
session rather than only by tests: the boot logged
"[Incarnations] Previous incarnation b-23760b0286f1 never shut down cleanly
(started 2026-08-02T12:35:35.938Z) — treating this boot as crash recovery" and
"[AgentMode] the base was damped when this robot last shut down (FSM 1) — send
`posture stand` before any locomotion", and the console rendered "Recovered
from an unclean shutdown" behind its acknowledge gate. The restored snapshot
correctly dropped pose, place and held object as too old rather than carrying
them forward.'
---


# Durable safety state — a rebooted robot remembers it was stopped

## Description

After a crash or a restart, the robot must come back **knowing it was E-Stopped, knowing it was
damped, and knowing it did not shut down cleanly** — and refuse self-initiated motion until a
human clears it.

Today it does the opposite, and the current behaviour is worse than simple amnesia:

- `SafetyMonitor.executeStop()` (~`:897-917`) sets `s.status = 'online'` and pushes the string
  `Emergency stop activated: <reason>` into `s.warnings`.
- `warnings` **is** part of `PersistedState` and **is** restored verbatim (`robot/state.ts:346-347`).
- `latchedByEmergencyStop` (`SafetyMonitor.ts:241`) is **not** persisted.
- The only path that clears the warning, `clearCommunicationLossStop` (~`:420-450`),
  string-matches the *comms-loss* warning only.

So a rebooted robot displays an E-Stop warning **it can never clear**, while the latch that would
refuse motion is gone. It is a lying state, not an amnesiac one — and a rebooted G1 is currently
**more willing to move** than one that has been running.

This is the prerequisite for TASK-199 (heartbeat). A timer that wakes a robot whose E-Stop latch
silently vanished on reboot is the failure mode that ends with a G1 walking away after a crash.

Priority 1: this is a live safety defect in code that is already deployed, independent of the
persistent-agent work it unblocks.

## Details

### Design decisions (settled — do not re-litigate during implementation)

| Topic | Decision |
|---|---|
| Restore semantics | A latched E-Stop comes back **latched** and requires the existing explicit `resetEstop()` (which already refuses if `SafetyMonitor` refuses). `damped` comes back damped. |
| The zombie warning | Restoring the warning **without** the latch is the bug. Restore **both** — never the warning alone. |
| Pose staleness | If `savedAt` is older than `PLACE_STALE_MS`, restore pose/place as `null`, not as truth. A robot that was carried while powered off must not report its old pose. Same bug class as a resurrected `heldObject`. |
| Crash detection | `incarnations.jsonl` — one line per boot, `endedAt` written on clean shutdown. A missing `endedAt` on load **means crash**. |
| Scope of the refusal | A crash-recovered robot refuses **self-initiated** motion only. An operator standing there giving a command *is* the acknowledgement. |
| Migration | A real `migrate()`, not a version bump. See the footgun below — getting this wrong wipes every robot's persisted battery/location/task queue on upgrade. |

### The migration footgun (read before touching `StatePersistence`)

Three things have to change together or the build silently destroys state on every boot:

1. `StatePersistence.ts:18` — `CURRENT_VERSION = 1` → `2`.
2. `StatePersistence.ts:173` — `isValidPersistedState` currently **hard-rejects any
   `version !== 1`** and there is no migration path. It must become `version <= CURRENT_VERSION`
   plus a `migrate()` that defaults the new fields.
3. **`robot/state.ts:317` — `buildPersistedState()` hardcodes the literal `version: 1`**, not the
   constant. Bump only the constant and you get a build that *writes* v1 and *rejects* it on the
   next load: silent, total state loss, on every single boot.

`robot/state.ts:338-359` also trusts the restored blob unconditionally, with no staleness check on
`savedAt`. Add one.

**Write the v1→v2 migration test first.** It is the cheapest possible insurance here.

### Robot Agent

**1. Extend `PersistedState` — `src/robot/StatePersistence.ts`**

```ts
agentState: {
  estopLatched: boolean;
  estopReason: string | null;
  estopAt: string | null;      // ISO
  damped: boolean;
  lastFsmId: number | null;
  place: string | null;        // TASK-195; null if savedAt is stale
  bootId: string;
}
```

`migrate(v1) → v2` defaults all of it to the safe values (`estopLatched: false`, `damped: false`,
`place: null`) — a robot upgrading from v1 has no record either way, and "not latched" is the
honest answer, not a guess.

**2. Persist on transition — `src/agent-mode/agent-mode-controller.ts`**

`estop` (~`:509`), `resetEstop` (~`:587`) and `isDamped()` are the transitions. Write through on
each; the existing 500 ms debounce in `StatePersistence` covers the write rate. Note the damped
flag is already deliberately **not** cleared by a reset — preserve that.

**3. Restore — `src/robot/state.ts:290-373 restorePersistedState`**

- Restore `estopLatched` **and** its warning together, or neither.
- Re-latch `SafetyMonitor` so the refusal is real, not cosmetic.
- Apply the `savedAt` staleness check before restoring pose/place.
- Log a boot banner that says plainly what was restored.

**4. Incarnation lineage — `src/agent-mode/incarnations.ts` (NEW)**

`workspace-<robotId>/incarnations.jsonl` (or `data/` until TASK-197 creates the workspace):

```jsonc
{"bootId":"b-7f3a","startedAt":"…","endedAt":null,"exit":null,
 "lastPlace":"AISLE-3","estopLatched":false,"damped":false}
```

- **Open** it in the boot sequence (`src/index.ts:44-145`), after `SecureBootVerifier` — which
  already captures `bootTime` and an integrity hash, so reuse them.
- **Close** it in `shutdown()` (`src/index.ts:~321-361`) **before the network phase**, next to
  `saveStateSync()`. `server.close()` can hang forever on an open WebSocket; the existing ordering
  already accounts for this — follow it.
- **Rotate.** `npm run dev` is `tsx watch`, so every file save is a new incarnation. Cap the file
  (keep the last 200 lines) or a dev box accumulates thousands within a week — and the sensorium
  reads this file at boot.

**5. The initiative gate — `src/agent-mode/initiative.ts` (NEW, ~80 lines, pure)**

```ts
mayInitiate(action: AgentBlockKind, origin: 'self' | 'operator'): { ok: boolean; reason: string }
```

This is **not** `SafetyMonitor`. SafetyMonitor constrains *physics*; this constrains *intent*.
It checks: origin is `self`; the allowed-kinds filter; battery; place known and fresh (TASK-195);
crash-unacknowledged. It returns a reason string that is logged and **speakable** —
*"I did not go and look because I do not know where I am."*

Ship it in this task even though nothing calls it yet with `origin: 'self'`. TASK-199 wires it up;
having it land here, tested and pure, keeps that task from growing a safety surface.

### Frontend

`AgentModeState` gains `recovered: { fromCrash: boolean; estopLatched: boolean; at: string } | null`
(three-file wire change: robot-agent → server → app types).

The Agent Mode panel must show a **latched-after-restart badge with a one-click reset**. Without
it, the first operator who meets a robot that came back latched will delete the state file to
"fix" it — and that is a worse outcome than the bug.

### Server

None. `PersistedState` is robot-local; the wire change rides the existing Agent Mode state event.

### Key files

| File | Change |
|---|---|
| `robot-agent/src/robot/StatePersistence.ts` | `CURRENT_VERSION` → 2, `agentState`, `migrate()`, relax `isValidPersistedState` |
| `robot-agent/src/robot/state.ts` | **`:317` hardcoded `version: 1`**; restore latches at `:290-373`; `savedAt` staleness check |
| `robot-agent/src/safety/SafetyMonitor.ts` | Re-latch on restore; resolve the unclearable-warning path |
| `robot-agent/src/agent-mode/agent-mode-controller.ts` | Persist on estop / resetEstop / damped transitions |
| `robot-agent/src/agent-mode/incarnations.ts` | NEW — append/close/rotate, crash detection |
| `robot-agent/src/agent-mode/initiative.ts` | NEW — `mayInitiate()`, pure |
| `robot-agent/src/index.ts` | Open incarnation after SecureBootVerifier; close before the network phase |
| type files ×3 + `app/src/features/agentmode/` | `recovered` badge + one-click reset |

## Test Strategy

**Unit (vitest) — the migration test comes first.**

- v1 state file → `migrate()` → v2 with safe defaults, **no field lost**. Assert battery,
  location and the task queue all survive.
- A v2 file written by `buildPersistedState()` passes `isValidPersistedState` (this is the
  regression test for the hardcoded-version footgun).
- A future version (v3) is rejected, not silently accepted.
- Latched E-Stop round-trips: latch → persist → restore → `SafetyMonitor` refuses motion.
- Warning and latch are restored together; assert you can never get one without the other.
- `savedAt` older than `PLACE_STALE_MS` ⇒ pose and place restore as `null`.
- `incarnations.jsonl`: missing `endedAt` ⇒ `fromCrash: true`; clean SIGTERM ⇒ `false`; rotation
  caps the file.
- `initiative.ts`: `origin: 'operator'` is never blocked by crash-unacknowledged;
  `origin: 'self'` is.

**Integration (sim, no robot) — this is the demo.**

1. Boot the MuJoCo stack, E-Stop the robot from the Agent Mode UI.
2. `Ctrl-C` the robot-agent.
3. Restart. It comes back **latched**, the badge says so, and a walk command is refused.
4. Click reset → the robot walks.
5. Repeat with `kill -9` instead of `Ctrl-C` → additionally reports "recovered from crash".

## Out of scope

- `zone_violation` (`safety/types.ts:29` declares it, nothing implements it) — needs place
  keepouts, TASK-200.
- Anything that *uses* `mayInitiate()` with `origin: 'self'` — TASK-199.
- Server-side mirroring of safety history.
