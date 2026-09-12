---
id: "TASK-286"
aliases: []
title: "Record tenant ownership for sensor scans, motion clips and VLA sessions"
slug: "record-tenant-ownership-for-sensor-scans-motion-clips-and-vla-sessions"
status: "done"
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

# Record tenant ownership for sensor scans, motion clips and VLA sessions

## Description

Three models hold some of the most sensitive data the platform stores — raw LiDAR sweeps of customer
buildings, captured motion clips, and the natural-language prompts operators gave their robots — and
none of them has a `tenantId` column at all. They cannot be closed by an allowlist entry the way the
digital-twin models can; the column has to exist first. Add `tenantId` to `SensorScan`, `MotionClip`
and `VlaSession`, wire the FK and indexes, add them to the tenant allowlist, and backfill existing
rows — with the `SensorScan` backfill batched, because it is the one table in this set that grows
per LiDAR frame.

## Details

### Current state

Confirmed by reading `server/prisma/schema.prisma` on 2026-09-12: none of the three models declares a
`tenantId` field or a `tenant` relation.

- **`SensorScan`** (`server/prisma/schema.prisma:75`) — one row per captured point cloud. Carries
  `robotId`, `sensorType` (`'lidar' | 'depth_camera'`), the object-storage triple
  (`storageBackend`/`storageBucket`/`storageKey`), an axis-aligned bounding box, the robot's world pose
  at capture, and `capturedAt`. It has `robot Robot @relation(fields: [robotId], references: [id], onDelete: Cascade)`
  and indexes `[robotId, capturedAt]`, `[capturedAt]`, `[sessionId, frameIndex]`.
  `sessionId` is a plain FK to `ScanSession` with **no** Prisma relation (the schema comment at `:96`
  says "plain FK, no relation to stay additive"), so scans do not cascade with their session.
- **`MotionClip`** (`server/prisma/schema.prisma:121`) — `name`, `source`, `robotType`, `fps`,
  `frameCount`, and a `frames` column holding the whole clip as JSON. It has **no relation to anything**
  — not even to a robot — so today there is no column anywhere on the row that says who owns it. Index:
  `[createdAt]`.
- **`VlaSession`** (`server/prisma/schema.prisma:2860`) — `robotId`, `prompt`, `serverUrl`, `status`,
  `startedAt`/`stoppedAt`. Relation `robot Robot @relation(... onDelete: Cascade)`. Indexes `[robotId]`,
  `[startedAt]`. The `prompt` column is the operator's own words.

Access paths that are unscoped as a result:

- `server/src/repositories/SensorScanRepository.ts` — `create:113`, `listBySession:152`, `findById:160`,
  `listByRobot:165`, `listAll:174`, `delete:182`. `listAll()` is a bare `findMany` across every tenant.
- `server/src/repositories/MotionClipRepository.ts` — `create:121`, `listAll:147`, `findById:157`,
  `delete:168`.
- `VlaSession` has **no repository**. It is queried directly through the extended `prisma` singleton at
  eight sites: `server/src/routes/vla-session.routes.ts:30` (create), `:54` (findFirst), `:66` (update),
  `:90` (findMany), `:110` (findFirst); and `server/src/routes/robot.routes.ts:622` (create), `:658`
  (findFirst), `:663` (update). Mounted at `server/src/app.ts:388` behind `authMiddleware`.

Because all three go through the extended `prisma` client, adding them to `TENANT_SCOPED_MODELS` is
sufficient to scope every one of those call sites — including the eight raw `prisma.vlaSession` ones —
with no per-route change.

`MULTI_TENANCY_ENABLED` defaults to false (`server/src/config/features.ts:24`), so this is latent. The
cost of deferring is that ownership is not being *recorded* now, and it cannot be reconstructed later:
a `MotionClip` has no robot, no user and no session to infer an owner from.

### Server

**1. Schema.** Add to each of the three models, matching the shape used by `PatrolRoute`
(`server/prisma/schema.prisma`, the `tenantId`/`tenant` pair inside that model):

```prisma
  tenantId String?
  tenant   Tenant? @relation(fields: [tenantId], references: [id])
```

**Declare the full relation, not a bare column.** The repo contains both patterns — `PatrolRoute`,
`PatrolRun`, `PatrolFinding`, `TourRoute` and `TourRun` carry the relation and a matching back-relation
on `Tenant`, while `EpisodeReward`, `DatasetEpisodeFlag`, `InterventionEpisode` and `DigitalTwin` carry
only `tenantId String?`. Use the relation form: the migration adds a real
`ADD CONSTRAINT ..._fkey` either way (see step 2), so the relation-less models are drift between what
Prisma believes and what the database enforces, not a pattern worth copying. Add the matching
back-relations to the `Tenant` model beside the existing grouped blocks, following their comment style
(`// Relations (TASK-212 patrol)` and similar):

```prisma
  // Relations (TASK-286 perception & VLA)
  sensorScans SensorScan[]
  motionClips MotionClip[]
  vlaSessions VlaSession[]
```

Add a composite index per model, mirroring the existing sort column so list queries stay covered:
`@@index([tenantId, capturedAt])` on `SensorScan`, `@@index([tenantId, createdAt])` on `MotionClip`,
`@@index([tenantId, startedAt])` on `VlaSession`.

**2. Migration.** New directory
`server/prisma/migrations/20260912140000_task_286_tenant_scope_perception/migration.sql`. Copy the DDL
shape from `server/prisma/migrations/20260412130000_task_158_wave_3bcd_remaining_models/migration.sql`,
which is the house pattern for exactly this change — a header comment explaining that the column is
nullable so single-tenant deployments keep working, then per model:

```sql
ALTER TABLE "SensorScan" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "SensorScan_tenantId_capturedAt_idx" ON "SensorScan"("tenantId", "capturedAt");
ALTER TABLE "SensorScan"
    ADD CONSTRAINT "SensorScan_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
```

and the same for `MotionClip` (`createdAt`) and `VlaSession` (`startedAt`).

This SQL is **Postgres DDL and never runs locally**. `server/prisma/schema.prisma:12` is
`provider = "sqlite"`; `.github/workflows/check.yml:197` seds it to postgresql before
`npx prisma migrate deploy` (`:201`) and then runs a `prisma migrate diff --exit-code` drift gate at
`:209`. Local dev and both vitest suites get the schema through `npx prisma db push`
(`.github/workflows/check.yml:69`), which ignores the migration entirely. So the migration must be
written by hand to match the schema exactly, or the drift gate fails in CI while everything passes
locally.

**3. Allowlist.** Add `'SensorScan'`, `'MotionClip'` and `'VlaSession'` to `TENANT_SCOPED_MODELS` in
`server/src/database/client.ts`, with a `// TASK-286 perception & VLA` wave comment matching the
existing style at `:62-70`.

**4. Backfill — batched for `SensorScan`.** `server/src/database/seedTenant.ts:40-41` defines a
`backfill()` helper that runs one unbounded
`updateMany({ where: { tenantId: null }, data: { tenantId: DEFAULT_TENANT_ID } })` per model, and
`seedDefaultTenant()` runs on **every boot** from `server/src/index.ts:58`.

`MotionClip` and `VlaSession` can use that helper unchanged — add them to the `Promise.all` at `:43-72`
and to the `labels` array at `:74-82`.

`SensorScan` must **not**. It holds one row per LiDAR frame of every sweep ever captured, so on a
production database an unbounded `updateMany` inside the boot path is a single statement over
potentially millions of rows, taking a write lock and stalling startup. Add a separate paged helper in
the same file:

```ts
async function backfillPaged(
  model: { findMany: (a: unknown) => Promise<{ id: string }[]>; updateMany: (a: unknown) => Promise<{ count: number }> },
  pageSize = 5_000,
): Promise<{ count: number }> { /* loop findMany(select id, take pageSize, where tenantId null) → updateMany(where id in) until empty */ }
```

Prisma's `updateMany` takes no `take`, which is why the page is selected first by id. Log progress per
page through `logger.info` so a long backfill is visible rather than looking like a hung boot. Add a
scope line to the file's header comment block (`server/src/database/seedTenant.ts:12-18`), which lists
every wave.

**Note for sizing, not for the AC:** `server/prisma/dev.db` currently holds **0** rows in all three
tables (and 2 `DigitalTwin`, 6 `SimScene`), so the backfill is trivial locally and the batching is a
production and correctness argument, not something a local run will exercise. Write the paged test
against a seeded fixture rather than expecting dev data to cover it.

**Key files:**
- `server/prisma/schema.prisma` — `tenantId`/`tenant` on `SensorScan` (`:75`), `MotionClip` (`:121`),
  `VlaSession` (`:2860`); three back-relations on `Tenant`; three composite indexes
- `server/prisma/migrations/20260912140000_task_286_tenant_scope_perception/migration.sql` — NEW,
  Postgres DDL
- `server/src/database/client.ts` — three allowlist entries
- `server/src/database/seedTenant.ts` — `MotionClip`/`VlaSession` backfill, paged `SensorScan` backfill,
  header scope line
- `server/src/repositories/SensorScanRepository.ts` — read: the six query methods that become scoped
- `server/src/repositories/MotionClipRepository.ts` — read: the four query methods that become scoped
- `server/src/routes/vla-session.routes.ts` — read: five raw `prisma.vlaSession` call sites
- `server/src/routes/robot.routes.ts` — read: three raw `prisma.vlaSession` call sites (`:622`, `:658`,
  `:663`)
- `server/src/database/__tests__/tenantAllowlist.test.ts` — the DMMF ratchet; its expected set grows to 33
- `server/src/database/__tests__/client.test.ts` — add isolation cases for the three models
- `docs/multi-tenancy.md` — wave list

## Acceptance Criteria

- [ ] `SensorScan`, `MotionClip` and `VlaSession` each declare `tenantId String?` and
      `tenant Tenant? @relation(fields: [tenantId], references: [id])`, and `Tenant` declares the three
      matching back-relations.
- [ ] Each of the three has a composite index on `tenantId` plus its existing sort column
      (`capturedAt`, `createdAt`, `startedAt` respectively).
- [ ] All three appear in `TENANT_SCOPED_MODELS` in `server/src/database/client.ts`.
- [ ] `npx prisma migrate deploy` against Postgres followed by the
      `prisma migrate diff --exit-code` gate (`.github/workflows/check.yml:209`) reports no drift.
- [ ] Against the temp SQLite database in `client.test.ts`, a `SensorScan`, `MotionClip` and
      `VlaSession` row owned by tenant B is absent from tenant A's `findMany`, returns null from
      `findUnique`, and a cross-tenant `update` or `delete` throws `[tenant-isolation]`.
- [ ] `GET /api/robots/:robotId/vla-sessions` returns only the calling tenant's sessions, asserted
      through the route rather than the repository — it is the path with no repository layer.
- [ ] The `SensorScan` backfill is paged: a test seeding more rows than one page (use a page size of 10
      in the test) stamps every row and issues more than one `updateMany`.
- [ ] `seedDefaultTenant` stamps pre-existing null-tenant rows in all three tables and its log names
      them.
- [ ] `server/src/database/__tests__/tenantAllowlist.test.ts` passes with the DMMF-derived set at 33
      models, and still fails if any one of the three is removed from the allowlist.
- [ ] `cd server && npm run typecheck && npx vitest run` passes.

## Test Strategy

**There is no test that mocks this seam, because there is no test for these models at all.** That
absence is the finding, and it must be stated rather than papered over:

- `server/src/repositories/__tests__/` holds 21 files and contains **no** `SensorScanRepository` or
  `MotionClipRepository` test.
- `server/src/services/__tests__/SensorScanService.test.ts` and `ScanSessionService.test.ts:36-38` mock
  `SensorScanRepository` wholesale, so no Prisma call — and therefore no tenant extension — ever runs.
- `VlaSession` has no repository and no route test; `server/src/__tests__/` contains a
  `sensorscan-routes.test.ts` but nothing for `vla-session.routes.ts`.

What to add:

1. **Extension-level isolation cases in `server/src/database/__tests__/client.test.ts`.** That file
   already builds a real temp SQLite database (`mkdtempSync` + `npx prisma db push`) and seeds raw rows
   via helpers like `seedZoneRaw`. Add the same for the three models next to the existing Wave-3d cases
   (`:889-929`). Note this file currently pastes its own stale copy of the allowlist at `:52-72`;
   TASK-285 replaces that with an import of the real export. If TASK-285 has not landed, import the
   export here as part of this task rather than extending the copy — extending the copy is what let the
   original defect survive.

2. **A route-level test for VLA sessions**, `server/src/__tests__/vla-session-routes.test.ts`. This is
   the only one of the three whose queries live in a route file, so a repository test cannot cover it.
   Drive `GET /api/robots/:robotId/vla-sessions` under two tenant scopes with the real extension and
   assert each sees only its own rows. Copy the two-tenant harness from
   `server/src/__tests__/multi-tenancy.integration.test.ts` — but import `TENANT_SCOPED_MODELS` rather
   than its pasted 4-entry copy at `:43-48`, which excludes all three of these models.

3. **A paged-backfill test** for `seedTenant.ts`: seed more null-tenant `SensorScan` rows than one page,
   run `seedDefaultTenant()` with `MULTI_TENANCY_ENABLED=true`, and assert every row is stamped and that
   `updateMany` was called more than once. Note that `server/src/__tests__/setup.ts` is **inert** —
   `server/vitest.config.ts` lists only `./vitest.setup.ts` in `setupFiles` and no test imports
   `setup.ts` — so do not assume a global prisma mock exists; mock prisma in the test file itself,
   following `server/src/repositories/__tests__/SimulationJobRepository.test.ts:18-40`.

Run: `cd server && npm run typecheck && npx vitest run`, plus `npx prisma validate`.

## Notes

**Back-relation decision, settled.** Declare the full `tenant Tenant?` relation. Both patterns exist in
the repo and the bare-column one is more recent, but the migration adds a real FK constraint in either
case, so the bare-column models are simply out of step with their own database. If a reviewer prefers
the bare-column form for consistency with `DigitalTwin`, the cost of switching is one line per model
and no migration change — but say which was chosen and why in the PR body, rather than leaving it
implicit.

**Why this is separate from TASK-285.** TASK-285 closes the allowlist gap for models that already have
the column (`DigitalTwin`, `ScanSession`, `SimScene`) and adds a DMMF-derived test asserting that every
model *with* a `tenantId` is scoped. That test is silent about models that lack the column, which is
exactly this task. After this task lands, the DMMF set grows from 30 to 33 and the allowlist must grow
with it; TASK-285's test is the ratchet that enforces it. Either order works — if this task lands
first, TASK-285's expected count is 33 from the start.

`ScanSession` cascades to nothing here: `SensorScan.sessionId` is a plain FK with no Prisma relation
(`server/prisma/schema.prisma:96`), which is also why deleting a twin strands its scans — that is the
twin-deletion defect, owned by the TASK-281 ship-or-delete spike, not by this task.

Server-side only. No file under `app/` is touched, and nothing under
`app/src/components/layout/**` or `app/src/components/docs/DocsSidebar.tsx` — the parallel session
(TASK-273 to TASK-280) owns those.
