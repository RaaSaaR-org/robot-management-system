---
id: "TASK-369"
aliases: []
title: "Anonymous self-signup is closed with auth on and a duplicate robot registration answers 409"
slug: "anonymous-self-signup-is-closed-with-auth-on-and-a-duplicate"
status: "in-progress"
priority: 2
owner: "huhn511"
projects: []
customers: []
tags: ["core", "compliance"]
sprint: ""
parent: ""
depends_on: []
spe: 3
effort: "low"
due_date: ""
created: "2026-10-12"
updated: "2026-10-12"
---

# Anonymous self-signup is closed with auth on and a duplicate robot registration answers 409

## Description

Two server findings from the k3d tenant test. (1) With auth on and
`MULTI_TENANCY_ENABLED` off, `POST /api/auth/register` is open to anyone — an
anonymous visitor can create an account. (2) Registering a robot that is already
registered (for example by another tenant) answers a bare 500, because the
Prisma unique-constraint violation (P2002) is flattened to a plain `Error`.

## Details

**Current state:** `server/src/routes/auth.routes.ts` refuses `/register` only
under multi-tenancy (TASK-162). `RobotManager.registerRobot`
(`server/src/services/RobotManager.ts`) catches every failure and rethrows it
through `rethrowRobotCallError`, which turns a Prisma `P2002` from
`robotRepository.upsertWithRegistration` (robot id / agent-card name unique)
into `Error('Failed to register robot: ...')`; `server/src/routes/robot.routes.ts`
then answers 500. The app learns server config from the public
`GET /api/config/features` (`server/src/config/features.ts` `getFeatureFlags`,
read by `app/src/shared/hooks/useFeatures.ts`).

### Server
- `server/src/config/features.ts`: `selfRegistrationEnabled()` — false under
  multi-tenancy, true with `AUTH_DISABLED=true` (dev), otherwise
  `ALLOW_SELF_REGISTRATION=true` (default false). Exposed in `getFeatureFlags()`.
- `server/src/routes/auth.routes.ts`: `/register` answers 403
  `{ code: 'SELF_REGISTRATION_DISABLED' }` when it is off. Admin user creation
  (Team page, organization onboarding) uses other endpoints and is unaffected.
- `server/src/services/RobotManager.ts`: a P2002 during registration becomes a
  `ConflictError` with a sentence that names nothing of the existing robot.
- `server/src/routes/robot.routes.ts`: the last-resort branch goes through
  `sendFailure`, so an `AppError` keeps its status (409) and anything else stays
  a generic 500.

### Frontend
- `app/src/shared/hooks/useFeatures.ts`: `selfRegistrationEnabled` flag.
- `app/src/features/auth/pages/RegisterPage.tsx`: "Sign-up is disabled — ask
  your administrator" state once flags report it off.
- `app/src/features/auth/pages/LoginPage.tsx`: the "Create one" link follows the flag.

### Docs
- `server/.env.example`, `docs/deployment.md`, `docs/api.md`.

## Acceptance Criteria
- [x] With auth on and no opt-in, `POST /api/auth/register` answers 403 `SELF_REGISTRATION_DISABLED` and creates nothing
- [x] `ALLOW_SELF_REGISTRATION=true` reopens it; `AUTH_DISABLED=true` keeps it open; multi-tenancy keeps it closed
- [x] `GET /api/config/features` reports `selfRegistrationEnabled`; the register page shows a disabled state and the login page hides the sign-up link
- [x] A duplicate robot registration answers 409 with a sentence that leaks no detail of the existing robot; other failures stay a generic 500
- [x] The env var is documented in `server/.env.example` and `docs/deployment.md`

## Test Strategy
- `server/src/routes/__tests__/auth-register-gate.test.ts` — the three env cases.
- `server/src/services/__tests__/RobotManager.test.ts` — P2002 → `ConflictError`.
- `server/src/__tests__/robot-routes.test.ts` — 409 passthrough, generic 500.
- `app/src/features/auth/__tests__/RegisterPage.test.tsx` — disabled state vs form.

## Notes
