---
id: "TASK-472"
aliases: []
title: "The New-session form's submit says Create session"
slug: "the-new-session-form-s-submit-says-create-session"
status: "todo"                # backlog | todo | in-progress | review | done | cancelled
priority: 3                   # 1=critical, 2=high, 3=medium, 4=low
owner: "claude"
projects: []
customers: []
tags: [extended, ui]
sprint: ""
parent: ""
depends_on: []
spe: 1
effort: "low"
due_date: ""
created: "2026-10-31"
updated: "2026-10-31"
---

# The New-session form's submit says Create session

## Description

The New-session form's submit is labelled "Start session", but it only creates
the session and opens it in Set up. The session page then has the real "Start
session" (Space), which opens it for takes after the Get ready steps. Two
buttons with one label and two meanings confused the 2026-10-31 sim rehearsal.
This task renames the form's button to "Create session".

Branch: `fix/task-472-the-new-session-form-s-submit-says-create-session`.

## Details

### Current state

Checked on `main` at `a600c27e`.

- `app/src/features/datacollection/pages/NewSessionPage.tsx:407-409`: the
  submit `Button` reads "Start session" (`loadingText="Creating…"`); the file
  header (`:5`) says the same.
- The session page's own "Start session" is in Set up
  (`app/src/features/datacollection/components/console/SetupRail.tsx`,
  `app/src/features/datacollection/pages/SessionDetailPage.tsx`). It keeps its
  label.
- Tests and specs that may match the form's label:
  `app/src/features/datacollection/pages/__tests__/NewSessionPage.test.tsx`,
  `app/e2e/datacollection-new-session.spec.ts`, and the live specs
  `app/e2e/live/datacollection-vr.spec.ts`,
  `app/e2e/live/datacollection-takes-sync.spec.ts`. Change only the
  selectors that target the form's button.
- `docs/data-collection-two-person.md` Setup step 0 does not name the button;
  TASK-473 updates the runbook.

### Frontend

- The form's submit reads "Create session"; the header comment matches.

### Key files

- `app/src/features/datacollection/pages/NewSessionPage.tsx`
- `app/src/features/datacollection/pages/__tests__/NewSessionPage.test.tsx`
- `app/e2e/datacollection-new-session.spec.ts`
- `app/e2e/live/datacollection-vr.spec.ts`,
  `app/e2e/live/datacollection-takes-sync.spec.ts` (selectors only)

## Acceptance Criteria

- [ ] The New-session submit reads "Create session".
- [ ] The session page's "Start session" is unchanged.
- [ ] Vitest and the demo Playwright specs pass.

## Test Strategy

- `cd app && npx tsc --noEmit && npx vitest run src/features/datacollection`.
- Playwright `datacollection-new-session.spec.ts` and
  `datacollection-console.spec.ts`.

## Notes

- Found in the 2026-10-31 sim rehearsal ("Two different 'Start session'
  buttons"). The same finding's missing "head only" choice is TASK-447 (PR #464).
