---
id: "TASK-285"
aliases: []
title: "Derive the tenant allowlist from the schema and close the twin/scan gaps"
slug: "derive-the-tenant-allowlist-from-the-schema-and-close-the-twin-scan-gaps"
status: "review"
priority: 3
owner: "huhn511"
projects: []
customers: []
tags: [core, server]
sprint: ""
parent: "[[TASK-281]]"
depends_on: []
spe: 5
effort: "medium"
due_date: ""
created: "2026-09-12"
updated: "2026-09-12"
---

# Derive the tenant allowlist from the schema and close the twin/scan gaps

## Description

The tenant-isolation Prisma extension has an allowlist that no test can check, because both tenancy
tests paste their own stale copy of it instead of importing it. As a result three models that carry a
`tenantId` column — `DigitalTwin`, `ScanSession`, `SimScene` — silently fall outside isolation: merged
point clouds of customer buildings, LiDAR sweep sessions and twin-derived sim scenes are readable and
writable across tenants. Export the allowlist, derive the expected set from Prisma's DMMF in a test
that fails on drift, add the three models, and backfill their rows so the strict filter does not hide
them.

## Details

### Current state

`TENANT_SCOPED_MODELS` is a module-local `const` at `server/src/database/client.ts:33-71` with **27**
entries, and it is **not exported**. Exporting it is step 1 of this task — nothing can assert against
it today. The extension short-circuits for anything not in the set
(`client.ts:99` — `if (!model || !TENANT_SCOPED_MODELS.has(model)) return query(args)`).

Prisma's DMMF reports **30** models carrying a `tenantId` field (of 109 total). The diff against the
allowlist is exactly three:

- `DigitalTwin` — `server/prisma/schema.prisma:186` (the model opens at `:156`)
- `ScanSession` — `server/prisma/schema.prisma:219` (model opens at `:201`)
- `SimScene` — `server/prisma/schema.prisma:1955` (model opens at `:1937`)

Nothing else is missing.

Consequences today:

- `DigitalTwinRepository.list()` (`server/src/repositories/DigitalTwinRepository.ts:72-78`) is a bare
  `findMany` over every tenant's twins.
- `POST /api/digital-twins` (`server/src/routes/twin.routes.ts:228-232`) supplies no tenantId, so
  `DigitalTwinRepository.ts:61` stores `null` — the ownership needed to retrofit a filter is not being
  recorded even now.
- `ScanSessionRepository` (`create:44`, `updateMany:85`/`:99`, `findMany:113`/`:128`/`:147`) and
  `SimSceneRepository` (`findMany:113`, `upsert:136`/`:176`) are equally unscoped.

The routes are mounted behind `authMiddleware` (`server/src/app.ts:320`, `:323`), which establishes the
AsyncLocalStorage scope via `continueWithTenant` (`server/src/middleware/auth.middleware.ts:128`), so
the extension *would* fire if the models were listed.

**Why no test catches it.** `server/src/database/__tests__/client.test.ts:52-72` pastes a 19-entry copy
of the allowlist and re-implements the whole extension (`:46-188`) against a temp SQLite database —
`client.ts` is never imported. `server/src/__tests__/multi-tenancy.integration.test.ts:43-48` pastes a
4-entry copy. So a tenant-owned model can never fail a test by drifting out of the list.

User-visible symptom with `MULTI_TENANCY_ENABLED=true` (default false,
`server/src/config/features.ts:24`): tenant B's Digital Twin page lists tenant A's scanned buildings,
and can fetch and delete them.

### Server

1. **Export the allowlist.** `server/src/database/client.ts:33` — `const TENANT_SCOPED_MODELS` becomes
   `export const`. Append `'DigitalTwin'`, `'ScanSession'`, `'SimScene'` with a wave comment matching
   the existing style (the file uses `// TASK-213 host mode`, `// TASK-217 dataset episode flags` and
   similar at `:62-70`).

   **No schema or migration change is needed.** The columns already exist in
   `server/prisma/migrations/20260412125900_create_db_push_drift_tables/migration.sql`, and these three
   models carry no `tenant Tenant?` relation — exactly like `EpisodeReward`, `DatasetEpisodeFlag` and
   `InterventionEpisode`, which are already scoped. `schema.prisma` is not edited, so the "Prisma
   migrations match schema (Postgres)" gate (`.github/workflows/check.yml:156-214`) stays untouched.

2. **Keep the filter strict; backfill instead.** Do **not** make reads null-tolerant
   (`tenantId: { in: [tenantId, null] }`) — that makes every unstamped row visible to every tenant,
   which is the leak being closed, and `update`/`delete` would still deny them (`client.ts:191`).
   Extend the boot backfill in `server/src/database/seedTenant.ts:43-72` with
   `backfill(prisma.digitalTwin)`, `backfill(prisma.scanSession)`, `backfill(prisma.simScene)`, plus
   their labels at `:74-82`. Copy the Wave-3f lines (`:69-71`) for the shape, and add a scope line to
   the file header comment block (`:12-18`), which lists every wave.

3. **Close the built-in sim-scene race.** `server/src/services/SimulationService.ts:343` fires
   `void this.seedBuiltinScenes()` at construction (module import), so it can land *after*
   `seedDefaultTenant()` (`server/src/index.ts:58`) and leave `tenantId = null` rows. A later
   `upsertBuiltin`/`upsertForTwin` inside a request scope (`SimSceneRepository.ts:136`, `:176`, called
   from `DigitalTwinService.ts:256`) then injects `where.tenantId` (`client.ts:165-171`), misses the
   null row, falls through to CREATE and hits P2002 on the unique `builtinEnvId`/`twinId`.
   Fix: add `tenantId` to `UpsertBuiltinSceneInput` and pass
   `MULTI_TENANCY_ENABLED ? DEFAULT_TENANT_ID : null` from `seedBuiltinScenes`, both imported from
   `../config/features.js`.

4. **No route change.** Once `DigitalTwin` is scoped, `client.ts:145-148` stamps the tenantId that
   `twin.routes.ts:228` omits, overriding `DigitalTwinRepository.ts:61`'s `?? null`. Fixing the route
   instead of the allowlist would leave list, findUnique and update unscoped.

5. **Docs.** Update `docs/multi-tenancy.md:107-118` (the wave list) and `:420-425`, which still claims
   "19 models are tenant-scoped" — stale by eight models before this task adds three. Record the new
   limitation: built-in sim scenes belong to the DEFAULT organization.

**Key files:**
- `server/src/database/client.ts` — export the allowlist, add the three twin models
- `server/src/database/__tests__/tenantAllowlist.test.ts` — NEW: DMMF-derived set vs the export
- `server/src/database/__tests__/client.test.ts` — drop the pasted 19-entry copy (`:52-72`), import the
  export, add twin/scan/scene cases
- `server/src/__tests__/multi-tenancy.integration.test.ts` — drop the pasted 4-entry copy (`:43-48`),
  import the export
- `server/src/database/seedTenant.ts` — backfill digitalTwin, scanSession, simScene (`:43-82`)
- `server/src/repositories/SimSceneRepository.ts` — `tenantId` on `UpsertBuiltinSceneInput`
- `server/src/services/SimulationService.ts` — stamp built-in scenes at seed time (`:343`, `:566-583`)
- `docs/multi-tenancy.md` — wave list (`:107-118`) and the stale "19 models" claim (`:420-425`)

## Acceptance Criteria

- [ ] `TENANT_SCOPED_MODELS` is exported from `server/src/database/client.ts` and contains
      `DigitalTwin`, `ScanSession` and `SimScene` — 30 entries.
- [ ] `server/src/database/__tests__/tenantAllowlist.test.ts` fails when any DMMF model carrying a
      `tenantId` field is missing from the exported set and absent from the file's commented
      `EXCEPTIONS` constant — demonstrate by temporarily deleting one entry from `client.ts`.
- [ ] `grep -n 'new Set<string>(\[' server/src/database/__tests__/client.test.ts server/src/__tests__/multi-tenancy.integration.test.ts`
      returns nothing: both suites drive the extension from the imported constant.
- [ ] Against the temp SQLite database in `client.test.ts`, a `DigitalTwin`, `ScanSession` and
      `SimScene` row owned by tenant B is absent from tenant A's `findMany`, returns null from
      `findUnique`, and a cross-tenant `update` or `delete` throws `[tenant-isolation]`.
- [ ] `seedDefaultTenant` stamps pre-existing `digitalTwin`, `scanSession` and `simScene` rows whose
      `tenantId` is null, and its backfill log names them.
- [ ] A second boot with `MULTI_TENANCY_ENABLED=true` re-seeds the built-in scenes without a P2002
      unique violation, covered by a test that upserts over a null-tenant `SimScene` row.
- [ ] `cd server && npm test` passes, and
      `npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --exit-code`
      still reports no drift — no migration was added.
- [ ] `docs/multi-tenancy.md` no longer states "19 models are tenant-scoped" and documents that
      built-in sim scenes belong to the DEFAULT organization.

## Test Strategy

The seam is mocked in three places, and every one must change.

1. **`server/src/database/__tests__/client.test.ts:52-72`** pastes a 19-entry allowlist and
   re-implements the entire extension at `:46-188` against a real temp SQLite database —
   `server/src/database/client.ts` is never imported, so the production allowlist is untested. Replace
   the literal with `import { TENANT_SCOPED_MODELS } from '../client.js'`. The local re-implementation
   of the switch may stay; it is the algorithm under test, and mocking `../../config/features.js` at
   `:33` is what forces it. Then add twin cases alongside the Wave-3d ones (`:889-929`), seeding raw
   rows exactly as `seedZoneRaw` does: `DigitalTwin` list/findUnique/update isolation; a `ScanSession`
   `updateMany` that returns count 0 for a foreign session (the shape `completeIfProcessing` depends
   on, `ScanSessionRepository.ts:85`); and a `SimScene` `upsert` over a row whose `tenantId` is null —
   that last one is the P2002 regression.

2. **`server/src/__tests__/multi-tenancy.integration.test.ts:43-48`** pastes a 4-entry copy and drives
   it through a hand-built Express app. Import the same constant so the HTTP-level test moves with the
   allowlist.

3. **New: `server/src/database/__tests__/tenantAllowlist.test.ts`.** Read
   `Prisma.dmmf.datamodel.models` from `@prisma/client`, keep those with a field named `tenantId` (30
   today), and assert set equality against the export minus a top-of-file
   `const EXCEPTIONS = new Set<string>([])` with a comment stating the rule — a model carrying
   `tenantId` that must never be auto-filtered, for example anything only ever written under
   `runAsPlatform`. It is empty after this task; the comment exists so a future exception is
   deliberate.

   Use the DMMF, not a `schema.prisma` regex parser: the generated client is the same artifact the
   extension runs against, CI generates it before the tests (`npx prisma generate` in the server job of
   `.github/workflows/check.yml`), and there is no regex to rot.

There is currently **no** `DigitalTwinRepository`, `ScanSessionRepository` or `SimSceneRepository` test
at all (`server/src/repositories/__tests__/` holds 21 files, none of the three), and the twin service
tests mock the seam one level higher: `DigitalTwinService.test.ts:25-41` mocks
`../../repositories/index.js` wholesale and `ScanSessionService.test.ts:36-38` mocks
`SensorScanRepository`, so no Prisma call — and therefore no extension — ever runs for twins.

Run: `cd server && npm run typecheck && npx vitest run`.

## Notes

**The twin trio is the entire gap in the *allowlist*, not in the defect.** `SensorScan`, `MotionClip`
and `VlaSession` carry no `tenantId` column at all, so they cannot be closed by an allowlist entry —
raw LiDAR sweeps, motion clips and the prompts operators gave their robots are still not recording
ownership after this task. That half is **TASK-286**, and it is the part whose cost grows daily.
Do not let this task's DMMF test mislead a reader into thinking isolation is complete: the test asserts
that every model *with the column* is scoped, which is silent about models that lack it.

Ordering interaction with TASK-286: once TASK-286 adds the column to those three models, the
DMMF-derived set here grows from 30 to 33 and the allowlist must grow with it — the test added by this
task is exactly the ratchet that will catch it. That is by design, not a conflict.

Server-side only. This task touches no file under `app/` and none of the navigation files owned by the
parallel session (TASK-273 to TASK-280) — that session is still working in them.

TASK-276, which folded digital twin into Fleet as a Sites tab, **has already landed** (`2712f07b`).
Checked: that commit touched **no** file under `server/`, so nothing in this task's scope moved. The
only interaction is that its Sites list will start returning tenant-scoped twins once this lands, which
is the intended behaviour and needs no coordination beyond a heads-up.

`TwinZone` is deliberately out of scope — it is cascade-deleted with its twin, so it is not an
independent leak.

TASK-287 (atomic number generators) does edit `schema.prisma` and adds a migration; this task adds
none, so the two collide only in `docs/multi-tenancy.md`.
