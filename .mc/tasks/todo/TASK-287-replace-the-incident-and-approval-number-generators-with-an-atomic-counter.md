---
id: "TASK-287"
aliases: []
title: "Replace the incident and approval number generators with an atomic counter"
slug: "replace-the-incident-and-approval-number-generators-with-an-atomic-counter"
status: "in-progress"
priority: 3
owner: "huhn511"
projects: []
customers: []
tags: [core, server, compliance]
sprint: ""
parent: "[[TASK-281]]"
depends_on: []
spe: 5
effort: "medium"
due_date: ""
created: "2026-09-12"
updated: "2026-09-12"
---

# Replace the incident and approval number generators with an atomic counter

## Description

Incident and approval numbers are computed by reading the current maximum with a string `orderBy` and
adding one, against a column that is globally unique. That fails two ways: under multi-tenancy a second
tenant recomputes a number the first already holds and gets a 500 that never resolves, and — today,
with multi-tenancy off — the lexicographic ordering means every incident after the 1000th in a year
collides forever. Replace both generators with an atomic, self-seeding per-tenant counter and
tenant-qualify the unique constraints.

## Details

### Current state

`IncidentRepository.generateIncidentNumber` (`server/src/repositories/IncidentRepository.ts:121-139`)
does:

```ts
findFirst({ where: { incidentNumber: { startsWith: `INC-${year}-` } }, orderBy: { incidentNumber: 'desc' } })  // :128-130
```

then parses the tail and pads to 3 digits (`:139`). `generateRequestNumber` is the same shape at
`server/src/repositories/ApprovalRepository.ts:223-240` — ordering at `:229`, parse at `:235`, pad to
**5** digits at `:239`.

**Failure 1 — multi-tenancy.** The Prisma extension injects `tenantId` into every `findFirst`
(`server/src/database/client.ts:114-124`), but the column is globally unique:
`incidentNumber String @unique` (`server/prisma/schema.prisma:1175`) and
`requestNumber String @unique` (`:1386`). So tenant B scans only its own rows, computes `INC-2026-001`,
and `prisma.incident.create` (`IncidentRepository.ts:226`) raises P2002. `server/src/routes/incident.routes.ts:234-237`
turns that into a bare 500 — and it never resolves, because the number tenant B computes never advances.

**Failure 2 — lexicographic rollover, and this one bites today.** `orderBy: 'desc'` on a `String` sorts
lexicographically. Once `INC-2026-1000` exists, `INC-2026-999` still sorts highest, so incident 1001
recomputes `INC-2026-1000` and collides forever. Incidents pad to 3 digits (`IncidentRepository.ts:139`)
so the wall is the 1000th incident in a year; approvals pad to 5 (`ApprovalRepository.ts:239`) so the
same wall sits at 100 000 and is not a practical concern. **This failure is independent of
`MULTI_TENANCY_ENABLED`**, which defaults to false (`server/src/config/features.ts:24`) — it is a live
defect on every single-tenant deployment.

### Server

**1. Allocator.** Add to `server/prisma/schema.prisma`:

```prisma
model NumberSequence {
  scope     String   // 'incident' | 'approval'
  tenantKey String   // tenantId, or 'default' outside any tenant scope
  year      Int
  value     Int      @default(0)
  updatedAt DateTime @updatedAt

  @@id([scope, tenantKey, year])
}
```

The compound `@@id` avoids a uuid column. **Do not** add `NumberSequence` to `TENANT_SCOPED_MODELS`
(`server/src/database/client.ts:33-71`) — it has no `tenantId` column and the extension would try to
stamp one.

New `server/src/repositories/NumberSequenceRepository.ts` exporting
`allocateNumber(scope: 'incident' | 'approval'): Promise<{ year: number; value: number }>`:

- `tenantKey = getTenantId() ?? 'default'`, imported from `../middleware/tenantContext.js`
  (`server/src/repositories/UserRepository.ts:140` already imports `runAsPlatform` from there).
- Inside `prisma.$transaction` (interactive-transaction pattern:
  `server/src/repositories/RobotRepository.ts:242`), `upsert` on
  `{ where: { scope_tenantKey_year: { scope, tenantKey, year } }, update: { value: { increment: 1 } }, create: { scope, tenantKey, year, value: seed } }`.
- `seed` is computed **only on the create path**: read that tenant-and-year's existing numbers and take a
  **numeric** max plus 1, so a pre-existing database resumes from where it was instead of restarting at
  1 — and the lexicographic bug dies at the seed too, because the max is numeric.

**2. Generators.** `IncidentRepository.ts:121-139` becomes
`INC-${year}-${String(value).padStart(3, '0')}`; `ApprovalRepository.ts:223-240` the same with pad 5.
The rendered format is unchanged below rollover, and the 1000th incident now renders `INC-2026-1000`
rather than colliding.

**3. Constraints.** In `server/prisma/schema.prisma`:

- `Incident` — drop `@unique` from `incidentNumber` (`:1175`), add `@@unique([tenantId, incidentNumber])`.
- `ApprovalRequest` — drop `@unique` from `requestNumber` (`:1386`), add `@@unique([tenantId, requestNumber])`.
- `Robot` — `@@unique([tenantId, serialNumber])` (`:24`). No call sites reference the single-field
  unique, so this is free to fix while the migration is open.

Prisma then removes the single-field unique inputs, so two lookups must become tenant-injected
`findFirst`: `IncidentRepository.ts:156-159` and `ApprovalRepository.ts:269-273`.
`cd server && npm run typecheck` finds any site missed.

**4. Migration.** New
`server/prisma/migrations/20260912120000_task_287_atomic_number_sequences/migration.sql`, Postgres DDL
only: `CREATE TABLE "NumberSequence"`, then for each constraint `DROP INDEX` the old unique and
`CREATE UNIQUE INDEX` the tenant-qualified one. The old index names are in
`server/prisma/migrations/20260112222424_initial_schema/migration.sql` —
`Incident_incidentNumber_key` (`:1067`), `ApprovalRequest_requestNumber_key` (`:1145`), and
`Robot_serialNumber_key`. No data backfill: the allocator self-seeds on first use.

This SQL never runs locally. `server/prisma/schema.prisma:12` is `provider = "sqlite"`;
`.github/workflows/check.yml:197` seds it to postgresql before `migrate deploy` (`:201`) and then runs
a `prisma migrate diff --exit-code` drift gate (`:209`). Local dev and both vitest suites get the schema
through `npx prisma db push` (`.github/workflows/check.yml:69`). So hand-write the SQL to match the
schema exactly, or CI fails while everything passes locally.

**5. Route.** `server/src/routes/incident.routes.ts:234-237` currently answers a bare 500 on the P2002.
Map it through `prismaErrorToAppError` (`server/src/utils/errors.ts:300-325`) so a genuine duplicate
returns 409 rather than 500 — copy the shape from `server/src/routes/service-accounts.routes.ts:40`.

**Key files:**
- `server/prisma/schema.prisma` — `NumberSequence` model; tenant-qualified uniques on `Incident`
  (`:1175`), `ApprovalRequest` (`:1386`), `Robot` (`:24`)
- `server/prisma/migrations/20260912120000_task_287_atomic_number_sequences/migration.sql` — NEW
- `server/src/repositories/NumberSequenceRepository.ts` — NEW: atomic self-seeding allocator
- `server/src/repositories/IncidentRepository.ts` — generator `:121-139`, `findByNumber` `:156-159`
- `server/src/repositories/ApprovalRepository.ts` — generator `:223-240`, `findByRequestNumber` `:269-273`
- `server/src/routes/incident.routes.ts` — map P2002 to 409 (`:234-237`)
- `server/src/routes/service-accounts.routes.ts` — read: the error-mapping pattern at `:40`
- `server/src/repositories/RobotRepository.ts` — read: interactive `$transaction` pattern at `:242`
- `server/src/repositories/__tests__/IncidentRepository.test.ts` — replace the generator assertions
- `server/src/repositories/__tests__/ApprovalRepository.test.ts` — replace the generator assertions
- `server/src/database/__tests__/tenant-numbering.integration.test.ts` — NEW two-tenant real-extension test

## Acceptance Criteria

- [ ] In the new two-tenant test, tenant A and tenant B each create an incident through the real
      `IncidentRepository` and both receive `INC-<year>-001`, with no P2002 raised.
- [ ] With `INC-<year>-1000` already present for a tenant, the next allocation for that tenant returns
      `INC-<year>-1001`, asserted against a real database rather than a mocked prisma.
- [ ] An allocator run against a database that already holds incidents but no `NumberSequence` row
      continues from the existing numeric maximum instead of restarting at `001`.
- [ ] Approval numbers behave identically at pad 5 — two tenants both get `APR-<year>-00001`.
- [ ] `NumberSequence` is absent from `TENANT_SCOPED_MODELS` in `server/src/database/client.ts`.
- [ ] No `findUnique` keyed on `incidentNumber` or `requestNumber` remains anywhere in `server/src`.
- [ ] A duplicate incident number returns 409, not 500, from `server/src/routes/incident.routes.ts`.
- [ ] `cd server && npm run typecheck && npx vitest run` passes, and `npx prisma migrate deploy`
      followed by the `migrate diff --exit-code` gate reports no drift on Postgres.

## Test Strategy

The tests that mock the broken seam **assert the defect itself**, which is why it survived:

1. `server/src/repositories/__tests__/IncidentRepository.test.ts:164-190` —
   `describe('generateIncidentNumber')`, with prisma mocked at `:24-54`
   (`vi.mock('../../database/index.js')`). It asserts `orderBy: { incidentNumber: 'desc' }` verbatim at
   `:174` and the 3-digit pad at `:180-189`. Replace with assertions over the `NumberSequence` upsert and
   the numeric seed path.
2. `server/src/repositories/__tests__/ApprovalRepository.test.ts:482-506` — same shape, mock at `:27-45`,
   asserts `orderBy: { requestNumber: 'desc' }` at `:502`. Same replacement.

Neither existing tenancy test can host the replacement as written:
`server/src/__tests__/multi-tenancy.integration.test.ts:43-47` re-implements a four-model allowlist that
**excludes** `Incident` and `ApprovalRequest`, and `server/src/database/__tests__/client.test.ts:52-71`
re-implements a stale 19-entry copy plus its own copy of the extension (`:75-190`). Both exercise the
copy, never `server/src/database/client.ts`.

**New: `server/src/database/__tests__/tenant-numbering.integration.test.ts`.** Copy the `beforeAll` from
`client.test.ts:196-231` (`mkdtempSync`, `npx prisma db push --skip-generate --accept-data-loss`, seed
Tenant A and B) and the `beforeEach` raw-`deleteMany` reset (`:238-271`). But instead of
`buildTestPrisma()`, set `process.env.DATABASE_URL = 'file:' + dbPath` **before**
`await import('../client.js')` so the real singleton binds the temp database (`buildPrisma` passes no
`datasources`, `client.ts:78-80`). Add
`vi.mock('../../config/features.js', () => ({ MULTI_TENANCY_ENABLED: true, DEFAULT_TENANT_ID: 'default' }))`
and keep the **real** `server/src/middleware/tenantContext.ts`, driving tenants with
`tenantStore.run({ tenantId }, ...)`. Dynamically import `IncidentRepository` and `ApprovalRepository`
so they bind that same client.

Cases: both tenants get `INC-<year>-001` and `APR-<year>-00001`; a raw-seeded `INC-<year>-1000` yields
`1001`; an existing-incidents-no-sequence-row database resumes from the numeric max; and outside any
`tenantStore.run` scope numbering still advances under `tenantKey` `'default'`.

`server/vitest.config.ts` already includes `src/**/*.test.ts` with a 30 s timeout, and CI runs the suite
with `DATABASE_URL: file:./ci-test.db` (`.github/workflows/check.yml:44`).

Note: `server/src/__tests__/setup.ts` contains a global `vi.mock('../database/client.js')` prisma stub
but is **inert** — `server/vitest.config.ts` lists only `./vitest.setup.ts` in `setupFiles` and no test
imports `setup.ts`. Do not extend it or assume it applies; mock prisma per test file, following
`server/src/repositories/__tests__/SimulationJobRepository.test.ts:18-40`.

## Notes

**A deliberate trade that belongs in the PR body.** `tenantId` is nullable, and SQL treats NULLs as
distinct in a unique index on both engines. So with `MULTI_TENANCY_ENABLED=false` — the default — the
composite uniques stop being enforced by the database, and the allocator becomes the only guard against
a duplicate number. That is acceptable because the allocator is atomic where the old max-scan was not,
but it is a real reduction in database-level enforcement and a reviewer must be told. Making `tenantId`
`NOT NULL` is the alternative and is rejected here: it would require a `Tenant` row to exist for every
insert and risks P2003 on every single-tenant deployment.

`ModelVersion @@unique([skillId, version])` (`server/prisma/schema.prisma:2509`) is the same defect
class, since `SkillDefinition` is not tenant-scoped. Left out on purpose — it forces changes at
`server/src/repositories/VLARepository.ts:1146` and its test at `:953`. File a follow-up.

Deliberately unchanged: `User.email` stays globally unique
(`server/src/repositories/UserRepository.ts:135-145` — login resolves a user before their tenant is
known). `ApiToken`, `RobotTask`, `EpisodeReward` and `DatasetEpisodeFlag` uniques are already FK-scoped.
`AgentCard.name` (`server/prisma/schema.prisma:428`) is global but `AgentCard` is not in the allowlist —
leave it to TASK-285.

The `Zone @@unique([name, floor])` half of this defect was cut into **TASK-288** to keep this task under
the size ceiling. If both are in flight, order the two migration timestamps so they apply
deterministically.

CLAUDE.md's claim that "the Prisma schema uses `provider = \"postgresql\"` for production" is stale —
`server/prisma/schema.prisma:12` is `sqlite` and CI seds it. Worth correcting in a docs pass, not here.

Server-side only: no file under `app/` or `robot-agent/` is touched, and nothing under
`app/src/components/layout/**` — the parallel session (TASK-273 to TASK-280) owns those.
