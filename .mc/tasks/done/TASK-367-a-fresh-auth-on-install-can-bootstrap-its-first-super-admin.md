---
id: "TASK-367"
aliases: ["TASK-367"]
title: "A fresh auth-on install can bootstrap its first super-admin"
slug: "a-fresh-auth-on-install-can-bootstrap-its-first-super-admin"
status: "done"
priority: 2
owner: "claude"
projects: []
customers: []
tags: ["core", "multi-tenancy", "ops", "testing"]
sprint: ""
parent: ""
depends_on: []
spe: 3
effort: "medium"
due_date: ""
created: "2026-10-12"
updated: "2026-10-12"
---

# A fresh auth-on install can bootstrap its first super-admin

## Description

With `AUTH_DISABLED=false`, a fresh install has no way to create the first
super-admin, so no tenant can be onboarded and the demo seed Job fails with
401. Add an environment-driven bootstrap, plus an opt-in k3d stage that runs
the production chart with auth and multi-tenancy on.

## Details

**Current state**

- Nothing in the product creates a `super-admin` once auth is on.
  `POST /api/auth/register` creates a tenant-less `viewer` (403 under
  multi-tenancy). The Team page adds users to the caller's own tenant only.
  `/api/tenants/*` (onboard included) is `superAdminOnly`. The only
  `super-admin` row ever written is the `dev-user-id` mock under
  `AUTH_DISABLED=true` (`server/src/database/index.ts`).
- Measured on k3d (production chart, auth on): the demo seed
  (`deployments/neoDEM/files/demo-seed.mjs`) stops with
  `GET /api/tenants → HTTP 401`. It could only proceed after a super-admin row
  was inserted into Postgres by hand and its JWT passed as
  `NEODEM_SERVICE_TOKEN`. Service-account tokens cannot help here: they max
  out at `member` and belong to a tenant.
- `scripts/e2e-k3d/values-k3d.yaml` runs `AUTH_DISABLED=true`, and the chart has
  no value for `MULTI_TENANCY_ENABLED`, so no E2E has ever covered login,
  onboarding or isolation.

**Server**

- `server/src/database/bootstrapSuperAdmin.ts`, called at startup:
  `BOOTSTRAP_ADMIN_EMAIL` + `BOOTSTRAP_ADMIN_PASSWORD` (+ optional `_NAME`)
  create a tenant-less `super-admin` if no account has that email. It never
  resets a password and never promotes an existing account. A set but unusable
  configuration throws, so the rollout fails. Skipped under `AUTH_DISABLED=true`.
- Documented in `docs/multi-tenancy.md` §8 and `server/.env.example`.

**E2E**

- `scripts/e2e-k3d/tenant-test.sh` (opt-in via `E2E_TENANT=1` in `run.sh`, ~35 s):
  `kubectl set env` switches the server to auth + multi-tenancy + bootstrap
  admin, and an EXIT trap switches it back. Checks: anonymous 401, admin
  sign-in, two onboarded owners each in their own tenant with
  `forcePasswordChange`, 409 on a repeated slug, the password change clears the
  flag, tenant B gets 404 on tenant A's robot (GET/telemetry/command/delete),
  and an anonymous WebSocket gets no events.

**Key files**

- `server/src/database/bootstrapSuperAdmin.ts`, `server/src/index.ts`
- `server/src/database/__tests__/bootstrapSuperAdmin.test.ts`
- `scripts/e2e-k3d/tenant-test.sh`, `scripts/e2e-k3d/run.sh`, `scripts/e2e-k3d/README.md`
- `docs/multi-tenancy.md`, `server/.env.example`

## Acceptance Criteria

- [x] With the two variables set and auth on, the server creates one
      super-admin at boot; restarts change nothing.
- [x] An existing account with that email is neither reset nor promoted.
- [x] A half or invalid configuration stops the server from starting.
- [x] `E2E_TENANT=1 scripts/e2e-k3d/run.sh` runs the auth + tenant checks, and
      restores the server afterwards.

## Test Strategy

- Unit: `bootstrapSuperAdmin.test.ts` (8 cases).
- k3d: `tenant-test.sh` passed all six checks in 35 s, run against an image
  with TASK-365 and TASK-366 merged in. Its owner-tenant, robot and WebSocket
  checks fail on a server without those two fixes, which is what they are for.

## Notes

- The production chart (`deployments/neoDEM`) needs the variables wired in:
  `MULTI_TENANCY_ENABLED`, `BOOTSTRAP_ADMIN_*` from the release Secret, and a
  demo seed that signs in as that admin. Tracked outside this repo.
