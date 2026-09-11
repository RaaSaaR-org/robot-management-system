---
id: "TASK-269"
aliases: []
title: "Retire the legacy styles and guard the design system"
slug: "retire-the-legacy-styles-and-guard-the-design-system"
status: "todo"
priority: 2
owner: "huhn511"
projects: []
customers: []
tags: [core, design, frontend]
sprint: ""
parent: "[[TASK-260]]"
depends_on: ["[[TASK-262]]", "[[TASK-263]]", "[[TASK-264]]", "[[TASK-265]]", "[[TASK-266]]", "[[TASK-267]]", "[[TASK-268]]"]
spe: 5
effort: "medium"
due_date: ""
created: "2026-09-11"
updated: "2026-09-11"
---

# Retire the legacy styles and guard the design system

## Description

Once every feature group has migrated, delete the legacy styles that TASK-261 kept alive as aliases, and put two guards in the gate so the old language cannot come back: a drift ratchet that counts banned patterns, and a route smoke test that opens every app route in the demo build.

## Details

### Current state

After TASK-262 to TASK-268 every page is on the kit, but `app/src/index.css` still carries the compatibility layer from TASK-261: `--glass-*` tokens, the matte `.glass*`/`.card` classes, `.btn-*`, `.section-*`, and the `cobalt-*`/`turquoise-*` utility aliases. Anything outside the feature folders (for example `app/src/components/common`, `app/src/shared`) may still use them.

### Frontend

1. Replace the remaining legacy usages outside the landing page, then delete the compatibility layer from `app/src/index.css`. The white-label brand slots keep working (BrandProvider writes the primary/accent ramps).
2. **Drift ratchet** (`app/src/__tests__/design-drift.test.ts` or similar): scans `app/src` except `components/landing` and counts `cobalt-`, `turquoise-`, `glass`, `dark:`, raw Tailwind hues and greys, hex color literals in TSX, `backdrop-blur`, `text-[8px]`/`text-[9px]`, `window.confirm`. Each count must be zero.
3. **Route smoke** (`app/e2e/app-routes.spec.ts`): every app route in the demo build, at 1440px and 390px: no page error, exactly one `h1`, no horizontal overflow, no visible text under 10px, no `backdrop-filter`, body ground `rgb(8, 15, 24)` in dark.

**Key files:** `app/src/index.css`, `app/src/__tests__/`, `app/e2e/app-routes.spec.ts`, `app/playwright.config.ts`.

## Acceptance Criteria

- [ ] `app/src/index.css` has no `--glass-*`, `.glass*`, `.btn-*` or cobalt/turquoise utility aliases, and a white-label brand still recolors primary surfaces.
- [ ] The drift ratchet runs in `npx vitest run` and every count is zero.
- [ ] The route smoke runs in `npx playwright test` and passes for every app route.

## Test Strategy

- `npx tsc`, `npx vitest run`, `npx playwright test`.
- Break a rule on purpose (add `bg-cobalt-500` to a page) and watch the ratchet fail, then revert.
