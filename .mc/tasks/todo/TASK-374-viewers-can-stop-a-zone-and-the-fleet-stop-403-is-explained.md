---
id: "TASK-374"
aliases: []
title: "Viewers can stop a zone and the fleet stop 403 is explained"
slug: "viewers-can-stop-a-zone-and-the-fleet-stop-403-is-explained"
status: "review"
priority: 2
owner: "huhn511"
projects: []
customers: []
tags: ["core"]
sprint: ""
parent: ""
depends_on: []
spe: 3
effort: "low"
due_date: ""
created: "2026-10-12"
updated: "2026-10-12"
---

# Viewers can stop a zone and the fleet stop 403 is explained

## Description

A `viewer` must be able to stop what they can see is dangerous. The fleet stop is
already granted to every role, but the zone stop on the site map is not: the
server refuses it with a 403 and the app disables it for a viewer. Grant the zone
stop as a halt, make the app match, and find out where the 403 a viewer got on
**Stop fleet** in the earlier k3d tenant test (TASK-370) came from.

## Details

### Current state

- `server/src/middleware/auth.middleware.ts` — `writeRoleGuard` admits writes to
  member and above. `SAFETY_HALT_WRITES` is the list of halts a viewer may fire
  anyway; it holds only `POST /api/safety/fleet/estop`. Its doc comment says the
  zone stop is left out because "no shipped UI fires it" — but the site map
  (`app/src/features/fleet/components/SiteMap.tsx`, TASK-331, rendered on the
  fleet page and the dashboard) now stops a zone on click via
  `POST /api/safety/zones/:id/estop` (`server/src/routes/safety.routes.ts`).
- There is no zone reset route; resets exist only for the fleet
  (`/api/safety/fleet/estop/reset`) and a robot (`/api/safety/robots/:id/estop/reset`).
- App: `useCanStop()` (`app/src/features/safety/components/stopStyles.ts`) is the
  `robots:command` permission. TASK-370 used it to make the zone stop
  non-clickable on the site map for a viewer (with a "Your role can't use this
  stop" hint) and to disable `ZoneEmergencyStopButton`
  (`app/src/features/safety/components/ZoneEmergencyStopButton.tsx`).

### Server

- Add `/^\/api\/safety\/zones\/[^/]+\/estop\/?$/` to `SAFETY_HALT_WRITES`. The
  `\/?$` anchor keeps any `/reset` suffix out; `[^/]+` keeps it to one zone id
  segment.
- Rewrite the doc comment: the zone stop is in, the per-robot stop under
  `/api/safety` stays out (no UI fires it; a viewer's robot halt goes through the
  `emergency_stop` command type).

### Frontend

- `SiteMap.tsx`: zones are clickable for every role; drop the forbidden hint.
- `ZoneEmergencyStopButton.tsx`: enabled for every role, like Stop fleet.
- `stopStyles.ts`: `useCanStop` now gates only the per-robot stop and the
  resumes; update its comment and `STOP_FORBIDDEN_HINT`'s.

### Investigation — the k3d 403 on Stop fleet

Reproduce the viewer's fleet stop with auth on and multi-tenancy on, and look
for every other source of a 403 on that path. Fix it only if a real cause turns
up; otherwise record what was tried.

### Key files

- `server/src/middleware/auth.middleware.ts`
- `server/src/__tests__/write-route-authorization.test.ts`
- `docs/api.md` (the halts table)
- `app/src/features/fleet/components/SiteMap.tsx`
- `app/src/features/fleet/components/__tests__/SiteMap.test.tsx`
- `app/src/features/safety/components/ZoneEmergencyStopButton.tsx`
- `app/src/features/safety/components/stopStyles.ts`
- `app/src/features/safety/components/__tests__/EmergencyStopButtons.roles.test.tsx`

## Acceptance Criteria

- [x] With auth on, a viewer's `POST /api/safety/zones/:id/estop` is not refused
      by the role guard (200, or 404 for an unknown zone).
- [x] A viewer still gets 403 on `POST /api/safety/fleet/estop/reset`,
      `POST /api/safety/robots/:id/estop/reset` and `POST /api/safety/robots/:id/estop`,
      and no `.../zones/:id/estop/reset` or nested path matches the halt list.
- [x] The `SAFETY_HALT_WRITES` doc comment no longer says the zone stop is excluded.
- [x] On the site map and in `ZoneEmergencyStopButton`, a viewer can stop a zone
      and sees no "Your role can't use this stop" hint; the per-robot stop and
      every resume stay disabled for a viewer.
- [x] The source of the k3d Stop-fleet 403 is fixed with a test, or the task and
      the PR record that it does not reproduce on `main` and what was tried.

## Test Strategy

- `server/src/__tests__/write-route-authorization.test.ts` drives a real viewer
  JWT through the real app: zone stop 200, per-robot `/api/safety` stop and both
  resets 403, `isSafetyHalt` rejects `/reset` and nested zone paths, and the
  route inventory classifies the zone stop as a halt.
- App: `SiteMap.test.tsx` (viewer/owner/super-admin click a zone and the stop
  fires) and `EmergencyStopButtons.roles.test.tsx` (zone button enabled for every
  role, robot button still gated).
- Live: server from this branch, `AUTH_DISABLED=false MULTI_TENANCY_ENABLED=true`,
  a real tenant + viewer created through `/api/tenants/onboard` and `/api/team`,
  logged in through `/api/auth/login`.

## Notes

### The k3d Stop-fleet 403 does not reproduce on `main`

Tried, at `b9de8acc` (and again with this branch):

- **Live server, auth and multi-tenancy on.** SQLite, `AUTH_DISABLED=false`,
  `MULTI_TENANCY_ENABLED=true`, `NODE_ENV` unset, rate limiter
  on. Bootstrap super-admin → `POST /api/tenants/onboard` (tenant Acme + owner) →
  owner `POST /api/team` adds a viewer → viewer logs in (real token with
  `role: viewer`, a `tenantId`, `mustChangePassword: true`). Viewer
  `POST /api/safety/fleet/estop {"reason":"test"}` → **200**. On `main` the same
  viewer got 403 on the zone stop, the robot stop and both resets — all from
  `writeRoleGuard` — which is what this task fixes for the zone stop.
- **Real-app supertest.** `write-route-authorization.test.ts` already proves the
  viewer fleet stop is 200 through the full middleware stack.
- **Every other 403 emitter.** Grepped `server/src` for 403: the only ones that
  can reach `/api/safety` are `writeRoleGuard`/`roleMiddleware`. Rate limiting
  answers 429, CORS has no 403 path, there is no CSRF middleware, no `/api`-wide
  mount sits in front of `/api/safety`, `continueWithTenant` never refuses (an
  impersonation header from a non-super-admin is ignored), and
  `SafetyService.triggerFleetEStop` folds per-robot agent failures into
  `robotResults` with an overall 200 — an agent's 403 is never re-emitted.
- **App side.** `safetyApi.triggerFleetEStop` posts to `/safety/fleet/estop`
  against `VITE_API_BASE_URL=/api` (the k3d build arg); the store issues only
  that POST and a follow-up GET. No extra header. `app/nginx.conf.template` and
  the Helm ingress pass `/api` through unchanged, so `req.originalUrl` keeps the
  `^/api/safety` prefix the anchor needs.
- **Stale image.** Ruled out by history: `writeRoleGuard` and the fleet-stop
  entry landed in the same squash (`961d6786`, PR #320, first released in
  `v2026.09.12.1`). Before it `/api/safety` had no role check at all, after it
  the fleet stop is exempt — no build ever 403'd a viewer's fleet stop on the
  role. `scripts/e2e-k3d/up.sh` builds the images from the checkout, tagged with
  its commit.

Most likely explanation: the 403 seen in k3d was a different request — the zone
stop on the dashboard's compact site map (a viewer could not stop a zone on any
build before this task, and that click sits next to Stop fleet), the per-robot
or resume controls (TASK-370 lists "other command controls on the dashboard and
fleet pages"), or a cockpit command — read as Stop fleet. No fix is invented for
it; if it shows up again, capture the request URL and response body from the
browser's network panel.
