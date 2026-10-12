---
id: "TASK-376"
aliases: []
title: "Viewers cannot delete a site in the Sites gallery"
slug: "viewers-cannot-delete-a-site-in-the-sites-gallery"
status: "in-progress"         # backlog | todo | in-progress | review | done | cancelled
priority: 2                   # 1=critical, 2=high, 3=medium, 4=low
owner: "huhn511"
projects: []
customers: []
tags: ["core"]
sprint: ""
parent: ""
depends_on: []
spe: 3
effort: "low"
due_date: ""
created: "2026-10-12"
updated: "2026-10-12"
---

# Viewers cannot delete a site in the Sites gallery

## Description

A `viewer` sees "Delete" on every site card in Fleet's Sites tab and on the twin
viewer page, and the server then refuses the request with a 403. The digital
twin UI must stop offering a viewer the writes their role cannot perform — the
same convention TASK-284 set for robots and TASK-370 set for stop/command
controls.

## Details

### Current state

- `app/src/features/digitaltwin/components/SitesGallery.tsx` passes `onDelete`
  to every `SiteCard`, and `SiteCard.tsx` always renders a `Delete` item in its
  `RowActions`. Only "New scan" is gated (`usePermission('robots:command')`,
  disabled with "Your role can't start a scan.").
- `app/src/features/digitaltwin/pages/TwinViewerPage.tsx` always renders the
  header `RowActions` with "Delete site", and "Simulate in this room" generates
  a sim scene with `POST /api/simulation/...` when the twin has none.
- `ZonePanel.tsx` always shows "New zone" and per-zone Edit/Delete;
  `ZoneAuthoringOverlay.tsx` opens the zone edit form on a double-click.
- `ScanSessionPanel.tsx` always enables "Start sweep" / "Stop and build" /
  "Import scan" — all `POST`s.
- Server: every write under `/api/digital-twins` is mounted with
  `...protect` = `[authMiddleware, writeRoleGuard]` (`server/src/app.ts`), and
  `writeRoleGuard` delegates every POST/PUT/PATCH/DELETE to `memberOrAbove`, so
  `DELETE /api/digital-twins/:id` already answers 403 to a viewer. The
  enumeration test `server/src/__tests__/write-route-authorization.test.ts`
  holds that. No server change.

### Frontend

- There is no site-specific permission. The client mirror of `memberOrAbove` is
  `robots:write` (member, owner, super-admin — see the TASK-284 comment in
  `app/src/features/auth/types/auth.types.ts`). Wrap it in one hook,
  `useCanEditSites()` in `app/src/features/digitaltwin/hooks/`, so the twin
  feature names the decision once.
- Destructive / authoring row actions are **hidden** for a viewer, as
  `RobotList.tsx` hides "Unregister": the Delete item on `SiteCard`, the header
  "More actions" on `TwinViewerPage`, "New zone" and each zone's Edit/Delete in
  `ZonePanel`, and the double-click-to-edit in `ZoneAuthoringOverlay`.
- Primary acts that explain the page stay visible but **disabled with a
  reason** ("Your role can't …"), as "New scan" does: Start sweep, Stop and
  build, Import scan, and Simulate in this room while it would still have to
  build the scene. A twin that already has a sim scene only navigates, so a
  viewer may still open it.
- Reads — open, export downloads, zone selection — stay available.

### Key files

- `app/src/features/digitaltwin/hooks/useCanEditSites.ts` (new)
- `app/src/features/digitaltwin/components/SiteCard.tsx`
- `app/src/features/digitaltwin/components/SitesGallery.tsx`
- `app/src/features/digitaltwin/components/ZonePanel.tsx`
- `app/src/features/digitaltwin/components/ZoneAuthoringOverlay.tsx`
- `app/src/features/digitaltwin/components/ScanSessionPanel.tsx`
- `app/src/features/digitaltwin/pages/TwinViewerPage.tsx`
- tests under `app/src/features/digitaltwin/components/__tests__/`

## Acceptance Criteria

- [x] A viewer sees no "Delete" in a site card's actions in the Sites gallery; a member and an owner do.
- [x] A viewer sees no "Delete site" on the twin viewer page; a member does.
- [x] A viewer sees no "New zone" and no zone Edit/Delete, and double-clicking a zone opens no edit form.
- [x] A viewer's Start sweep, Stop and build and Import scan are disabled with a "Your role can't …" reason.
- [x] A viewer's "Simulate in this room" is disabled with a reason only while it would have to build the scene.
- [x] `DELETE /api/digital-twins/:id` answers 403 to a viewer (already true via `writeRoleGuard`; confirmed, no change).
- [x] Vitest component tests cover viewer vs member/owner for the gallery delete and the zone panel.

## Test Strategy

- `cd app && npx vitest run src/features/digitaltwin` — new cases in
  `SitesGallery.test.tsx` (viewer: no Delete; member and owner: Delete) and a
  new `SiteWriteControls.test.tsx` (ZonePanel and ScanSessionPanel, viewer vs member).
- `cd app && npx tsc --noEmit` and the full app vitest suite.
- Server: `server/src/__tests__/write-route-authorization.test.ts` already
  covers `DELETE /api/digital-twins/:id` for a viewer.

## Notes

- 2026-10-12: `robots:write` chosen over a new `sites:write` permission — the
  server has no site-specific role rule, only `memberOrAbove`, and that
  permission is already its documented client mirror.
