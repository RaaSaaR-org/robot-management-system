---
id: "TASK-283"
aliases: []
title: "Extend the write-route guard to every mount and fail closed"
slug: "extend-the-write-route-guard-to-every-mount-and-fail-closed"
status: "done"
priority: 1
owner: "huhn511"
projects: []
customers: []
tags: [core, server, compliance]
sprint: ""
parent: "[[TASK-281]]"
depends_on: ["[[TASK-282]]"]
spe: 5
effort: "medium"
due_date: ""
created: "2026-09-12"
updated: "2026-09-12"
---

# Extend the write-route guard to every mount and fail closed

## Description

[[TASK-282]] put `writeRoleGuard` on the physical and fleet mounts and landed the route-enumeration
test in report-only mode. This task finishes the job: apply the guard to every remaining
authenticated mount, complete the `SELF_SERVICE_WRITES` allowlist by classifying all 349 write
verbs, and flip the enumeration test fail-closed so that a new unguarded write route — or a stale
allowlist entry — breaks CI.

The value of this task is the **classification pass**, not the middleware. The middleware already
exists; what does not exist is a recorded, tested answer to "may a read-only viewer do this?" for
every write endpoint the product ships.

## Details

### Current state (after [[TASK-282]])

`writeRoleGuard` and `SELF_SERVICE_WRITES` exist in `server/src/middleware/auth.middleware.ts`
below `memberOrAbove` (`:411`). `server/src/app.ts` declares
`const protect = [authMiddleware, writeRoleGuard];` and spreads it on the physical and fleet mounts
(robots `:209`, zones `:230`, processes `:236`, plus teleoperation, skills, safety and deployments).
Every other authenticated mount still runs bare `authMiddleware`.

`server/src/__tests__/write-route-authorization.test.ts` enumerates the live Express router stack
and asserts the guarded mounts, listing the rest without failing.

**Measured inventory** — this is the size of the classification pass:

- **349** write registrations (POST/PUT/PATCH/DELETE) across **64** route files.
- Heaviest files: `gdpr` 16, `datasets` 16, `skills` 15, `process` 15, `incident` 14, `robot` 10.
- **Two nested routers** the stack walk must descend into, or their verbs are silently missed:
  `server/src/routes/skills.routes.ts:251` mounts `/chains`, and
  `server/src/routes/training.routes.ts:28` mounts `/workers`.
- **62** authenticated `/api` mounts in `server/src/app.ts`, running from `:195` to `:388`.

### Server

**1. Apply `...protect` to every remaining authenticated mount** in `server/src/app.ts` between
`:195` and `:388`. After this, the only mounts on bare `authMiddleware` should be none.

**2. Do not touch these six** — they are unauthenticated by design, and adding the guard breaks
login or the worker fleet:

| line | mount | why it stays open |
| --- | --- | --- |
| `:189` | `/api/config` | client bootstrap, read before any session exists |
| `:192` | `/api/auth` | **13 public writes** — login, register, refresh, forgot-password, MFA |
| `:279` | `/api/training/workers` | `workerAuthMiddleware`, shared worker token, not a user JWT |
| `:320` | `/api/twin/workers` | `workerAuthMiddleware`, same |
| `:391` | `/metrics` | scrape endpoint |
| `:394` | `/.well-known/a2a` | agent discovery |

The two worker mounts are the subtle ones: they authenticate, but with a shared token that carries
no `role`, so `memberOrAbove` would reject every worker claim. Leave them on
`workerAuthMiddleware`.

**3. Complete `SELF_SERVICE_WRITES`.** Walk the enumerated inventory and classify every one of the
349 verbs. The exemption bar is narrow: **a write a read-only viewer must be able to perform on
their own account or their own personal data.** Everything else is member-or-above. Starting set
from [[TASK-282]]:

- `PUT /api/settings`, `POST /api/settings/reset` (`server/src/routes/settings.routes.ts:36,61`)
- `POST /api/gdpr/requests/*`, `POST /api/gdpr/consents`, `DELETE /api/gdpr/consents/:type`,
  `DELETE /api/gdpr/requests/:id` (`server/src/routes/gdpr.routes.ts:60-296,378,426`)

Candidates to classify explicitly — decide each and leave the reason in a comment, do not just add
them: the rest of `gdpr.routes.ts` (the `/admin/*` half at `:491-714` is **not** exempt), password
change and MFA enrolment on an authenticated session, notification read-state and acknowledgement,
and contribution submission (`server/src/routes/contributions.routes.ts`, which already carries its
own per-route gate at `:544`).

**4. Flip the test fail-closed.** Every enumerated write verb must now either answer 403 to a viewer
token or match an allowlist entry. There is no third state and no skip list.

**Key files:**
- `server/src/app.ts` — `...protect` on the remaining authenticated mounts (`:195`-`:388`)
- `server/src/middleware/auth.middleware.ts` — complete `SELF_SERVICE_WRITES` with per-entry reasons
- `server/src/__tests__/write-route-authorization.test.ts` — descend nested routers, flip fail-closed
- `server/src/routes/skills.routes.ts:251` — read-only, nested `/chains` router
- `server/src/routes/training.routes.ts:28` — read-only, nested `/workers` router
- `server/src/routes/gdpr.routes.ts` — the exempt subject half vs the guarded `/admin/*` half
- `docs/api.md` — publish the finished rule and the full exception list

## Acceptance Criteria

- [ ] Every POST/PUT/PATCH/DELETE route reachable from `createApp()` either answers 403 to a `viewer` JWT or matches an entry in the exported `SELF_SERVICE_WRITES`; the test asserts this with no skip list.
- [ ] The enumeration descends both nested routers — a verb registered under `skills.routes.ts:251` `/chains` or `training.routes.ts:28` `/workers` appears in the inventory, proved by asserting the inventory's total count is 349.
- [ ] Adding a new write route to any guarded router without an allowlist entry fails the test — demonstrated by temporarily adding one.
- [ ] Every entry in `SELF_SERVICE_WRITES` matches at least one enumerated route, so a stale entry fails the test.
- [ ] Each allowlist entry carries a comment naming the self-service right it protects.
- [ ] `POST /api/auth/login`, `POST /api/auth/register`, `POST /api/auth/refresh`, `POST /api/training/workers/claim` and `POST /api/twin/workers/*` all behave exactly as before, with no user bearer token.
- [ ] A `member` JWT is not refused anywhere a `viewer` is, except where a stricter existing guard (`ownerOnly`, `superAdminOnly`) already applied.
- [ ] `cd server && npm run typecheck && npx vitest run` passes, and no existing route test file was edited.

## Test Strategy

The same three mocked seams described in [[TASK-282]] still stand, and this task is what finally
makes them irrelevant rather than merely supplemented:

1. `server/src/middleware/__tests__/auth.middleware.test.ts:643-697` proves `memberOrAbove` denies a
   viewer using fabricated req/res objects and never touches a router.
2. `server/src/__tests__/robot-routes.test.ts:31-36` mounts `robotRoutes` with no auth at all.
3. 49 of 60 route test files `vi.mock` the auth middleware to a pass-through
   (`team-routes.test.ts:66-80`, `service-accounts-routes.test.ts:36-49`).

Leave all three as they are. They test their own units correctly; the point is that none of them can
observe which routes are wrapped, which is why the enumeration test is the only real enforcement.

Extend `server/src/__tests__/write-route-authorization.test.ts` from [[TASK-282]]:

- Recurse into nested routers. A layer with `.route` yields `route.methods`; a layer whose
  `.name === 'router'` yields `.handle.stack` under its own mount path. A non-recursive walk silently
  drops `/chains` and `/workers` and the inventory count assertion is what catches that.
- Assert the inventory total is 349 before asserting behaviour, so a stack-walk regression fails
  loudly instead of shrinking the test surface to nothing.
- Flip from report-only to fail-closed.

Both environment facts from [[TASK-282]] still apply and are the two most likely ways to lose a
session here:

- `server/vitest.config.ts:16` forces `AUTH_DISABLED: 'true'` suite-wide; this test must set it
  `'false'` per-test (`vi.stubEnv`, pattern at
  `server/src/__tests__/worker-auth-routing.test.ts:26`).
- Set `process.env.RATE_LIMIT_DISABLED = 'true'` **before** importing `../app.js` — `app.ts:115`
  captures `rateLimitDisabled` at module import, and this suite now fires ~340 requests against the
  `/api/` limiter (`app.ts:118-125`).

Do not fire allowlisted requests; their handlers reach Prisma. Assert only that the path matched the
allowlist.

## Notes

Expect this task to surface genuine product questions — "may a viewer acknowledge an alert?",
"may a viewer submit a contribution?". Record the answer in the allowlist comment. A wrong answer
here is recoverable; an unrecorded one is the defect this epic exists to remove.

If the classification pass turns out to be larger than one session, split by route-file group
(compliance, training, fleet, admin) rather than lowering the bar — the fail-closed flip is the whole
deliverable and must not ship half-applied.

This task touches no file under `app/`, so it does not intersect the parallel navigation refactor
(TASK-273 to TASK-280).
