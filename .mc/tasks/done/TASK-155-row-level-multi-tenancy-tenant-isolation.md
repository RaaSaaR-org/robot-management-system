---
id: TASK-155
aliases:
- TASK-155
title: 'Row-Level Multi-Tenancy (Tenant Isolation)'
slug: row-level-multi-tenancy-tenant-isolation
status: done
priority: 2
owner: ''
projects: []
customers: []
sprint: ''
tags:
- core
depends_on: []
due_date: ''
created: '2026-04-09'
---

## Status: Done (2026-04-12)

Shipped in two PRs merged to `main`:

- **Wave 1** — #122 (commit `07e0747`): server-side foundation. `MULTI_TENANCY_ENABLED` feature flag, `Tenant` Prisma model, `$extends` client extension, AsyncLocalStorage tenant context, JWT `tenantId` claim, DEFAULT tenant seeder + backfill, `/api/config/features` public endpoint, frontend `useFeatures()` hook.
- **Wave 2** — #124 (commit `027747a`): demo-quality UI + operator escape hatch. `features/organizations/` feature module (list/create/delete cards + modal + empty state), TopBar `TenantBadge`, sidebar `requiresFeature` gating (first feature-gated nav group), `/api/tenants` CRUD, `TenantService`, `runAsPlatform` escape hatch for cross-tenant queries, `/api/tenants/current`, error-message pass-through fix, full docs at `docs/multi-tenancy.md`, README + CLAUDE mentions.

**Pilot-wave model coverage**: `User`, `Robot`, `Dataset`, `TrainingJob` are in `TENANT_SCOPED_MODELS` and filter correctly end-to-end (verified via Playwright — a newly created "Acme Robotics" tenant shows `0/0/0/0` counts alongside DEFAULT's real data).

**Follow-up work intentionally deferred to separate tasks**:
1. Wave 3 model expansion — extend `TENANT_SCOPED_MODELS` to Alert, Incident, Process, ApprovalRequest, ModelVersion, Deployment, etc. (each model = one PR)
2. Tenant isolation test suite — Prisma extension unit tests + cross-tenant integration tests (security-critical)
3. Super-admin role + tenant switcher + onboarding wizard
4. Per-tenant branding — logo upload, colours, `settings` JSON editor

See `docs/multi-tenancy.md` for architecture, configuration, developer guide, and `runAsPlatform` usage.

---

## Description (original)

Add **optional** row-level multi-tenancy so the platform can serve multiple customers from a single deployment. The feature is controlled by `MULTI_TENANCY_ENABLED` (default `false`). When off, the system behaves exactly like today — zero overhead, no tenant filtering. When on, each customer (tenant) gets isolated data — robots, datasets, training jobs, models, users — while sharing the same database and infrastructure.

This follows the same optional-infrastructure pattern used by NATS and RustFS: log a warning at startup when disabled, skip all tenant logic, and work as single-tenant.

## Current State

- `User` model already has a nullable `tenantId: String?` field (unused, no FK)
- `DataContribution` service has an `organizationId` param (isolated pattern, not enforced)
- 85 Prisma models, none scoped by tenant
- Auth middleware (`server/src/middleware/`) does not extract or enforce tenant context
- No Tenant/Organization model exists in the schema
- Frontend has no tenant switcher or org-aware UI
- Existing pattern: NATS (`NATS_ENABLED`), RustFS (`RUSTFS_ENABLED`) — feature flags that gracefully disable subsystems

## Implementation Plan

### Phase 1: Schema + Feature Flag + Middleware

1. **Feature flag** (`server/src/config/`):
   - `MULTI_TENANCY_ENABLED=true|false` (default `false`)
   - On startup: log `Multi-tenancy: enabled` or `Multi-tenancy: disabled (single-tenant mode)`
   - All tenant logic is gated behind this flag

2. **Create `Tenant` model** in `server/prisma/schema.prisma`:
   - `id`, `name`, `slug` (unique), `logoUrl?`, `plan?`, `settings` (JSON), `createdAt`, `updatedAt`
   - Add `tenant` relation + `tenantId` FK to `User` (keep nullable — null = single-tenant mode)
   - Add nullable `tenantId` FK to all top-level entities: `Robot`, `Fleet`, `Zone`, `Dataset`, `TrainingJob`, `Model`, `Alert`, `Incident`, `Process`, `Approval`, etc.
   - Migration seeds a `DEFAULT` tenant and backfills existing rows

3. **Prisma middleware** (`server/src/database/tenantMiddleware.ts`):
   - **When enabled**: auto-inject `where: { tenantId }` on all queries, auto-set `tenantId` on creates
   - **When disabled**: middleware is a no-op passthrough (zero overhead)
   - Extract tenant from request context (set by auth middleware)

4. **Auth middleware update** (`server/src/middleware/auth.ts`):
   - **When enabled**: decode `tenantId` from JWT claims, attach `req.tenantId`, reject cross-tenant access
   - **When disabled**: `req.tenantId` is `undefined`, no tenant validation

### Phase 2: Systematic Model Migration

- Add nullable `tenantId` column to all 85 models (nullable so single-tenant mode works without it)
- Backfill existing data with `DEFAULT` tenant ID
- Add composite indexes on `(tenantId, ...)` for common query patterns
- Update all repository files in `server/src/repositories/` to use tenant context (only when enabled)

### Phase 3: Frontend Tenant Awareness

- **Feature gate**: check server config endpoint to know if multi-tenancy is on
- **When off**: no tenant UI, no switcher — identical to current experience
- **When on**:
  - Tenant switcher in sidebar/header (for super-admins managing multiple customers)
  - Tenant context in auth store (`app/src/features/auth/`)
  - Login flow: after auth, resolve tenant from user or show picker if multi-tenant user
  - Branding: optional per-tenant logo/colors from `Tenant.settings`

### Phase 4: Super-Admin & Onboarding

- Admin API to create/manage tenants (`/api/tenants`) — only available when enabled
- Tenant onboarding wizard (create tenant → invite first user → assign robots)
- Cross-tenant dashboard for platform operator (you)

## Key Design Decisions

- **Optional by default**: `MULTI_TENANCY_ENABLED=false` — zero impact on existing single-tenant deployments
- **Naming**: use "Tenant" internally, "Organization" in UI
- **Users can belong to one tenant** (simplest; multi-tenant users deferred)
- **Robots are tenant-exclusive** (no sharing across tenants)
- **Super-admin role**: platform operator can access all tenants
- **Nullable tenantId**: all `tenantId` columns stay nullable so single-tenant mode needs no tenant data
- **Same pattern as NATS/RustFS**: feature flag → startup log → graceful no-op when disabled

## Key Files to Modify

- `server/prisma/schema.prisma` — add Tenant model, tenantId FKs
- `server/src/database/tenantMiddleware.ts` — new: Prisma tenant middleware
- `server/src/middleware/auth.ts` — extract tenantId from JWT
- `server/src/repositories/*.ts` — all 19 repos need tenant filtering
- `server/src/services/*.ts` — tenant context propagation
- `server/src/routes/*.ts` — tenant validation on 47 route files
- `app/src/features/auth/` — tenant context in auth flow
- `app/src/shared/` — tenant switcher component

## Test Strategy

- Unit tests: Prisma middleware injects tenantId on all CRUD ops
- Integration tests: user in Tenant A cannot read/write Tenant B data
- E2E: create two tenants, add robots to each, verify isolation in UI
- Security: attempt cross-tenant access via direct API calls → expect 403
