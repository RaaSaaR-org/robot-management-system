---
id: "TASK-261"
aliases: []
title: "Move the app onto the landing design system"
slug: "move-the-app-onto-the-landing-design-system"
status: "in-progress"
priority: 2
owner: "huhn511"
projects: []
customers: []
tags: [core, design, frontend]
sprint: ""
parent: "[[TASK-260]]"
depends_on: []
spe: 8
effort: "high"
due_date: ""
created: "2026-09-11"
updated: "2026-09-11"
---

# Move the app onto the landing design system

## Description

Switch the whole app from cobalt and glass to the landing tokens and type, give it a matte UI kit with one CRUD pattern, rebuild the shell and navigation, and rewrite the design docs. Every later page task (TASK-262 to TASK-268) only uses what this task defines. Executed as three slices on one branch: tokens and kit, shell, docs and review, each within the spe ceiling.

## Details

### Current state

See the survey in [[TASK-260]]. In short: cobalt/turquoise scales and a `--glass-*` system in `app/src/index.css`; glass `.card`/`.glass*` classes; a 16-file kit in `app/src/shared/components/ui/` with cobalt buttons, glass cards and raw-hue badges; a glass top bar and a sidebar whose active item is a solid cobalt block; no table, select, form field, confirm dialog or toast primitives.

### Frontend

1. **Tokens and type** (`app/src/index.css`, `app/src/brand/*`). Dark is the default and matches the landing ground (`#080f18`). The full token table, light values included, is in the design contract that this task writes into `docs/brand.md`. Add the utilities `bg-canvas`, `bg-panel`, `bg-inset`, `bg-raised`, `bg-field`, `border-line(-subtle|-strong)`, `text-ink-muted`, `bg-primary-hover`, `text-on-primary`, `bg-stop`, `text-on-stop`, and the radii `rounded-panel`/`rounded-control`/`rounded-tag`. Re-point the default brand scales to mint, keep white-label overrides working, and add `onPrimary`/`onAccent` to `BrandConfig`. Make the legacy `cobalt-*`/`turquoise-*` utilities aliases of the primary/accent ramps, and turn `.glass*`/`.card` into matte surfaces without `backdrop-filter`, so unmigrated pages already look right. Codemod every `text-white` on a primary fill to `text-on-primary`. Default theme: dark.
2. **Kit** (`app/src/shared/components/ui/`). Restyle `Button`, `Badge`, `Card`, `Input`, `Modal`, `Tabs`, `PageHeader` (+ `eyebrow`, `back`, `description`), `EmptyState`, `SegmentedControl`, `Tooltip`, `ProgressBar`, `Spinner`, `PageLoader`. Add `Panel`, `StatTile`, `StatRow`, `Toolbar`, `KeyValueList`, `Eyebrow`, `Divider`, `LinkButton`, `RowActions`/`DropdownMenu`, `FormField`, `SearchInput`, `Textarea`, `Select`, `Checkbox`, `Switch`, `FormModal`, `ConfirmDialog`, `toast`/`useToast`/`ToastProvider`, `ErrorState`, `Skeleton`, `StatusTag`, `statusTone`, `chartColors`, `DataTable`. Keep every existing export and prop working so the 242 importers still compile. A dev-only `/design-system` route renders every primitive in every state.
3. **Shell** (`app/src/components/layout/*`). Matte top bar and sidebar, the group structure Overview · Operate · Build · Comply · System · Admin (the Models page joins Build), an active item in `bg-primary/10` with a 2px bar, an icon rail when collapsed, the same groups in the mobile drawer, the alarm banner on `bg-stop`. Mount `ToastProvider`. Delete the unused `DashboardLayout.tsx` and `AuthLayout.tsx`.
4. **Docs.** Rewrite `docs/brand.md` as the design contract (tokens, type, page anatomy, CRUD pattern, kit, shell, testing) and bring `app/AGENTS.md` in line with it.

**Key files:** `app/src/index.css`, `app/src/brand/{types,defaults,BrandProvider}.ts(x)`, `brand/_template/*`, `app/src/features/settings/store/themeStore.ts`, `app/src/shared/components/ui/*`, `app/src/components/layout/*`, `app/src/components/common/*`, `app/src/App.tsx`, `app/src/routes/lazyPages.ts`, `docs/brand.md`, `app/AGENTS.md`.

## Acceptance Criteria

- [ ] In dark mode every app route paints `rgb(8, 15, 24)` behind the content, and no element outside the landing page has a `backdrop-filter`.
- [ ] No primary fill in `app/src` carries `text-white`, and a brand config with an orange primary renders readable buttons.
- [ ] Every primitive named above exists, is exported from `@/shared/components/ui`, and renders on `/design-system` in dark and light.
- [ ] The shell matches the contract at 1440px, 800px and 390px wide, including the collapsed rail and the mobile drawer.
- [ ] `docs/brand.md` and `app/AGENTS.md` describe the new language and the CRUD pattern.
- [ ] `npx tsc`, `npx vitest run` and `npx playwright test` pass.

## Test Strategy

- `npx tsc`, `npx vitest run`, `npx playwright test` (with `PLAYWRIGHT_PORT` set when 4173 is busy).
- Unit tests for `statusTone`, `ConfirmDialog`, `DataTable` and the toast queue.
- Screenshots of `/design-system` and of ten representative routes at 1440/390 in dark and light, read by a person or a reviewing agent.
