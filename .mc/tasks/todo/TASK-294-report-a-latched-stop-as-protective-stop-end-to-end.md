---
id: "TASK-294"
aliases: []
title: "Report a latched stop as protective_stop end to end"
slug: "report-a-latched-stop-as-protective-stop-end-to-end"
status: "review"
priority: 2
owner: "huhn511"
projects: []
customers: []
tags: [core, server, robot-agent]
sprint: ""
parent: "[[TASK-281]]"
depends_on: []
spe: 3
effort: "medium"
due_date: ""
created: "2026-09-12"
updated: "2026-09-12"
---

# Report a latched stop as protective_stop end to end

## Description

A robot in a latched safety stop refuses to move but renders in the fleet console as "Online", in green. The app has declared a 7th robot status, `protective_stop`, since the safety work landed — with a label, a red badge, a list filter and a fleet counter — but no producer can emit it, because the robot agent writes `'online'` during a stop and all four declarations of the status union stop at 6 values. This task makes the agent report the truth and widens the union everywhere it is declared, in one PR.

## Details

### Current state

`robot-agent/src/safety/SafetyMonitor.ts:1225` (`applyStopToState`) writes:

```ts
s.status = 'online'; // Stopped but not in error
```

for **both** stop categories, while setting `currentTaskName` to `'EMERGENCY STOP'` / `'Protective stop'`. That method is reached from `executeStop` for every stop — `triggerEmergencyStop` (`:939`, category 0) and `triggerProtectiveStop` (`:976`, `this.config.defaultStopCategory`) — and from `restoreLatchedEmergencyStop` (`:1033`), so a stop restored across an agent restart reports the same falsehood.

That `'online'` leaves the agent via `GET /api/v1/health` (`robot-agent/src/api/rest-routes.ts:348`, `robotStatus: robot.status`), is read by the health poll in `server/src/services/RobotManager.ts` (typed GET at ~`:903-908`, `statusChanged` diff at ~`:923`), persisted by `robotRepository.updateHealthCheck` (`server/src/repositories/RobotRepository.ts:302-317`) and broadcast as `robot_status_changed` (`RobotManager.ts:1061`).

**There are FOUR producers of the union, not three.** All four enumerate exactly 6 values and all four must widen:

1. `robot-agent/src/robot/types.ts:11-17` — `RobotStatus`
2. `robot-agent/cli/src/api/types.ts:7-13` — the `roboctl` mirror
3. `server/src/services/RobotManager.ts:27-33` — `RobotStatus`
4. `server/src/database/schemas.ts:21-28` — **`RobotStatusSchema`, a real zod gate.** This is the one that is easy to miss and the one that rejects at runtime.

They must land in a single PR. Widening them asymmetrically means the agent compiles and starts emitting `protective_stop` while the server's zod gate rejects the value it now receives.

The app already declares and handles the 7th value — nothing to add there:

- `app/src/features/robots/types/robots.types.ts:13-20` — `RobotStatus`, 7 values
- `ROBOT_STATUS_LABELS` `:478-486`, `ROBOT_STATUS_COLORS` `:489-497`
- the list filter `app/src/features/robots/components/RobotList.tsx:29`
- the fleet counter `app/src/features/fleet/hooks/useFleetStatus.ts:39-46`
- **a fourth consumer the epic missed:** `app/src/features/robots/components/common/RobotStatusTag.tsx:22` (tone `'stopped'`) and `:29` (label "Protective stop"). This is what the list and the cards actually render through — `RobotList.tsx:131` and `RobotCard.tsx:95`.

Symptom today: a latched robot shows Online in green, the "Protective stop" filter returns nothing, the fleet counter is permanently 0, and `isRobotAvailable` (`robots.types.ts:529-531`) still returns true, so its command buttons stay live.

**No Prisma migration.** `server/prisma/schema.prisma:25` is `status String @default("offline")` with an explanatory comment only — no enum, no check constraint.

### Robot Agent

1. Add `'protective_stop'` to `RobotStatus` in `robot-agent/src/robot/types.ts:11-17`. `SimulatedRobotState.status` (`:343`) and `Robot.status` (`:107`) are typed from that union, and `SafetyMonitor`'s `stateUpdater` is `(updater: (state: SimulatedRobotState) => void) => void` (`SafetyMonitor.ts:40`), so the new value typechecks at the mutation site with no further plumbing.
2. In `applyStopToState` (`SafetyMonitor.ts:1216-1238`), replace `s.status = 'online'` at `:1225` with `'protective_stop'` for **both** categories. Keep the `currentTaskName` distinction (`'EMERGENCY STOP'` vs `'Protective stop'`) exactly as it is — that is where the emergency-vs-protective difference survives.
3. Leave the reset path alone: `SafetyMonitor.ts:1147` already writes `s.status = 'online'` and clears both the stop warning and the `currentTaskName` slot.
4. Mirror the union in `robot-agent/cli/src/api/types.ts:7-13` so `roboctl status` compiles and prints the value.

**Do NOT add an 8th `'estop'` value.** The emergency-vs-protective distinction already survives in two places: `currentTaskName` (`SafetyMonitor.ts:1226`) and `GET /robots/:id/safety` (`rest-routes.ts:792-807` → `getSafetyStatus()`, carrying `estop.stopCategory` and `triggeredBy`). An 8th value would force a new key into all three `Record<RobotStatus, …>` maps in the app for no operator-visible gain.

### Server

1. Add `'protective_stop'` to `RobotStatus` at `server/src/services/RobotManager.ts:27-33`.
2. Widen the zod enum `RobotStatusSchema` at `server/src/database/schemas.ts:21-28`. Without this the value is rejected at the gate.
3. **Do NOT touch `normalizePresentedStatus` (`RobotManager.ts:586-594`).** It rewrites only `'online'`/`'busy'` to `'offline'` for non-live robots; the new value passes through untouched, exactly like `'maintenance'` does. Adding it there would hide the stop.

Nothing else on the server needs changing: the value flows unchanged through the existing health poll, `updateHealthCheck` (whose `status?: RobotStatus` goes straight to Prisma) and the `robot_status_changed` emit at `:1061`.

### Frontend

**No app source change.** The 7th value and all four of its consumers already exist. This task adds app regression coverage only — see Test Strategy.

**Key files:**
- `robot-agent/src/safety/SafetyMonitor.ts` — `:1225` writes `'protective_stop'` instead of `'online'`
- `robot-agent/src/robot/types.ts` — `:11-17`, add the 7th value
- `robot-agent/cli/src/api/types.ts` — `:7-13`, mirror the union
- `server/src/services/RobotManager.ts` — `:27-33`, add the value
- `server/src/database/schemas.ts` — `:21-28`, widen `RobotStatusSchema`
- `robot-agent/src/safety/__tests__/SafetyMonitor.estop-latch.test.ts` — new during-stop status case
- `server/src/services/__tests__/RobotManager.test.ts` — `:580-610`, add a `protective_stop` health case

## Acceptance Criteria

- [ ] A `SafetyMonitor` unit test drives `triggerProtectiveStop` and `triggerEmergencyStop` against a real state object and asserts the mutated `SimulatedRobotState.status` is `'protective_stop'` for both, and `'online'` again after `resetEmergencyStop`.
- [ ] `RobotStatusSchema.safeParse('protective_stop').success` is `true` in `server/src/database/schemas.ts`.
- [ ] All four declarations carry the value, and `npm run typecheck` passes in `server`, `robot-agent` and `robot-agent/cli`.
- [ ] A `RobotManager` health-check test whose mocked agent reports `robotStatus: 'protective_stop'` asserts it is passed to `robotRepository.updateHealthCheck` and that a `robot_status_changed` event is emitted.
- [ ] With a robot reporting `'protective_stop'`, the robots list renders the "Protective stop" tag, the "Protective stop" filter returns that robot, the fleet counter reads 1, and `isRobotAvailable(robot)` returns `false`.
- [ ] `git status` shows no new file under `server/prisma/migrations/`.

## Test Strategy

The seam here is **untested rather than mocked** — say so plainly rather than claiming a replaced mock.

1. **The agent-side seam has no test.** `robot-agent/src/safety/__tests__/SafetyMonitor.estop-latch.test.ts:109-118` builds a real monitor over a real state object via `makeMonitor()` and asserts `state.status` is `'online'` — but it asserts that **after** `resetEmergencyStop()`, which stays correct and must not be changed. The status *during* a stop is asserted nowhere in the agent suite. Add the new case beside it, using the same `makeMonitor()` harness.

2. **The server-side seam is mocked.** `server/src/services/__tests__/RobotManager.test.ts:580-610` ("updates battery/status and persists when a cached robot reports new health") hand-writes the agent's response — `httpGet.mockResolvedValueOnce({ status: 'ok', robotStatus: 'busy', batteryLevel: 55 })` — and asserts pass-through. A hand-written value proves nothing about what the agent can actually emit, which is the entire defect. Keep the test, add a `'protective_stop'` case, and pair it with the real-producer test from (1) so both halves of the boundary are covered.

3. App regression coverage: assert the filter, the counter, the tag and `isRobotAvailable` against a robot fixture whose status is `'protective_stop'`.

Run: `cd robot-agent && npm run typecheck && npx vitest run`, `cd robot-agent/cli && npm run typecheck`, `cd server && npm run typecheck && npx vitest run`, `cd app && npx tsc && npx vitest run src/features/robots src/features/fleet`.

## Notes

A robot latched while its agent then goes unreachable is set to `'offline'` by the health-check catch (`RobotManager.ts` ~`:1087-1092`), so the stop drops off the list. That is acceptable and **must not be worked around** here — an unreachable agent genuinely cannot be reported as latched, and papering over it would mean trusting a stale status.

Sibling task: **TASK-295** covers the other half of this console's dishonesty — a remote E-stop or reset never reaching the dashboard's fleet Stop button. The two are independent: this task is the robot status value on `/api/v1/health`; TASK-295 is the E-stop broadcast and the `fleetStatus` reduce, which never consults robot status. Ship this one first — it is smaller and removes the more visible lie.

Widening `RobotStatus` is a cross-component contract. The four declarations must land in **one** PR or typecheck fails asymmetrically.

No file under `app/src/components/layout/**` or `app/src/components/docs/DocsSidebar.tsx` is touched — a parallel session owns those (TASK-273..280).
