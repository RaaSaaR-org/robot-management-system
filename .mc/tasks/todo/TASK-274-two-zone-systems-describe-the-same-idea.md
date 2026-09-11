---
id: "TASK-274"
aliases: []
title: "Two zone systems describe the same idea"
slug: "two-zone-systems-describe-the-same-idea"
status: "backlog"
priority: 3
owner: "huhn511"
projects: []
customers: []
tags: [core, server, app]
sprint: ""
parent: ""
depends_on: ["[[TASK-273]]"]
spe:
effort: ""
due_date: ""
created: "2026-09-12"
updated: "2026-09-12"
---

# Two zone systems describe the same idea

## Description

The platform has two unrelated models for "an area of the world a robot may or
may not enter": `Zone`, a flat rectangle on a floor drawn in Fleet's Map tab, and
`TwinZone`, bound to a `DigitalTwin` and edited through Sites. Two schemas, two
APIs, two editors. Found while grilling TASK-273, which deliberately left it
alone and only moved the two surfaces into one page.

## Details

### Current state (found 2026-09-12)

- `server/prisma/schema.prisma` — `model Zone` (line ~486): `name`, `floor`,
  `type` (`operational | restricted | charging | maintenance`), `bounds` as a JSON
  `{ x, y, width, height }`, tenant-scoped, unique on `(name, floor)`.
- `server/prisma/schema.prisma` — `model TwinZone` (line ~236), alongside
  `DigitalTwin`, `ScanSession` and `SensorScan`.
- `app/src/features/fleet/pages/FleetPage.tsx` — the Map tab owns zone
  draw/create/edit/delete via `useZones` and `ZoneConfigPanel.tsx`.
- `app/src/features/digitaltwin/api/twinZoneApi.ts` — the parallel client.
- TASK-200 shipped twin-bound places and an **enforced geofence**; whichever model
  that enforcement reads is the one that must not regress.
- After TASK-273, both surfaces sit in one page (`Fleet: Map · Robots · Sites`),
  which makes the duplication visible but does not resolve it.

### Open questions for a grilling

1. Which model is the survivor — does a flat `Zone` become a degenerate
   `TwinZone` on a site with no scan, or does the twin keep a separate concept?
2. What does the enforced geofence read today, and can it be pointed at one model
   without a behaviour change?
3. Is a migration needed for existing `Zone` rows, and what happens to the
   `(name, floor)` uniqueness in a twin-scoped world?

Not ready to implement — grill it first.

## Acceptance Criteria

- [ ] Grilled: one surviving model, migration path decided, geofence behaviour
      stated before any code
