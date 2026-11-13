---
id: "TASK-494"
aliases: []
title: "A dataset imported from Hugging Face says so in its page header, with a link to the commit"
slug: "a-dataset-imported-from-hugging-face-says-so-in-its-page"
status: "todo"                # backlog | todo | in-progress | review | done | cancelled
priority: 2                   # 1=critical, 2=high, 3=medium, 4=low
owner: "claude"
projects: []
customers: []
tags: ["datasets", "demo", "ui", "core"]
sprint: ""
parent: ""
depends_on: ["[[TASK-492]]"]
spe: 1
effort: "low"
due_date: "2026-11-16"
created: "2026-11-13"
updated: "2026-11-13"
---

# A dataset imported from Hugging Face says so in its page header, with a link to the commit

## Description

The header of a dataset's page shows the source of a Hub import as a bare
`ycchen0106/g1-apple-to-plate@37cb1d6e` directly under the title, where it reads like a
second name for the dataset. It should read as provenance. TASK-493 built the component
for it and fixed the same line in the datasets list; the header was left alone because
its file was being rewritten by TASK-492 at the same time. This is the one-hunk wiring.

## Details

### Current state

- `app/src/features/training/pages/DatasetEpisodesPage.tsx`, in `<PageHeader meta={…}>`:

  ```tsx
  {dataset.huggingFaceRepoId && (
    <span className="break-all font-mono text-xs text-ink-tertiary" title={…} data-testid="dataset-source">
      {formatRepoAtRevision(dataset.huggingFaceRepoId, dataset.sourceRevision)}
    </span>
  )}
  ```

- `app/src/features/training/components/datasets/DatasetProvenance.tsx` (TASK-493, with
  `__tests__/DatasetProvenance.test.tsx`) renders "Imported from Hugging Face:
  <owner/repo> at revision 37cb1d6e": the repo is a link to that exact commit on the Hub
  (`hubDatasetUrl`, new tab), the full SHA is the hover text, nothing is rendered for a
  dataset without `huggingFaceRepoId`, and the root keeps `data-testid="dataset-source"`.
  Nothing uses it yet.

### Frontend

- Replace the span above with `<DatasetProvenance dataset={dataset} />`.
- Drop `formatRepoAtRevision` from that file's `importFormat` import if nothing else in
  it uses it.
- Check how it sits in the header's `meta` row beside the status and LeRobot-version
  tags at 1280x720; `DatasetProvenance` takes a `className` if it needs its own line.

### Key files

- `app/src/features/training/pages/DatasetEpisodesPage.tsx`
- `app/src/features/training/pages/__tests__/DatasetEpisodesPage.*.test.tsx` (add the case)

## Acceptance Criteria

- [ ] The header of a Hub-imported dataset reads "Imported from Hugging Face: owner/repo
      at revision <8 characters>", the repo linking to
      `https://huggingface.co/datasets/<owner>/<repo>/tree/<full revision>`.
- [ ] A dataset that was not imported from the Hub shows no source line.
- [ ] The header still fits one screen with the video and the joint chart at 1280x720.

## Test Strategy

- `cd app && npx vitest run src/features/training` — a page test that renders a
  Hub-imported dataset and reads `data-testid="dataset-source"`.
- In a browser: `/datasets/<id>/episodes` of a Hub import and of an uploaded dataset, at
  1280x720 and 1440x900, light and dark.

## Notes

Blocked only by the merge of TASK-492, which edits the same file.
