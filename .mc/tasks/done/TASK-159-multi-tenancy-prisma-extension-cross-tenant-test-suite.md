---
id: TASK-159
aliases:
- TASK-159
title: 'Multi-tenancy: Prisma extension + cross-tenant test suite'
slug: multi-tenancy-prisma-extension-cross-tenant-test-suite
status: done
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


# Multi-tenancy: Prisma extension + cross-tenant test suite

## Description

Row-level multi-tenancy (TASK-155) is security-critical: a silent regression in the Prisma `$extends` extension at `server/src/database/client.ts` would expose one customer's data to another. There are **zero automated tests** for it today — verification was Playwright-driven smoke tests against a seeded dev DB. This task adds the unit + integration coverage that must exist before we onboard a second real customer or enable the flag in production.

## Current State

- Extension code: `server/src/database/client.ts` (buildPrisma, `TENANT_SCOPED_MODELS` allowlist, per-operation handlers for `findMany`, `findUnique*`, `create`, `createMany`, `upsert`, `update`, `delete`, `updateMany`, `deleteMany`)
- Tenant context: `server/src/middleware/tenantContext.ts` (`tenantStore` ALS, `getTenantId`, `runAsPlatform`, `PLATFORM_TENANT` sentinel)
- Test infra: existing Vitest setup in `server/src/services/__tests__/` (see `MFAService.test.ts` for style). No tests currently cover `database/` or `middleware/tenantContext.ts`.

## Scope

### Unit tests — extension behaviour per operation

Create `server/src/database/__tests__/client.test.ts`. For each pilot model (`User`, `Robot`, `Dataset`, `TrainingJob`) and each operation, assert:

- **`findMany`** — injects `where.tenantId = <current>` when inside a tenant scope; pass-through when `getTenantId()` returns `undefined`
- **`findFirst[OrThrow]`, `count`, `aggregate`, `groupBy`** — same injection behaviour
- **`findUnique[OrThrow]`** — post-filters the result; returns `null` / throws `TenantNotFound` on mismatch
- **`create`** — stamps `data.tenantId` automatically
- **`createMany`** — stamps all rows
- **`upsert`** — scopes `where.tenantId` AND stamps `create.tenantId`
- **`update`, `delete`** — `findUnique` ownership check rejects cross-tenant mutations; proceeds on match
- **`updateMany`, `deleteMany`** — scopes `where.tenantId`
- **Non-allowlisted model** (e.g. `Alert` pre-Wave 3) — extension is a passthrough
- **`runAsPlatform`** — `getTenantId()` returns `undefined`, extension does nothing; explicit `where.tenantId` filters are respected

Mock `getTenantId` and use an in-memory SQLite test DB (Vitest + temp file, wipe between tests).

### Integration tests — cross-tenant isolation end-to-end

Create `server/src/__tests__/multi-tenancy.integration.test.ts`. Spin up a real Express app + SQLite DB, seed two tenants (`tenantA`, `tenantB`) with 2 users + 2 robots each, then:

1. As `userA` in `tenantA`, `GET /api/robots` — assert response contains only `tenantA` robots (2 items)
2. As `userA`, `GET /api/robots/:id` for a `tenantB` robot — assert 404
3. As `userA`, `PATCH /api/robots/:id` targeting a `tenantB` robot — assert 404 or 403, verify DB row unchanged
4. As `userA`, `DELETE /api/robots/:id` targeting a `tenantB` robot — assert 404, verify row still exists
5. As `userA`, `POST /api/robots` — assert created row has `tenantId = 'tenantA'`
6. As `userA`, `GET /api/tenants/current` — assert returns `tenantA`
7. As `userA`, `GET /api/tenants` — assert returns both tenants (platform admin view is intentionally cross-tenant)
8. As `userA`, `DELETE /api/tenants/:id` for DEFAULT — assert 400 (system-protected)
9. As `userA`, `DELETE /api/tenants/:id` for a non-empty tenant — assert 409 with counts

Also assert the **disabled path**: set `MULTI_TENANCY_ENABLED=false`, run the same requests, confirm behaviour is identical to pre-multi-tenancy NeoDEM (no filtering, single-tenant).

### Security tests — the malicious-input surface

- Caller passes `where: { tenantId: 'other-tenant' }` explicitly → extension should override with caller's tenant, not respect the input
- Caller passes `data: { tenantId: 'other-tenant' }` on create → extension should override with caller's tenant
- Caller passes `AND` / `OR` combinators trying to sneak cross-tenant predicates — verify injection survives

## Key Files to Create

- `server/src/database/__tests__/client.test.ts` — unit tests
- `server/src/middleware/__tests__/tenantContext.test.ts` — ALS + `runAsPlatform` tests
- `server/src/__tests__/multi-tenancy.integration.test.ts` — E2E with real Express + SQLite
- `server/vitest.config.ts` — include new test globs if needed

## Test Strategy (for this task itself)

1. `npm test` passes with the new suite
2. Mutation testing: break the extension (e.g. remove `tenantId` injection from `findMany`) — assert the unit tests catch it
3. Mutation testing: break the ownership guard on `update` — assert the integration test catches cross-tenant mutation
4. Coverage report shows `client.ts` and `tenantContext.ts` at >90%

## Dependencies

- TASK-155 (merged) — foundation under test

## Notes

- This is a blocker for "production enable" and for onboarding a second real customer. Prioritise accordingly.
- Once this lands, the test suite becomes a forcing function for TASK-158 (Wave 3 model expansion) — each new model added to `TENANT_SCOPED_MODELS` should get matching test cases.
- See `docs/multi-tenancy.md` §5 (per-operation table) and §6 (`runAsPlatform`) for the behaviour specification the tests verify.
