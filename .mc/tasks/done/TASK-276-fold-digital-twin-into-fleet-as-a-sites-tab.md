---
id: "TASK-276"
aliases: []
title: "Fold Digital Twin into Fleet as a Sites tab"
slug: "fold-digital-twin-into-fleet-as-a-sites-tab"
status: "done"
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

# Fold Digital Twin into Fleet as a Sites tab

## Description

`Digital Twin` is a sidebar row of its own for a gallery of scanned rooms that
only ever describes the places the fleet works in. It becomes **Fleet's third
tab** — `Map · Robots · Sites` — and the row leaves the sidebar. The twin viewer
`/sites/:siteId` stays a full route, because it is a 3D workspace, not a tab.

Parent: [[TASK-273]]. Blocked by [[TASK-275]] (the model has to be able to
declare tabs first).

## Details

### Current state (verified 2026-09-12)

- `app/src/features/digitaltwin/pages/SitesGalleryPage.tsx` (199 lines) renders
  `PageHeader eyebrow="Operate" title="Digital Twin"` with the description "Rooms
  scanned in 3D by a robot — the ground truth for zones, routes and simulation.",
  a `Button` "New scan" as its only header action, a `Toolbar` with a
  `SearchInput` and a status `Select`, the card grid, and `NewScanModal`. It has
  **no tab bar of its own** — which is why it fits a tab.
- Its five status filters (`SitesGalleryPage.tsx:29-35`), value→label:
  `draft`→Empty, `recording`→Scanning, `processing`→Building, `ready`→Scanned,
  `failed`→Failed.
- It subscribes with `useTwinEvents({ onSessionProgress, onTwinReady })`
  (lines 63-73), which drives the per-card build progress bars. Cards navigate
  with `navigate(`/sites/${id}`)`; `NewScanModal.onCreated` does the same.
- `app/src/features/fleet/pages/FleetPage.tsx` declares
  `const TABS = [{ id: 'map', label: 'Map' }, { id: 'list', label: 'Robots' }] as const;`
  reads `?tab=` with `params.get('tab') === 'list' ? 'list' : 'map'`, and writes
  it with the updater form of `setParams` deleting the param for `map`. Its
  header actions are already **tab-dependent** (Draw zone / New zone appear on
  the Map tab). Its `list` tab renders `<RobotsPage />`, which is deliberately
  header-less — `RobotsPage.tsx:12` says *"No PageHeader: FleetPage renders it."*
  That is the pattern to copy.
- `ZoneFormModal` is mounted outside the tab switch, i.e. always.
- `app/src/App.tsx`: `/sites` → `LazySitesGalleryPage` (line 206),
  `/sites/:siteId` → `LazyTwinViewerPage` (line 214). Redirect convention, from
  the same file: `<Route path="/robots" element={<Navigate to="/fleet?tab=list" replace />} />`
  under a `{/* … (TASK-nnn) */}` comment.
- `app/src/features/digitaltwin/pages/TwinViewerPage.tsx` (345 lines) has
  `eyebrow="Operate"`, `back={{ to: '/sites', label: 'Digital Twin' }}` and its
  own tabs `scan` / `zones`.

### Frontend

1. **Extract the gallery body.** New
   `app/src/features/digitaltwin/components/SitesGallery.tsx` holding everything
   `SitesGalleryPage` renders **below** the header: the `Toolbar` (search + the
   five-value status `Select`), the card grid, the `useTwinEvents` subscription,
   the empty/error/loading states and `NewScanModal`. Header-less by design, with
   the same file-header comment style as `RobotsPage.tsx`. It takes
   `{ className?: string }` plus whatever it needs to let the parent open the
   modal — the simplest shape that works is an imperative-free one: keep
   `NewScanModal`'s open state inside `SitesGallery` and expose it through a
   prop pair `{ newScanOpen: boolean; onNewScanOpenChange: (open: boolean) => void }`
   so `FleetPage`'s header button can open it. Export it from the feature barrel.
2. **Delete `SitesGalleryPage.tsx`** and its `LazySitesGalleryPage` entry in
   `app/src/routes/lazyPages.ts`, plus the `/sites` route's element. Check the
   feature's `index.ts` barrel and `pages/index.ts` for the export and remove it.
3. **`FleetPage.tsx`:**
   - `TABS` gains `{ id: 'sites', label: 'Sites' }` after `list`.
   - Replace the two-way `?tab=` read with the repo's standard validated form:
     `const tab: FleetTab = TABS.some((t) => t.id === requested) ? requested : 'map'`,
     keeping the `p.delete('tab')` behaviour for `map`.
   - Body: `{tab === 'sites' && <SitesGallery newScanOpen={…} onNewScanOpenChange={…} />}`.
   - Header actions: on the `sites` tab, a single primary `Button` "New scan"
     that opens the modal; the Map tab's Draw-zone/New-zone pair and the Robots
     tab's actions are unchanged.
   - The existing `useEffect` that leaves draw mode when the tab is not `map`
     must also fire for `sites` (it keys off the tab, so check it still does).
4. **`App.tsx`:** `/sites` becomes
   `<Route path="/sites" element={<Navigate to="/fleet?tab=sites" replace />} />`
   with a `{/* Digital Twin — merged into Fleet tabs (TASK-276). Viewer route stays. */}`
   comment. `/sites/:siteId` is untouched.
5. **`TwinViewerPage.tsx`:** `back` becomes
   `{ to: '/fleet?tab=sites', label: 'Fleet' }`. Eyebrow stays `Operate`.
6. **`navigation.ts`:** delete the `Digital Twin` row from `operate`. The `Fleet`
   row gains the `sites` tab in its `tabs` array and
   `alsoActiveOn: [/^\/robots\/[^/]+\/?$/, /^\/sites(\/|$)/]` so the twin viewer
   keeps the Fleet row lit.

### Accepted trade-off

Switching to Fleet's Map or Robots tab unmounts `SitesGallery` and with it the
`useTwinEvents` subscription, so a running scan's progress bar stops animating
until the tab is opened again. The build itself is server-side and unaffected,
and the gallery re-subscribes and re-fetches on mount. This is the reason the
**twin viewer** stays a full route instead of becoming a fourth tab: the viewer
owns a point-cloud stream and a scan session, which must not be torn down by a
tab click.

## Acceptance Criteria

- [ ] The sidebar has no `Digital Twin` row; `Operate` is Fleet · Control Center · Alerts
- [ ] `/fleet` shows three tabs `Map · Robots · Sites`; `?tab=sites` deep-links to
      the gallery and `?tab=map` is never written to the URL
- [ ] The Sites tab keeps every view the old page had: search, the five status
      filters (Empty · Scanning · Building · Scanned · Failed), the card grid with
      live build progress, the empty and error states, and New scan
- [ ] "New scan" appears in the Fleet header only on the Sites tab, and creating a
      scan still navigates to `/sites/:siteId`
- [ ] `/sites` redirects to `/fleet?tab=sites`; `/sites/:siteId` still renders the
      twin viewer, whose back link now reads "Fleet" and goes to `/fleet?tab=sites`
- [ ] The Fleet row is active on `/fleet`, `/robots/:id` and `/sites/:siteId`
- [ ] Zone drawing on the Map tab is unaffected: drawing is cancelled when the tab
      changes to `sites`, Esc still cancels, `ZoneFormModal` still mounts
- [ ] `cd app && npx tsc --noEmit` clean, `npm run test` green

## Test Strategy

- `app/src/components/layout/__tests__/navigation.test.ts` — no `Digital Twin`
  row; `/sites/s-1` → Fleet; `/fleet?tab=sites` present in
  `navDestinations(NAV_GROUPS)`
- A `FleetPage` test (or extend the existing fleet tests if there are any):
  `?tab=sites` renders the gallery and the "New scan" action; `?tab=map` renders
  the map and does not render the gallery
- A `SitesGallery` test: the five filter options are present and filtering by
  `ready` shows only scanned rooms — mock `twinZoneApi`/the twin store the way the
  existing digitaltwin tests do (check `app/src/features/digitaltwin/**/__tests__`
  first and follow whatever is there)
- Redirect coverage for `/sites` in the App-level route test if one exists;
  otherwise assert it in the navigation test's redirect table
- Playwright: from `/dashboard`, open Fleet → Sites, open a site, come back via
  the back link
