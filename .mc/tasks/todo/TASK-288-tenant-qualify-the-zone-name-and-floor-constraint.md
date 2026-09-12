---
id: "TASK-288"
aliases: []
title: "Tenant-qualify the zone name and floor constraint"
slug: "tenant-qualify-the-zone-name-and-floor-constraint"
status: "in-progress"
priority: 3
owner: "huhn511"
projects: []
customers: []
tags: [core, server]
sprint: ""
parent: "[[TASK-281]]"
depends_on: []
spe: 2
effort: "low"
due_date: ""
created: "2026-09-12"
updated: "2026-09-12"
---

# Tenant-qualify the zone name and floor constraint

## Description

`Zone`'s `@@unique([name, floor])` is not tenant-qualified, and the duplicate pre-check that guards it is
a `findUnique` the tenant extension can only post-filter to `null`. So a second tenant creating a zone
called "Warehouse A" on floor 1 passes validation and then gets a raw 500 from the database. Add
`tenantId` to the constraint, turn the pre-check into a tenant-injected `findFirst`, and map the
remaining P2002 to a 409.

## Details

### Current state

`server/prisma/schema.prisma:501` declares `@@unique([name, floor])` on `Zone` with no `tenantId`.

`ZoneRepository.findByNameAndFloor` (`server/src/repositories/ZoneRepository.ts:112-115`) is:

```ts
findUnique({ where: { name_floor: { name, floor } } })
```

The tenant extension cannot inject a tenant filter into a compound-unique `findUnique`; it can only
post-filter the result to `null` (`server/src/database/client.ts:128-142`). So the pre-check in
`ZoneService.validateCreateInput:273` sees no duplicate, validation passes, and the insert then throws
P2002, which `server/src/routes/zone.routes.ts:167-175` turns into a bare 500.

"Warehouse A", "Dock 1" and "Charging" are default zone names, so this collides across tenants by
default rather than as an edge case.

**The rename path has the identical hole.** `ZoneService.validateUpdateInput:332` calls the same
`findByNameAndFloor`, so `PUT /api/zones/:id` carries the same defect and is in scope here.

`MULTI_TENANCY_ENABLED` defaults to false (`server/src/config/features.ts:24`), so this is latent —
but the constraint change is what makes multi-tenant zones possible at all.

### Server

1. **Schema.** `server/prisma/schema.prisma:501` — `@@unique([name, floor])` becomes
   `@@unique([tenantId, name, floor])`. `Zone` already carries `tenantId` and is already in
   `TENANT_SCOPED_MODELS` (`server/src/database/client.ts`, Wave 3d), so no allowlist change is needed.

2. **Repository.** `server/src/repositories/ZoneRepository.ts:112-115` — the compound-unique input no
   longer exists once the constraint changes, so `findByNameAndFloor` becomes
   `findFirst({ where: { name, floor } })`. The extension injects `tenantId` into `findFirst`
   (`server/src/database/client.ts:114-124`), which is the whole point: the pre-check now actually
   scopes. `cd server && npm run typecheck` finds the call sites if any were missed.

3. **Migration.** New
   `server/prisma/migrations/20260912130000_task_288_tenant_qualified_zone_unique/migration.sql`,
   Postgres DDL: `DROP INDEX "Zone_name_floor_key";` then
   `CREATE UNIQUE INDEX "Zone_tenantId_name_floor_key" ON "Zone"("tenantId", "name", "floor");`
   The old index name is in `server/prisma/migrations/20260112222424_initial_schema/migration.sql`.

   This SQL never runs locally: `server/prisma/schema.prisma:12` is `provider = "sqlite"` and
   `.github/workflows/check.yml:197` seds it to postgresql before `migrate deploy` (`:201`), followed by
   a `prisma migrate diff --exit-code` drift gate (`:209`). Local dev and the vitest suites get the
   schema via `npx prisma db push` (`.github/workflows/check.yml:69`). Hand-write the SQL to match the
   schema exactly or CI fails while local passes.

4. **Route.** `server/src/routes/zone.routes.ts:167-175` (POST) and the corresponding PUT catch: map
   P2002 through `prismaErrorToAppError` (`server/src/utils/errors.ts:300-325`) so a genuine same-tenant
   duplicate that races past the pre-check returns 409 instead of 500. Copy the shape from
   `server/src/routes/service-accounts.routes.ts:40`.

**Key files:**
- `server/prisma/schema.prisma` — `@@unique([tenantId, name, floor])` on `Zone` (`:501`)
- `server/prisma/migrations/20260912130000_task_288_tenant_qualified_zone_unique/migration.sql` — NEW
- `server/src/repositories/ZoneRepository.ts` — `findByNameAndFloor` `:112-115` becomes a scoped `findFirst`
- `server/src/routes/zone.routes.ts` — map P2002 to 409 on create (`:167-175`) and on update
- `server/src/services/ZoneService.ts` — read: `validateCreateInput:273` and `validateUpdateInput:332`,
  both callers of the pre-check
- `server/src/routes/service-accounts.routes.ts` — read: the error-mapping pattern at `:40`
- `server/src/repositories/__tests__/ZoneRepository.test.ts` — rewrite the `name_floor` expectation
  (`:133-152`)
- `server/src/database/__tests__/zone-tenant-unique.integration.test.ts` — NEW two-tenant real-extension test

## Acceptance Criteria

- [ ] `server/prisma/schema.prisma` declares `@@unique([tenantId, name, floor])` on `Zone` and no
      `@@unique([name, floor])` remains.
- [ ] `git grep -n "name_floor" server/src` returns no hits.
- [ ] Two tenants each create a `Zone` named "Warehouse A" on floor "1" through `zoneService.createZone`
      and both succeed.
- [ ] A second "Warehouse A" on floor "1" **within the same tenant** is rejected as a 400
      `ZoneValidationError` from the pre-check — never a 500.
- [ ] Renaming a zone to a name already used in the same tenant and floor via `PUT /api/zones/:id` is
      likewise rejected by `validateUpdateInput`, not by a database error.
- [ ] A P2002 that reaches the route handler returns 409 with a mapped sentence, and the response body
      contains no query text or server file path.
- [ ] `cd server && npm run typecheck && npx vitest run` passes, and `npx prisma migrate deploy`
      followed by the `migrate diff --exit-code` gate reports no drift on Postgres.

## Test Strategy

The seam is mocked at all three layers, and the repository test asserts the defect verbatim:

1. `server/src/repositories/__tests__/ZoneRepository.test.ts:133-152` asserts the exact
   `findUnique({ where: { name_floor: { ... } } })` call that must disappear. Rewrite it to assert the
   scoped `findFirst({ where: { name, floor } })`.
2. `server/src/services/__tests__/ZoneService.test.ts` mocks the whole repository module (`:17-31`,
   default `null` at `:71`, the duplicate case at `:275`), so the extension's post-filter never runs and
   the service cannot observe the bug.
3. `server/src/__tests__/zone-routes.test.ts` mocks `zoneService` outright.

**New: `server/src/database/__tests__/zone-tenant-unique.integration.test.ts`** — the test that crosses
the real boundary. Copy the temp-database bootstrap from
`server/src/database/__tests__/client.test.ts:196-231` (`mkdtempSync` +
`npx prisma db push --skip-generate --accept-data-loss`, seed Tenant A and B), but set
`process.env.DATABASE_URL = 'file:' + dbPath` before `await import('../client.js')` so the real singleton
binds the temp database (`buildPrisma` passes no `datasources`, `client.ts:78-80`). Mock
`../../config/features.js` to `{ MULTI_TENANCY_ENABLED: true, DEFAULT_TENANT_ID: 'default' }`, keep the
**real** `server/src/middleware/tenantContext.ts`, and drive tenants with
`tenantStore.run({ tenantId }, ...)`. Dynamically import `ZoneRepository` and `ZoneService` so they bind
the same client.

Cases: both tenants create "Warehouse A"/"1" successfully; a same-tenant repeat throws
`ZoneValidationError` from the pre-check; and a rename collision within one tenant is refused.

Note that neither existing tenancy suite can host this: `server/src/__tests__/multi-tenancy.integration.test.ts:43-47`
re-implements a four-model allowlist that excludes `Zone`, and `client.test.ts:52-71` re-implements a
stale copy of the allowlist plus its own copy of the extension. Both exercise the copy, never
`server/src/database/client.ts`. Also note `server/src/__tests__/setup.ts` is **inert** —
`server/vitest.config.ts` lists only `./vitest.setup.ts` in `setupFiles` and nothing imports `setup.ts` —
so do not assume a global prisma mock exists.

Run: `cd server && npm run typecheck && npx vitest run src/repositories src/services src/database`.

## Notes

This task was cut out of the original "tenant-qualify the unique constraints" slice so that neither half
sat at the size ceiling. Its sibling, **TASK-287**, owns the `Incident` and `ApprovalRequest` number
generators and their constraints. Both add a migration: if the two are in flight at once, order the
timestamps (`20260912120000` for TASK-287, `20260912130000` here) so they apply deterministically, and
whoever lands second rebases rather than editing the other's migration.

The same nullable-`tenantId` trade applies here as in TASK-287: SQL treats NULLs as distinct in a unique
index, so with `MULTI_TENANCY_ENABLED=false` the composite unique stops being enforced by the database
and the `ZoneService` pre-check becomes the only guard — which leaves a narrow concurrent-duplicate race
on single-tenant deployments. Say so in the PR body. Making `tenantId` `NOT NULL` is the alternative and
is rejected for the same reason: it would require a `Tenant` row for every insert.

Server-side only: no file under `app/` or `robot-agent/` is touched, and nothing under
`app/src/components/layout/**` or `app/src/components/docs/DocsSidebar.tsx` — the parallel session
(TASK-273 to TASK-280) owns those.
