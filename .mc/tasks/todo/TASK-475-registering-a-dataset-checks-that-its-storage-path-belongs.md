---
id: "TASK-475"
aliases: []
title: "Registering a dataset checks that its storage path belongs to the caller's tenant"
slug: "registering-a-dataset-checks-that-its-storage-path-belongs"
status: "todo"                # backlog | todo | in-progress | review | done | cancelled
priority: 2                   # 1=critical, 2=high, 3=medium, 4=low
owner: "claude"
projects: []
customers: []
tags: ["core", "compliance"]
sprint: ""
parent: ""
depends_on: []
spe: 2
effort: "medium"
due_date: ""
created: "2026-11-01"
updated: "2026-11-01"
---

# Registering a dataset checks that its storage path belongs to the caller's tenant

## Description

Any member can `POST /api/datasets {name, robotTypeId, storagePath}` and get a `ready`
dataset row for any absolute directory on the server that holds `meta/info.json`. With
multi-tenancy on, that includes another tenant's recording directory, which the member
can then read, export or publish under their own tenant. Registration must confine the
path to the server's dataset roots and refuse a path that belongs to another tenant.

## Details

### Current state (origin/main, 8abe39f7)

- `server/src/routes/datasets.routes.ts:409` — `POST /api/datasets` checks only `name`,
  then calls `datasetService.create(dto)`; errors go through `sendFailure(..., 400)`
  (`server/src/utils/routeErrors.ts:33`), which answers an `AppError` with its own status.
- `server/src/services/DatasetService.ts:732-749` — `create()` treats a non-empty
  `storagePath` as a registration. For an absolute path it checks only that the directory
  exists and has `meta/info.json`; a RustFS prefix is taken on trust. The row is created
  `ready` (`:763`). Nothing compares the path with the dataset roots or with the caller's
  tenant. `CreateDatasetDto.storagePath` is documented at
  `server/src/types/dataset.types.ts:192-202`.
- The `Dataset` row is tenant-scoped (`TENANT_SCOPED_MODELS` in
  `server/src/database/client.ts:36`, `Dataset` at `:40`), so the new row lands in the
  caller's tenant — but the directory on disk is not scoped by anything. Robots are
  tenant-scoped; `TeleoperationSession` is not, but carries `robotId`.
- The robot agent writes a recording to `<root>/<sessionId>/`, where `<root>` is
  `RECORDING_DATASET_DIR` or `robot-agent/data/workspace-<robotId>/datasets`
  (`robot-agent/src/recording/recording-controller.ts:32-36`).
- The server's own writers do not use this door: the session wrap-up registers through
  `datasetRepository.create` (`TeleoperationService.registerAgentDataset`,
  `server/src/services/TeleoperationService.ts:~2750-2807`), as do curation
  (`DatasetCurationService.ts:~442`) and Cosmos synthetic data
  (`CosmosSyntheticService.ts:~677`). Tightening `create()` does not touch them.
- PR #416 (TASK-394, Hugging Face publish, open) adds `defaultDatasetRoots()` and
  `confineToRoots()` to `server/src/services/HuggingFacePublishService.ts` and uses them
  only for a publish: roots are `datasetStorageRoot()` (`DatasetService.ts:234`) plus
  `RECORDING_DATASET_DIR`, or `robot-agent/data` restricted to
  `workspace-*/datasets/*`; realpaths on both sides, so a symlink out of a root is refused.
- Tenant context: `getTenantId()` and `runAsPlatform()` in
  `server/src/middleware/tenantContext.ts:51,67`; flag `MULTI_TENANCY_ENABLED` in
  `server/src/config/features.ts:24`. See `docs/multi-tenancy.md`.

### Server

1. **Shared roots.** Move `defaultDatasetRoots()` and `confineToRoots()` into
   `server/src/services/datasetRoots.ts` (create it), and import them from there in
   `HuggingFacePublishService.ts`. If #416 has not merged when this starts, create the
   module with the same two functions and the same tests, and let #416 rebase onto it.
2. **Roots, always.** In `create()`, a registration with an absolute `storagePath` is
   refused unless `confineToRoots()` returns a path, with flag on or off:
   `new AppError(message, 400, 'STORAGE_PATH_OUTSIDE_ROOTS')`
   (`server/src/utils/errors.ts:12`; `BadRequestError`/`AuthorizationError` fix their own
   code, so use `AppError` directly). The row stores the path as given (trailing slash as
   today), not the realpath.
3. **Tenant, when `MULTI_TENANCY_ENABLED`.** Outside a platform context, refuse with
   `new AppError(message, 403, 'STORAGE_PATH_NOT_OWNED')` when:
   - the path (local or RustFS prefix, trailing slash normalised) is already the
     `storagePath` of a dataset row in another tenant — looked up under `runAsPlatform`;
   - a local path is under the recording root and its `<sessionId>` directory is not a
     `TeleoperationSession` whose robot is found in the caller's tenant scope; in the
     default layout the `workspace-<robotId>` segment must also be that robot;
   - a local path is under `datasetStorageRoot()` and no row of the caller's tenant
     claims it (nothing else writes there through this door).
   The message says which rule refused, never the other tenant's name or dataset id.
4. **Route.** `sendFailure` answers an `AppError`'s status and message but not its
   `code`; the `POST /` handler adds `code` to the body for these two refusals.
5. Fix `docs/vr-teleop-data-collection.md:336` ("`POST /api/datasets` does not accept a
   `storagePath`" — it does since TASK-215) and document the two refusals in
   `docs/api.md` ("Datasets (`/api/datasets`)", `:245`).

### Key files

- `server/src/services/DatasetService.ts` (modify `create`)
- `server/src/routes/datasets.routes.ts` (`POST /` adds `code`)
- `server/src/services/datasetRoots.ts` (create)
- `server/src/services/HuggingFacePublishService.ts` (import from the new module, if #416 merged)
- `server/src/services/__tests__/DatasetService.test.ts` (`describe('create')` at `:305`)
- `server/src/__tests__/dataset-register-tenant.integration.test.ts` (create)
- `docs/vr-teleop-data-collection.md`, `docs/api.md`

### Out of scope

- A RustFS prefix that no row claims stays taken on trust: its owner cannot be read from
  the object store.
- Checking existing rows that already point into another tenant's directory — an
  operator report, if wanted, is a separate task.

## Acceptance Criteria

- [ ] An absolute `storagePath` outside the dataset roots (including through a symlink)
      answers 400 `STORAGE_PATH_OUTSIDE_ROOTS` and creates no row, with the flag on or off.
- [ ] With multi-tenancy on, a member of tenant B registering tenant A's recording
      directory, or a path an A-row already uses, gets 403 `STORAGE_PATH_NOT_OWNED`, no row,
      and a message that names neither tenant A nor its dataset.
- [ ] With multi-tenancy on, a member registering a recording of a robot in their own
      tenant still gets a `ready` row, as today.
- [ ] With multi-tenancy off, a registration inside the roots behaves exactly as today.
- [ ] Session wrap-up, curation and Cosmos registrations are unchanged (they do not call
      `create()`).
- [ ] `docs/vr-teleop-data-collection.md` and `docs/api.md` describe the route as it is.

## Test Strategy

- Vitest in `DatasetService.test.ts`: temp dirs for an inside-root, an outside-root and a
  symlink-out-of-root dataset; the refusals' status and code; no `datasetRepository.create`
  call on refusal; flag off keeps today's behaviour.
- An integration test in the style of `server/src/__tests__/tenant-boundary.integration.test.ts`
  (real schema on a temp SQLite file, `MULTI_TENANCY_ENABLED` mocked true, two tenants
  driven through `tenantStore`): a robot and session in tenant A with a recording dir; B's
  registration refused, A's accepted; a path already used by an A-row refused for B.
- Move the root tests from `HuggingFacePublishService.test.ts` with the functions, and
  keep the publish tests green. `./scripts/test-all.sh --skip-pw` green.
