---
id: TASK-160
aliases:
- TASK-160
title: 'Multi-tenancy: super-admin role + tenant switcher + onboarding wizard'
slug: multi-tenancy-super-admin-role-tenant-switcher-onboarding-wizard
status: backlog
priority: 3
owner: ''
projects: []
customers: []
tags:
- extended
sprint: ''
depends_on:
- TASK-159
due_date: ''
created: 2026-04-12
updated: 2026-04-12
---


# Multi-tenancy: super-admin role + tenant switcher + onboarding wizard

## Description

TASK-155 shipped the Organizations UI but left three operator-level gaps: (1) there's no super-admin role, so any authenticated user under `AUTH_DISABLED=true` can reach `/organizations`; (2) there's no way to view another tenant's data as a support action — you're pinned to your own tenant for the session; (3) creating a new organization is a two-field modal with no follow-up to seed an admin user, invite first employee, or add starter robots, so every demo needs manual SQL post-create.

This task closes those gaps so the multi-tenancy story is production-ready, not just demo-ready.

## Current State

- Auth: `AuthUser = { id, email, name, role, tenantId }` in `server/src/middleware/auth.middleware.ts`. Roles today are `'admin' | 'operator' | 'viewer'` — no `super-admin`.
- `AUTH_DISABLED=true` mock user (dev): `{ role: 'admin', tenantId: 'default' }` in the same file.
- `/api/tenants/*` routes at `server/src/routes/tenants.routes.ts` are mounted with `authMiddleware` only — no role check.
- TopBar badge at `app/src/components/layout/TenantBadge.tsx` is read-only (no dropdown).
- Organizations page at `app/src/features/organizations/pages/OrganizationsPage.tsx` has a bare "Create organization" modal — no follow-up steps.

## Scope

### 1. Super-admin role

**Server:**
- Add `'super-admin'` to the `UserRole` union across `AuthUser`, `AuthService`, Prisma `User.role` default enum values
- New `superAdminOnly` middleware in `server/src/middleware/auth.middleware.ts` (alongside `adminOnly`, `operatorOrAdmin`)
- Gate `/api/tenants/*` with `superAdminOnly` except `GET /api/tenants/current` (every tenant user should see their own tenant)
- `MOCK_USER` under `AUTH_DISABLED=true` gets `role: 'super-admin'` so dev flows still work
- Seeder for the first super-admin in `server/src/database/seedTenant.ts` when `MULTI_TENANCY_ENABLED=true` and no super-admin exists

**Frontend:**
- `useAuth().user.role === 'super-admin'` guard on the Organizations sidebar entry (alongside the `multiTenancyEnabled` feature gate)
- Gracefully hide the page for non-super-admins even if they navigate directly

### 2. Tenant switcher (super-admin impersonation)

**Server:**
- New `POST /api/tenants/:id/impersonate` endpoint — super-admin only. Returns a short-lived JWT with `tenantId = :id` and the original user's `id/email/name/role`. Must log an audit entry to `ComplianceLog` (tamper-evident audit per EU AI Act Art. 12).
- `DELETE /api/tenants/impersonate` — revoke the impersonation, restore original token

**Frontend:**
- Upgrade `TenantBadge` to a dropdown showing the current tenant + a list of other tenants (super-admin only). Clicking an entry calls `POST /impersonate`, replaces the access token in `tokenStorage`, reloads the page so all Zustand stores hydrate with the new tenant context
- A "Stop impersonating" banner pinned below the TopBar while `impersonating === true`
- Store impersonation state in `authStore.ts`: `{ originalUser, impersonatedTenantId }`

### 3. Onboarding wizard

Replace the two-field create modal with a multi-step wizard:

**Step 1 — Basics:** name + slug (current fields)

**Step 2 — First admin user:** email + name + temporary password (or magic-link email if a real SMTP provider is wired up; for now, just create a user scoped to the new tenant and return credentials inline for the operator to hand off)

**Step 3 — Starter resources (optional):**
- Clone 1-N robot templates (pick from a list, copies robots from DEFAULT into the new tenant as belonging-to that tenant)
- Optional: copy a starter dataset

**Step 4 — Review + Create:** confirm, submit, show success with copy-ready login URL

All steps server-side use a single transaction: `prisma.$transaction(async (tx) => { ... })` so a failure at step 3 rolls back step 2. The step-1 flow from TASK-155 stays available via a "Quick create" link at the bottom of step 1 for operators who don't need the extras.

## Key Files to Modify

- `server/src/middleware/auth.middleware.ts` — new role + middleware
- `server/src/services/AuthService.ts` — impersonation token issuance
- `server/src/routes/tenants.routes.ts` — super-admin gate + impersonate endpoints + multi-step create
- `server/src/services/TenantService.ts` — onboarding transaction
- `server/src/database/seedTenant.ts` — super-admin seeder
- `app/src/features/organizations/components/OnboardingWizard.tsx` (new) — multi-step form
- `app/src/features/organizations/components/TenantSwitcher.tsx` (new) — dropdown + impersonation
- `app/src/components/layout/TenantBadge.tsx` — wraps the switcher
- `app/src/features/auth/store/authStore.ts` — impersonation state
- `app/src/components/layout/Sidebar.tsx` — add role-based filter alongside `requiresFeature`
- `docs/multi-tenancy.md` — update §7 "Current limitations" and add a new §Super-admin section

## Test Strategy

- Unit: new middleware rejects non-super-admin requests with 403
- Integration: impersonation issues a new JWT with correct `tenantId`, audit log entry is written, impersonated queries scope correctly, `DELETE /impersonate` restores the original token
- Integration: onboarding wizard failure at step 3 rolls back steps 1+2
- Playwright: super-admin opens Organizations, clicks "Switch to Acme Robotics", dashboard shows Acme data, clicks "Stop impersonating", returns to DEFAULT view
- Security: regular tenant user cannot hit `/api/tenants/:id/impersonate` (403)

## Dependencies

- TASK-155 (merged) — foundation
- TASK-159 — test suite should exist so impersonation tests can extend it

## Notes

- Impersonation is a privileged operation and **must** be audited. Use the existing `ComplianceLog` pipeline (`server/src/services/ComplianceLogService.ts`) — each impersonation = one log entry with `{ actor, tenantId, reason }`.
- Consider a "reason" field on the impersonation modal so operators record why they're accessing another tenant's data (GDPR-friendly, matches real SaaS patterns).
- A "stop impersonating" banner is non-negotiable — it's far too easy to forget you're in someone else's context and accidentally modify their data.
