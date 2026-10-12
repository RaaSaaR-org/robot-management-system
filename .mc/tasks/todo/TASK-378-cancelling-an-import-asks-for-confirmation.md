---
id: "TASK-378"
aliases: []
title: "Cancelling an import asks for confirmation"
slug: "cancelling-an-import-asks-for-confirmation"
status: "in-progress"
priority: 3
owner: "huhn511"
projects: []
customers: []
tags: ["core"]
sprint: ""
parent: ""
depends_on: []
spe: 2
effort: "low"
due_date: ""
created: "2026-10-12"
updated: "2026-10-12"
---

# Cancelling an import asks for confirmation

## Description

The Cancel button on a running dataset import cancels on a single click, and a cancel
deletes the files downloaded so far. A misclick therefore throws away a long download.
Put a confirmation step in front of it, using the shared `ConfirmDialog`.

## Details

**Current state:** `app/src/features/training/components/ImportActivity.tsx` renders a
`CancelButton` (added in TASK-371) on every running import row in the top-bar import
panel. Its click calls `useImportJobsStore().cancel(datasetId)`
(`app/src/features/training/store/importJobsStore.ts`), which calls
`trainingApi.cancelImport` (`POST /datasets/:id/import/cancel`). The server stops the
download and deletes the partial files. This is the only place in the app that cancels
an import (`ImportProgress` and the dataset detail have no cancel).

The panel closes on any pointerdown outside it and on Escape. A dialog opened from inside
it renders in a portal, so without a guard the first click into that dialog would close
the panel and unmount the dialog with it.

### Frontend

- `CancelButton` opens a `ConfirmDialog` (`@/shared/components/ui`, the pattern every
  destructive action uses; never `window.confirm`): title "Cancel the import of ‹label›?",
  description "The files downloaded so far are discarded. Importing it again starts from
  the beginning.", confirm "Cancel import" (danger), dismiss "Keep importing",
  `testId="import-job-cancel-confirm"`.
- Only the confirm button calls the store's `cancel`; dismissing (button, Escape,
  backdrop) does nothing.
- The panel's outside-click/Escape handler ignores events while an `alertdialog` is open,
  so the panel stays open behind the confirmation.

**Key files:**
- `app/src/features/training/components/ImportActivity.tsx`
- `app/src/features/training/components/__tests__/ImportActivity.test.tsx`

## Acceptance Criteria

- [ ] One click on Cancel opens a confirmation and does not call `cancelImport`.
- [ ] Confirming calls `cancelImport` and the row shows Cancelled with a Retry.
- [ ] Dismissing (button or Escape) does not call `cancelImport`, and the import panel stays open.
- [ ] The copy says the downloaded files are discarded.

## Test Strategy

Vitest in `ImportActivity.test.tsx`: one click opens the alertdialog with the copy and
does not cancel; confirming cancels (the existing TASK-371 test, now through the dialog);
dismissing via the button and via Escape does not cancel and leaves `panelOpen` true.

## Notes
