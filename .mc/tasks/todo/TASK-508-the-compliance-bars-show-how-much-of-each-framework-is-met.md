---
id: "TASK-508"
aliases: []
title: "The compliance bars show how much of each framework is met, the docs README leaves out the demo-only row, and a charging robot's battery follows on the server"
slug: "the-compliance-bars-show-how-much-of-each-framework-is-met"
status: "review"              # backlog | todo | in-progress | review | done | cancelled
priority: 2                   # 1=critical, 2=high, 3=medium, 4=low
owner: "claude"
projects: []
customers: []
tags: ["compliance", "docs", "robots", "demo", "core"]
sprint: ""
parent: ""
depends_on: []
spe: 3
effort: "medium"
due_date: "2026-11-16"
created: "2026-11-14"
updated: "2026-11-14"
---

# The compliance bars show how much of each framework is met, the docs README leaves out the demo-only row, and a charging robot's battery follows on the server

## Description

A post-deploy check of the live instance (https://neodem.emai.dev, build
`d2c63b55`, 2026-11-14) before the demo day of 2026-11-16 found three small
presentation gaps. Each is closed with the smallest change; nothing else
changes behaviour.

1. **Compliance overview.** EU AI Act, Machinery Regulation and Cyber
   Resilience Act each read "1 open of 1" next to a full "100%" bar. The bar
   drew `FrameworkScore.score`, a penalty score (100 minus points for open
   gaps and missed deadlines) that stays at 100 while nothing is overdue, even
   with every requirement of the framework's deadline open (live: 0 of 8 for
   the AI Act). The panel says "Share of each framework's tracked requirements
   that are met", which the score is not.
2. **Docs README.** `/docs/README` renders a "Demo day rehearsal — The browser
   demo used as a presentation fallback" row in its "Running an instance"
   table, although `docsRegistry.ts` hides the `demo-day` page from the nav on
   a real instance (TASK-505). (`demo-intro` has no row in the README.)
3. **Battery while charging.** `GET /api/robots/sim-robot-001` held the
   starting battery for ~20 s and then jumped (85 % → 96 %). The record's
   battery is written only by the 30 s health check; the post-command
   follow-up added in TASK-504 re-reads `/api/v1/health` every 2 s while the
   robot is busy or charging, but mirrored only the status, although the same
   response carries `batteryLevel`.

## Details

### Server

- `server/src/services/ComplianceTrackerService.ts` — `FrameworkScore` gains
  `metRequirements` and `totalRequirements`, from a new exported
  `requirementCounts(deadlines, openGaps)`: each deadline's requirement list
  (completed entries capped at the list length), one unmet requirement per
  non-closed gap, and a deadline without a requirement list as one requirement,
  met (the same deadline the open-item count treats as done). `score`,
  `status`, `openItems`, `totalItems` and `overallScore` are unchanged.
- `server/src/services/RobotManager.ts` — the follow-up read passes the health
  response's `batteryLevel` to `noteRobotAnswered`, which takes it as an
  optional third argument: `undefined` keeps the cached value, `null` (a robot
  without a battery) or a new number updates the cache, writes it with
  `robotRepository.updateHealthCheck` and emits `robot_status_changed`. The
  same level again writes and emits nothing. The SafetyService caller is
  unchanged (two arguments). The follow-up still only reads; it sends the
  robot nothing.

### Frontend

- `app/src/features/compliance/components/complianceFormat.ts` — new
  `frameworkCompletion(fw)`: `metRequirements / totalRequirements` as 0-100;
  against a server without those fields, the share of items not open.
- `app/src/features/compliance/components/ComplianceDashboard.tsx` — the bar
  draws `frameworkCompletion(fw)`. Colour: overdue stays red (TASK-503); a
  bar that would be green is amber whenever the framework is at risk, has open
  items or is under 100 % (TASK-505 plus this task); a score under 80 / 50
  stays amber / red as before.
- `app/src/features/compliance/types/compliance-tracker.types.ts` — the two
  optional fields.
- `app/src/components/docs/docsMarkdown.ts` — new
  `dropRowsLinkingToHiddenDocs(markdown, slug, isHidden)`: drops a table row
  whose first cell links only to hidden docs; later-cell mentions and fenced
  code stay.
- `app/src/components/docs/docsRegistry.ts` — outside the demo build, every
  doc's loaded text goes through it with `isDemoBuildOnlyDoc`. The heading
  lines, TOC and read time are all computed from that same text.
  `docs/README.md` itself is not edited, so GitHub still lists the page.

### Robot Agent

No change — `/api/v1/health` already reports the live `batteryLevel`.

## Acceptance Criteria

- [x] A framework with "1 open of 1" and 0 of its requirements done shows an
      empty bar, "0%"; a part-done one a partial amber bar; only a framework
      with everything met a full green bar.
- [x] The overall compliance score and each framework's status are unchanged.
- [x] On a real instance `/docs/README` has no "Demo day rehearsal" row; the
      demo build still lists it; the `demo-day` page still opens by link.
- [x] During the post-command follow-up (every 2 s while busy or charging) the
      server's robot record and the `robot_status_changed` event carry the
      battery the robot reports.

## Test Strategy

- `server/src/services/__tests__/ComplianceTrackerService.test.ts` — the
  requirement counts (live AI Act case 0 of 8, a gap as one unmet requirement,
  extra completed entries capped, not-assessed 0 of 0); the nis2 case gains
  the two fields.
- `server/src/services/__tests__/RobotManager.test.ts` — battery mirrored on
  each follow-up read while charging, written with the status on the first
  read and alone after, no write for an unchanged level; `noteRobotAnswered`
  keeps the battery on `undefined` and clears it on `null`.
- `app/src/features/compliance/components/__tests__/ComplianceDashboard.test.tsx`
  — empty bar next to "1 open of 1", partial amber, full green, overall score
  as given; the overdue case now reads 0 from the item fallback.
- `app/src/components/docs/__tests__/docsMarkdown.test.ts`,
  `docsRegistry.test.ts` — the row filter and the loaded README.
- Before/after screenshots of `/compliance` and `/docs/README` at 1280x720 and
  1440x900 (local dev server proxied read-only to the live API).

## Notes

- The overall "Compliance score 92 %" tile still averages the penalty scores,
  so it reads 92 % next to frameworks at 0 % of their requirements. Changing
  what that number means was out of scope for two days before the demo.
