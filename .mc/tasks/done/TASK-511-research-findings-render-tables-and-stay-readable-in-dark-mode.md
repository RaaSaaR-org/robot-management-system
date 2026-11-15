---
id: "TASK-511"
aliases: []
title: "Research findings render tables and stay readable in dark mode"
slug: "research-findings-render-tables-and-stay-readable-in-dark-mode"
status: "done"                # backlog | todo | in-progress | review | done | cancelled
priority: 3                   # 1=critical, 2=high, 3=medium, 4=low
owner: "claude"
projects: []
customers: []
tags: ["research", "core"]
sprint: ""
parent: ""
depends_on: []
spe: 1
effort: "low"
due_date: ""
created: "2026-11-15"
updated: "2026-11-15"
---

# Research findings render tables and stay readable in dark mode

## Description

The Findings panel of a research publication (`/research/:id`) renders `body.markdown` with
`react-markdown` but without `remark-gfm`, so Markdown tables arrive as one paragraph of pipes. It also
uses the typography plugin's default greys, which are tuned for a white page: in the dark theme headings,
bold text and links are painted almost black on the dark panel and are close to invisible.

## Details

**Current state.** `app/src/features/research/components/ResearchDetail.tsx` renders
`<div className="prose prose-sm max-w-none break-words text-ink-primary"><ReactMarkdown skipHtml …>`.
`/docs` already solves both problems (`app/src/components/docs/DocsArticle.tsx` passes `remarkGfm`;
`docs-prose.css` maps every `--tw-prose-*` colour to a theme token). `remark-gfm` is already a dependency.

### Frontend

- `ResearchDetail.tsx`: pass `remarkPlugins={[remarkGfm]}` (keeps `skipHtml` and the heading mapping) and
  add the class `prose-theme`.
- `app/src/index.css`: new `.prose-theme` next to `.prose-inherit` — the `--tw-prose-*` colours mapped to
  `--text-*`, `--border-color*`, `--color-primary` and `--bg-tertiary`, so light and dark follow
  ThemeProvider.

**Key files:** `app/src/features/research/components/ResearchDetail.tsx`, `app/src/index.css`,
`app/src/features/research/pages/__tests__/ResearchPage.test.tsx`.

## Acceptance Criteria

- [x] A Markdown table in a publication's `body.markdown` renders as a table with header cells.
- [x] Headings, bold text and links in Findings use theme tokens (readable in both themes).
- [x] Raw HTML is still skipped and `javascript:` links still dropped (existing test unchanged).

## Test Strategy

- `npx vitest run src/features/research` — new case renders a GFM table and finds `.prose-theme`.
- `npx tsc --noEmit` in `app/`.
- Manual: a publication with headings, bold text and a table viewed in the dark theme through the Vite dev
  server: table rendered, headings and bold readable.
