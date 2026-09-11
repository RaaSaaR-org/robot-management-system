---
id: "TASK-271"
aliases: []
title: "Close the kit gaps the page redesign found"
slug: "close-the-kit-gaps-the-page-redesign-found"
status: "done"
priority: 2
owner: "huhn511"
projects: []
customers: []
tags: [core, design, frontend]
sprint: ""
parent: "[[TASK-260]]"
depends_on: []
spe: 5
effort: "medium"
due_date: ""
created: "2026-09-11"
updated: "2026-09-11"
---

# Close the kit gaps the page redesign found

## Description

While TASK-262 to TASK-268 rebuilt every page on the shared UI kit, their agents hit the same kit gaps again and again and worked around each one locally. The result is three hand-built pagers, several status maps, error texts that read "[object Object]", and toasts that cover phone bottom sheets. This task closes those gaps in the kit (`app/src/shared/components/ui`) and swaps the local copies in the already-merged features for the kit version, so paging, status, errors and feedback work the same everywhere.

## Details

### Current state (on `main` after #306–#311)

- **Pagination.** There is no kit piece for server-paged tables. Local copies:
  - `features/compliance/components/Pager.tsx`
  - `features/explainability/…/Pager.tsx`
  - `features/incidents/components/PaginationFooter` (or similar)
  - the alerts History footer in `features/alerts`
- **Status map.** `statusTone()` in `shared/components/ui/statusTone.ts` resolves these to neutral:
  - run states: `done`, `aborted`, `abandoned`
  - incident severities `high`/`medium`/`low`, and alert severity `info`
  - incident statuses: `detected`, `investigating`, `contained`, `resolved`, `closed`
  - notification statuses: `overdue`, `sent`, `acknowledged`
  - deployment statuses: `canary`, `production`, `rolling_back`, `rolled_back`, `deprecated`
  - A2A task states: `submitted`, `working`, `input_required`, `canceled`

  Local maps work around it: `features/patrol` (`RunStatusTag` in `opsUi`), `features/compliance/complianceFormat.ts`, `features/oversight/oversightFormat.ts`, and the alerts/incidents severity maps.
- **Errors.** `app/src/api/client.ts` rejects with plain `ApiError` objects, not `Error` instances, so `err instanceof Error ? err.message : String(err)` shows "[object Object]". `features/gdpr/components/errorMessage.ts` is a local fix.
- **Toasts.**
  - Below 640px they sit at the bottom and cover the footer of a bottom-sheet Modal/FormModal and the robot control center's sticky dock.
  - Success toasts have no `role="status"`.
- **Modal.** With `onSubmit`, Modal does not call `event.preventDefault()` (FormModal does), so a Modal used as a form reloads the page.
- **Testability.** There is no way to set a `data-testid` on:
  - FormModal's submit and cancel buttons
  - `DropdownMenuItem`/`RowActionItem`
  - `confirm()`
  - `StatTile`
  - a DataTable row
- **ConfirmDialog.** It renders a nested `[role=dialog]` around its `[role=alertdialog]`.
- **Small gaps.**
  - There is no indeterminate ProgressBar.
  - `focusRing` is not exported from the kit index.
  - Panel does not forward a ref.
  - Spinner still accepts `color="cobalt"`.
  - There is no CSS-variable colour helper for three.js/SVG; `features/digitaltwin/utils/cssColor.ts` is local.
  - There is no single-choice card group; `features/training/components/jobs/ChoiceCard.tsx` is local.

### Frontend

1. **Pagination.** Add a kit `Pager` ("Page x of y", Previous/Next, optional total) and a `pagination` prop on DataTable that renders it in the table footer. Replace the local pagers in compliance, explainability, incidents and alerts.
2. **statusTone.** Add the states above, grouped like this:
   - success: done, production, resolved, closed, sent, acknowledged
   - info: working, submitted, canary, investigating, detected
   - warning: aborted, abandoned, input_required, rolling_back, rolled_back, contained, medium, overdue
   - danger: high, critical
   - neutral: low, info, deprecated, canceled

   Adjust the grouping if the existing map implies otherwise, and keep the contract's rule that amber means unknown or needs attention, red means stopped or fault. Then delete the local maps in patrol, compliance, oversight, alerts and incidents that only duplicated them, keeping domain wording where it differs. Extend `__tests__/statusTone.test.ts`.
3. **errorMessage.** Export `errorMessage(err: unknown, fallback?: string): string` from the kit (or `shared/utils`). It reads `Error.message`, an `{ message }` object, or `response.data.error`/`message`. Replace the gdpr local helper and the `instanceof Error ? … : String(err)` pattern in merged features. Add the helper to `page-recipes`-style docs in `docs/brand.md` §4.
4. **Toaster.**
   - Below 640px, show toasts at the top of the viewport so bottom sheets and sticky docks stay reachable. Leave desktop as it is.
   - Success, info and neutral toasts get `role="status"`; errors keep `role="alert"`.
5. **Modal.** `onSubmit` calls `preventDefault()` first, exactly like FormModal.
6. **Test ids.** All additive and optional:
   - `submitTestId`/`cancelTestId` on FormModal
   - `testId` on `DropdownMenuItem`/`RowActionItem`
   - `testId` in `confirm()` options
   - `data-testid` passthrough on StatTile
   - `rowProps?(row)` on DataTable
7. **ConfirmDialog.** Render a single dialog element.
8. **Small pieces.**
   - ProgressBar `indeterminate`.
   - Export `focusRing`.
   - `Panel` with `forwardRef`.
   - Spinner: keep accepting `cobalt`/`turquoise` only if `app/src` still passes them, otherwise drop them.
   - Move `cssColor`/`useCssColor` into the kit next to `chartColors`, and point digitaltwin at it.
   - Add a kit `ChoiceCard` group from the training one, and point the training wizard at it.
9. **Docs.** Update `docs/brand.md` (§5 kit list) and `app/AGENTS.md` with the new pieces.

**Constraints.** Every kit change is additive or behaviour-preserving, because TASK-266 and TASK-268 are still open on branches that import the kit. Do not edit `features/deployment`, `fleetlearning`, `contributions`, `updates`, `auth`, `settings`, `organizations`, `team`, `a2a`, `processes`, `components/demo` or `components/docs`; they belong to those open tasks. Do not touch `app/src/index.css` legacy layers, which belong to TASK-269.

**Key files:**
- `app/src/shared/components/ui/{DataTable,Pager (new),statusTone,Toaster,toast,Modal,FormModal,ConfirmDialog,confirm,DropdownMenu,StatTile,ProgressBar,Panel,Spinner,ChoiceCard (new),cssColor (new),index}.ts(x)` and their tests
- the merged features' local copies listed above
- `docs/brand.md`
- `app/AGENTS.md`

## Acceptance Criteria

- [ ] No local pager remains in compliance, explainability, incidents or alerts; they use the kit Pager through DataTable.
- [ ] `statusTone()` maps every state listed above, and the duplicated local maps are gone.
- [ ] No "[object Object]" can appear in an error toast or form error in the merged features; they use `errorMessage()`.
- [ ] At 390px a toast never covers a bottom-sheet footer or the control center's dock. Success toasts carry `role="status"`.
- [ ] A Modal with `onSubmit` never reloads the page.
- [ ] `npx tsc`, `npx vitest run` and `npx playwright test` pass.

## Test Strategy

- Unit tests for Pager, the DataTable `pagination` prop, `statusTone` additions, `errorMessage`, Modal `preventDefault`, the Toaster position and roles, and ConfirmDialog's single dialog.
- ui-check and click-throughs in live mode:
  - compliance audit log paging
  - incidents paging
  - an error toast
  - a create in a phone-width FormModal with a toast showing
