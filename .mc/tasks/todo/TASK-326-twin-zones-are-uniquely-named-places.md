---
id: "TASK-326"
aliases: []
title: "Twin zones are uniquely named places"
slug: "twin-zones-are-uniquely-named-places"
status: "todo"
priority: 3
owner: "huhn511"
projects: []
customers: []
tags: [core, server, app]
sprint: ""
parent: "[[TASK-274]]"
depends_on: []
spe: 3
effort: "low"
due_date: ""
created: "2026-09-30"
updated: "2026-09-30"
---

# Twin zones are uniquely named places

## Description

Make every navigable `TwinZone` a place with a unique, place-id-safe name, so the
digital twin can replace the fleet `Zone` as the only zone model (epic TASK-274).
Adds the "which place contains this point" helper the later slices reuse.

## Details

### Current state

- `server/prisma/schema.prisma` `model TwinZone` (~line 252): `twinId`, `name`, `type`
  (`keepout | workcell | charging | speed | room`), `points` JSON polygon in metres,
  `minZ/maxZ`, `color`, `metadata`. No uniqueness on `name`.
- `server/src/services/TwinPlaceGraphService.ts:41` — `PLACE_ZONE_TYPES` maps only
  `room → keepout:false` and `keepout → keepout:true`; its doc comment says
  `workcell`, `charging`, `speed` are deliberately not places (that decision is now
  reversed by TASK-274, rewrite the comment). `ROBOT_SAFE_PLACE_ID`
  (`/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/`) lives in the same file.
- `server/src/services/TwinZoneService.ts` (107 lines) creates/updates zones;
  zone CRUD routes in `server/src/routes/twin.routes.ts` ~`:390-458`.
- App form: `app/src/features/digitaltwin/components/TwinZoneFormModal.tsx`.

### Server

- Schema: add `nameKey String` to `TwinZone` (lower-cased, trimmed `name`) and
  `@@unique([twinId, nameKey])`. Migration backfills `nameKey = lower(name)`; if the
  backfill would collide, suffix duplicates (`-2`, `-3`) in the migration SQL rather
  than failing. Follow the existing migrations in `server/prisma/migrations/`.
  Remember the SQLite dev path (see `CLAUDE.md` Database section).
- `TwinZoneService` sets `nameKey` on create/rename, and rejects a name that does not
  match `ROBOT_SAFE_PLACE_ID` (or whose `metadata.placeId` override does not) with a
  400 `ValidationError`; a P2002 unique violation becomes a 409 with message
  `A zone named "<name>" already exists in this twin`.
- `PLACE_ZONE_TYPES`: `room → false`, `workcell → false`, `charging → false`,
  `keepout → true`. `speed` stays out. The emitted place's `placeType` defaults to the
  zone type when `metadata.placeType` is unset (`charging` → `charging`, `workcell` →
  `cell`, `room` → `unknown` as today) — keep `TwinPlaceTypes` valid.
- New pure helper `findContainingPlace(zones, point)` (e.g. in
  `server/src/services/twinPlaceGeometry.ts`): point-in-polygon over place-type zones,
  returns the **smallest-area** containing zone on overlap, `null` if none. Export it;
  TASK-330 (E-stop, deployments) reuses it.
- Rewrite the comment above `model TwinZone` (`schema.prisma:247-251`): TwinZone is the
  only zone model; the fleet `Zone` is being removed (TASK-274).

### Frontend

- `TwinZoneFormModal.tsx` shows the 409/400 message inline on the name field instead
  of a generic toast.

### Key files

- `server/prisma/schema.prisma`, new migration under `server/prisma/migrations/`
- `server/src/services/TwinZoneService.ts`, `server/src/services/TwinPlaceGraphService.ts`
- `server/src/services/twinPlaceGeometry.ts` (new)
- `app/src/features/digitaltwin/components/TwinZoneFormModal.tsx`

## Acceptance Criteria

- [ ] Creating a second TwinZone named `aisle-1` on a twin that already has `AISLE-1`
      is rejected (DB unique on `(twinId, nameKey)`), API answers 409; the same name
      on another twin is accepted.
- [ ] A zone name like `Aisle 1 / north` (not a safe place id) is rejected with 400.
- [ ] `room`, `workcell`, `charging` and `keepout` zones appear in
      `GET /api/digital-twins/:id/places/_index.json`; only `keepout` has
      `keepout: true`; `speed` zones do not appear.
- [ ] `findContainingPlace` returns the smallest containing zone on overlap.
- [ ] The comment above `model TwinZone` says it is the only zone model.
- [ ] The form modal shows the duplicate-name error on the name field.
- [ ] Server + app typecheck and vitest pass.

## Test Strategy

Vitest: `TwinZoneService` uniqueness (case-insensitive, per twin) and safe-id
rejection; `TwinPlaceGraphService` emits the four types with kinds and skips speed;
`findContainingPlace` overlap/none cases. App: form modal renders the server error.
