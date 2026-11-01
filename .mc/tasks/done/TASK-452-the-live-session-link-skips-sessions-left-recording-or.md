---
id: "TASK-452"
aliases: []
title: "The live session link skips sessions left recording or paused for more than 12 hours"
slug: "the-live-session-link-skips-sessions-left-recording-or"
status: "done"
priority: 2
owner: "claude"
projects: []
customers: []
tags: ["core"]
sprint: ""
parent: ""
depends_on: []
spe: 2
effort: "low"
due_date: ""
created: "2026-10-31"
updated: "2026-10-31"
---

# The live session link skips sessions left recording or paused for more than 12 hours

## Description

The Quest opens `/data-collection/live?robot=<id>`, which redirects to the robot's one live
session. A session nobody ended stays `recording` or `paused` forever and keeps counting, so the
headset lands on a dead session from days ago, or shows a chooser instead of redirecting once
today's session exists. Sessions left recording or paused with no activity for more than 12 hours
must stop counting, the same way READY sessions already age out after 4 hours.

## Details

### Current state

- `app/src/features/datacollection/pages/LiveSessionRedirect.tsx` — `liveCandidates()` asks the
  server for `created`, `recording` and `paused` sessions. A `created` session counts only while it
  is younger than `LIVE_CREATED_MAX_AGE_MS` (4 h, by `createdAt`); older ones go to `ignored`,
  which the page names ("Ignoring ‘…’ (created 2 days ago, never started)") while it waits. Every
  `recording` or `paused` session counts at any age.
- Seen on the lab box: session `814249f2` on `g1-edu-4` ("Remote test 1") has been `paused` since
  2026-10-29 15:33. With no session for today the Quest redirects to it; with today's session
  created, the page shows a two-item chooser instead of redirecting.
- `TeleoperationSession` (`app/src/features/datacollection/types/datacollection.types.ts`)
  carries `createdAt`, `startedAt`, `endedAt` and `updatedAt`. On the server `updatedAt` is a
  Prisma `@updatedAt` column, bumped by every write to the session row: start, pause, resume, and
  each saved take (`frameCount`), so it is the session's last activity.

### Frontend

- New constant `LIVE_ACTIVE_MAX_IDLE_MS` = 12 h. A `recording` or `paused` session whose last
  activity (`updatedAt`, falling back to `startedAt`, then `createdAt`, when unparseable) is older
  than that goes to `ignored` and is never redirected to. The `created` filter is unchanged.
- The waiting state's "Ignoring …" line describes an idle session truthfully:
  "Ignoring ‘Remote test 1’ (paused, last active 2 days ago)." instead of "never started".

### Key files

- `app/src/features/datacollection/pages/LiveSessionRedirect.tsx`
- `app/src/features/datacollection/pages/__tests__/LiveSessionRedirect.test.tsx`
- `app/e2e/live/quest-live-link-and-takes.spec.ts` (precondition and "Ignoring" pattern)
- `docs/data-collection-two-person.md` (the runbook's description of the live link)

## Acceptance Criteria

- [x] Only a 2-day-old `paused` session for the robot → no redirect; the page waits and names it
      as ignored.
- [x] A fresh `recording` session plus a 2-day-old `paused` one → the page redirects to the fresh
      one, with no chooser.
- [x] A `paused` session last active 1 hour ago still counts.
- [x] `created` sessions still age out after 4 h, unchanged.

## Test Strategy

Vitest in `LiveSessionRedirect.test.tsx`: `liveCandidates` cases for the 2-day-old paused, the
1-hour-old paused, and an old session with recent `updatedAt`; MSW page cases for the lone stale
paused session (waiting, ignored line) and fresh recording + stale paused (redirect). Gates:
`cd app && npx tsc && npx vitest run src/features/datacollection`.

## Notes
