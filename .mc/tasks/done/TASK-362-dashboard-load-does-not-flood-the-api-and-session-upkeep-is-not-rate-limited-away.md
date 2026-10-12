---
id: "TASK-362"
aliases: []
title: "Dashboard load does not flood the API and session upkeep is not rate limited away"
slug: "dashboard-load-does-not-flood-the-api-and-session-upkeep-is-not-rate-limited-away"
status: "done"
priority: 2
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
created: "2026-10-12"
updated: "2026-10-12"
---

# Dashboard load does not flood the API and session upkeep is not rate limited away

## Description

A production-mode k3d run showed that, after login, `/dashboard` sent ~117 `/api`
requests in 0.6 s (29x `/api/alerts/active`, 29x `/api/robots`, 28x
`/api/digital-twins`, 27x `/api/digital-twins/:id/zones`) until the production rate
limiter answered 429 — and the 429s then logged the user out. Separately, the
strict `authLimiter` (5 req/min) in `server/src/app.ts` is mounted on all of
`/api/auth`, so ordinary session upkeep (`/auth/me`, `/auth/refresh`,
`/auth/logout`) is rate limited and ends the session.

## Details

**Root cause of the flood.** `DashboardPage` showed its skeleton while
`isLoading && robotMarkers.length === 0`. With an empty fleet, every robots fetch
flips that back to true, which unmounts `SiteMap` and `NeedsAttentionPanel`; on
remount, `SiteMap` calls `fetchRobots` + `fetchTwins` (then zones) and the panel
fetches active alerts — which sets `isLoading` again: a remount loop. Concurrent
identical fetches from several components also each hit the network.

### Frontend

- `app/src/features/robots/store/robotsStore.ts` — `hasFetched` flag; concurrent
  identical `fetchRobots` calls share one request.
- `app/src/features/dashboard/pages/DashboardPage.tsx` — skeleton only until the
  first fetch settles.
- `app/src/features/alerts/store/alertsStore.ts`,
  `app/src/features/digitaltwin/store/twinStore.ts` — in-flight dedupe.
- `app/src/api/client.ts` — 429 is retried with back-off (honours
  `Retry-After`); concurrent 401s share one refresh; a failed refresh drops the
  tokens only when the server rejected the refresh token (401/403).
- `app/src/features/auth/store/authStore.ts` — `refreshSession`/`initialize` log
  out only on an auth rejection, not on 429/5xx/network errors.

### Server

- `server/src/app.ts` + `server/src/middleware/authRateLimit.ts` — the strict
  limiter counts only credential endpoints (login, register, forgot/reset/change
  password); `/me`, `/refresh`, `/logout`, MFA status stay under the general API
  limiter (MFA routes keep their own limiters).

## Acceptance Criteria

- [x] One dashboard load with an empty fleet sends each of `/robots`,
      `/alerts/active`, `/digital-twins` at most once (vitest counts requests).
- [x] `authLimiter` 429s the 6th login within a minute but never `/auth/me`,
      `/auth/refresh` or `/auth/logout` (vitest).
- [x] A 429 on an API request is retried after back-off instead of failing; a
      429 on `/auth/refresh` does not clear the tokens (vitest).
- [x] typecheck + unit tests green; CI green.

## Test Strategy

Vitest: dashboard request-count test with msw, client 429/refresh tests,
server supertest for the auth limiter scoping. Production-mode check in k3d when
feasible.

## Notes
