---
id: "TASK-266"
aliases: []
title: "Redesign deployments, models, fleet learning, marketplace and updates"
slug: "redesign-deployments-models-fleet-learning-marketplace-and-updates"
status: "done"
priority: 2
owner: "huhn511"
projects: []
customers: []
tags: [core, design, frontend]
sprint: ""
parent: "[[TASK-260]]"
depends_on: ["[[TASK-261]]"]
spe: 8
effort: "high"
due_date: ""
created: "2026-09-11"
updated: "2026-09-11"
---

# Redesign deployments, models, fleet learning, marketplace and updates

## Description

Rethink and rebuild these pages on the design system from [[TASK-261]], so they look and work exactly like every other page in the app: the same page anatomy, the same CRUD pattern, the same states and status tags. Executed as directory slices, one agent each, every slice within the spe ceiling; the branch is browser-tested as a whole before its PR.

## Details

### Current state

- **Owned directories:** `features/deployment`, `app/src/features/fleetlearning`, `app/src/features/contributions`, `app/src/features/updates` (all under `app/src/`).
- **Routes:** `/deployments` (incl. the Skills tab), `/deployments/:id`, `/models`, `/fleet-learning`, `/fleet-learning/rounds/:id`, `/marketplace`, `/marketplace/mine`, `/marketplace/:id`, `/updates`.
- **Size and state:** about 12,400 lines of TSX. Deployments and Skills render `DemoFeaturePlaceholder` in demo mode; the model registry (TASK-238) is covered by `e2e/demo-smoke.spec.ts`.

### Frontend

For every page, in this order:

1. **UX pass.** Write down what the page is for, what an operator does first, and what can go. Restructure to the page anatomy in `docs/brand.md`: `PageHeader` (eyebrow = nav group, title, description, one primary action), optional tabs in `?tab=`, a stat row only where it summarises state, a toolbar for search and filters, content in `Panel`s.
2. **CRUD.** Lists become `DataTable` or a card grid with `SearchInput`; create and edit go through `FormModal`; every delete goes through `ConfirmDialog`; results through `toast`; `window.confirm`, hand-rolled `fixed inset-0` dialogs and raw `<select>`/`<table>` markup go.
3. **States.** `Skeleton` while loading, `EmptyState` with the header's primary action when empty, `ErrorState` with Retry on failure.
4. **Tokens only.** No `cobalt-*`, `turquoise-*`, `glass*`, raw hues, greys, hex literals or `dark:` variants in the owned directories; status through `StatusTag`/`statusTone`; mono only for code and machine output; nothing below 10px.
5. **Responsive.** 390px wide with no horizontal page scroll; 800×600 (Tauri default) usable.
6. **Keep behavior.** Stores, hooks and API calls stay unless a UX change needs them. Update vitest and Playwright specs that assert the old classes or copy; never delete a test to make it pass.

## Acceptance Criteria

- [ ] Every route listed above leads with `PageHeader`, uses kit primitives for lists, forms, dialogs, states and status, and has at most one primary button per view.
- [ ] Create, edit and delete follow the CRUD table in `docs/brand.md`, including `ConfirmDialog` for every delete and a toast for every result.
- [ ] `grep` finds no `cobalt-`, `turquoise-`, `glass`, `dark:`, raw Tailwind hues or hex color literals in the owned directories.
- [ ] Every route was opened with `ui-check` at 1440px and 390px in dark and light (live mode, and demo mode where the page is not a placeholder): no page errors, no horizontal overflow, no text under 10px, one `h1`; the screenshots were reviewed and the CRUD flows clicked through.
- [ ] `npx tsc`, `npx vitest run` and `npx playwright test` pass.

## Test Strategy

- `ui-check` over every route listed above, both modes, both widths, both themes; screenshots read, findings fixed.
- A Playwright flow script per CRUD surface against the live API on a copy of the dev database: create, edit, delete, with the toast and the confirm dialog asserted.
- The gate: `npx tsc`, `npx vitest run`, `npx playwright test`.
