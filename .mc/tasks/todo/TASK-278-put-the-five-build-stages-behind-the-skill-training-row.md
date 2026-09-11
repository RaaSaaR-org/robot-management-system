---
id: "TASK-278"
aliases: []
title: "Put the five build stages behind the Skill Training row"
slug: "put-the-five-build-stages-behind-the-skill-training-row"
status: "todo"
priority: 2
owner: "huhn511"
projects: []
customers: []
tags: [core, app]
sprint: ""
parent: "[[TASK-273]]"
depends_on: ["[[TASK-275]]"]
spe: 3
effort: "medium"
due_date: ""
created: "2026-09-12"
updated: "2026-09-12"
---

# Put the five build stages behind the Skill Training row

## Description

The `Build` group lists the `Skill Training` hub **and** all five stages it
already steps through, so the sidebar says the same thing six times. The five
stage rows move behind the hub's second-level rail —
`Overview · Collect · Datasets · Train · Models · Learning` — and `Build` becomes
three rows: `Skill Training · Deployments · Marketplace`. Deployments keeps its
row because it is the seam where Build hands over to Operate.

Parent: [[TASK-273]]. Blocked by [[TASK-275]].

## Details

### Current state (verified 2026-09-12)

- `app/src/features/pipeline/pages/PipelinePage.tsx` (267 lines) is the hub:
  `StageKey = 'collect' | 'dataset' | 'train' | 'evaluate' | 'deploy'`, five
  `StageCard`s each linking to its stage page, `FirstRunWizard` when nothing
  exists yet, a `setInterval(fetchAll, 10000)` refresh, and a header action that
  points at the next open stage. `eyebrow="Build"`, `title="Pipeline"`.
- The five stage pages, with their own tab bars:

  | Path | File | Own tabs |
  | ---- | ---- | -------- |
  | `/data-collection` | `features/datacollection/pages/DataCollectionPage.tsx` | Sessions · Priorities · Uncertainty |
  | `/datasets` | `features/training/pages/DatasetsPage.tsx` | none |
  | `/training` | `features/training/pages/TrainingPage.tsx` | Jobs · Simulation · Evaluation |
  | `/models` | `features/deployment/pages/ModelsPage.tsx` (title "Model Registry") | none |
  | `/fleet-learning` | `features/fleetlearning/pages/FleetLearningPage.tsx` | Rounds · Convergence · Privacy · ROHE |

  Sub-routes that must keep working: `/data-collection/new`,
  `/data-collection/:sessionId`, `/data-collection/record/:sessionId`,
  `/datasets/:datasetId/episodes`, `/fleet-learning/rounds/:id`.
- Three of them have their own tab bars, which is why the second level is a
  **rail** and not another tab row (the epic's rule: a rail sits one level above
  the page's own tabs).
- `PipelineBreadcrumb` (`shared/components/ui/PipelineBreadcrumb.tsx`) renders a
  chip "3/5 · Train stage · Pipeline overview" linking to `/pipeline`. It is used
  on `DataCollectionPage`, `NewSessionPage`, `SessionDetailPage`, `DatasetsPage`,
  `DatasetEpisodesPage`, `TrainingPage` and `DeploymentsPage`.
- `ModelsPage`'s Deploy action navigates to `/deployments?new=<modelVersionId>`,
  which `DeploymentsPage` consumes to prefill its form — that handoff must not
  break.
- `/evaluation` and `/simulation` already redirect into `/training?tab=…`.

### Frontend

1. **`navigation.ts`** — the `build` group becomes three rows. Replace the six
   with:

```ts
{
  label: 'Skill Training',
  path: '/pipeline',
  icon: GraduationCap,
  alsoActiveOn: [
    /^\/data-collection(\/|$)/,
    /^\/datasets(\/|$)/,
    /^\/training(\/|$)/,
    /^\/models(\/|$)/,
    /^\/fleet-learning(\/|$)/,
  ],
  rail: [
    { label: 'Overview', path: '/pipeline', icon: GraduationCap },
    { label: 'Collect', path: '/data-collection', icon: Video, tabs: [/* DataCollectionPage TABS */] },
    { label: 'Datasets', path: '/datasets', icon: Database },
    { label: 'Train', path: '/training', icon: Cpu, tabs: [/* TrainingPage TABS */] },
    { label: 'Models', path: '/models', icon: Brain },
    { label: 'Learning', path: '/fleet-learning', icon: Network },
  ],
},
```

   then `Deployments` and `Marketplace` unchanged. Anchor every regex — `/fleet`
   must still not be active on `/fleet-learning`, and the existing test asserts
   it. Move the `tabs` arrays [[TASK-275]] put on the Data Collection, Training
   and Fleet Learning **rows** onto the matching **rail items**; the Skill
   Training row declares no `tabs` of its own.

2. **Retire the redundant chip.** On the pages the rail now covers, the rail
   already offers "Overview" and every sibling stage, so
   `PipelineBreadcrumb` is a second, weaker copy of it. Remove the
   `<PipelineBreadcrumb …/>` from `DataCollectionPage`, `NewSessionPage`,
   `SessionDetailPage`, `DatasetsPage`, `DatasetEpisodesPage` and `TrainingPage`
   (and the now-unused import). **Keep it on `DeploymentsPage`** — Deployments is
   a row of its own with no rail above it, so the chip is still the only thing
   tying it back to the pipeline. Leave the component in the kit and in
   `shared/components/ui/index.ts`; `DeploymentsPage` still uses it.

3. **No route changes and no redirects.** All five stage paths stay exactly where
   they are — that is the point of a rail. `/pipeline` stays a route and stays the
   rail's first stop, so `FirstRunWizard` and the stepper keep their home.

4. **Eyebrows** stay `Build` on all of these pages; the group label did not
   change.

## Acceptance Criteria

- [ ] The sidebar's `Build` group is exactly three rows:
      `Skill Training · Deployments · Marketplace`
- [ ] `Skill Training` is the active row on `/pipeline`, `/data-collection`,
      `/data-collection/new`, `/data-collection/:sessionId`,
      `/data-collection/record/:sessionId`, `/datasets`,
      `/datasets/:id/episodes`, `/training`, `/models`, `/fleet-learning` and
      `/fleet-learning/rounds/:id` — and on none of them is any other row active
- [ ] `Fleet` is still not active on `/fleet-learning`, and `Deployments` is still
      its own active row on `/deployments` and `/deployments/:id`
- [ ] The rail reads `Overview · Collect · Datasets · Train · Models · Learning`
      on every one of those URLs, with `aria-current="page"` on the owning stop
- [ ] Every view survives: the five `StageCard`s and `FirstRunWizard` on
      `/pipeline`; Data Collection's three tabs and its three sub-routes;
      Datasets' New-dataset menu (upload · Hugging Face · synthetic · compatibility)
      and the episode viewer; Training's Jobs/Simulation/Evaluation tabs; the model
      registry with versions; Fleet Learning's four tabs and round detail
- [ ] `/models` → Deploy still lands on `/deployments?new=<id>` with the form
      prefilled
- [ ] `PipelineBreadcrumb` is gone from the six rail-covered pages and still
      present on `DeploymentsPage`
- [ ] `cd app && npx tsc --noEmit` clean, `npm run test` green

## Test Strategy

- `app/src/components/layout/__tests__/navigation.test.ts` — extend the URL→row
  table with all eleven URLs above; keep the `/fleet` vs `/fleet-learning`
  segment case; assert `Build` has three items and that the old `Models` row
  assertion is replaced by a rail-item assertion
- `SectionRail.test.tsx` — six links on `/datasets/d-1/episodes` with `Datasets`
  current; `Overview` current on `/pipeline`
- `navDestinations` — contains `/pipeline`, `/data-collection`,
  `/data-collection?tab=priorities`, `/datasets`, `/training`,
  `/training?tab=simulation`, `/models`, `/fleet-learning`,
  `/fleet-learning?tab=privacy`; contains no `?tab=` entry for a first tab
- Grep-level check in the test run: no `PipelineBreadcrumb` import remains in the
  six pages
- Playwright: from `/dashboard`, reach a dataset's episode viewer and a training
  job through the sidebar and the rail only, then use the rail's Overview stop to
  get back to the stepper
