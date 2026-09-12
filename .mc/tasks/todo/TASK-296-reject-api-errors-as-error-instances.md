---
id: "TASK-296"
aliases: []
title: "Reject api errors as Error instances"
slug: "reject-api-errors-as-error-instances"
status: "in-progress"
priority: 2
owner: "huhn511"
projects: []
customers: []
tags: [core, app]
sprint: ""
parent: "[[TASK-281]]"
depends_on: []
spe: 3
effort: "medium"
due_date: ""
created: "2026-09-12"
updated: "2026-09-12"
---

# Reject api errors as Error instances

## Description

The app's api client rejects with a plain object literal, never an `Error`. 165 sites across `app/src` then write `error instanceof Error ? error.message : '<fallback>'`, so the fallback always wins and the server's sentence is always discarded. Fixing the contract at the root — one class, two files — makes all 165 sites start telling the truth immediately, without touching any of them.

## Details

### Current state

`app/src/api/client.ts:176-210` (`createApiError`) returns a plain object literal `{ code, message, details, statusCode }`, and both reject paths (`:154`, `:162`) reject with it. Nothing on the api path is ever an `Error`.

The operator-facing consequence, traced end to end:

1. `server/src/services/SafetyService.ts:109` throws ``Robot ${robotId} is not connected``
2. `server/src/routes/safety.routes.ts:67-68` answers 503 with that sentence in `{ error }`
3. `app/src/api/client.ts:185` lifts it into `message`
4. `app/src/features/safety/store/safetyStore.ts:171` discards it — `instanceof Error` is false
5. `app/src/features/safety/components/RobotEmergencyStopButton.tsx:49` renders "The stop did not reach the robot. Use the hardware stop." via `lastSafetyError()` (`stopStyles.ts:19-21`), which reads the already-discarded `lastActionError`

The operator is never told whether the robot was unknown, disconnected, or still latched.

Two correct helpers already exist and 120 non-test files use one of them:

- `getErrorMessage` — `app/src/shared/utils/error.ts:44`, barrel `@/shared/utils`
- `errorMessage` — `app/src/shared/components/ui/errorMessage.ts:38`, barrel `@/shared/components/ui`

### Frontend

**Scope is two source files: `app/src/api/client.ts` and `app/src/shared/types/api.types.ts`.**

1. Replace the `createApiError` object literal (`client.ts:176-210`) with an exported

   ```ts
   export class ApiRequestError extends Error implements ApiError
   ```

   assigning `code`, `details` and `statusCode` as own properties and passing the resolved message to `super(message)`. Keep every field name exactly as `ApiError` declares them (`app/src/shared/types/api.types.ts:34-39`), and keep the message-resolution order at `client.ts:183-188` **unchanged**.

2. Both reject paths (`:154`, `:162`) reject with the class instance.

**Why this is backward compatible with the 120 files already on the helpers:**

- `getErrorMessage` takes its `error instanceof Error` branch (`error.ts:45`) and returns the same string `asApiErrorLike` produced
- `errorMessage` still finds `.message` (`errorMessage.ts:44`)
- `getErrorStatus` still reads the own `statusCode` property (`error.ts:65`)

**Why this is the child to do first:** it is four files of context and it fixes all 165 `instanceof Error` sites at the root the moment it lands — the E-stop button included. TASK-297's sweep is then cleanup for consistency, not for correctness.

**msw wiring.** `msw` 2.12 is already a devDependency and `app/src/mocks/server.ts` already calls `setupServer(...handlers)`, but **no test imports it**. This task owns wiring `listen` / `resetHandlers` / `close` into `app/src/test/setup.ts` (the only entry in `vitest.config.ts` `setupFiles`). Pick an `onUnhandledRequest` setting that does not break the many existing suites that mock `apiClient` — `'bypass'` is the safe default there; do not use `'error'` globally.

**Key files:**
- `app/src/api/client.ts` — replace the `createApiError` literal with the `ApiRequestError` class
- `app/src/shared/types/api.types.ts` — the `ApiError` interface the class must satisfy (`:34-39`)
- `app/src/api/__tests__/client.test.ts` — NEW, real-seam test via msw
- `app/src/test/setup.ts` — wire msw listen/reset/close
- `app/src/mocks/server.ts` — existing `setupServer`, currently imported by nothing
- `app/src/features/safety/store/__tests__/safetyStore.test.ts` — replace the `new Error` mock at `:221`
- `app/src/shared/utils/error.ts` — read only, `:45`/`:65`, the branches this must stay compatible with

## Acceptance Criteria

- [ ] A rejected api call fails `expect(err).toBeInstanceOf(Error)` while still exposing `code`, `message` and `statusCode` as own properties matching the `ApiError` interface.
- [ ] The message-resolution order at `client.ts:183-188` is unchanged, asserted by a test that serves a body with `error`, one with `message`, and one with neither.
- [ ] Triggering the per-robot E-stop against a robot the server reports as 503 "not connected" leaves that exact sentence in the safety store's `lastActionError` and in the toast, not the "Use the hardware stop." fallback.
- [ ] `app/src/test/setup.ts` starts and stops the msw server, and the full existing app suite still passes unchanged — no suite that mocks `apiClient` regresses.
- [ ] `cd app && npx tsc && npx vitest run` passes.
- [ ] No file outside `app/src/api/`, `app/src/shared/types/api.types.ts`, `app/src/test/setup.ts` and the two test files above is modified.

## Test Strategy

**The test that mocks the broken seam:** `app/src/features/safety/store/__tests__/safetyStore.test.ts`. Line `:27-40` replaces the whole `../../api/safetyApi` module with `vi.fn()`s, and **line 221** does `mockApi.triggerRobotEStop.mockRejectedValue(new Error('estop fail'))`, asserting `lastActionError === 'estop fail'` at **line 227**. (The epic cited `:226`; that line is `expect(ok).toBe(false)`.) `new Error` is the one shape production never produces, so the test passes on code that discards every real server message. The same pattern appears in 32 feature test files — `gdprStore`, `complianceStore`, `a2aStore` and others.

**What replaces it, in two layers:**

1. **A real-seam test that mocks nothing at the broken boundary.** New file `app/src/api/__tests__/client.test.ts`, using the already-present msw `setupServer`, with no `vi.mock` of axios. Serve a 503 with body `{"error":"Robot r1 is not connected"}`, call through `apiClient`, and assert the rejection is `instanceof Error`, has `statusCode === 503`, and carries that sentence.

2. **In `safetyStore.test.ts`, stop hand-rolling `new Error`.** Reject with the real `ApiRequestError` exported from `app/src/api/client.ts` and assert `lastActionError` is the server sentence. This substitution is the point: a regression test that keeps rejecting with `new Error` would still pass against the old broken store.

**File ownership in `safetyStore.test.ts`** — three tasks touch this file; keep to your own lines:
- **This task (TASK-296)** owns the `new Error('estop fail')` mock at **line 221** and its assertion at `:227`.
- **TASK-295** owns the new E-stop reducer cases.
- **TASK-297** owns the six `instanceof Error` lines at `:115`, `:171`, `:198`, `:227`, `:253`, `:282`.

## Notes

Sibling tasks from the same defect: **TASK-297** sweeps the 165 call sites onto the shared helpers and adds the ratchet; **TASK-298** fixes the server half (route handlers echoing raw caught error text). None of the three blocks another — the helpers already handle both the `Error` and the `{ message }` shapes, so order is a review convenience only.

TASK-298 must preserve the curated 404/503 branching at `server/src/routes/safety.routes.ts:62-71`, because the demoable win in this task's acceptance criteria depends on that sentence still reaching the client.

No file under `app/src/components/layout/**` or `app/src/components/docs/DocsSidebar.tsx` is touched — a parallel session owns those (TASK-273..280).
