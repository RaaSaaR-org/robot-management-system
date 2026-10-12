---
id: "TASK-382"
aliases: []
title: "A latched E-stop refuses moves and a returning robot can be stopped at once"
slug: "a-latched-e-stop-refuses-moves-and-a-returning-robot-can-be-stopped-at-once"
status: "done"
priority: 1
owner: "huhn511"
projects: []
customers: []
tags: ["core"]
sprint: ""
parent: ""
depends_on: []
spe: 5
effort: "medium"
due_date: ""
created: "2026-10-13"
updated: "2026-10-13"
---

# A latched E-stop refuses moves and a returning robot can be stopped at once

## Description

Two safety bugs. (1) The robot agent executes motion commands while its E-stop is
latched: a sim robot walks away from a triggered E-stop and its status flips from
`protective_stop` back to `online`, also after a restart that restored the latch.
(2) The server refuses an E-stop with 503 "not connected" for up to 30 s after an
agent comes back, because it trusts the cached `isConnected` flag that only the 30 s
health check flips; the fleet status also lags an E-stop or reset by up to 30 s.

## Details

### Robot Agent

**Current state:** `robot-agent/src/robot/CommandExecutor.ts` — `execute()` and
`beginMove()` check charging, error and battery but never the SafetyMonitor latch.
Every entry point (REST `POST /robots/:id/command`, A2A/Genkit tools, the task queue,
`RobotStateManager.moveTo/goToCharge/returnHome/pickup/drop`) goes through this
executor. The latch itself is restored from the state file in the
`RobotStateManager` constructor (`robot-agent/src/robot/state.ts`), so gating on
`safetyMonitor.isEStopTriggered()` covers the restart case.

**Change:** inject an `isEStopTriggered` hook into `CommandExecutorConfig`
(wired in `state.ts` to the SafetyMonitor). `execute()` refuses every type except
`stop` and `emergency_stop` as `failed` with an "E-stop latched — reset required"
message, without touching state. `beginMove` (so `moveTo`, `goToCharge`,
`returnHome`, and real walks), `pickup`, `drop` and `executeVLAAction` refuse too.
Stopping is never gated. The E-stop and reset REST responses also carry the
robot's resulting `robotStatus` so the server can mirror it.

### Server

**Current state:** `server/src/services/SafetyService.ts` `applyRobotEStop` /
`applyRobotReset` throw "not connected" before any HTTP attempt when
`registered.isConnected` is false, and never update the cached robot status.
`RobotManager.sendCommand` does the same for `emergency_stop`.

**Change:** always attempt the E-stop and reset HTTP calls against the robot's
`baseUrl`; only a failed request reports the robot unreachable. On success,
`RobotManager` marks the robot connected, sets its status from the response
(`robotStatus`, else `protective_stop` when triggered), persists it and emits
`robot_status_changed`. `sendCommand` attempts `stop` / `emergency_stop` whatever
`isConnected` says.

**Key files:**
- `robot-agent/src/robot/CommandExecutor.ts`
- `robot-agent/src/robot/state.ts`
- `robot-agent/src/api/rest-routes.ts`
- `server/src/services/SafetyService.ts`
- `server/src/services/RobotManager.ts`

## Acceptance Criteria
- [x] With the E-stop latched, `execute()` of `move`, `charge`, `return_home`, `pickup`, `drop` returns `failed` with an E-stop message; location, target and status are unchanged.
- [x] `moveTo`, `goToCharge`, `returnHome`, `pickup`, `drop` and `executeVLAAction` refuse while latched (tools, A2A, task queue), and no walk is started on real locomotion.
- [x] `stop` and `emergency_stop` still run while latched, and leave the status `protective_stop` (never `online`).
- [x] The simulation's own battery drives to the charger (low and critical) do not start while latched.
- [x] A `RobotStateManager` whose persisted latch was restored on construction refuses a move.
- [x] The server's robot E-stop and reset are attempted even when the cached `isConnected` is false; a successful answer marks the robot connected and updates its status and emits `robot_status_changed` at once.
- [x] `sendCommand` attempts `stop`/`emergency_stop` regardless of `isConnected`; other commands keep the precondition.
- [x] An unreachable robot still fails the E-stop with an error (never reported as stopped).

## Test Strategy

Vitest: a CommandExecutor E-stop gating test (robot-agent), a RobotStateManager
restored-latch test, and SafetyService/RobotManager tests with a stale
`isConnected` and a mocked HTTP client (server). Typecheck + full vitest in both
components.

## Notes
Fleet and zone E-stops now also attempt robots whose cached status is `offline`
(the same 30 s lag); one that still does not answer is left out of the result,
as before, so a long-dead robot does not turn every fleet stop into a failure.
