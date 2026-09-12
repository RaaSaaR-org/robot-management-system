---
id: "TASK-295"
aliases: []
title: "Broadcast every E-stop transition and reduce it in the fleet console"
slug: "broadcast-every-e-stop-transition-and-reduce-it-in-the-fleet-console"
status: "in-progress"
priority: 2
owner: "huhn511"
projects: []
customers: []
tags: [core, server, app]
sprint: ""
parent: "[[TASK-281]]"
depends_on: []
spe: 5
effort: "medium"
due_date: ""
created: "2026-09-12"
updated: "2026-09-12"
---

# Broadcast every E-stop transition and reduce it in the fleet console

## Description

The dashboard's fleet Stop button cannot react to a stop it did not initiate. The server broadcasts an E-stop event for only two of its five transitions, and the client logs whatever arrives into an event list that the button never reads — it renders off `fleetStatus`, fetched exactly once on mount. This task makes every E-stop transition emit, gives the event an explicit trigger-vs-reset discriminator, and reduces it into the state the button already reads.

## Details

### Current state

**Server — only two of five transitions emit.** `logEStopEvent` (`server/src/services/SafetyService.ts:558-589`) is the only thing that notifies `eventCallbacks` (`:87`), and it runs at exactly two call sites:

- `:254` — fleet trigger
- `:408` — zone trigger

These three emit **nothing**:

- `triggerRobotEStop` (`:96-134`) — a single-robot stop broadcasts nothing at all
- `resetRobotEStop` (`:139-171`)
- `resetFleetEStop` (`:270-316`)

`server/src/websocket/index.ts:251-258` forwards whatever the callback receives under `safety:estop`, so it needs no change.

**Client — the event is logged, never reduced.** `app/src/features/robots/hooks/useRobotWebSocket.ts:145-149` routes `safety:estop` to `useSafetyStore.getState().addEvent(...)`. `addEvent` (`app/src/features/safety/store/safetyStore.ts:310-317`) unshifts into `state.events` and touches nothing else. But `FleetEmergencyStopButton.tsx:69-85` renders entirely off `fleetStatus.anyTriggered` / `triggeredCount`, fetched once on mount by `useFleetSafety` (`app/src/features/safety/hooks/useSafety.ts:45-48`) with no polling and no WS path.

The only 5-second refresher lives in `useSafetyOverview` (`useSafety.ts:221-260`), and it is **dead code**: its sole consumer `SafetyStatusDashboard` is exported at `app/src/features/safety/index.ts:43` and rendered nowhere. Do not wire new behaviour through it.

**The dangerous direction is the inverse one.** After a *remote reset*, the tag still reads "Fleet stopped" and still offers "Resume fleet" on an already-armed fleet. An operator acting on that is resuming a fleet that is already running. This is why reducing the incoming event alone is not sufficient — `resetFleetEStop` emits nothing today, so the reset must start emitting before anything can reduce it.

`app/src/features/dashboard/pages/DashboardPage.tsx:82` carries the comment "Safety-critical: visible in every state, right-most, never a primary" over a component structurally incapable of reacting to a stop it did not initiate.

### Server

1. Make `logEStopEvent` (`SafetyService.ts:558-589`) the single emitter for every scope by also calling it from `triggerRobotEStop` (`:96-134`), `resetRobotEStop` (`:139-171`) and `resetFleetEStop` (`:270-316`).
2. **No new scope value is needed.** `EStopScope` (`SafetyService.ts:17`, mirrored at `app/src/features/safety/types/safety.types.ts:12`) already carries an unused `'robot'` member.
3. **Widen `EStopEvent` (`SafetyService.ts:44-52`).** Two things are wrong with it:
   - `result` is typed `FleetEStopResult | ZoneEStopResult`, which no single-robot payload and no reset payload satisfies.
   - The type has no notion of armed-vs-triggered at all.

   Add an explicit `action: 'trigger' | 'reset'` discriminator. **Do not let the client infer intent from the `reason` string** — a safety state must not depend on prose. Mirror the widened type at `app/src/features/safety/types/safety.types.ts:118-126`.
4. `server/src/websocket/index.ts:251-258` needs no change.

### Frontend

1. In `safetyStore.ts`, reduce the event instead of only logging it. Apply it to `fleetStatus.anyTriggered` / `triggeredCount` and the `robotStatuses` cache, then call `fetchFleetStatus()` to reconcile with the authority.
2. **Copy the refetch-after-mutation shape from the store itself** — `safetyStore.ts:168`, `:190`, `:237` already do exactly this. Do **not** copy it from `useSafetyOverview`, which is dead code (see Current state).
3. Route the event to the new reducer at `useRobotWebSocket.ts:145-149`. Keep `addEvent`'s existing behaviour for the event list; the reducer is additional, not a replacement.
4. `FleetEmergencyStopButton.tsx:69-85` and `useFleetSafety` (`useSafety.ts:45-48`) need **no change** — the state they already read becomes live.
5. Fix the dangerous direction first: after a remote reset the tag must stop reading "Fleet stopped" and stop offering "Resume fleet" on an armed fleet.

**Key files:**
- `server/src/services/SafetyService.ts` — emit via `logEStopEvent` at `:96`, `:139`, `:270`; widen `EStopEvent` `:44-52`
- `app/src/features/safety/types/safety.types.ts` — `:118-126`, add `action`, widen `result`
- `app/src/features/safety/store/safetyStore.ts` — `:310-317`, reduce the event into `fleetStatus`, then refetch
- `app/src/features/robots/hooks/useRobotWebSocket.ts` — `:145-149`, route to the new reducer
- `server/src/services/__tests__/SafetyService.test.ts` — `:396-440`, assert emission on robot trigger and both resets
- `server/src/websocket/__tests__/index.test.ts` — `:500-508`, drive a real `EStopEvent`, not a literal
- `app/src/features/safety/store/__tests__/safetyStore.test.ts` — add trigger/reset reducer cases

## Acceptance Criteria

- [ ] A `SafetyService` test asserts an `onEStopEvent` subscriber fires for a single-robot trigger, a single-robot reset and a fleet reset — not only for a fleet trigger — each carrying the right `scope` and `action`.
- [ ] `EStopEvent` carries an explicit `action: 'trigger' | 'reset'`, and its `result` type is satisfied by a single-robot payload and by a reset payload.
- [ ] A `safetyStore` test feeds a reset `EStopEvent` through the reducer and asserts `selectFleetHasTriggeredEStop` becomes `false` and `selectTriggeredRobotCount` becomes `0`, with no component remount.
- [ ] A `safetyStore` test feeds a trigger `EStopEvent` through the reducer and asserts the inverse.
- [ ] After a fleet E-stop is triggered from a second client, the first client's `FleetEmergencyStopButton` shows the stopped tag and "Resume fleet" with no reload; after a remote reset it shows neither.
- [ ] The reducer calls `fetchFleetStatus()` to reconcile, following the pattern at `safetyStore.ts:168`/`:190`/`:237`.
- [ ] `cd server && npm run typecheck && npx vitest run` and `cd app && npx tsc && npx vitest run src/features/safety src/features/robots` pass.
- [ ] `git diff --name-only main` lists no file under `app/src/components/layout/` or `app/src/components/docs/`.

## Test Strategy

Two tests currently stand in for the broken seam, and one of them passes no matter what the service emits.

1. **`server/src/services/__tests__/SafetyService.test.ts:411-423`** ("notifies subscribers on new events and unsubscribes") subscribes via `onEStopEvent` and then drives only `triggerFleetEStop` — the one path that already emits. The `resetFleetEStop` case at `:286-301` asserts result counts and never the callback. Add cases asserting the callback fires for `triggerRobotEStop`, `resetRobotEStop` and `resetFleetEStop`, with the expected `scope` and `action`.

2. **`server/src/websocket/__tests__/index.test.ts:500-508`** mocks `SafetyService` wholesale (the `vi.mock` at `:108-112` captures `onEStopEvent`) and then invokes the captured callback with `{ robotId: 'r1', engaged: true }` — **a shape the real `EStopEvent` never has**, so the test passes regardless of what the service actually emits. Replace that literal with a real `EStopEvent` built from the service's own type, so the broadcast test breaks if the envelope changes.

3. **`app/src/features/safety/store/__tests__/safetyStore.test.ts`** mocks the entire `safetyApi` module at `:27-39`; its `addEvent` cases assert only the unshift and the 100-item cap. Add cases that feed a trigger event and a reset event through the reducer and assert `selectFleetHasTriggeredEStop` / `selectTriggeredRobotCount`, keeping the api mock only for the reconciling `fetchFleetStatus` call.

**File ownership in `safetyStore.test.ts`** — three tasks touch this file; keep to your own lines:
- **This task (TASK-295)** owns the new E-stop reducer cases.
- **TASK-296** owns the `new Error('estop fail')` mock at **line 221** (assertion at `:227`).
- **TASK-297** owns the six `instanceof Error` lines at `:115`, `:171`, `:198`, `:227`, `:253`, `:282`.

## Notes

`app/src/components/layout/AppLayout.tsx:47` already mounts `useRobotWebSocket()` app-wide, so **no change is needed under `app/src/components/layout/**`** — which a parallel session owns (TASK-273..280). If review asks for a provider to be mounted there instead, raise it with that session rather than editing those files.

Sibling task: **TASK-294** covers the other half of this console's dishonesty (a latched robot rendering as Online). The two are independent — they act on different endpoints: TASK-294 is the robot status value on `/api/v1/health`, this one is the E-stop broadcast and the `fleetStatus` reduce, which never consults robot status. Ship TASK-294 first because it is smaller, not because this one is blocked.

`SafetyStatusDashboard` (`app/src/features/safety/index.ts:43`) is dead UI. Do not wire new behaviour through it, and do not "fix" it as part of this task.
