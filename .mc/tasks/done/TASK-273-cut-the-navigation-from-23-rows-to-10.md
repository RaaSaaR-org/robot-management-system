---
id: "TASK-273"
aliases: []
title: "Cut the navigation from 23 rows to 10"
slug: "cut-the-navigation-from-23-rows-to-10"
status: "done"
priority: 2
owner: "huhn511"
projects: []
customers: []
tags: [core, app]
sprint: ""
parent: ""
depends_on: []
spe:
effort: ""
due_date: ""
created: "2026-09-12"
updated: "2026-09-12"
---

# Cut the navigation from 23 rows to 10

## Description

The sidebar carries 23 entries across six groups, all of them always rendered,
and it reads as a list of everything rather than a map of the product. This epic
cuts it to 10 rows in **one** workspace — no Operate/Build app split, no mode
switch — by promoting hubs, demoting their stages behind a second-level rail,
merging the structural twins, and moving the three entries that were never
navigation (Docs, Settings, Updates) out of the sidebar. It ships with a ⌘K
palette so nothing demoted becomes unreachable.

Decisions and the alternatives they rejected:
[`docs/records/TASK-273-cut-the-navigation-from-23-rows-to-10.md`](../../../docs/records/TASK-273-cut-the-navigation-from-23-rows-to-10.md).

## Details

### Current state (found 2026-09-12)

`app/src/components/layout/navigation.ts` declares six groups and **23 items**.
`NavList.tsx` renders every item of every visible group — static eyebrows, no
accordions — so the column scrolls; `Sidebar.tsx` is a 224px column that becomes
a 64px icon rail when collapsed, and `MobileNav.tsx` reads the same model.

| Group | n | Entries |
| ----- | - | ------- |
| Overview | 1 | Dashboard |
| Operate | 8 | Fleet · Control Center · Agent Mode · Patrol · Guide · Automations · Alerts · Digital Twin |
| Build | 8 | Skill Training · Data Collection · Datasets · Training · Models · Deployments · Fleet Learning · Marketplace |
| Comply | 1 | Compliance |
| System | 3 | Updates · Docs · Settings |
| Admin | 2 | Organizations · Team (multi-tenancy + owner/super-admin) |

Facts that shaped the target:

- **Demoting a page to a tab is an established pattern.** `App.tsx` already holds
  ~11 redirects from retired top-level routes into tabs (`/evaluation` and
  `/simulation` → Training, `/gdpr` `/oversight` `/approvals` `/explainability`
  → Compliance, `/incidents` → Alerts, `/skills` → Deployments, `/contributions`
  → Marketplace, `/robots` → Fleet, `/tasks` → Processes).
- **`/pipeline` duplicates five rows.** `features/pipeline/pages/PipelinePage.tsx`
  is a stepper over collect → dataset → train → evaluate → deploy, and the
  sidebar lists the hub *and* all five stages.
- **Tabs cannot be the demotion mechanism.** The pages being demoted already own
  tab bars — Data Collection 3, Training 3, Fleet Learning 4, Patrol 2, Guide 2,
  Compliance 7. A second tab row stacked above those reads worse than the long
  sidebar. Demoted areas therefore need a **rail one level above the page's own
  tabs**.
- **`/control-center` and `/robots/:id/cockpit` are the same component**
  (`RobotCockpitPage`); the control-center route auto-picks a robot.
- **`TourPage.tsx`'s own header calls itself "the structural twin of /patrol"** —
  same shape, same route family (`routes/:id`, `runs/:runId`).
- **Roles are tenancy-shaped**, not job-shaped:
  `UserRole = 'super-admin' | 'owner' | 'member' | 'viewer'`. There is no
  operator/engineer axis, so nothing in this epic may depend on one.
- **There is no ⌘K or search anywhere in `app/src`.** The sidebar is currently
  the only way to reach anything.
- **Two spatial systems exist**: `Zone` (flat `bounds` + `floor`, drawn in
  Fleet's Map tab) and `TwinZone` (twin-bound, `twinZoneApi`, reached via Sites).
  Unifying them is **out of scope** here — see TASK-274.

### Target navigation (10 rows)

```
  Dashboard
OPERATE    Fleet · Control Center · Alerts
AUTOMATE   Agent Mode · Missions
BUILD      Skill Training · Deployments · Marketplace
  Compliance
```

`Dashboard` and `Compliance` are plain rows with no group label — a label over a
single row is the pattern removed with the old `Overview` group. Group labels are
verbs: **Operate · Automate · Build**.

Second-level rails and tabs:

| Row | Second level |
| --- | ------------ |
| Fleet | tabs `Map · Robots · Sites` — [[TASK-276]] |
| Missions | rail `Patrol · Guide · Automations` — [[TASK-277]] |
| Skill Training | rail `Overview · Collect · Datasets · Train · Models · Learning` — [[TASK-278]] |

Out of the sidebar entirely:

| Was | Becomes |
| --- | ------- |
| Updates | a fourth `Settings` tab (Appearance · Notifications · Dashboard · Updates) |
| Docs | a help icon in `TopBar`, beside the theme toggle; `/docs` and `DocsSidebar` unchanged |
| Settings | user menu, next to "Account settings" |
| Organizations · Team | the `OrganizationSwitcher` menu, role gates unchanged |

### Views inventory — nothing may be lost

Every demoted page keeps every view it has today. The audit that must stay true:

| Page | Views that must survive |
| ---- | ----------------------- |
| Control Center | `CockpitViewport` (pose/camera), **`CockpitPerceptionPanel` — the LiDAR/point-cloud panel, gated to G1-family + H1**, `CockpitVitals`, `CockpitCommandDock` (E-stop), robot picker |
| Agent Mode | `BlockTimeline`, `AgentChat` + `AgentVoiceBar`, `KnowledgePanel`, `ConditionAnnouncer`, `EstopBanner`, `SelfHeader`, `PlaceChip`, `TourStopChip` |
| Patrol | tabs Routes · Runs, three-tile summary, live runs, `RouteEditorPage`, `RunDetailPage` |
| Guide | tabs Tours · Visits, three-tile summary, tours in progress, `TourEditorPage`, `RunDetailPage` |
| Automations | process list, `CreateProcessModal`, `/processes/:id` |
| Digital Twin | gallery with its five status filters, `TwinViewerPage` (`/sites/:siteId` stays a full route) |
| Data Collection | tabs Sessions · Priorities · Uncertainty; `/data-collection/new`, `/:sessionId`, `/record/:sessionId` |
| Datasets | table, `DatasetEpisodesPage`, upload / HF import / synthetic generate, mixtures |
| Training | tabs Jobs · Simulation · Evaluation |
| Models | registry + versions, the Deploy handoff to `/deployments?new=<id>` |
| Fleet Learning | tabs Rounds · Convergence · Privacy · ROHE, `/fleet-learning/rounds/:id` |
| Updates | packages, approve, deploy to robot, roll back |

`/a2a` (the four-page A2A chat) is reachable today only from a robot's Info tab.
It gets no row and is not retired — the palette is what makes it findable.

### Frontend

`app/src/components/layout/navigation.ts` is the single source of truth and must
stay one. Rails and tabs belong **in that model**, not hardcoded per page, because
the palette enumerates it.

Key files:

- `app/src/components/layout/navigation.ts` — groups, rows, rails, tabs; keep
  `isNavItemActive`, `filterNavGroups`, `useVisibleNavGroups` as the only gates
- `app/src/components/layout/NavList.tsx` — 10 rows, three verb groups, two
  unlabelled bookend rows, rail variant
- `app/src/components/layout/Sidebar.tsx`, `MobileNav.tsx` — same model, no drift
- `app/src/components/layout/TopBar.tsx` — help icon → `/docs`
- `app/src/components/layout/UserMenu.tsx` — Settings beside Account settings
- `app/src/components/layout/OrganizationSwitcher.tsx` — Organizations, Team
- `app/src/components/layout/__tests__/navigation.test.ts` — the row/rail contract
- `app/src/App.tsx` — redirects for every retired top-level route
- `app/src/features/fleet/pages/FleetPage.tsx` — third tab `Sites`
- new Missions page hosting Patrol · Guide · Automations as tabs
- `app/src/features/pipeline/pages/PipelinePage.tsx` — the stage rail's host
- `app/src/features/settings/pages/SettingsPage.tsx` — fourth tab `Updates`

### Children (planned 2026-09-12)

| Task | Slice | spe | Depends on |
| ---- | ----- | --- | ---------- |
| [[TASK-275]] | The nav model learns rails, tabs and the verb groups; `SectionRail` in the shell; page eyebrows follow. No row removed. | 3 | — |
| [[TASK-276]] | Digital Twin becomes Fleet's `Sites` tab. | 3 | [[TASK-275]] |
| [[TASK-277]] | Patrol · Guide · Automations collapse into one `Missions` row with a rail. | 2 | [[TASK-275]] |
| [[TASK-278]] | The five build stages move behind `Skill Training`'s rail. | 3 | [[TASK-275]] |
| [[TASK-279]] | Docs, Settings, Updates, Organizations and Team leave the sidebar — this is the slice that reaches 10 rows. | 5 | [[TASK-275]] |
| [[TASK-280]] | The ⌘K palette over every row, rail item and tab, with the guard test. | 5 | [[TASK-275]] |

Two mechanism decisions were taken during planning, after reading the pages, and
are recorded in the decision record as D9 and D10:

- **Missions is a rail, not a page with tabs.** `PatrolPage` owns `Routes · Runs`
  and `TourPage` owns `Tours · Visits`, so three Missions tabs would stack two tab
  rows — the thing this epic rejected. As a rail, all three keep their routes,
  their `?tab=` state, their live subscriptions and their sub-routes, and the
  slice costs a model edit instead of a refactor.
- **`PipelineBreadcrumb` retires from the pages the Build rail covers.** The rail
  offers Overview and every sibling stage; the chip is a weaker second copy of it.
  It stays on `Deployments`, which has no rail above it.

## Acceptance Criteria

- [ ] The sidebar renders exactly 10 rows for a signed-in `member` with
      multi-tenancy off: Dashboard · Fleet · Control Center · Alerts · Agent Mode ·
      Missions · Skill Training · Deployments · Marketplace · Compliance
- [ ] Group labels read `Operate`, `Automate`, `Build`; `Dashboard` and
      `Compliance` carry no group label
- [ ] No app split and no Operate/Build mode switch exists anywhere in the shell
- [ ] Every view in the inventory table above is still reachable, the LiDAR
      `CockpitPerceptionPanel` included, with its G1-family/H1 gate intact
- [ ] Every retired top-level route redirects to its new home; no URL 404s
- [ ] Rails and tabs are declared in `navigation.ts`, not per page, and
      `Sidebar`, `MobileNav` and the palette all read that one model
- [ ] Updates is a `Settings` tab; Docs is a `TopBar` help icon; Settings sits in
      the user menu; Organizations and Team sit in the organization switcher with
      their role gates unchanged
- [ ] ⌘K opens a palette that reaches every row, rail item and tab
- [ ] `Zone`/`TwinZone` are untouched (TASK-274 owns that)

## Test Strategy

- `app/src/components/layout/__tests__/navigation.test.ts` — assert the 10 rows,
  the three group labels, the two unlabelled rows, and `isNavItemActive` for every
  rail item and demoted route
- A test that fails if a nav row, rail item or tab exists that the palette cannot
  enumerate — the one guard against the model fragmenting again
- Redirect coverage for every retired route in `App.tsx`
- Playwright: from Dashboard, reach the LiDAR panel, a patrol route editor, a
  dataset's episode viewer and the Updates tab; `./scripts/test-all.sh --skip-pw`
  for the rest
