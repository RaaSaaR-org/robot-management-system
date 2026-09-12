---
id: "TASK-280"
aliases: []
title: "A command palette over every navigation destination"
slug: "a-command-palette-over-every-navigation-destination"
status: "done"
priority: 2
owner: "huhn511"
projects: []
customers: []
tags: [core, app]
sprint: ""
parent: "[[TASK-273]]"
depends_on: ["[[TASK-275]]"]
spe: 5
effort: "medium"
due_date: ""
created: "2026-09-12"
updated: "2026-09-12"
---

# A command palette over every navigation destination

## Description

Cutting 23 rows to 10 only works if the demoted pages stay findable. ⌘K opens a
palette over **every** destination the nav model knows — each row, each rail item,
each tab — so a page that lost its row did not lose its way in. This is the slice
that makes the cut safe, and the guard test in it is what stops the sidebar
growing back.

Parent: [[TASK-273]]. Blocked by [[TASK-275]], which adds `navDestinations`.

## Details

### Current state (verified 2026-09-12)

- **There is no ⌘K, no palette and no global keyboard-shortcut hook anywhere in
  `app/src`.** Nothing in the repo references `metaKey` or `ctrlKey`. This is
  greenfield.
- Existing global `keydown` listeners, all Esc-only and all scoped to an open
  thing: `Modal.tsx` (Esc + Tab trap, gated by an open-dialog stack),
  `useTopBarMenu.ts`, `MobileNav.tsx`, `OrchestratorDrawer.tsx`, `FleetPage.tsx`
  (only while drawing a zone). The one listener that eats plain letters is
  `features/robots/components/tabs/TeleopTab.tsx` (WASD driving) — requiring a
  modifier keeps the palette clear of it.
- `shared/components/ui/Modal.tsx` is the right base: portal, real focus trap,
  Esc-to-close, backdrop click, focus restored to the opener, refcounted scroll
  lock, a nesting stack so only the top dialog reacts to Esc, `initialFocusRef` /
  `[data-autofocus]`, `size: 'sm'|'md'|'lg'|'xl'|'full'`, bottom-sheet below
  640px. It does **not** provide `role="listbox"` semantics or arrow-key list
  navigation — the palette adds those itself.
- **Do not use `SearchInput`**: it calls `event.stopPropagation()` on Esc while it
  has a value, which would swallow the first Esc and leave the dialog open. Use
  the plain `Input`.
- There is no `Command`/`Combobox` primitive. `features/command/**` is unrelated
  (the natural-language robot command bar).
- `navDestinations(groups)` from [[TASK-275]] returns
  `{ label, path, kind: 'row' | 'rail' | 'tab', icon, group?, row }[]` in model
  order, with a page's first tab mapped to the bare path.

### Frontend

#### 1. `app/src/components/palette/CommandPalette.tsx`

```ts
export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}
export function CommandPalette({ open, onClose }: CommandPaletteProps): JSX.Element
```

- Destinations come from `navDestinations(useVisibleNavGroups())`, so the
  palette is gated by exactly the same feature and role rules as the sidebar —
  never a second gate.
- Built on `Modal` with `size="lg"`, no title bar: an `Input` at the top
  (`data-autofocus`, `placeholder="Search pages…"`,
  `aria-controls` + `aria-activedescendant` pointing at the list), then a
  `role="listbox"` of `role="option"` rows.
- Matching: case-insensitive **subsequence** match ("dsep" finds "Deployments")
  over `label`, `row` and `group` joined. Rank exact prefix on `label` first,
  then label matches, then row/group matches; keep model order inside a rank.
  Empty query lists everything, unsorted, in model order. Pure helper
  `matchDestinations(destinations, query)`, exported for tests.
- Each row shows the destination's icon, its `label`, and a muted trail
  (`row` then `group`) when they differ from the label, so `Runs` reads
  "Runs · Patrol · Automate". A `kind: 'tab'` row is visually the same — the
  user does not care that it is a tab.
- Keys: `↑`/`↓` move (wrapping), `Home`/`End` jump, `Enter` navigates and closes,
  `Esc` closes via `Modal`. Mouse hover moves the selection so pointer and
  keyboard never disagree. The selected row is scrolled into view
  (`scrollIntoView({ block: 'nearest' })`).
- Navigation is `useNavigate()` to the destination's `path` — the `?tab=` in a
  tab's path does the rest, because every tabbed page already reads `?tab=` from
  the URL.
- Empty result: an `EmptyState` with the query echoed back.

#### 2. `app/src/components/palette/usePaletteHotkey.ts`

A `useEffect` on `document` `keydown`: `(event.metaKey || event.ctrlKey) &&
event.key.toLowerCase() === 'k'` → `preventDefault()` and toggle. Ignore repeats
(`event.repeat`). No other binding, and no plain-letter binding at all, so
`TeleopTab`'s WASD keys are untouched.

#### 3. Mount it once

`AppLayout.tsx` owns the open state, renders `<CommandPalette open onClose />`
and calls `usePaletteHotkey`. One instance for the whole shell, inside the
router, next to `MobileNav`.

#### 4. Make it discoverable

In `TopBar.tsx`, left of the help icon, a ghost `Button` that opens the palette:
a `Search` icon plus a `<kbd>` hint rendering `⌘K` on Apple platforms and `Ctrl K`
elsewhere (`navigator.platform`/`userAgent` check in a small helper, guarded for
SSR-less safety). Hide the hint below `sm` but keep the button.

### Explicitly out of scope

Entity search (robots, datasets, deployments by name) needs a server-side search
endpoint across 83 Prisma models; this slice is navigation-only, client-side, no
API call. Recents and pinning are out too.

## Acceptance Criteria

- [ ] ⌘K (and Ctrl+K) opens the palette from any page in the shell; Esc closes it;
      the trigger keeps focus afterwards
- [ ] With an empty query the palette lists every destination
      `navDestinations(useVisibleNavGroups())` returns, in model order
- [ ] Typing filters by subsequence over label, row and group; `Enter` navigates
      to the selected destination and closes the palette
- [ ] `↑`/`↓` wrap, `Home`/`End` jump, hover and keyboard share one selection, and
      the selected row stays in view
- [ ] The palette respects the model's gates: a `member` with multi-tenancy off
      sees no destination a `filterNavGroups` pass would hide
- [ ] Choosing a tab destination lands on the right tab (e.g. "Visits" →
      `/tour?tab=visits` with the Visits tab open)
- [ ] The top bar has a search affordance showing `⌘K` / `Ctrl K` that opens the
      same palette
- [ ] `⌘K` does not fire while a plain letter key is pressed, and `TeleopTab`'s
      WASD driving still works
- [ ] `cd app && npx tsc --noEmit` clean, `npm run test` green

## Test Strategy

- **The guard test** — `app/src/components/palette/__tests__/coverage.test.ts`:
  for every group, row, rail item and tab reachable by walking `NAV_GROUPS` by
  hand, assert a matching entry exists in `navDestinations(NAV_GROUPS)`, and that
  the two counts are equal. It fails the moment someone adds a row, rail item or
  tab the palette cannot enumerate — which is the whole point of keeping the
  second level in `navigation.ts`
- `matchDestinations` unit tests: subsequence hits, ranking (exact prefix first),
  empty query returns everything in order, no match returns `[]`
- `CommandPalette.test.tsx` (RTL, `MemoryRouter`, `useFeatures` and `authStore`
  mocked as in `Shell.test.tsx`): opens on ⌘K; arrow keys move
  `aria-activedescendant`; `Enter` calls the router with the expected path;
  gate case for a `member`; Esc closes
- Playwright: ⌘K → type "lidar"-adjacent terms to reach Control Center, and ⌘K →
  "visits" to land on the Guide page's Visits tab
