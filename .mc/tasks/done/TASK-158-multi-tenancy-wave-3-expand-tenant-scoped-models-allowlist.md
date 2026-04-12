---
id: TASK-158
aliases:
- TASK-158
title: 'Multi-tenancy Wave 3: expand TENANT_SCOPED_MODELS allowlist'
slug: multi-tenancy-wave-3-expand-tenant-scoped-models-allowlist
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


# Multi-tenancy Wave 3: expand TENANT_SCOPED_MODELS allowlist

## Description

Extend row-level multi-tenancy (TASK-155) to the remaining top-level entities so the Organizations UI stat tiles reflect real isolation across the whole product, not just the four Wave 1 pilot models. Without this, cards on `/organizations` show per-tenant counts for `User/Robot/Dataset/TrainingJob` but leak global counts for everything else — a real customer demo will expose the gap within minutes.

**Do this in small, independently-shippable waves** (one PR per 2-4 models) so each migration can be reviewed and rolled back without blocking the others. Same pattern as Wave 1/2.

## Current State

Wave 1 foundation shipped in PR #122 (commit `07e0747`). Wave 2 UI + `runAsPlatform` escape hatch shipped in PR #124 (commit `027747a`). Allowlist lives at `server/src/database/client.ts` as `TENANT_SCOPED_MODELS = new Set(['User', 'Robot', 'Dataset', 'TrainingJob'])`.

## Target Models (grouped by wave)

Ordered by impact on the demo story:

**Wave 3a — Operations visibility (highest demo value) — PR #131:**
- `Alert` (11 queries — full CRUD in AlertRepository)
- `Incident` (17 queries — full CRUD + stats in IncidentRepository)
- `RobotTask` (18 queries — full CRUD + stats in RobotTaskRepository)
- ~~`RobotCommand`~~ — **SKIP**: only 1 Prisma query (GDPR export). Commands go via HTTP to robot agents, not persisted via Prisma.

**Wave 3b — Automations & workflows:**
- `ProcessDefinition` (10 queries — full CRUD in ProcessRepository)
- `ProcessInstance` (8 queries — full CRUD in ProcessRepository)
- `ApprovalRequest` (17 queries — full CRUD in ApprovalRepository)
- `Event` (9 queries — audit log in EventRepository)

**Wave 3c — VLA lifecycle:**
- `ModelVersion` (9 queries — VLA lifecycle in VLARepository)
- `Deployment` (9 queries — VLA lifecycle in VLARepository)
- `SimulationJob` (5 queries — CRUD in SimulationJobRepository)
- `SyntheticJob` (18 queries — full CRUD + pagination in SyntheticDataService)

**Wave 3d — Conversations / misc:**
- ~~`Fleet`~~ — **SKIP**: model does not exist in schema.prisma. "Fleet" is a route-level concept only (safety, oversight). No `model Fleet` to scope.
- `Zone` (10 queries — full CRUD in ZoneRepository)
- `Conversation` (8 queries — CRUD in ConversationRepository)
- `Message` — **OPTIONAL**: only 2 queries, always accessed through parent `Conversation` FK. Implicitly isolated if `Conversation` is scoped.

**Wave 3e — Service accounts (new, from TASK-165):**
- `ApiToken` (8 queries in ServiceAccountService) — auth middleware queries by prefix without tenant filter, potential cross-tenant token leak. Must scope or use `runAsPlatform` for the auth lookup.

## Implementation Recipe (per model)

Follow the template from `docs/multi-tenancy.md` §5:

1. **Schema** — add nullable `tenantId String?` + `tenant Tenant? @relation(fields: [tenantId], references: [id])` + composite index `@@index([tenantId, <time-col>])`
2. **Tenant model** — add the back-reference to `Tenant` (e.g. `alerts Alert[]`)
3. **Migration SQL** — new file under `server/prisma/migrations/`; copy the shape of `20260411232000_task_155_multi_tenancy_wave_1/migration.sql`:
   - `ALTER TABLE "X" ADD COLUMN "tenantId" TEXT;`
   - `CREATE INDEX ...`
   - `ADD CONSTRAINT ... FOREIGN KEY ... ON DELETE SET NULL`
4. **Allowlist** — add the model name to `TENANT_SCOPED_MODELS` in `server/src/database/client.ts`
5. **Seeder backfill** — extend `server/src/database/seedTenant.ts` with an additional `updateMany WHERE tenantId IS NULL` call wrapped in the existing `Promise.all`

## Key Files to Modify

- `server/prisma/schema.prisma` — per-model field + back-reference + index
- `server/prisma/migrations/<new-timestamp>_wave_3<wave>_<models>/migration.sql`
- `server/src/database/client.ts` — `TENANT_SCOPED_MODELS` set
- `server/src/database/seedTenant.ts` — backfill loop
- `docs/multi-tenancy.md` — update §7 "Current limitations" to reflect what's now scoped

## Test Strategy

Per model, per wave:
1. `npm run typecheck` in `server/` clean after schema change
2. `npx prisma db push` (local SQLite) — migration applies cleanly
3. Restart server with `MULTI_TENANCY_ENABLED=true` — seeder logs the backfill count
4. Create a second tenant via `/organizations` UI, then manually insert a row into the new model scoped to it via `sqlite3`
5. Confirm `GET /api/<model>` returns only the caller's rows; direct SQL confirms both exist
6. `./scripts/test-all.sh --skip-e2e` passes with flag ON and OFF

## Dependencies

- TASK-155 (merged) — foundation
- TASK-159 — test coverage should land before or alongside this so regressions are caught

## Notes

- **Do not** add all models to the allowlist at once. Each wave is independently reviewable and any one of them can reveal a model with custom Prisma middleware, raw SQL, or transactional patterns that need special handling.
- **Cross-model relations** (e.g. `Alert` has an `Incident[]` relation) — the extension handles these automatically as long as both ends are in the allowlist. If only one end is scoped, cross-tenant data can leak via Prisma `include`.
- Use `runAsPlatform` (from `server/src/middleware/tenantContext.ts`) for any operator-level aggregation query that needs cross-tenant reads — see `TenantService.countsFor()` for the canonical example.
- **ApiToken** (TASK-165) — `authenticateServiceToken()` in `ServiceAccountService.ts` does `prisma.apiToken.findMany({ where: { prefix } })` which is a cross-tenant lookup by design (auth must find the token regardless of tenant). This should use `runAsPlatform` or stay unscoped. Other ApiToken queries (list, create, revoke) go through tenant-scoped User FK but could still benefit from explicit scoping.

## Model Usage Audit (2026-04-12)

Prisma query counts per model (excluding tests, node_modules):

| Model | Queries | Status |
|-------|---------|--------|
| Alert | 11 | Active — full CRUD |
| Incident | 17 | Active — full CRUD + stats |
| RobotTask | 18 | Active — full CRUD + stats |
| RobotCommand | **1** | **Dead** — GDPR export only |
| ProcessDefinition | 10 | Active — full CRUD |
| ProcessInstance | 8 | Active — full CRUD |
| ApprovalRequest | 17 | Active — full CRUD |
| Event | 9 | Active — audit log |
| ModelVersion | 9 | Active — VLA lifecycle |
| Deployment | 9 | Active — VLA lifecycle |
| SimulationJob | 5 | Active — CRUD |
| SyntheticJob | 18 | Active — full CRUD + pagination |
| Fleet | **0** | **Dead** — no Prisma queries, route-level concept only |
| Zone | 10 | Active — full CRUD |
| Conversation | 8 | Active — CRUD |
| Message | 2 | Light — always via parent Conversation |
| ApiToken | 8 | Active — service account auth + CRUD (TASK-165) |

## Cleanup TODO (separate from this task)

- **`Fleet`** — listed in the original task but `model Fleet` does not exist in schema.prisma. The concept is route-level only. Remove from any future wave plans.
- **`RobotCommand`** — only used in GDPR export. Evaluate whether commands should be persisted at all (currently sent via HTTP to robot agents, not stored).
