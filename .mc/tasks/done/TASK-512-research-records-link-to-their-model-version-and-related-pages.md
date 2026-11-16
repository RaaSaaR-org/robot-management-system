---
id: "TASK-512"
aliases: []
title: "Research records link to their model version and to related pages"
slug: "research-records-link-to-their-model-version-and-related-pages"
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
created: "2026-11-16"
updated: "2026-11-16"
---

# Research records link to their model version and to related pages

## Description

A research record that names a model version links to the plain `/models` list, so the reader has to find the
version again by hand. A record also has no way to point at related pages outside the RMS (a field app's finding
page, a compare view): evidence URIs must have no query string, and Markdown links are hard to see in the dark theme.

## Details

**Current state:** `app/src/features/research/components/ResearchDetail.tsx` renders `body.modelVersionId` as a
link to `/models`. The models page already opens one version from `?model=<id>`
(`app/src/features/deployment/pages/ModelsPage.tsx`).

### Frontend

- The model version link goes to `/models?model=<id>`.
- New optional `body.links`: a list of `{ label, url }`. Shown as a "Links" panel above Evidence. Only absolute
  http(s) URLs without credentials become links; anything else is dropped; at most 20 are shown.
- No server change: `body` is already a free record, so publishers can send `links` today.

**Key files:** `app/src/features/research/components/ResearchDetail.tsx`,
`app/src/features/research/pages/__tests__/ResearchPage.test.tsx`.

## Test Strategy

Vitest: a record with http, http-with-query, `javascript:` and relative links shows only the first two as links;
a record with `modelVersionId` links to `/models?model=<id>`.
