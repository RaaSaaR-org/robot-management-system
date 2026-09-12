---
id: "TASK-282"
aliases: []
title: "Enforce member-or-above authorization on fleet and physical write routes"
slug: "enforce-member-or-above-authorization-on-fleet-and-physical-write-routes"
status: "review"
priority: 1
owner: "huhn511"
projects: []
customers: []
tags: [core, server, compliance]
sprint: ""
parent: "[[TASK-281]]"
depends_on: []
spe: 5
effort: "medium"
due_date: ""
created: "2026-09-12"
updated: "2026-09-12"
---

# Enforce member-or-above authorization on fleet and physical write routes

## Description

A `viewer` — the lowest role a tenant owner can assign — can today unregister any robot from the
fleet and send it physical motion commands. Authentication is mounted everywhere and authorization
nowhere: the two guards written for exactly this purpose are applied by zero route files. This task
adds one `writeRoleGuard` middleware, applies it to the physical and fleet mounts, allowlists the
genuine self-service exceptions, and lands a table-driven test that enumerates the real Express
router stack and drives a real viewer JWT at every write verb on those mounts.

The remaining mounts and the fail-closed flip are [[TASK-283]]. The client half — a viewer still
*seeing* the buttons the server now refuses — is [[TASK-284]].

## Details

### Current state

64 route files live in `server/src/routes/*.routes.ts` and declare 349 write verbs
(POST/PUT/PATCH/DELETE). Role guards appear in **4** of them, all owner or super-admin:

- `server/src/routes/service-accounts.routes.ts:24` and `server/src/routes/team.routes.ts:26` —
  router-level `.use(ownerOnly)`. **This is the pattern to copy for a router-level gate.**
- `server/src/routes/tenants.routes.ts:64,91,137,159` and
  `server/src/routes/contributions.routes.ts:544` — per-route.

`memberOrAbove` (`server/src/middleware/auth.middleware.ts:411`, whose own JSDoc reads "for
write/operate endpoints that read-only viewers should not reach") and `viewerOrAbove` (`:417`) are
imported by **zero** route files.

`server/src/routes/robot.routes.ts` has no router-level guard and no `req.user` reference except the
camera ticket at `:284`. It carries **10** ungated writes, not the two the sweep first named:

| line | route | |
| --- | --- | --- |
| `:22` | `POST /register` | |
| `:127` | `DELETE /:id` | unregisters a robot from the fleet |
| `:145` | `POST /:id/command` | **issues physical motion** |
| `:277` | `POST /:id/camera/:name/ticket` | |
| `:472` | `POST /:id/pointcloud/capture` | |
| `:495` | `POST /:id/pointcloud/lidar/switch` | moves hardware |
| `:524` / `:542` | scan start + stop | |
| `:599` / `:644` | proxy / VLA start + stop | starts model inference on a robot |

`server/src/app.ts:209` mounts it as `app.use('/api/robots', cameraStreamTicket, authMiddleware,
robotRoutes)` — authentication, not authorization.

`viewer` is a real production artifact: `server/src/services/TeamService.ts:29` lists it in
`ASSIGNABLE_ROLES`. A JWT with `role: 'viewer'` receives **200** on `DELETE /api/robots/:id` and on
`POST /api/robots/:id/command`.

**There is no chokepoint.** A plain `app.use('/api', writeRoleGuard)` does not work in either
position: Express runs middleware in mount order, so a guard registered *before* the routers runs
before `authMiddleware` and sees no `req.user`, and one registered *after* them never runs at all.
The guard must be an extra handler on each protected mount — which is why the enumeration test, not
the mount list, is the real enforcement mechanism.

`AUTH_DISABLED=true` short-circuits both layers: `auth.middleware.ts:236` injects a `super-admin`
`MOCK_USER` (`:56-62`), and `roleMiddleware` returns `next()` at `:368-371` before any role check.

### Server

**1. The guard.** Add to `server/src/middleware/auth.middleware.ts`, directly below `memberOrAbove`
(`:411`), keeping the file's JSDoc style:

```ts
export const SELF_SERVICE_WRITES: RegExp[] = [ /* … */ ];
export function writeRoleGuard(req: AuthenticatedRequest, res: Response, next: NextFunction): void
```

Body, in this order — each step matters:

1. `if (isAuthDisabled()) return next();` — the helper already exists at `:68`. This keeps dev and
   all 60 existing route test files green.
2. `if (!WRITE_METHODS.has(req.method)) return next();` where
   `const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);`. GET/HEAD/OPTIONS stay
   untouched, so the ticket-authenticated MJPEG GET at `robot.routes.ts:390` is unaffected.
3. `const path = req.originalUrl.split('?')[0];` — **`req.path` is mount-relative inside a mounted
   middleware**, so `originalUrl` is required. If any `SELF_SERVICE_WRITES` entry matches, `next()`.
4. Otherwise delegate: `memberOrAbove(req, res, next)`. Reuse it; do not re-implement the
   `403 {error: 'Forbidden'}` body.

**2. `SELF_SERVICE_WRITES`** — each entry with a one-line comment naming why it is exempt:

- `PUT /api/settings` and `POST /api/settings/reset` (`server/src/routes/settings.routes.ts:36,61`)
  — a viewer's own theme and preferences.
- `POST /api/gdpr/requests/*`, `POST /api/gdpr/consents`, `DELETE /api/gdpr/consents/:type`,
  `DELETE /api/gdpr/requests/:id` (`server/src/routes/gdpr.routes.ts:60-296,378,426`) — data-subject
  rights, which a viewer must be able to exercise over their own data. **The `/api/gdpr/admin/*`
  half (`:491-714`) is NOT exempt.**

**3. Apply it.** In `server/src/app.ts`: import `writeRoleGuard` alongside `authMiddleware` (`:91`),
declare `const protect = [authMiddleware, writeRoleGuard];`, and replace `authMiddleware` with
`...protect` on the **physical and fleet mounts only** — robots, processes, zones, teleoperation,
skills, safety and deployments. Known exactly: `:209` `/api/robots`, `:230` `/api/zones`, `:236`
`/api/processes`. Find the rest among the authenticated mounts, which run from `:195` to `:388`.

`:209` becomes `app.use('/api/robots', cameraStreamTicket, ...protect, robotRoutes)` — the ticket
middleware stays first.

Leave every other mount on bare `authMiddleware` for now; [[TASK-283]] extends it.

### Robot Agent

Service-account tokens can be minted as `member` or `viewer`
(`server/src/services/ServiceAccountService.ts:19`, `ASSIGNABLE_SERVICE_ROLES`). Six robot-agent
clients present such a token via `platformAuthHeaders()`
(`robot-agent/src/utils/platform-auth.ts:10`, env `NEODEM_SERVICE_TOKEN`), and their targets include
writes that become member-only here — among them `POST /api/robots/register`
(`robot-agent/src/utils/platform-registration.ts:15`) and
`POST /api/robots/:id/agent-mode/events` (`robot-agent/src/agent-mode/server-mirror.ts:142`).

A robot whose token was minted as `viewer` starts getting 403 on all of these. **That is the correct
outcome** — these are fleet writes — so the fix is documentation, not an allowlist entry.

Change `robot-agent/.env.example`, the `NEODEM_SERVICE_TOKEN` comment block at lines 28-31: state
that the service account must be created with role **member**, and name the symptom (registration
and compliance-log 403s at boot). No code change in `robot-agent/`.

This note is load-bearing for [[TASK-292]], which gives four more agent clients their credentials —
without it, those newly-credentialed clients get a 403 where they were built to report a 401.

**Key files:**
- `server/src/middleware/auth.middleware.ts` — add `writeRoleGuard` + `SELF_SERVICE_WRITES` below `:411`
- `server/src/app.ts` — `...protect` on the physical and fleet mounts
- `server/src/__tests__/write-route-authorization.test.ts` — new, table-driven stack enumeration
- `server/package.json` — optional `express-list-endpoints` devDependency for the stack walk
- `robot-agent/.env.example` — service account must be role `member` (lines 28-31)
- `docs/api.md` — record the write-route rule and its exceptions
- `server/src/routes/team.routes.ts:26` — read-only, the router-level gate pattern
- `server/src/__tests__/worker-auth-routing.test.ts` — read-only, the auth-on test pattern

## Acceptance Criteria

- [ ] A `viewer` JWT sent to `DELETE /api/robots/:id` and to `POST /api/robots/:id/command` on an app built by `createApp()` with `AUTH_DISABLED=false` returns 403 with body `{error: 'Forbidden'}`.
- [ ] A `member` JWT still reaches the handler on both of those routes (status is not 403, with `robotManager` spied).
- [ ] The new test enumerates every POST/PUT/PATCH/DELETE route on the guarded mounts from the live Express router stack and reports, per verb, whether a viewer is refused. It runs in report-only mode: it asserts the guarded mounts, and merely lists the unguarded ones.
- [ ] Every entry in `SELF_SERVICE_WRITES` matches at least one route in that enumerated inventory, so a stale entry fails the test.
- [ ] `PUT /api/settings` succeeds for a viewer, and `POST /api/gdpr/admin/requests/:id/execute-erasure` does not.
- [ ] `POST /api/auth/login` behaves exactly as before with no bearer token.
- [ ] `cd server && npm run typecheck && npx vitest run` passes **with no edits to any existing route test file**.
- [ ] `robot-agent/.env.example` states that the `NEODEM_SERVICE_TOKEN` service account must have role `member`.

## Test Strategy

Three tests currently stand in for this seam, and all three are green while zero routes are guarded:

1. `server/src/middleware/__tests__/auth.middleware.test.ts:643-697` — the "pre-bound role guards"
   table proves `memberOrAbove` denies a `viewer` with 403 using **fabricated req/res objects**. It
   never touches a router, so it stays green no matter how many routes use the guard.
2. `server/src/__tests__/robot-routes.test.ts:31-36` — `createTestApp()` does
   `app.use('/api/robots', robotRoutes)` with **no auth middleware at all**; `DELETE /:id` and
   `POST /:id/command` are exercised as if already authorized.
3. **49 of the 60 route test files** `vi.mock('../middleware/auth.middleware.js')` and inject a
   privileged user, stubbing any guard to a pass-through — e.g. `team-routes.test.ts:66-80` (`:78`
   is `ownerOnly: (_req, _res, next) => next()`) and `service-accounts-routes.test.ts:36-49`.

**What replaces them:** `server/src/__tests__/write-route-authorization.test.ts`, which mocks no auth
at all. Copy the shape from `server/src/__tests__/worker-auth-routing.test.ts`:
`import { createApp } from '../app.js'` (`:9,13`), `jwt.sign({userId, email, name, role},
process.env.JWT_SECRET!, {expiresIn: '1h'})` (`:19-23`), and `vi.stubEnv('AUTH_DISABLED', 'false')`
in `beforeEach` (`:26`). Mint two tokens: `role: 'viewer'` and `role: 'member'`.

Two environment facts the test must handle, both of which will otherwise waste a session:

- `server/vitest.config.ts:16` forces `AUTH_DISABLED: 'true'` for the entire server suite, so **no
  test in this repo currently exercises a role check through a router**. The new test must set it to
  `'false'` per-test.
- Set `process.env.RATE_LIMIT_DISABLED = 'true'` **before** importing `../app.js`:
  `rateLimitDisabled` is captured at module import (`app.ts:115`), and this suite fires enough
  requests to trip the `/api/` limiter (`app.ts:118-125`).

There is **no test helper that mints a role token**. `server/src/__tests__/helpers.ts:12`
`authRequest()` mints nothing — its own comment says it relies on `AUTH_DISABLED=true`. Inline
`jwt.sign` is the only precedent in the repo (`worker-auth-routing.test.ts:19`,
`camera-stream-ticket.test.ts`, `mfa-routes.test.ts`).

Enumerate from the real stack, not a hand-written list: walk `app._router.stack` (Express 4.21,
`server/package.json:38`) recursively — a layer with `.route` yields `route.methods`; a layer whose
`.name === 'router'` yields `.handle.stack` under its mount path. Adding `express-list-endpoints` as
a devDependency instead of hand-rolling the regexp decode is acceptable; the value is the
enumeration, not the parser. Substitute `:param` segments with a literal such as `test-id`, skip
non-write methods, then assert 403 for the viewer token unless the path matches
`SELF_SERVICE_WRITES` — do not fire the allowlisted requests, their handlers hit Prisma.

Finally, run the suite once as CI runs it (`AUTH_DISABLED=true`) to confirm no existing route test
regressed.

## Notes

`helm/neodem/values.yaml:150` ships `authDisabled: "true"`, so the shipped default deployment is
unaffected until auth is turned on. That is exactly why this is invisible today and why the new test
must run with `AUTH_DISABLED=false`.

Client-side gating is deliberately **not** here — it is [[TASK-284]]. Until that lands, a viewer
still sees buttons that now return 403. That is acceptable: the server is the security boundary.

`PUT /api/processes/tasks/:taskId/status` (`robot-agent/src/robot/TaskQueue.ts:193`) sends no
credential at all and 401s today; [[TASK-292]] owns that. It stays broken here — **do not add it to
`SELF_SERVICE_WRITES`** to paper over it.

This task touches no file under `app/`, so it does not intersect the parallel navigation refactor
(TASK-273 to TASK-280).
