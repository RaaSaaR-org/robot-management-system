---
id: "TASK-298"
aliases: []
title: "Stop route handlers echoing raw caught error text"
slug: "stop-route-handlers-echoing-raw-caught-error-text"
status: "in-progress"
priority: 3
owner: "huhn511"
projects: []
customers: []
tags: [core, server]
sprint: ""
parent: "[[TASK-281]]"
depends_on: []
spe: 5
effort: "medium"
due_date: ""
created: "2026-09-12"
updated: "2026-09-12"
---

# Stop route handlers echoing raw caught error text

## Description

Route handlers across `server/src/routes/` put raw caught error text into the response body. A `PrismaClientKnownRequestError` is an `Error`, and no `errorFormat` is configured, so its full dump — the failing query, the schema shape and the absolute server source path — reaches the browser. A mapper for exactly this exists and has two call sites. This task adds one shared failure helper and routes the echoing handlers through it.

## Details

### Current state

**Step one is to re-run the grep and set your own scope.** The epic said "33 of 64 route files"; the measured figure is higher:

```bash
grep -rlE '(message|error|detail|why).*instanceof Error' server/src/routes/*.ts
```

returns **37 files**. Work from that list, not from the number in this file — otherwise the completeness criterion below fails late.

The shape matters for scoping: only 5 files inline the echo directly in a `res.json` argument (`command`, `curation`, `models`, `service-accounts`, `team`); the other ~30 assign it to an intermediate `message` / `detail` / `why` variable first, so a single-line grep finds only 5.

`prismaErrorToAppError` (`server/src/utils/errors.ts:300-326`) exists for exactly this, and its own comment says so — "that belongs in a log, never in a response". It has **two** call sites: `server/src/routes/team.routes.ts:42` and `server/src/routes/service-accounts.routes.ts:40`.

Three facts that shape the fix:

- **`prismaErrorToAppError` does NOT cover every case.** It returns `null` for any non-Prisma error (`errors.ts:305`), and most of what these routes throw is a plain `Error`. Adding call sites alone would therefore **not** stop the leak.
- **The epic's own "clean reference pattern" is itself leaking.** `service-accounts.routes.ts:39-47` maps the Prisma branch correctly and then, at `:45`, echoes `error.message` raw for everything else. It is a reference for the Prisma branch only, and it must be fixed too.
- **The global handler is unreachable from a route catch.** `server/src/app.ts:432-448` gets this right (dev-only), but routes contain zero `next(error)` calls and use no `asyncHandler`, so nothing reaches it. `errorResponse()` (`errors.ts:331`) has zero production call sites — it is referenced only by its own unit test.

No `errorFormat` is set on the Prisma client (`server/src/database/client.ts:78-80`), which is why the dump is verbose.

Disclosure is to authenticated users only, which is why this is `priority: 3` rather than higher.

### Server

**1. Add `server/src/utils/routeErrors.ts`** exporting:

```ts
export function sendFailure(
  res: Response,
  error: unknown,
  fallbackMessage: string,
  fallbackStatus = 500,
): void
```

with a three-step body, in this order:

1. `prismaErrorToAppError(error)` — returns an `AppError` for `PrismaClientValidationError` and `PrismaClientKnownRequestError` (P2002 / P2003 / P2025 / default), `null` otherwise. Respond with `{ error: appError.message }` at `appError.statusCode`.
2. `isOperationalError(error)` (`errors.ts:269`) — an `AppError` thrown deliberately by a service carries a curated message and status. Respond with those.
3. **Everything else:** log the full error via `logger.error({ err }, ...)` (see `app.ts:443` for the shape) and respond with the caller's `fallbackMessage`. **Never `error.message`.** This step is what actually closes the leak.

Do not introduce a second response envelope — either leave `errorResponse()` alone or adopt it inside the new helper.

**2. Route the echoing handlers through it.** This is **per-catch judgment, not a codemod.** The rule to apply:

> A message that came from a `throw new Error(...)` this repo wrote may be echoed. Anything that could be a driver, library or Prisma error may not.

Two files are explicitly exempt:

- **`server/src/routes/safety.routes.ts:62-71` — preserve it.** It deliberately branches on the message to choose 404 vs 503 and echoes a curated service sentence (`SafetyService.ts:105` and `:109`). Those messages are safe and operator-facing, and **TASK-296's acceptance criteria depend on that sentence still reaching the client.**
- **`server/src/routes/robot.routes.ts` — do not touch.** It already does the right thing: it keeps the text for substring matching only, with the comment "Don't leak internal error details" at `:46`. It is the 38th file the grep matches and the one that is already correct.

**3. Fix `service-accounts.routes.ts:45`** — the raw echo in the file the epic held up as the reference.

**Key files:**
- `server/src/utils/routeErrors.ts` — NEW, the shared `sendFailure` helper
- `server/src/utils/errors.ts` — read only: `prismaErrorToAppError` at `:300-326`, `isOperationalError` at `:269`, `errorResponse` at `:331`
- the ~37 files from the grep in step one
- `server/src/routes/service-accounts.routes.ts` — `:39-47`, fix the raw echo at `:45`
- `server/src/routes/team.routes.ts` — the second existing call site, `:42` and `:69`
- `server/src/routes/safety.routes.ts` — `:62-71`, preserve the 404/503 branching
- `server/src/routes/robot.routes.ts` — already correct, do not change
- `server/src/utils/__tests__/errors.test.ts` — add the missing `prismaErrorToAppError` cases
- `server/src/services/__tests__/ServiceAccountService.test.ts` — read only, the `p2002()` factory at `:145-146`

## Acceptance Criteria

- [ ] `server/src/utils/routeErrors.ts` exports `sendFailure`, and its third branch logs the full error and responds with the caller's fallback message, never `error.message`.
- [ ] A grep for `instanceof Error ? ` inside a `res.json` / `res.status(...).json` argument across `server/src/routes` returns only `robot.routes.ts`, which uses the text for branching and never puts it in a body.
- [ ] Every file returned by `grep -rlE '(message|error|detail|why).*instanceof Error' server/src/routes/*.ts` either routes through `sendFailure` or is one of the two documented exemptions.
- [ ] Given a `PrismaClientKnownRequestError` with code P2002, a route using `sendFailure` responds 409 with the mapped sentence, and the response body contains neither the failing query nor any absolute server file path.
- [ ] `prismaErrorToAppError` has explicit unit tests covering P2002, P2003, P2025, an unrecognised code, `PrismaClientValidationError`, and a non-Prisma `Error` returning `null`.
- [ ] `server/src/routes/safety.routes.ts:62-71` still answers 404 and 503 with the curated service sentences, asserted by a test.
- [ ] `server/src/routes/service-accounts.routes.ts` no longer echoes raw caught text at `:45`.
- [ ] `cd server && npm run typecheck && npx vitest run` passes.

## Test Strategy

**The tests that mock the broken seam** never construct a Prisma error at all, so the `prismaErrorToAppError` branch is dead in every route test:

- `server/src/__tests__/team-routes.test.ts:58` mocks `TeamService` and rejects with `new Error('DB error')` at `:127`, `:194`, `:306`, `:358`
- `server/src/__tests__/service-accounts-routes.test.ts` does the same at `:129`, `:218`, `:372`

**What replaces them:** the only real `PrismaClientKnownRequestError` in the repo is built by the `p2002()` factory at `server/src/services/__tests__/ServiceAccountService.test.ts:145-146`. Copy that factory into the route tests, throw it through a handler, and assert two things — that the response body contains the *mapped* sentence, and that it does **not** contain the raw `error.message`. The negative assertion is the one that matters; without it the test passes on the leaking code.

**`prismaErrorToAppError` is currently untested.** `server/src/utils/__tests__/errors.test.ts` contains **zero** occurrences of the name, despite testing every `AppError` subclass. Add the six cases listed in the acceptance criteria — this is the mapper the whole fix rests on.

Add a test for `safety.routes.ts:62-71` asserting the 404 and 503 branches still carry their curated sentences, so the exemption is protected rather than merely documented.

## Notes

Sibling tasks from the same defect: **TASK-296** fixes the client half at the root (the api client rejecting a plain object instead of an `Error`) and **TASK-297** sweeps the app call sites. None of the three blocks another.

The dependency to respect is a behavioural one, not a scheduling one: **do not "clean up" `safety.routes.ts:62-71` while doing this sweep.** TASK-296's demoable win is that the sentence "Robot … is not connected" reaches the operator, and it reaches them through those exact lines.

`server/src/utils/errors.ts` may see a trivial conflict with other server slices in this epic; nothing else in `server/src/routes/` is claimed by a sibling task.

No `app/` file is touched by this task.
