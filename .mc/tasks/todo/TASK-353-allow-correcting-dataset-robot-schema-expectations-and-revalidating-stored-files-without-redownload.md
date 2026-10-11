---
id: "TASK-353"
aliases: []
title: "Allow correcting dataset robot/schema expectations and revalidating stored files without redownload"
slug: "allow-correcting-dataset-robot-schema-expectations-and-revalidating-stored-files-without-redownload"
status: "review"
priority: 2
owner: "claude"
projects: []
customers: []
tags: ["core"]
sprint: ""
parent: ""
depends_on: []
spe: 5
effort: "medium"
due_date: ""
created: "2026-10-12"
updated: "2026-10-12"
---

# Allow correcting dataset robot/schema expectations and revalidating stored files without redownload

GitHub issue: [#372](https://github.com/RaaSaaR-org/robot-management-system/issues/372)

## Description

An imported dataset whose robot type was guessed wrong (production case:
`nvidia/GR00T-N1.7-AppleToPlate`, 43-wide state/action, attached to the 28-wide
`Unitree_G1` type) fails validation with `ROBOT_STATE_DIM_MISMATCH` /
`ROBOT_ACTION_DIM_MISMATCH`, and there is no way to fix it short of deleting and
re-downloading it. Operators need to see observed vs expected widths, point the
dataset at the right robot configuration (creating one if none exists, never
mutating a shared type), and revalidate the files already in storage.

## Details

### Current state

- `Dataset.robotTypeId` (`server/prisma/schema.prisma`) is set at import and
  never editable: `PUT /api/datasets/:id` (`DatasetService.update`) ignores it.
- `validateDatasetStructure` (`server/src/services/lerobot/validateDataset.ts`)
  compares the parquet's observed widths against the robot type's
  `proprioceptionDim`/`actionDim`; the report (incl. `observedStateWidth` /
  `observedActionWidth`) is stored in `Dataset.validationJson` but the widths are
  not returned to the client.
- `POST /api/datasets/:id/validate` already reruns validation against the files
  under `storagePath` (no HF download) via `DatasetService.requestValidation`,
  with a 409 while a pass is in flight.
- Robot types can only be listed (`GET /api/datasets/robot-types`); the only
  creators are the HF importer, teleop and synthetic services.
- The compliance log (`ComplianceLogService.logAccess`) is the audit trail other
  services use (see `ServiceAccountService.auditLog`).
- The details page is `app/src/features/training/pages/DatasetEpisodesPage.tsx`.

### Server

- `PUT /api/datasets/:id/robot-type` `{ robotTypeId, reason? }` →
  `DatasetService.reassociateRobotType`: 404 unknown dataset/type, 400 for a
  view, 409 `DATASET_BUSY` while importing/uploading or while a validation is in
  flight. Persists the new association, drops the old verdict (the stored report
  is replaced by an `invalidated` record plus a `history` of expectation
  changes), audit-logs the change, then starts a revalidation of the stored
  files. The robot type row itself is never written.
- `POST /api/datasets/robot-types` creates a NEW robot type (name unique → 409,
  positive integer dims required); it never updates an existing one.
- `POST /api/datasets/:id/validate` refuses with 409 while an import is running
  and is audit-logged.
- Dataset response: `robotType` carries `actionDim`/`proprioceptionDim`;
  `validation` carries `observedStateWidth`/`observedActionWidth`;
  `expectations` carries the invalidation record and history.
- The validator warns `ROBOT_TYPE_LABEL_DIFFERS` when widths match but
  `info.json`'s `robot_type` does not name the selected type — matching widths
  alone do not prove interchangeable robots.

### Frontend

- `DatasetExpectationsPanel` on the details page: observed vs expected
  state/action widths, selected robot type, robot-type picker, "Define a new
  robot configuration" form (prefilled from the observed widths, with a
  G1 EDU + Dex3-1 43 DOF preset), "Revalidate existing files", the
  validating/ready/failed outcome and the change history.

### Key files

- `server/src/services/DatasetService.ts`
- `server/src/routes/datasets.routes.ts`
- `server/src/services/lerobot/validateDataset.ts`
- `server/src/types/dataset.types.ts`
- `server/src/services/__tests__/DatasetService.reassociate.test.ts` (new)
- `app/src/features/training/components/datasets/DatasetExpectationsPanel.tsx` (new)
- `app/src/features/training/api/trainingApi.ts`, `app/src/features/training/types/training.types.ts`
- `app/src/features/training/pages/DatasetEpisodesPage.tsx`

## Acceptance Criteria

- [x] Details view shows observed state/action widths beside expected widths and the selected robot type.
- [x] An authorized operator can reassociate the dataset with another robot type after import.
- [x] A new robot configuration can be defined explicitly; shared robot types are never mutated.
- [x] Corrected association is persisted; "Revalidate existing files" reruns validation on stored objects with no download, move or delete.
- [x] Changing expectations invalidates the old verdict, shows validating/ready/failed, and is audit-logged with history.
- [x] Source provenance and dataset schema stay untouched; genuine incompatibility still fails.
- [x] Reassociation is refused (409) during an active import/validation.
- [x] Tests: 43-wide dataset on 28-wide type fails → reassociate → revalidate passes with no HF download; incompatible reassociation still fails; shared type unchanged; 409 while busy.

## Test Strategy

- Server vitest: `DatasetService.reassociate.test.ts` drives the real validator
  over a fixture tree with the repositories mocked, asserting no `fetch` and no
  storage delete/move.
- App vitest: `DatasetExpectationsPanel.test.tsx`.
- `npm run typecheck` + `npx vitest run` in `server/` and `app/`.

## Notes

- 2026-10-12: Reassociation sets the row to `validating` and starts the
  revalidation itself; if the store is unreachable it falls back to `failed`
  (never `ready`, since the old verdict is void). A standalone
  "Revalidate existing files" button reuses `POST /:id/validate`.
- No schema migration: the invalidation record and history live in
  `Dataset.validationJson`; the durable audit trail is the compliance log
  (`access_audit`, robot id `system:datasets`).
