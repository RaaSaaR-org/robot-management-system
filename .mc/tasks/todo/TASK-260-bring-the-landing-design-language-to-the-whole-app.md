---
id: "TASK-260"
aliases: []
title: "Bring the landing design language to the whole app"
slug: "bring-the-landing-design-language-to-the-whole-app"
status: "in-progress"
priority: 2
owner: "huhn511"
projects: []
customers: []
tags: [core, design, frontend]
sprint: ""
parent: ""
depends_on: []
spe:
effort: ""
due_date: ""
created: "2026-09-11"
updated: "2026-09-11"
---

# Bring the landing design language to the whole app

## Description

The public landing page now speaks one visual language (TASK-256, TASK-258, TASK-259): a dark matte ground, a mint primary, honest signal colors, Archivo for headlines, Inter for every normal text and mono only for code. The product behind "Open App" still speaks the old one: cobalt, glassmorphism and mono labels. This epic brings the whole app over. It is also a UX redesign: every page is rethought, and every page gets the same look and the same way of doing things — one page anatomy, one CRUD pattern, one set of buttons, states and status tags. Every page is opened and clicked through in a real browser before it counts as done.

## Scope (2026-09-11)

The user asked for three things on top of the original plan:

1. **Rethink every page, not only restyle it.** Each page gets a UX pass: what it is for, what the operator does first, what can go.
2. **Unified usage.** Every page has the same look and feel, and buttons, lists, create/edit/delete, empty/loading/error states and status work the same way everywhere, kept simple.
3. **Browser-tested.** Every page is opened in a browser (live API and demo data, desktop and phone width, dark and light) and its CRUD flows are clicked through.

## Decisions (settled 2026-09-11)

The user asked to carry out the plan, so the six open decisions take their recommendations:

1. **Primary color and white-label brands.** Keep the brand slots. Add optional `onPrimary`/`onAccent` to `BrandConfig`. Signal colors stay out of brand control.
2. **Light mode.** Kept as a matte token set only. `dark:` pairs are deleted as each feature migrates. The default theme becomes dark.
3. **Reuse `lp-*` or build primitives.** Share tokens, not classes. The app gets its own kit in `app/src/shared/components/ui/`.
4. **Flag or big-bang.** Neither. The tokens switch once on `main` (TASK-261); each feature group then migrates in its own PR.
5. **Safety colors.** A saturated `--signal-stopped-fill` for STOP and alarms. Amber and red mean a condition that is true now.
6. **When the rules docs change.** In TASK-261, so every later PR is reviewed against the new rules.

The design contract (tokens, type, page anatomy, CRUD pattern, kit, shell, testing) lands in `docs/brand.md` with TASK-261 and is binding for every child.

## Children

| Task | Scope |
|---|---|
| [[TASK-261]] | Tokens, type, the UI kit, the shell and navigation, the docs |
| [[TASK-262]] | Dashboard, fleet, alerts, incidents, safety, command |
| [[TASK-263]] | Robot detail, cockpit and control center |
| [[TASK-264]] | Agent Mode, patrol, guide (tour) and digital twin |
| [[TASK-265]] | Skill pipeline, data collection, datasets, training, simulation, evaluation |
| [[TASK-266]] | Deployments, models, fleet learning, marketplace, updates |
| [[TASK-267]] | Compliance and its tabs (audit, oversight, approvals, explainability, GDPR) |
| [[TASK-268]] | Auth, account, settings, organizations, team, A2A chat, automations, docs, 404 |
| [[TASK-271]] | Close the kit gaps the page groups found: pager, status map, error text, toasts, test ids |
| [[TASK-269]] | Retire the legacy styles and guard the new ones in the gate |

TASK-262 to TASK-268 depend only on TASK-261 and run in parallel. TASK-269 lands last.

## Details

### Current state (survey of `app/src`, 2026-09-11)

- **Tokens.** `app/src/index.css` defines `cobalt-*`/`turquoise-*` scales, with `primary-*`/`accent-*` as `var()` aliases that white-label brands override. It also defines `--bg-*`/`--text-*`/`--border-*`/`--signal-*` per theme, a full `--glass-*` set, and the `.glass*`/`.card` classes with `backdrop-filter`. The landing values live scoped under `.landing-page` in `app/src/components/landing/landing-theme.css`.
- **Theme and brand.** `app/src/app/providers/ThemeProvider.tsx` toggles `.light`/`.dark` on `<html>` from `features/settings/store/themeStore.ts` (default `system`). `app/src/brand/BrandProvider.tsx` writes brand overrides inline onto `<html>`. Brand configs other than `brand/_template` are gitignored.
- **Shell.** `app/src/components/layout/`: `AppLayout`, `TopBar` (glass), `Sidebar` (active item `bg-cobalt text-white`), `MobileNav`, `UserMenu`, `OrganizationSwitcher`, `ImpersonationBanner`. `DashboardLayout.tsx` and `AuthLayout.tsx` are imported nowhere.
- **Primitives.** `app/src/shared/components/ui/`: 16 files with 242 importers. Button primary is `bg-cobalt text-white`, Card defaults to glass, and Badge uses raw hues with `dark:` pairs. There is no Table, Select, FormField, ConfirmDialog or toast.
- **CRUD today.** 43 feature files use `Modal`, 21 roll their own `fixed inset-0` dialogs, 10 call `window.confirm`, 52 use a raw `<select>`, 15 hand-roll a `<table>`, and 322 raw `<button>`s sit next to 140 `Button` users. Only organizations and team show toasts.
- **Drift in `features/`** (364 `.tsx` files):

  | Pattern | Uses | Files |
  |---|---|---|
  | theme variable utilities | 3525 | 279 |
  | raw status hues | 2636 | 250 |
  | `dark:` variants | 1479 | 184 |
  | greys | 1273 | 114 |
  | `cobalt-*` | 809 | 152 |
  | `glass*` | 462 | 115 |
  | hex literals | 366 | 44 |
  | `font-mono` | 209 | 86 |
  | `text-[10px]` | 80 | 41 |

  78 lines put `text-white` on a primary fill, which becomes unreadable once primary is mint.
- **Tests.** `app/e2e/screenshots/demo-pages.spec.ts` writes PNGs but compares nothing. 15 vitest files assert classes (7 in agentmode). The Tauri build is not in CI. 13 demo routes render `DemoFeaturePlaceholder`.
- **Docs.** `docs/brand.md` and `app/AGENTS.md` still prescribe glassmorphism, cobalt and Inter headlines.

**Key files:** `app/src/index.css`, `app/src/components/landing/landing-theme.css`, `app/src/brand/*`, `app/src/shared/components/ui/*`, `app/src/components/layout/*`, `app/e2e/`, `app/playwright.config.ts`, `docs/brand.md`, `app/AGENTS.md`.

## Acceptance Criteria

- [ ] Every app route renders on the landing tokens: body ground `rgb(8, 15, 24)` in dark mode, and no `backdrop-filter` anywhere in the app outside the landing page.
- [ ] Normal text is Inter, headings are Archivo, and mono appears only on code and machine output. No app text is below 10px (checked in e2e).
- [ ] Every page follows the page anatomy and the CRUD pattern in `docs/brand.md`: one header, one primary action, the same list, form, confirm, toast, empty, loading and error behavior.
- [ ] Every route was opened in a browser at 1440px and 390px, dark and light, with no page errors and no horizontal overflow, and its CRUD flows were clicked through.
- [ ] A white-label brand config still recolors primary surfaces, with a readable on-primary text color.
- [ ] The drift ratchet in the gate stands at zero.
- [ ] `docs/brand.md` and `app/AGENTS.md` describe the new language.

## Test Strategy

- The gate on every child PR: `npx tsc`, `npx vitest run`, and `npx playwright test`.
- Every child opens each of its routes in live mode (API on a copy of the dev database) and demo mode with `ui-check`, reviews the screenshots, and clicks its CRUD flows.
- The drift ratchet's counts may only fall, and TASK-269 sets them to zero.
- A manual `npm run tauri dev` smoke test at 800×600 and a real white-label config checked by hand after TASK-261.
