---
id: TASK-163
aliases:
- TASK-163
title: Team management page + direct add-user flow (no email)
slug: team-management-page-direct-add-user-flow-no-email
status: done
priority: 2
owner: ''
projects: []
customers: []
tags:
- core
sprint: ''
depends_on:
- TASK-162
due_date: ''
created: 2026-04-12
updated: 2026-08-29
---


# Team management page + direct add-user flow (no email)

## Description

Give tenant owners a self-service way to add teammates to their organization without touching SQLite. This is the tenant-level user management layer that's missing from Wave 2 — the Organizations page creates tenants but has no way to populate them. Design decision: **no email sending in this task**. Owners generate a temporary password in the UI and hand it to the new user out-of-band (Slack, Signal, in person). First login forces a password change (wired up in TASK-164).

Login already auto-routes by email thanks to Wave 1 (email is globally unique on `User`, `/login` does an email-only lookup), so a newly-added user can sign in immediately with just their email + temp password — they never see or type a tenant name.

## Current State

- `User` model scoped by the Prisma isolation extension (Wave 1). `GET prisma.user.findMany()` inside a tenant request already auto-filters by `tenantId`.
- `User.forcePasswordChange: Boolean @default(true)` exists at `schema.prisma:311` but nothing reads it today. TASK-164 wires it through.
- `AuthService` at `server/src/services/AuthService.ts` already has `register()` which bcrypt-hashes passwords and creates User rows, and `createRefreshToken()`. We can reuse the hash step but skip the rest (no email verification, no refresh token issuance at add-time).
- `ComplianceLogService` at `server/src/services/ComplianceLogService.ts` has `logAccess({ sessionId, robotId, operatorId, payload, severity })`. Wire each add/role-change/deactivate through it for the EU AI Act audit trail.
- No existing `TeamService`, `team.routes.ts`, or `features/team/` on the frontend. Clean slate.
- Sidebar has an Admin group gated on `multiTenancyEnabled` (from Wave 2). Adding a second item there is straightforward.

## Implementation Plan

### 1. Server — `TeamService`

New file: `server/src/services/TeamService.ts`.

Responsibilities:
- `list(tenantId)` → returns active + inactive users for the tenant (extension auto-scopes, but pass `tenantId` explicitly for when platform admins call it)
- `add({ tenantId, name, email, role, tempPassword })` → hash password, create User with `forcePasswordChange=true`, `isActive=true`, role validated against `owner|member|viewer` (reject `super-admin`)
- `changeRole({ tenantId, userId, newRole, actorId })` → enforces last-owner rule (query `count WHERE tenantId AND role='owner' AND isActive=true`; if the target is the only owner AND newRole !== 'owner' → throw `LastOwnerError`)
- `deactivate({ tenantId, userId, actorId })` → sets `isActive=false`; same last-owner rule (can't deactivate the only owner)
- `generateTempPassword()` → 12-char crypto-random, mix of letters/numbers/symbols, readable (no ambiguous chars like `0Ol1I`)

Errors:
- `LastOwnerError extends Error` — 409 in the route layer
- `EmailTakenError extends Error` — 409, email is globally unique (reuse existing `User.email @unique` constraint → catch Prisma P2002 and rethrow as this type)
- `InvalidRoleError extends Error` — 400 when role is `super-admin` or anything outside the union

Every successful mutation calls `complianceLogService.logAccess(...)` with action descriptions like `team.add`, `team.change_role`, `team.deactivate`, plus `before`/`after` payloads.

### 2. Server — routes

New file: `server/src/routes/team.routes.ts`.

All routes require `authMiddleware + ownerOnly` from TASK-162.

| Method | Path | Body | Behaviour |
|---|---|---|---|
| `GET` | `/api/team` | — | List members of caller's tenant (active + inactive, sort active first) |
| `POST` | `/api/team` | `{ name, email, role, tempPassword? }` | Add a user. If `tempPassword` omitted, server generates one. Response includes the generated password **once** so the owner can copy it. |
| `PATCH` | `/api/team/:id` | `{ role?, isActive? }` | Change role or toggle active. 409 on last-owner violations. |
| `DELETE` | `/api/team/:id` | — | Alias for `PATCH { isActive: false }`. 409 on last-owner. |

Mount in `server/src/app.ts` next to `/api/tenants`:
```ts
app.use('/api/team', authMiddleware, ownerOnly, teamRoutes);
```

### 3. Frontend — feature module

New directory: `app/src/features/team/`. Mirror `features/organizations/`:

```
app/src/features/team/
├── api/teamApi.ts              # list, add, patchRole, deactivate
├── store/teamStore.ts          # Zustand: { members, loaded, loading, error, fetch, add, changeRole, deactivate }
├── types/team.types.ts         # TeamMember = pick<User, 'id'|'name'|'email'|'role'|'isActive'|'lastLoginAt'>, AddTeamMemberInput
├── components/
│   ├── TeamMemberRow.tsx       # row with inline role editor + deactivate button
│   ├── AddTeamMemberModal.tsx  # form: name, email, role select, temp password (with "generate" + "copy" buttons)
│   ├── CredentialsHandoffModal.tsx  # one-time "here are the creds, copy now" modal post-add
│   └── TeamEmptyState.tsx      # only shown if somehow 0 users (unlikely since owner is always present)
├── pages/TeamPage.tsx          # header + member list + add button
└── index.ts
```

**`AddTeamMemberModal` UX:**
- Fields: name, email, role (segmented: Owner / Member / Viewer), temp password (pre-filled with a generated suggestion)
- "Regenerate" button next to the password field
- "Copy" button on focus (since the owner will need to paste it elsewhere)
- Primary action "Add teammate" → POST → dismiss → open `CredentialsHandoffModal`

**`CredentialsHandoffModal`:**
- Big bordered section showing email + password in mono font
- Copy-all button (copies both as `email\npassword`)
- Warning banner: "This password will not be shown again. Copy it now."
- Dismiss returns to the Team page

**`TeamMemberRow`:**
- Avatar (first letter), name, email
- Role dropdown inline (saves on change)
- Last-login timestamp
- Active/deactivated badge
- Kebab menu: "Deactivate" (or "Reactivate" if inactive)

### 4. Routing + sidebar

- `app/src/routes/lazyPages.ts`: `LazyTeamPage = lazy(() => import('@/features/team').then(m => ({ default: m.TeamPage })))`
- `app/src/App.tsx`: register `/team` route under `ProtectedAppRoute`
- `app/src/components/layout/Sidebar.tsx`: add a second item to the Admin group:
  ```ts
  {
    id: 'admin',
    label: 'Admin',
    requiresFeature: 'multiTenancyEnabled',
    items: [
      { label: 'Organizations', path: '/organizations', ... },
      { label: 'Team', path: '/team', icon: <UsersIcon /> },
    ]
  }
  ```
  Note: both entries are visible to super-admins (via `MOCK_USER` in dev). A future enhancement can additionally gate the Team entry on `role === 'owner'` so non-owners don't see it in their own tenant.

## Key Files to Create / Modify

- `server/src/services/TeamService.ts` (new)
- `server/src/routes/team.routes.ts` (new)
- `server/src/app.ts` — mount `/api/team`
- `app/src/features/team/**` (new feature module)
- `app/src/routes/lazyPages.ts` — `LazyTeamPage`
- `app/src/App.tsx` — `/team` route registration
- `app/src/components/layout/Sidebar.tsx` — Team nav item

## Test Strategy (Playwright MCP)

Prereq: server running with `MULTI_TENANCY_ENABLED=true` + `AUTH_DISABLED=true`.

1. Navigate to `/team` → see self listed (MOCK_USER → "Dev Admin" as owner)
2. Click "Add teammate" → modal opens with a pre-filled temp password
3. Fill: `Alice Smith` / `alice@example.com` / role `member` → Add
4. Credentials handoff modal shows email + password → copy → dismiss
5. Back on the Team page, Alice's row is visible as `member`
6. Change Alice's role to `viewer` via the inline dropdown → refresh → persists
7. Try to change MOCK_USER's role from `owner` to `member` (note: under AUTH_DISABLED, MOCK_USER is `super-admin` per TASK-162, so this test needs a real tenant owner — or temporarily flip the mock role to test the last-owner guard)
8. Deactivate Alice → row greyed out; `GET /api/team` still shows her with `isActive: false`
9. Add a second user with a duplicate email → 409 with clear error
10. Check server logs: each mutation generates a ComplianceLog entry with actor, target, action

## Dependencies

- **TASK-162** (role model) — `ownerOnly` middleware + last-owner semantics depend on `owner` being a first-class role.
- **TASK-164** (force-change flow) — not a hard blocker, but the add-user flow only feels complete once first login forces a password change. Can merge this PR first and TASK-164 second.

## Notes

- **No email sending.** The owner is responsible for delivering credentials. Print the "copy these now" modal once and only once — don't persist the temp password in memory beyond the modal's lifecycle.
- **Temp password storage**: never write the plaintext temp password to a log, audit record, or response beyond the initial POST response. `ComplianceLogService` entries should only record that a user was added, never the credentials.
- **Server-side role validation** is critical — a malicious caller could POST `{ role: 'super-admin' }` and try to escalate. `TeamService.add()` must reject anything outside `owner|member|viewer`.
- **Self-deactivation**: for v1, just let owners deactivate themselves as long as they're not the last owner. Locking yourself out is recoverable via super-admin impersonation.
- **Pagination**: skip for v1. Real teams are small enough that a flat list renders fine until ~100 members. File a follow-up if it becomes an issue.
- **Search/filter**: skip for v1 for the same reason.
