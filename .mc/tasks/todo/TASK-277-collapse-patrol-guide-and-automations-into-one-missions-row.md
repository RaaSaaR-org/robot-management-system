---
id: "TASK-277"
aliases: []
title: "Collapse Patrol, Guide and Automations into one Missions row"
slug: "collapse-patrol-guide-and-automations-into-one-missions-row"
status: "todo"
priority: 2
owner: "huhn511"
projects: []
customers: []
tags: [core, app]
sprint: ""
parent: "[[TASK-273]]"
depends_on: ["[[TASK-275]]"]
spe: 2
effort: "low"
due_date: ""
created: "2026-09-12"
updated: "2026-09-12"
---

# Collapse Patrol, Guide and Automations into one Missions row

## Description

Patrol, Guide and Automations are three sidebar rows for the same idea: work a
robot does on its own. They become **one `Missions` row** in the `Automate`
group, with the three pages reachable from the second-level rail
`Patrol · Guide · Automations`. Agent Mode keeps its own row beside it — it is the
live console, and a tab or rail click must never unmount it.

Parent: [[TASK-273]]. Blocked by [[TASK-275]] (which adds `rail` to the model and
the `SectionRail` that renders it).

## Details

### Why a rail and not tabs

[[TASK-273]] sketched Missions as a page with three tabs. Reading the pages
settles it as a **rail** instead, which is the same mechanism [[TASK-278]] uses
and costs far less:

- `PatrolPage` owns tabs `Routes · Runs` and `TourPage` owns `Tours · Visits`.
  Three Missions tabs above those would stack two tab rows — the exact thing the
  epic rejected when it chose "a rail one level above the page's own tab bar".
- All three pages keep their own routes, their own `?tab=` state, their own live
  subscriptions and their own sub-routes. Nothing is extracted, nothing is
  re-parented, no deep link changes. The work is a model edit plus icons.

### Current state (verified 2026-09-12)

- `app/src/features/patrol/pages/PatrolPage.tsx` — `TABS` `routes` · `runs`,
  `usePatrolEvents()` socket, header action "New route" → `/patrol/routes/new`.
  Sub-routes: `/patrol/routes/new`, `/patrol/routes/:id` (both
  `LazyPatrolRouteEditorPage`), `/patrol/runs/:runId` (`LazyPatrolRunDetailPage`).
- `app/src/features/tour/pages/TourPage.tsx` — its own file header calls it
  *"the structural twin of /patrol"*. `TABS` `tours` · `visits`,
  `useTourEvents()`, action "New tour" → `/tour/routes/new`. Sub-routes:
  `/tour/routes/new`, `/tour/routes/:id`, `/tour/runs/:runId`.
- `app/src/features/processes/pages/ProcessesPage.tsx` (73 lines) — no tab bar,
  action "New automation", sub-route `/processes/:id` →
  `ProcessDetailPage` → `TaskDetailPanel` (which holds a
  `useProcessWebSocket`).
- After [[TASK-275]] all three sit in the `automate` group with
  `eyebrow="Automate"`, and their `tabs` are declared on their rows.
- `/tasks` and `/tasks/:id` already redirect to `/processes` (`App.tsx:314-315`).

### Frontend

Everything happens in `app/src/components/layout/navigation.ts`. Replace the
three rows in the `automate` group with one:

```ts
{
  label: 'Missions',
  // The rail's first stop is the row's own page.
  path: '/patrol',
  icon: ListChecks,
  // Guide and Automations are rail stops, not rows of their own.
  alsoActiveOn: [/^\/tour(\/|$)/, /^\/processes(\/|$)/],
  rail: [
    { label: 'Patrol', path: '/patrol', icon: Route, tabs: [/* PatrolPage TABS */] },
    { label: 'Guide', path: '/tour', icon: Speech, tabs: [/* TourPage TABS */] },
    { label: 'Automations', path: '/processes', icon: Workflow },
  ],
},
```

- `Agent Mode` keeps its row and stays first in the group, so `Automate` is
  `Agent Mode · Missions`.
- Move the `tabs` arrays [[TASK-275]] put on the Patrol and Guide **rows** onto
  the matching **rail items**, ids and labels unchanged. The Missions row itself
  declares no `tabs` — its page is whatever the rail points at.
- Import `ListChecks` from `lucide-react` into the alphabetised list; keep
  `Route`, `Speech` and `Workflow`, which are already imported.
- No route changes, no redirects, no page refactor. `/patrol`, `/tour`,
  `/processes` and all six sub-routes keep working exactly as they do.

### What the user sees

Clicking `Missions` lands on `/patrol`. The rail sits above the page's own tab
bar and is present on the editors and run details too, because the row owns those
URLs. `PageHeader` still says "Patrol", "Guide" or "Automations", so the page
never loses its name.

## Acceptance Criteria

- [ ] The sidebar's `Automate` group is exactly two rows: `Agent Mode · Missions`
- [ ] `Missions` is the active row on `/patrol`, `/patrol/routes/new`,
      `/patrol/routes/:id`, `/patrol/runs/:runId`, `/tour`, `/tour/routes/new`,
      `/tour/routes/:id`, `/tour/runs/:runId`, `/processes` and `/processes/:id`
- [ ] `Agent Mode` is still its own row and is not active on any of those URLs
- [ ] The rail shows `Patrol · Guide · Automations` on all ten URLs above, with
      `aria-current="page"` on the one that owns the URL
- [ ] Every view survives: Patrol's Routes/Runs tabs, three-tile summary, live
      run banner, route export and delete; Guide's Tours/Visits tabs and its
      three tiles; the automation list and `CreateProcessModal`; all six
      sub-routes
- [ ] The Patrol and Guide `tabs` declarations moved to their rail items with ids
      and labels unchanged, and `navDestinations` still lists
      `/patrol`, `/patrol?tab=runs`, `/tour`, `/tour?tab=visits`, `/processes`
- [ ] `cd app && npx tsc --noEmit` clean, `npm run test` green

## Test Strategy

- `app/src/components/layout/__tests__/navigation.test.ts` — extend the URL→row
  `it.each` table with all ten URLs above resolving to `Missions` and to exactly
  one row; assert `Automate` has two items
- `SectionRail.test.tsx` — on `/tour?tab=visits` the rail renders the three links
  with `Guide` carrying `aria-current="page"`; on `/patrol/routes/new` the rail
  still renders with `Patrol` current
- `navDestinations` — the five paths above are present, `/patrol?tab=routes` and
  `/tour?tab=tours` are absent (first tab = bare path)
- Playwright: from `/dashboard` reach Missions → Guide → a tour's visit history,
  then the Patrol route editor, using only the sidebar and the rail
