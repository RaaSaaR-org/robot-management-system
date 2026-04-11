---
id: TASK-162
aliases:
- TASK-162
title: Unified role model (super-admin/owner/member/viewer) + /register lockdown
slug: unified-role-model-super-admin-owner-member-viewer-register-lockdown
status: backlog
priority: 2
owner: ''
projects: []
customers: []
tags:
- core
sprint: ''
depends_on: []
due_date: ''
created: 2026-04-12
updated: 2026-04-12
---


# Unified role model (super-admin/owner/member/viewer) + /register lockdown

## Description

Replace the legacy `'admin' | 'operator' | 'viewer'` role string with a new four-value union that unifies platform-level and tenant-level authorisation: `'super-admin' | 'owner' | 'member' | 'viewer'`. Also close the anonymous self-service signup hole that exists when multi-tenancy is enabled. This is a prerequisite for TASK-163 (team UI) and TASK-164 (login UX) — the team page needs first-class `owner` semantics and the last-owner-protection check relies on `owner` being a well-defined role.

Legacy roles are enforced in exactly **one** route today (`server/src/routes/contributions.routes.ts`), so the migration blast radius is tiny. Meanwhile `/api/auth/register` still creates users with `tenantId = null` from anonymous requests — that silently bypasses the whole multi-tenancy isolation story. Lock it down behind the feature flag.

## Current State

- Schema (`server/prisma/schema.prisma:303-341`): `User.role` is `String` with comment `// UserRole: 'admin' | 'operator' | 'viewer'`, default `"viewer"`. No Prisma enum type.
- Auth middleware (`server/src/middleware/auth.middleware.ts`):
  - `AuthUser.role: 'admin' | 'operator' | 'viewer'`
  - `MOCK_USER.role = 'admin'` under `AUTH_DISABLED=true`
  - Exports: `roleMiddleware`, `adminOnly`, `operatorOrAdmin`
  - Only 1 consumer: `server/src/routes/contributions.routes.ts` uses `roleMiddleware('admin')` once
- JWT claim (`server/src/services/AuthService.ts:18-26`): `TokenPayload.role: string` — Wave 1 added `tenantId` here.
- Register route (`server/src/routes/auth.routes.ts:59`): takes `{ email, password, name }`, creates user via `authService.register()` with `tenantId = null` regardless of multi-tenancy state.
- `/api/tenants/*` routes are mounted with `authMiddleware` only — no role gate. Any authenticated user can list/create/delete tenants today.

## Implementation Plan

### 1. Schema + migration

- Update `User.role` comment in `server/prisma/schema.prisma` to reflect the new union: `// UserRole: 'super-admin' | 'owner' | 'member' | 'viewer'`.
- Keep it a plain `String` (no Prisma enum — stays easy to migrate).
- New migration file `server/prisma/migrations/<timestamp>_unified_role_model/migration.sql`:
  ```sql
  -- Map legacy role values to the unified model
  UPDATE "User" SET "role" = 'owner'  WHERE "role" = 'admin';
  UPDATE "User" SET "role" = 'member' WHERE "role" = 'operator';
  -- 'viewer' stays 'viewer'
  ```
- Change the default on User.role from `"viewer"` to `"member"` (new tenant users are members by default; viewer is a deliberate downgrade).

### 2. Auth middleware rewrite

File: `server/src/middleware/auth.middleware.ts`.

- New `UserRole` type: `'super-admin' | 'owner' | 'member' | 'viewer'`.
- `AuthUser.role: UserRole`.
- `MOCK_USER.role = 'super-admin'` so dev under `AUTH_DISABLED=true` retains full access (and can reach the Organizations page gated by `superAdminOnly`).
- Rewrite `roleMiddleware(...roles)` — same shape, new types.
- New exports, ordered most→least privileged:
  ```ts
  export const superAdminOnly = roleMiddleware('super-admin');
  export const ownerOnly       = roleMiddleware('super-admin', 'owner');
  export const memberOrAbove   = roleMiddleware('super-admin', 'owner', 'member');
  export const viewerOrAbove   = roleMiddleware('super-admin', 'owner', 'member', 'viewer');
  ```
- Remove `adminOnly` and `operatorOrAdmin` exports. Search + replace the 1 call site in `contributions.routes.ts` (was `roleMiddleware('admin')`, becomes `memberOrAbove` or `ownerOnly` depending on intent — read that file to decide).

### 3. JWT + `/me` response

- `server/src/services/AuthService.ts`: `TokenPayload.role: UserRole` (stricter type). No behavioural change — the string already flows through untouched.
- `server/src/routes/auth.routes.ts:/me`: response shape gains nothing new, but verify it carries the correct `role` value after the migration.

### 4. Gate `/api/tenants/*` with super-admin

File: `server/src/app.ts` (mount lines near `/api/settings`).

- Current: `app.use('/api/tenants', authMiddleware, tenantsRoutes);`
- New: split the routes so `GET /tenants/current` is reachable by any authenticated user, but list/create/delete require super-admin.
  - Option A (simpler): add `superAdminOnly` to the top-level mount for everything except `/current`, and inside `tenants.routes.ts` short-circuit `/current` before the role check. Express-native way: mount `/current` as its own sub-router first.
  - Option B (cleaner): inline `superAdminOnly` on each route in `tenants.routes.ts` except the `GET /current` handler.
- Go with Option B — keeps the routing flat and obvious to future readers.

### 5. `/register` lockdown

File: `server/src/routes/auth.routes.ts` (around line 59).

Inside the register handler, add an early check:

```ts
import { MULTI_TENANCY_ENABLED } from '../config/features.js';

if (MULTI_TENANCY_ENABLED) {
  return res.status(403).json({
    error: 'Signup is invite-only. Ask your organization owner to add you.',
  });
}
```

Rationale: when multi-tenancy is on, the only supported signup path is TASK-163's direct-add-user flow. Anonymous self-service would create unscoped `tenantId = null` users and bypass isolation. When the flag is off, existing single-tenant deployments keep working unchanged.

### 6. Docs

Update `docs/multi-tenancy.md` §7 "Current limitations":
- Remove "No role-based access on `/organizations`" (now gated).
- Add "Signup is invite-only when `MULTI_TENANCY_ENABLED=true` — new users are added via the Team page (TASK-163), not `/api/auth/register`."
- Add a brief role table: super-admin / owner / member / viewer and what each can do.

## Key Files to Modify

| File | Change |
|---|---|
| `server/prisma/schema.prisma` | Update `User.role` default + comment |
| `server/prisma/migrations/<timestamp>_unified_role_model/migration.sql` (new) | Map legacy values |
| `server/src/middleware/auth.middleware.ts` | New `UserRole` union, new middleware exports, remove legacy |
| `server/src/services/AuthService.ts` | Stricter `TokenPayload.role` type |
| `server/src/routes/auth.routes.ts` | `/register` lockdown when flag is on |
| `server/src/routes/tenants.routes.ts` | Add `superAdminOnly` to list/create/delete; leave `/current` unguarded |
| `server/src/app.ts` | No change if option B taken (routes self-gate) |
| `server/src/routes/contributions.routes.ts` | Update the 1 existing `roleMiddleware('admin')` call |
| `docs/multi-tenancy.md` | §7 update + role table |

## Test Strategy

- `npm run typecheck` clean in `server/` + `app/` (frontend imports `UserRole` via `/me` response types — expect some minor updates)
- Start server with `MULTI_TENANCY_ENABLED=true` + `AUTH_DISABLED=true` — `MOCK_USER.role === 'super-admin'` — navigate to `/organizations`, still works
- `POST /api/auth/register { email, password, name }` — assert 403 with the expected error message when flag is on
- `POST /api/auth/register { email, password, name }` — assert 201 when flag is off (existing behaviour preserved)
- Flip `MOCK_USER.role` to `'owner'` temporarily → confirm `/api/tenants` list returns 403 (super-admin-only) but `/api/tenants/current` still returns 200
- Confirm existing DB rows migrate: after `prisma db push` on the existing SQLite dev DB, run the UPDATE statements manually, verify `SELECT DISTINCT role FROM User` shows only `super-admin | owner | member | viewer`

## Dependencies

None. This is the prereq for TASK-163 and TASK-164.

## Notes

- **Do not** delete the legacy role values from the running DB without the UPDATE migration. If the migration runs before legacy rows are mapped, JWT issuance will succeed but middleware will fail authorisation and lock users out.
- A super-admin always has `tenantId = null`. The team-add flow in TASK-163 is explicitly prohibited from creating `super-admin` users — that stays a seeder-only + TASK-160-impersonation concern.
- Consider filing a follow-up to add a real Prisma enum instead of a string for `User.role`. The migration is trivial (`provider = "sqlite"` doesn't support enums natively but PostgreSQL does) and it would give us compile-time safety. Skip for now to keep this task small.
