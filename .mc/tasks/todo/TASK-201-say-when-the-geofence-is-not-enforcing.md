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
due_date: ''
created: 2026-08-02
updated: 2026-08-02
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

**Also worth deciding in this task** (do not silently pick one):
- whether the drift budget should be per-site rather than a single global default, since it is
  really "how far this robot's odometry can be trusted here";
- whether entering a small mapped place deeply should re-anchor automatically, or whether that
  would fake a re-localisation the system does not have.

### Related, found in the same session

A protective stop latched on the SafetyMonitor is invisible in the Agent Mode rail. The operator
discovers it only when the next command is refused, and the refusal reads
*"E-Stop is latched on the safety monitor, not by Agent Mode — clear it there
(POST /robots/:id/safety/estop/reset) before sending a new command."* — an API call, with no
button in the console. Fold in here or split, but do not lose it.

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
