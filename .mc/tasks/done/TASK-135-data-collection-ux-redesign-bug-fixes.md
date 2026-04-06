---
id: TASK-135
aliases:
- TASK-135
title: Data Collection UX redesign + bug fixes
slug: data-collection-ux-redesign-bug-fixes
status: backlog
priority: 3
owner: ''
projects: []
customers: []
tags:
- core
sprint: ''
depends_on: []
due_date: ''
created: 2026-04-05
updated: 2026-04-05
---

# Data Collection UX redesign + bug fixes

## Description

The `/data-collection` page looks dated compared to the recently-redesigned Simulation and Pipeline pages — uses `text-gray-900 dark:text-gray-100` instead of theme tokens, tabs don't match the shared `Tabs` component, "New Session" button overflows on narrow screens, and "Create Session" navigates to a broken route that redirects users to the landing page. Align with the rest of the app's futuristic design language and fix the blockers preventing users from actually creating sessions.

## Details

### Bugs to fix

1. **Broken navigation** in `NewSessionPage.tsx:55` — navigates to `/data-collection/sessions/${session.id}` but the actual route is `/data-collection/:sessionId` (see `App.tsx:363`), so post-create redirects land on the public landing page. Change to `/data-collection/${session.id}`.
2. **Stale error state** on NewSessionPage — "An unexpected error occurred" persists from previous failed submits; clear on mount.
3. **Hardcoded modelId** in UncertaintyAnalysis hits `GET /api/data-collection/uncertainty?modelId=default-model` which 404s. Add a model selector backed by `trainingApi.listRegisteredModels()` + a "No model selected" empty state.

### UX redesign — match Simulation/Pipeline look

- **Header**: add feature icon chip + h1 + PipelineBreadcrumb (already present, keep)
- **Tabs**: swap hand-rolled tab bar for shared `Tabs` component (keyboard nav, ARIA, cobalt active state)
- **Educational banner**: collapsible card explaining teleoperation modes, session lifecycle, how sessions become datasets. Use the EducationBanner pattern from SimulationPage.
- **Info tooltips** on: session status, quality score, jerk warning, FPS, LeRobot v3 format
- **New session form**: 6 teleop cards in a 3×2 grid with cobalt selection ring; show robot online/offline indicator next to Robot ID; replace raw `<input>` with shared `Input`
- **Empty states**: mirror SimulationPage pattern (Card with icon + title + actionable CTA)
- **Session cards**: match sim Job card design — status dot, relative time, quality score with color coding, frame count progress bar
- **Priority / Uncertainty tabs**: wrap in Cards with subtle borders to match the app; use brand cobalt/turquoise gradient for the heatmap

### Layout fixes

- Move "New Session" button into the page header (next to PipelineBreadcrumb) instead of fighting the filter row
- Drop `container mx-auto px-4 py-6 max-w-7xl` wrapper — use standard `space-y-6` shell
- Filters go into their own `Card variant="subtle"` row

### Key files

- `app/src/features/datacollection/pages/DataCollectionPage.tsx` (significant refactor)
- `app/src/features/datacollection/pages/NewSessionPage.tsx` (bug fix + styling refresh)
- `app/src/features/datacollection/pages/SessionDetailPage.tsx` (theme token refresh)
- `app/src/features/datacollection/components/SessionList.tsx` (redesigned cards)
- `app/src/features/datacollection/components/PriorityDashboard.tsx` (Card wrapping + tokens)
- `app/src/features/datacollection/components/UncertaintyHeatmap.tsx` (model selector + brand colors)

## Test Strategy

1. Create session end-to-end → verify redirect lands on real detail page, not landing
2. Tab navigation works with keyboard (Tab, arrow keys, Enter)
3. Info tooltips appear on all key labels
4. "New Session" button never overflows at 1280×720, 1024×768, 375px widths
5. Empty state and populated state visual parity with Simulation page
6. Uncertainty Analysis works without console 404s (model dropdown picks real models)
7. `npx tsc --noEmit` clean
8. Playwright MCP verifies the full create-session flow
