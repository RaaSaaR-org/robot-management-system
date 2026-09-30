---
id: "TASK-331"
aliases: []
title: "The fleet map is a site map"
slug: "the-fleet-map-is-a-site-map"
status: "in-progress"
priority: 3
owner: "huhn511"
projects: []
customers: []
tags: [core, app]
sprint: ""
parent: "[[TASK-274]]"
depends_on: ["[[TASK-328]]", "[[TASK-330]]"]
spe: 8
effort: "medium"
due_date: ""
created: "2026-09-30"
updated: "2026-09-30"
---

# The fleet map is a site map

## Description

The Fleet "Map" tab and the dashboard stop drawing the flat SVG `FleetMap` of fleet
zones and show a **site map** instead: pick a digital twin, see it top-down with its
zones and the live robots bound to it, and E-stop a zone from the map. Epic TASK-274.

## Details

### Current state

- `app/src/features/fleet/pages/FleetPage.tsx` (229 lines): tabs `map | list | sites`
  (`?tab=`, default `map`). The map tab renders `FleetMap`
  (`components/FleetMap.tsx`, `SCALE = 10` px per map unit) with fleet-zone
  create/draw/edit/delete (`useZones`, `ZoneFormModal`, `ZoneEditor`, "Draw zone" /
  "New zone" buttons gated by `canManage`). The `sites` tab renders
  `SitesGallery` (imported by path to keep three.js out of the fleet chunk).
- `app/src/features/dashboard/pages/DashboardPage.tsx:36,116-118` renders the fleet
  map with `useZones().zones`.
- Twin side (`app/src/features/digitaltwin/`): `twinZoneApi`, `twinZoneStore`,
  `ZoneAuthoringOverlay.tsx` (2D top-down SVG of a twin: zones, faint cloud projection,
  `deriveWorldBounds` falls back to a 12 m square when there is no scan),
  `ZoneLegend.tsx`, `LivePoses.tsx`, `SiteCard.tsx`, digital-twin list API.
- Robots carry `twinId` (TASK-327), `location.x/y/heading`, `location.place` and
  `location.siteAligned` (TASK-328; true only when the pose is in the twin frame).
- Zone E-stop: `useSafety` / `safetyStore.triggerZoneEStop(zoneId, reason)` →
  `POST /api/safety/zones/:id/estop`, which takes a TwinZone id (TASK-330).

### Frontend

- New `app/src/features/fleet/components/SiteMap.tsx` (+ small subcomponents as
  needed): props `{ size?: 'full' | 'compact' }`.
  - Site picker: the tenant's twins; remembers the last site per viewer in
    `localStorage` (key `fleet.siteMap.lastTwinId`, wrapped in try/catch; fall back to
    the first twin). Empty state links to the Sites tab when no twin exists.
  - Top-down view: extract the read-only rendering from `ZoneAuthoringOverlay`
    (world bounds, polygon drawing, cloud projection) into a shared component, e.g.
    `digitaltwin/components/TwinTopDown.tsx`, used by both — no three.js import in the
    fleet chunk. Zones coloured by type with `ZoneLegend`; keepouts visually distinct.
  - Robots: plot robots with `twinId === site.id && location.siteAligned === true` at
    `location.x/y` with heading, live from the existing robots store. List beside the
    map: bound but not aligned ("not aligned — fence not enforcing") and robots with
    no site ("no site").
  - Click a zone → confirm dialog → `triggerZoneEStop(zone.id, reason)`; toast with
    the stopped count. Hidden/disabled for roles that cannot E-stop (reuse the
    safety feature's permission check).
- `FleetPage.tsx`: the map tab renders `<SiteMap />`; remove the fleet-zone
  create/draw/edit buttons and modals from the page (the components themselves are
  deleted in TASK-334). Update the page header description.
- `DashboardPage.tsx`: render `<SiteMap size="compact" />` in place of the fleet map.

### Key files

- `app/src/features/fleet/components/SiteMap.tsx` (new),
  `app/src/features/digitaltwin/components/TwinTopDown.tsx` (new, extracted),
  `app/src/features/digitaltwin/components/ZoneAuthoringOverlay.tsx`,
  `app/src/features/fleet/pages/FleetPage.tsx` (+ `__tests__/FleetPage.test.tsx`),
  `app/src/features/dashboard/pages/DashboardPage.tsx`

## Acceptance Criteria

- [ ] Fleet → Map shows a site picker, the chosen twin top-down with its zones, and
      aligned bound robots moving live; the last site is remembered across reloads.
- [ ] Bound-but-unaligned robots and unbound robots are listed beside the map, not
      plotted; the unaligned ones say "not aligned — fence not enforcing".
- [ ] Clicking a zone and confirming calls the zone E-stop with that TwinZone id.
- [ ] The dashboard shows the same component in compact size.
- [ ] Neither page imports `FleetMap` or `useZones`; `ZoneAuthoringOverlay` still works
      in the twin viewer.
- [ ] App typecheck, vitest and the Playwright suite pass.

## Test Strategy

Vitest: SiteMap plots only aligned bound robots and lists the rest; picker persists
the last site (and survives a throwing `localStorage`); zone click → confirm → E-stop
call; compact variant renders. Update `FleetPage.test.tsx`. Sim check: Fleet → Map,
Demo Warehouse, the sim robot moves live, zone E-stop stops it.
