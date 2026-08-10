---
id: TASK-201
aliases:
- TASK-201
title: Say when the geofence is not enforcing — a stale pose silently disarms the keepout fence
slug: say-when-the-geofence-is-not-enforcing
status: todo
priority: 1
owner: ''
projects: []
customers: []
tags:
- core
- safety
- g1
- agentmode
sprint: ''
depends_on:
- "[[TASK-200]]"
- "[[TASK-205]]"
due_date: ''
created: 2026-08-02
updated: 2026-08-09
---


# Say when the geofence is not enforcing — a stale pose silently disarms the keepout fence

## Description

Once the pose belief degrades to `stale`, the keepout geofence stops enforcing and **nothing says
so**. The robot will walk through a keepout place with `estop=armed` and `systemHealthy=true`.
Every module involved behaves exactly as its own doc-comment says; what is missing is that the
lapse is invisible to the operator, and that the budget is spent by less than one traverse of a
20 m hall.

This is not a request to weaken the fence. A pose that may be tens of metres wrong really is not
evidence that the robot is inside a rack — that reasoning is correct and should stay. The defect is
silence.

## Details

### What was observed (dz-226, 2026-08-02, warehouse scene)

Driving Agent Mode through `g1_warehouse_scene.xml` with the surveyed graph
`places.warehouse.json` loaded, the robot was commanded `walk forward 2 metres` from
(3.31, −1.99) facing +x, straight at keepout `RACK-A` (x ∈ [4.0, 5.0]).

It walked **through** the rack and out the far side to (5.01, −1.99). No stop, no warning:

```
GET /api/v1/robots/sim-robot-g1-edu/safety
  estop=armed  systemHealthy=True  warnings=[]
```

The cause is drift, and this is the proof — the utterance below moves the robot **zero
centimetres**, it only resets the drift budget:

```
POST .../agent-mode/command  {"text":"you are in Aisle 2"}
  -> "Understood — I am in Aisle 2. I have reset how far I think I have drifted."

GET .../safety   (5 s later, robot stationary)
  estop=triggered  systemHealthy=False
  warnings=[Protective stop: Keepout violated: Rack A (RACK-A)
            — 0.49 m past the safety margin at (5.01, -1.99)]
```

Below the budget the fence is exact: an earlier approach was stopped at x=3.52, **0.48 m clear of
the rack face**, with `PROTECTIVE STOP: Keepout violated: Rack A (RACK-A) — 0.02 m past the safety
margin at (3.52, -2.50)`.

### The chain, in code

1. `robot-agent/src/agent-mode/place-resolver.ts` (~line 607) —
   `confidence: this.driftSinceAnchorM > this.driftBudgetM ? 'stale' : 'confident'`.
2. `robot-agent/src/robot/state.ts` — `evaluateGeofenceForPose()` derives `poseTrusted` from that
   confidence and passes it into the evaluator.
3. `robot-agent/src/agent-mode/geofence.ts` — `evaluateGeofence()` returns
   `{ kind: 'unknown', reason: 'the pose has drifted past its budget' }`.
4. `SafetyMonitor` treats `unknown` as **change nothing** — correct in isolation, and the point at
   which the fence stops being a fence with nobody told.

`PLACE_DRIFT_BUDGET_M` defaults to 15 (`robot-agent/src/config/config.ts`). The warehouse hall is
20 m long: one errand across it and back spends the budget.

### What to build

**Robot Agent.** The belief already carries `insideKeepout: null` for the undecided case
(`robot/state.ts`, `PlaceBelief`) — that null is the signal and it currently goes nowhere. Surface
an explicit enforcement state on `AgentModeState` (e.g. `geofence: 'enforcing' | 'not-enforcing' |
'no-map'`, with the reason string the evaluator already produces) so the console can render it,
and log the transition once when it flips — the same way `Place: A → B` is logged today rather
than every sample.

**Frontend.** The rail already renders staleness (`Aisle 1 · stale`, `app/src/features/agentmode/`),
so the place chip is the right place for it — but "stale place" and "keepout fence not enforcing"
are different claims and an operator should not have to infer the second from the first. Whatever
it looks like, it must be visible without opening the details drawer, because it is a safety state.

### Decisions taken (2026-08-09) — both were open, neither was picked silently

**D1 — the drift budget stays a single global `PLACE_DRIFT_BUDGET_M = 15`.** The observed failure is
not that 15 m is the wrong number for that hall; it is that 15 m is ~0.75 traverses and the *only*
reset is an operator utterance. A per-site budget would let the warehouse set 40 and thereby hide the
same bug behind a bigger number — the one change that makes the lapse rarer without making it honest.
It is also a schema change on the surveyed graph files (`PlaceGraph` carries no budget field today),
out of proportion to a visibility fix.

Two things this task **does** owe D1: do not retune the budget, and pin the two independent `15`s so
they cannot drift apart unnoticed — `config.ts:398` and `place-resolver.ts:319` are separate constants
and only the second is currently pinned by a test (`place-resolver.test.ts:247`). Per-site budgets are
a legitimate follow-up, sequenced *after* collapsing those two defaults.

**D2 — no auto re-anchor on deep entry into a small mapped place.** It would fake a re-localisation the
system does not have: it zeroes a *scalar* (`driftSinceAnchorM` accumulates `|Δ|` frame-independently
at `place-resolver.ts:481` and `:518`) without correcting x/y. Worse, it is self-referential — the
place is derived from the drifted pose, so a drifted robot that believes it is deep inside AISLE-2
would re-confidence itself on the strength of the very pose that drifted. `state.ts:650-657` already
states this hazard, TASK-200 put pose correction explicitly out of scope, and
`guardReanchorRelease` (`state.ts:715-728`) exists precisely so a release is taken by someone who can
see the robot is nowhere near the boundary — auto re-anchor substitutes a machine for that someone.

If 15 m proves too tight in practice the honest fixes are, in order: (i) make the not-enforcing state
loud enough that an operator re-anchors deliberately — which is what this task builds; (ii) a per-site
budget; (iii) real re-localisation (LiDAR / fiducial), a separate capability. Record D2 as a
doc-comment beside `place-resolver.ts:442` so it is not re-litigated silently.

### Related, found in the same session — now [[TASK-205]]

A protective stop latched on the SafetyMonitor is invisible in the Agent Mode rail; the operator
discovers it only when the next command is refused, with an API call quoted at them. **Split out as
TASK-205 and sequenced BEFORE this task** — it is a different defect (state that exists and is not
published, vs state that exists nowhere), it is ~4 touches, and it lands on the same three frontend
files this task touches, so `CONDITION_ORDER` and `AgentModeState` get edited once instead of twice.

### Implementation notes (code mapped 2026-08-09)

**Not every `unknown` is a lapse.** Five distinct `unknown` verdicts reach `SafetyMonitor.updateGeofence`,
and only some of them mean the fence stopped being a fence. Mapping all of them to `not-enforcing`
would alarm on correct behaviour and turn the new signal into wallpaper:

| verdict / site | label |
|---|---|
| `clear` (`geofence.ts:118`, `:147`), `violating` (`:143`) | `enforcing` |
| `unknown` `'no place graph'` (`state.ts:677`) | `no-map` |
| `unknown` unregistered frame (`state.ts:683`) | `no-map` — its own doc calls it a map problem |
| `unknown` `'no pose sample'` (`geofence.ts:106`) | `not-enforcing` |
| `unknown` `'the pose has drifted past its budget'` (`geofence.ts:109`) | **`not-enforcing` — the bug** |
| `unknown` `'inside the keepout release margin'` (`geofence.ts:147`, ternary) | `enforcing` — pose is trusted, hysteresis band only, a `violating` verdict still fires |
| `unknown` re-anchor hold (`state.ts:721-726`) | `enforcing` — a withheld *release*, not a withheld *stop* |

Derive the label from a typed `cause` on the `unknown` variant (`safety/types.ts:67-70`), never by
string-matching the reason prose downstream. Widening that union makes `tsc` find all six
construction sites.

**Where the information is lost today.** `SafetyMonitor.ts:838-839` is an early `return` on
`kind === 'unknown'` — no field, no warning, no event. Upstream, `state.ts:586` holds the verdict in a
local that dies at `:619`, compressed into the tri-state `insideKeepout` at `:596` with the reason
string dropped. **Do not weaken either:** the early return stays, `guardReanchorRelease` stays. This
task adds a record, not a behaviour change.

**The trap that will silently break the fix:** `state.ts:607` is a bare `return` — an early exit for
the whole function when the place id has not changed. The observed scenario is *exactly* a constant
place id while drift trips, so a transition log added after `:607` never fires. Capture the previous
enforcement label next to `previousPlaceId` (`:580`), and gate `setAgentSafetyState` on `placeChanged`
while calling `notifyListeners()` when *either* changed. Log once on transition (the `Place: A → B`
style at `:611-616`), not the one-shot latch at `:534-538` — the state flips back and forth, and a
latch would report the first lapse then stay silent for every later one.

**Three strings the advisory must not contain**, or existing matchers will eat it: `'Protective stop'`
/ `'Emergency stop'` (`SafetyMonitor.ts:1077`, `:1123-1125`) and `'Keepout violated'`
(`ZONE_VIOLATION_REASON_PREFIX`, matched at `:879`, `:895-897`). It must also not go through
`applyStopToState()` (`:1190-1208`), which writes a different, persisted array. Model it on
`tiltWarning` (`:765`, `:770-772`, `:1318`) — a warn-only channel that never touches `estopState`, so
`systemHealthy` (`:1307`) cannot flip.

**Wire compatibility.** `AgentModeState` is hand-mirrored in three places (`robot-agent/src/agent-mode/types.ts`,
`server/src/types/agent-mode.types.ts`, `app/src/features/agentmode/types/agentmode.types.ts`). Add
the field **optional** in all three: required would make `isValidAgentModeSnapshot`
(`AgentModeService.ts:43-53`) reject an older agent and break six typed literals in tests and mocks.
`emptyState()` (`AgentModeService.ts:283-292`) must not fabricate `'enforcing'`; absent renders as
nothing, never as enforcing.

**Frontend.** Add `'geofence'` as a `ConditionKey` (`conditions.ts:32-39`, `:76`) rather than a
free-floating chip — `conditions.ts:27-31` states nothing outside that list may put amber or red on the
page. Amber (level 2), not red: level 3 is documented as "a stop the hardware did NOT confirm" and
fires an assertive screen-reader interrupt, and `'no-pose'` is transient (`SafetyMonitor.ts:830-837`:
the sidecar drops a poll), so red would flicker per dropped poll. The chip must be **separate from**
the `· stale` marker inside `PlaceChip.tsx:132-142` — the two claims can be true independently — and
must say it in words, not colour alone (`PlaceChip.tsx:133-139`, pinned by `PlaceChip.test.tsx:124`).

**Unverified — establish before relying on it:** whether `RobotStateManager.notifyListeners()` reaches
`AgentModeController` as an `agent:state:changed`. If it does not, a geofence flip with no place change
surfaces only on the 15 s liveness re-push (`agent-mode-controller.ts:195`). [[TASK-205]] needs the same
hook and should settle it first.

### Key files

- `robot-agent/src/agent-mode/geofence.ts`
- `robot-agent/src/agent-mode/place-resolver.ts`
- `robot-agent/src/robot/state.ts` (`evaluateGeofenceForPose`, `PlaceBelief`, `onPoseSample`)
- `robot-agent/src/safety/SafetyMonitor.ts`
- `robot-agent/src/types/` (AgentModeState shape) and `server/src/types/agent-mode.types.ts`
- `app/src/features/agentmode/` (status rail)

## Test Strategy

Unit: an `unknown` geofence verdict must produce the not-enforcing state, and a `clear` verdict
must not — the two are different answers and the whole bug is that they render the same.

Integration, and this is the one that would have caught it: drive more than `PLACE_DRIFT_BUDGET_M`
metres without a re-anchor, then walk at a keepout place, and assert that **either** a stop fires
**or** the state says enforcement is off. Asserting only "a stop fires" is what let this through.

Live re-check on dz-226 (the reproduction above is a runbook): load the warehouse scene, drive
> 15 m, approach RACK-A, confirm the console says the fence is not enforcing, then re-anchor with
`"you are in Aisle 1"` and confirm the stop fires with the robot stationary.
