---
id: "TASK-275"
aliases: []
title: "Give the nav model rails, tabs and verb groups"
slug: "give-the-nav-model-rails-tabs-and-verb-groups"
status: "review"
priority: 2
owner: "huhn511"
projects: []
customers: []
tags: [core, app]
sprint: ""
parent: "[[TASK-273]]"
depends_on: []
spe: 3
effort: "medium"
due_date: ""
created: "2026-09-12"
updated: "2026-09-12"
---

# Give the nav model rails, tabs and verb groups

## Description

`app/src/components/layout/navigation.ts` describes 23 flat rows and nothing
below them. Before any page can be demoted, the model has to be able to describe
the second level (a row's **rail**, a page's **tabs**), the sidebar has to render
a group that carries no eyebrow, the groups need their verb labels, and the shell
needs exactly one place that renders a rail. **No row is removed and no page moves
in this slice** — it is the foundation the other four sit on.

Parent: [[TASK-273]]. Decisions:
[`docs/records/TASK-273-cut-the-navigation-from-23-rows-to-10.md`](../../../docs/records/TASK-273-cut-the-navigation-from-23-rows-to-10.md).

## Details

### Current state (verified 2026-09-12)

- `app/src/components/layout/navigation.ts` (233 lines) exports `NavItem`,
  `NavGroup`, `NAV_GROUPS` (6 groups / 23 items), `NAV_ITEMS`,
  `isNavItemActive`, `filterNavGroups`, `useVisibleNavGroups`,
  `useVisibleNavItems`. `NavItem` already carries `alsoActiveOn?: RegExp[]` and
  `notActiveOn?: RegExp[]`; `NavGroup` carries `requiresFeature?:
  'multiTenancyEnabled'` and `requiresRole?: UserRole[]`.
- Consumers of the model: `Sidebar.tsx` and `MobileNav.tsx`
  (`useVisibleNavGroups`), `NavList.tsx` (`isNavItemActive`, the types),
  `components/demo/DemoFeaturePlaceholder.tsx` (`NAV_GROUPS`,
  `isNavItemActive`), the `components/layout/index.ts` barrel, and
  `__tests__/navigation.test.ts`. **`App.tsx` does not read the model** — the
  route table and the nav model are two independent lists.
- `NavList.tsx` (137 lines) renders one `<section>` per group with
  `headingId = nav-group-${variant}-${group.id}` and, for `expanded`/`drawer`,
  an `<h2 id={headingId} className="mb-1 px-3 font-sans text-[11px] font-medium
  uppercase tracking-[0.12em] text-ink-muted">{group.label}</h2>` plus
  `aria-labelledby={headingId}`. The `rail` variant renders no heading: it puts
  `<div role="separator" className="my-2 h-px w-8 bg-line" />` before every group
  after the first and sets `aria-label={group.label}` on the section.
- `AppLayout.tsx` renders `TopBar`, `Sidebar`, then a content column
  `<div className="flex flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">` holding
  `ImpersonationBanner`, `AlertBanner` and `{children}`.
- Pages keep their tab state in `?tab=`, validated against a module-scope
  `const TABS = [{ id, label }] as const`, and the **first tab deletes the
  param** (`p.delete('tab')`) rather than writing `?tab=<first>`.
- `PageHeaderProps.eyebrow`'s JSDoc still lists the old group names
  ("Overview · Operate · Build · Comply · System · Admin").
- `app/src/shared/components/ui/Tabs.tsx` has **no vertical or rail variant**
  (`variant: 'default' | 'pills'`, `aria-orientation="horizontal"` hardcoded), so
  the rail is a new component, not a Tabs variant.

### Frontend

#### 1. `app/src/components/layout/navigation.ts`

Add the second level to the types:

```ts
/** One tab of a page, as the page's own `TABS` const declares it. */
export interface NavTab {
  /** The `?tab=` value. The first tab of a page omits the param. */
  id: string;
  label: string;
}

/** One entry of a row's second-level rail. Its own page, its own tabs. */
export interface NavRailItem {
  label: string;
  path: string;
  icon: LucideIcon;
  tabs?: NavTab[];
}
```

and on `NavItem`:

```ts
  /** Second-level rail rendered by `SectionRail` while this row is active. */
  rail?: NavRailItem[];
  /** This page's own tabs, when it has no rail. First tab = the bare path. */
  tabs?: NavTab[];
```

Make `NavGroup.label` optional (`label?: string`) — a group of one row carries no
eyebrow.

Regroup `NAV_GROUPS` into, in this order:

| id | label | items |
| -- | ----- | ----- |
| `dashboard` | *(none)* | Dashboard |
| `operate` | `Operate` | Fleet · Control Center · Alerts · Digital Twin |
| `automate` | `Automate` | Agent Mode · Patrol · Guide · Automations |
| `build` | `Build` | Skill Training · Data Collection · Datasets · Training · Models · Deployments · Fleet Learning · Marketplace |
| `comply` | *(none)* | Compliance |
| `system` | `System` | Updates · Docs · Settings |
| `admin` | `Admin` | Organizations · Team |

Still 23 rows: `overview` is renamed `dashboard` and loses its label, `comply`
loses its label, and the four automation rows move out of Operate into a new
`automate` group. Every `path`, `icon`, `requiresRole`, `requiresFeature`,
`alsoActiveOn` and comment is carried over unchanged. `system` and `admin` stay
exactly as they are — [[TASK-279]] removes them.

Declare `tabs` on every row whose page has a tab bar today. **Copy the ids and
labels verbatim from the page's own `TABS` const** — do not invent or re-word
them. The pages to read:

| Row | File to copy `TABS` from |
| --- | ------------------------ |
| Fleet | `app/src/features/fleet/pages/FleetPage.tsx` |
| Alerts | `app/src/features/alerts/pages/AlertsPage.tsx` |
| Patrol | `app/src/features/patrol/pages/PatrolPage.tsx` |
| Guide | `app/src/features/tour/pages/TourPage.tsx` |
| Data Collection | `app/src/features/datacollection/pages/DataCollectionPage.tsx` |
| Training | `app/src/features/training/pages/TrainingPage.tsx` |
| Deployments | `app/src/features/deployment/pages/DeploymentsPage.tsx` |
| Fleet Learning | `app/src/features/fleetlearning/pages/FleetLearningPage.tsx` |
| Compliance | `app/src/features/compliance/pages/CompliancePage.tsx` |

Rows whose pages have no tab bar (Dashboard, Control Center, Agent Mode,
Automations, Skill Training, Datasets, Models, Marketplace, Digital Twin,
Updates, Docs, Settings, Organizations, Team) get no `tabs`.

Then add the flattener the ⌘K palette ([[TASK-280]]) and the guard test both read:

```ts
export type NavDestinationKind = 'row' | 'rail' | 'tab';

export interface NavDestination {
  label: string;
  /** Where clicking it goes, `?tab=` included when it is a tab. */
  path: string;
  kind: NavDestinationKind;
  icon: LucideIcon;
  /** The group's label, or undefined for the unlabelled bookend groups. */
  group?: string;
  /** The row this destination hangs under — its own label for a row. */
  row: string;
}

/**
 * Every place the navigation can take you: each row, each rail item, each tab.
 * The single enumeration — the palette reads this, so nothing declared in the
 * model can become unreachable.
 */
export function navDestinations(groups: NavGroup[]): NavDestination[];
```

Rules `navDestinations` must follow:

- One entry per row, then its rail items, then the tabs (a rail item's tabs hang
  off that rail item, a row's own tabs off the row).
- A tab's path follows the app's own convention: the **first** tab of a page is
  the bare path (`/fleet`), every later tab is `path?tab=id`
  (`/fleet?tab=list`). Never `?tab=<first>`.
- A tab's `row` is the label of the row it ultimately belongs to; a rail item's
  `row` is its own label; `group` is the owning group's `label` (may be
  undefined).
- Order is the model's order, top to bottom — the palette shows it unsorted for
  an empty query.
- Pure function, no hooks, exported for tests.

#### 2. `app/src/components/layout/NavList.tsx`

- Skip the `<h2>` entirely when `group.label` is undefined, in every variant. The
  section then gets `aria-label={group.items[0].label}` instead of
  `aria-labelledby` (a `<section>` with no accessible name is not a landmark).
- The `rail` variant keeps its `role="separator"` between groups, including
  around unlabelled ones.
- Nothing else changes: `Shell.test.tsx` asserts
  `expect(screen.queryByRole('button')).toBeNull()` for the sidebar, so do not
  add anything button-like.

#### 3. New `app/src/components/layout/SectionRail.tsx`

```ts
export interface SectionRailProps { className?: string }
export function SectionRail({ className }: SectionRailProps): JSX.Element | null
```

- Reads `useVisibleNavGroups()` and `useLocation()`, finds the row for which
  `isNavItemActive(item, pathname)` is true, and returns `null` unless that row
  has a `rail`. Also `null` when nothing matches.
- Renders `<nav aria-label="Section">` holding one `<Link>` per rail item,
  `aria-current="page"` on the active one (`isNavItemActive` semantics: own path
  or anything under it). Horizontally scrollable on narrow screens
  (`overflow-x-auto`), never wrapping.
- Look: a segmented track, visually distinct from the underline `Tabs` a page
  renders below it. Reuse the existing tokens —
  `rounded-control border border-line-subtle bg-inset p-0.5` for the track,
  `bg-raised text-ink-primary` for the active item, `text-ink-secondary
  hover:text-ink-primary` for the rest, `focusRing` from
  `@/shared/components/ui`, icons `h-4 w-4 strokeWidth={1.75}`. Lift the exact
  classes from `shared/components/ui/SegmentedControl.tsx` so it matches the
  house style; do not invent new colours.
- Export it from `app/src/components/layout/index.ts`.
- **One rule, no exceptions:** the rail renders wherever the owning row is
  active, detail and editor routes included. That is deliberate — the rail is the
  row's chrome, not the page's.

#### 4. `app/src/components/layout/AppLayout.tsx`

Render `<SectionRail />` inside the content column, directly after
`<AlertBanner />` and before `{children}`. It is `null` for every row that has no
rail, so nothing changes visually in this slice.

#### 5. Page eyebrows follow the group labels

`PageHeader`'s `eyebrow` is documented as the nav group label, so:

- The four rows that moved into `Automate` change `eyebrow="Operate"` →
  `eyebrow="Automate"` on their pages **and their sub-routes**:
  `features/agentmode/pages/AgentModePage.tsx`,
  `features/patrol/pages/PatrolPage.tsx` + `RouteEditorPage` + `RunDetailPage`,
  `features/tour/pages/TourPage.tsx` + `TourEditorPage` + `TourRunDetailPage`,
  `features/processes/pages/ProcessesPage.tsx`,
  `features/processes/pages/ProcessDetailPage.tsx` and
  `features/processes/components/TaskDetailPanel.tsx`.
  Find them all with `grep -rn 'eyebrow="Operate"' app/src` and change only the
  ones in that list — Fleet, Control Center, Alerts, Digital Twin and the robot
  pages stay `Operate`.
- The two unlabelled bookend rows drop the eyebrow instead of inventing one:
  remove `eyebrow="Overview"` from `features/dashboard/pages/DashboardPage.tsx`
  (line ~59) and `eyebrow="Comply"` from the `Header` helper in
  `features/compliance/pages/CompliancePage.tsx`. Their `<h1>` already says what
  the page is.
- Update the `eyebrow` JSDoc in `app/src/shared/components/ui/PageHeader.tsx` to
  the new set: `Operate · Automate · Build · System · Admin`.

## Acceptance Criteria

- [ ] `NavGroup.label` is optional; `NavList` renders no `<h2>` for a group
      without one and gives that section an `aria-label` instead
- [ ] `NAV_GROUPS` has the seven groups above in that order, still 23 rows, with
      labels `Operate`, `Automate`, `Build`, `System`, `Admin` and no label on
      `dashboard` or `comply`
- [ ] Agent Mode, Patrol, Guide and Automations sit in `automate`, and every one
      of their pages and sub-pages reads `eyebrow="Automate"`
- [ ] `DashboardPage` and `CompliancePage` render no eyebrow
- [ ] Every row whose page has a `TABS` const declares `tabs` with the same ids
      and labels, verbatim
- [ ] `navDestinations(NAV_GROUPS)` returns every row, every rail item and every
      declared tab exactly once, in model order, with the first tab of a page
      mapped to the bare path and later tabs to `path?tab=id`
- [ ] `SectionRail` returns `null` for every row in the model today, and renders
      one `aria-current="page"` link per rail item for a fixture row that has one
- [ ] `AppLayout` renders `SectionRail` above the page content
- [ ] `Sidebar`, `MobileNav` and `DemoFeaturePlaceholder` still work unchanged;
      `Shell.test.tsx` passes with the new group set
- [ ] `cd app && npx tsc --noEmit` is clean and `npm run test` passes

## Test Strategy

- `app/src/components/layout/__tests__/navigation.test.ts` — rewrite the group
  assertions for the seven groups and the two unlabelled ones; keep the whole
  existing `it.each` URL→active-row table green (`/robots/r-1` → Fleet,
  `/robots/r-1/cockpit` → Control Center, `/incidents/i-1` → Alerts,
  `/docs/architecture` → Docs, `/fleet` not active on `/fleet-learning`, nothing
  active on `/account`); keep the four `filterNavGroups` gate cases
- New `navDestinations` tests: total count equals rows + rail items + tabs; no
  duplicate paths; `/fleet` and `/fleet?tab=list` both present and `/fleet?tab=map`
  absent; a row with a rail contributes its rail items' tabs, not its own
- New `app/src/components/layout/__tests__/SectionRail.test.tsx` — `null` when the
  active row has no rail; three links with the middle one `aria-current="page"`
  for a fixture row, rendered in a `MemoryRouter` with `useFeatures` and
  `authStore` mocked the way `Shell.test.tsx` does it
- `Shell.test.tsx` — the collapsed rail still shows `separator`s and accessible
  names with an unlabelled group in the model; the sidebar still has no buttons
