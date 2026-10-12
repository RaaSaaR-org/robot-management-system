---
id: "TASK-363"
aliases: []
title: "Dataset robot-type panel offers real choices and shows the true validation state"
slug: "dataset-robot-type-panel-offers-real-choices-and-shows-the"
status: "review"
priority: 2
owner: "huhn511"
projects: []
customers: []
tags: ["core"]
sprint: ""
parent: ""
depends_on: []
spe: 3
effort: "medium"
due_date: ""
created: "2026-10-12"
updated: "2026-10-12"
---

# Dataset robot-type panel offers real choices and shows the true validation state

## Description

Follow-up to TASK-353 (#378). The robot-type panel on `/datasets/:id/episodes`
offers nothing to switch to on a fresh install, shows a stale `Ready` badge while
a revalidation runs, takes the whole first screen above the episode browser and
prints raw `unknown` robot types. The trajectory chart also logs a Recharts size
warning on every load.

## Details

**Current state**

- `GET /api/datasets/robot-types` (`server/src/routes/datasets.routes.ts`) lists
  whatever rows exist. On a fresh install that is only the type an import
  auto-created (e.g. `so100_follower`), so "Change robot type" has no option.
  Creating a type is owner-only (TASK-353), so members cannot fix that themselves.
- `DatasetExpectationsPanel.tsx` renders `StatusTag status={dataset.status}`.
  "Revalidate existing files" leaves a `ready`/`failed` row alone until the
  verdict lands, so the badge says `Ready` for the whole pass.
- The panel only collapses when the verdict passes; otherwise the full form sits
  above the episode list. Types created from a `robot_type: "unknown"` manifest
  show as `unknown`.
- `TrajectoryPanels.tsx` mounts `ResponsiveContainer` with Recharts'
  default `initialDimension` of -1 × -1, which warns before the first measure.

### Server

- `server/src/database/seedStandardRobotTypes.ts` (new): an idempotent boot seed
  of the standard embodiments (G1 EDU + Dex3-1 43/43, G1 arms + Dex3-1 hands
  28/28, SO-101 follower 6/6). Create-only by name: an existing row of the same
  name is never touched, matching TASK-353's rule that shared types are never
  rewritten. Called from `server/src/index.ts` next to `seedDemoWarehouse`.

### Frontend

- `DatasetExpectationsPanel.tsx`: badge shows `validating` while this panel
  watches a pass; panel collapses to one summary line in every state and
  expands on demand (and can collapse again); readable label for unknown types;
  picker lists widths-matching types first. The in-form G1 preset is dropped in
  favour of the seeded type.
- `datasetFormat.ts`: `robotTypeLabel()`.
- `TrajectoryPanels.tsx`: non-negative `initialDimension`.

## Acceptance Criteria

- [ ] A fresh server boot creates the standard robot types once; a second boot and an existing row of the same name are left untouched.
- [ ] The picker offers the standard types (widths-matching first) without any owner action.
- [ ] Clicking "Revalidate existing files" switches the badge to `Validating` immediately and back to the verdict when the pass ends.
- [ ] The panel is a single line by default whatever the verdict, expands on demand, and collapses again; the episode list stays above the fold.
- [ ] A robot type named `unknown` is shown as a readable label, never as raw `unknown`.
- [ ] `/datasets/:id/episodes` logs no Recharts `width(-1) and height(-1)` warning.

## Test Strategy

- Server vitest for the seed (fresh, re-run, pre-existing name).
- App vitest for the panel (badge, collapse, label, ordering) and `robotTypeLabel`.
- Playwright on the demo build: episodes page shows the collapsed panel, the
  picker lists types, and the console carries no Recharts size warning.
