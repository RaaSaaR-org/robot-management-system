---
id: "TASK-513"
aliases: []
title: "The research list hides superseded records and a corrected record names its correction"
slug: "the-research-list-hides-superseded-records"
status: "done"                # backlog | todo | in-progress | review | done | cancelled
priority: 3                   # 1=critical, 2=high, 3=medium, 4=low
owner: "claude"
projects: []
customers: []
tags: ["research", "core"]
sprint: ""
parent: ""
depends_on: []
spe: 2
effort: "low"
due_date: ""
created: "2026-11-17"
updated: "2026-11-17"
---

# The research list hides superseded records and a corrected record names its correction

## Description

Research records are immutable, so a correction is a new record with `supersedesId`. The list shows the old record
next to its correction with the same status, and the old record's page does not say that it was corrected
(GitHub issue #513).

## Details

**Current state:** `GET /api/research/records` lists every record; `GET /api/research/records/:id` returns the row
alone. `app/src/features/research/pages/ResearchPage.tsx` shows the list, `ResearchDetail.tsx` the record.

### Server

- `listResearchSchema` (`server/src/types/research.types.ts`) takes `current=true|false`. With `true`, records that
  another record of the tenant supersedes are left out (the set is read off the corrections' `supersedesId`).
- `ResearchService.get` adds `supersededBy`: the newest record whose `supersedesId` is this one.

### Frontend

- The list sends `current=true` unless the URL has `corrected=show`; a "Show corrected records" toggle switches it,
  and the header says "corrected records hidden".
- A record with `supersededBy` opens with a "Corrected" notice linking to the correction.

**Key files:** `server/src/types/research.types.ts`, `server/src/services/ResearchService.ts`,
`server/src/__tests__/research-records.integration.test.ts`, `app/src/features/research/pages/ResearchPage.tsx`,
`app/src/features/research/components/ResearchDetail.tsx`, `app/src/features/research/types/research.types.ts`,
`app/src/features/research/pages/__tests__/ResearchPage.test.tsx`.

## Test Strategy

Integration (SQLite + HTTP): after a correction, `current=true` lists only the correction, the old record reads
`supersededBy`, another tenant sees nothing, `current=yes` is a 400. Vitest: the list sends `current=true` by default
and drops it after the toggle; a record with `supersededBy` shows the notice and link.
