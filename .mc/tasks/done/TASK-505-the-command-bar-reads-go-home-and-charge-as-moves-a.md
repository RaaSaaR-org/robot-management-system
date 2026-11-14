---
id: "TASK-505"
aliases: []
title: "The command bar reads go home and charge as moves, a framework with open deadline requirements is not called compliant, the docs hide the browser-demo pages, and a model's version and notes can be corrected"
slug: "the-command-bar-reads-go-home-and-charge-as-moves-a"
status: "done"                # backlog | todo | in-progress | review | done | cancelled
priority: 2                   # 1=critical, 2=high, 3=medium, 4=low
owner: "claude"
projects: []
customers: []
tags: ["demo", "ui", "command", "compliance", "docs", "models", "core"]
sprint: ""
parent: ""
depends_on: []
spe: 4
effort: "medium"
due_date: "2026-11-16"
created: "2026-11-14"
updated: "2026-11-14"
---

# The command bar reads go home and charge as moves, a framework with open deadline requirements is not called compliant, the docs hide the browser-demo pages, and a model's version and notes can be corrected

## Description

A second review of the live instance (https://neodem.emai.dev, build
`5a66bda4`) two days before the demo day on 2026-11-16 found five places where
the app or server says something the instance contradicts. This task fixes
each with the smallest change; it does not touch `app/src/features/robots/**`
or `robot-agent/**`.

## Details

### Frontend — command bar example chips

**Current state:** `app/src/features/command/components/CommandBar.tsx` offers
three fixed chips: `Go to DOCK-1`, `Go to the charging station`, `Return home`.
A robot with no site (the live SimBot-01) has no place `DOCK-1`, so the chip
sends a `move` without a destination and the robot refuses it with a red toast.

**Change:** drop `Go to DOCK-1`. The other two succeed on a robot without
places (the app maps target `charging…` to `sendToCharge` and `home` to
`returnHome`).

### Server — "go home" read as a 60% custom command

**Current state:** the live server has no LLM provider, so
`server/src/services/CommandInterpreter.ts` `fallbackInterpretation` answers.
It has no `home` / `charg` keyword: "go home" became `custom` at 0.6 with
"Please be more specific…", and the app's `targetlessAction`
(`app/src/features/command/api/commandApi.ts`) then sent the robot home anyway.

**Change:** a new exported `homeOrChargeTarget(text)` returns `'charging
station'` for `(re)charge/charging` and `'home'` for `home`, with the same
question / negation guard as `targetlessAction`, plus a leading question word,
a status keyword (`status|battery|position|check|report`) or an explicit
"to <other place>" returning null. The fallback treats a match as `navigation`
with that target (confidence 0.85, no suggestion). The Gemini system prompt
gains the same rule so both paths agree.

### Server + Frontend — compliance overview

**Current state:** `ComplianceTrackerService.calculateFrameworkScores` counted a
deadline as an open item only once it was past due, so EU AI Act (0 of 8
requirements, deadline 2027-08-02) read "100 · Compliant · 0 open".

**Change:** every deadline with requirements still open is an open item. The
score formula is unchanged. The status is `compliant` only with no open items,
otherwise `in_progress`, or `at_risk` when a deadline under 90 days away is
less than half done (the rule `getRegulatoryDeadlines` already uses);
`overdue` stays as it was. `ComplianceDashboard.tsx` draws an at-risk
framework's bar amber instead of green.

### Frontend — docs nav

**Current state:** `app/src/components/docs/docsRegistry.ts` lists
`demo-day` and `demo-intro` (pages written for the GitHub-Pages browser mock)
under Getting Started on a real instance; `records/` and `adr/` are bundled
too.

**Change:** a new exported `isDemoBuildOnlyDoc(slug)`; outside
`VITE_DEMO_MODE=true` those pages are left out of the nav. Their content stays
loaded, so `docs/README.md`'s link to `demo-day.md` still opens.

### Server — model version metadata

**Current state:** `PATCH /api/models/versions/:id`
(`server/src/routes/models.routes.ts`) accepts only `skillId`, `name` and
`deploymentStatus`.

**Change:** it also accepts `version` (1–100 characters, trimmed) and `notes`
(at most 4000 characters, null or blank clears) — the same limits as a model
upload — through `UpdateModelVersionInput` (`server/src/types/vla.types.ts`)
and `ModelVersionRepository.update` (`server/src/repositories/VLARepository.ts`).
No data on the live instance is changed by this task.

### Key files

- `app/src/features/command/components/CommandBar.tsx`
- `server/src/services/CommandInterpreter.ts`
- `server/src/services/ComplianceTrackerService.ts`
- `app/src/features/compliance/components/ComplianceDashboard.tsx`
- `app/src/components/docs/docsRegistry.ts`
- `server/src/routes/models.routes.ts`, `server/src/repositories/VLARepository.ts`, `server/src/types/vla.types.ts`
- `app/src/features/deployment/types/deployment.types.ts`, `docs/api.md`

## Acceptance Criteria

- [x] The command bar offers no `Go to DOCK-1` chip; the remaining chips need no named place.
- [x] With no LLM provider, "go home" / "return home" interpret as navigation to `home`, "charge" / "go charge" as navigation to `charging station`, at 0.85 with no suggestion; "don't go home", "is it charging?" and "check the battery charge" never do.
- [x] A framework whose deadline still has requirements open is not `compliant`; its open items count the deadline; the score is unchanged.
- [x] Outside the demo build the docs nav lists no `demo-day`, `demo-intro`, `records/` or `adr/` page; a link to one still opens it.
- [x] `PATCH /api/models/versions/:id` sets `version` and `notes`, and refuses non-strings, a blank version and over-long values with 400.

## Test Strategy

- `server/src/services/__tests__/CommandInterpreter.test.ts`: the home / charge phrases and the guarded ones.
- `server/src/services/__tests__/ComplianceTrackerService.test.ts`: in progress, compliant, at risk, half done near a deadline, overdue open items.
- `app/src/features/compliance/components/__tests__/ComplianceDashboard.test.tsx`: "In progress" label and amber at-risk bar.
- `app/src/components/docs/__tests__/docsRegistry.test.ts`: the hidden set, holding in both builds.
- `server/src/__tests__/models-routes.test.ts`: PATCH version / notes, validation, rejected write; repository update.
- `app/src/features/command/components/__tests__/CommandBar.examples.test.tsx`: the chips.
- Server and app typecheck + full vitest; Playwright `demo-smoke` and `app-routes`.

## Notes

- The live instance needs a server and app deploy for these to show.
- Editing the existing model's `notes` / `version` on the live instance is left to the main session.
