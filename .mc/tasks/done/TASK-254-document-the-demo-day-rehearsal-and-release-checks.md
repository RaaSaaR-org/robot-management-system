---
id: "TASK-254"
title: "Document the demo day rehearsal and release checks"
slug: "document-the-demo-day-rehearsal-and-release-checks"
status: "done"
priority: 2
owner: "huhn511"
tags: ["core"]
created: "2026-09-08"
updated: "2026-09-08"
spe: 3
effort: "medium"
---

# Document the demo day rehearsal and release checks

## Description

Demo day needs a repeatable local fallback, a clear presentation route, and honest boundaries between browser fixtures, backend operation and physical robots. The current demo intro calls the browser experience a live fleet and implies all features operate there.

## Details

Create docs/demo-day.md using app/playwright.config.ts, deploy-demo.yml, check.yml, README quick start and docs/runbook.md as command anchors. Update docs/demo-intro.md to describe the actual browser simulation, supported presentation flow and backend-dependent stages. Link the runbook from README documentation table.

Add docs/agent-mode.md as the operator guide for Agent Mode, patrol and host mode: startup prerequisites, configuration, routes, behavior, data retention and safety limits. Expand the README feature overview and status table with these use cases and link the guide from the documentation index, architecture and AI operations guide. Document the actual server and robot Agent Mode/tour HTTP surfaces in docs/api.md, and add the existing tour UI routes to app/AGENTS.md. Keep claims aligned with current implementation, including the shipped TASK-201 geofence advisory and the separate simulator/hardware verification boundaries.

## Acceptance Criteria

- [x] An operator can build/serve the demo locally and verify its routes with documented commands.
- [x] Rehearsal distinguishes fixture interactions from backend/physical hardware demonstrations and gives a recovery path.
- [x] Release checklist requires current-head CI, reviewed PRs and post-deploy browser checks.
- [x] Agent Mode operator guide covers startup, patrol/host opt-ins, data handling and safety limits, with simulation-only maturity stated.
- [x] README and documentation entry points describe and link Agent Mode, patrol and host mode consistently.
- [x] API descriptions and tour UI route guidance match implemented paths, methods and behavior.
- [x] Commands and internal links are checked against the repository; independent review passes.

## Test Strategy

Cross-check commands/configuration and links; use browser gate evidence from TASK-252 for the demo navigation flow. No artificial tests for prose.

Validation: commands checked against package scripts, Vite/Playwright config and workflows; repository document links resolve. Independent review corrected browser installation instructions and in-app documentation link compatibility. TASK-252 browser rehearsal passed 45 tests.

Independent continuation review: checked demo commands against package scripts, Vite/Playwright and Pages configuration, and Agent Mode API descriptions against the actual routes. Corrected terminal working directories, host answer/privacy boundaries, patrol confirmation semantics, memory/identity HTTP methods and the shipped TASK-201 geofence advisory. Screenshot links now also work outside the in-app docs renderer. No simulator or physical hardware validation was performed for this documentation review.

Independent review of origin/main...214157ec is clean after correcting tour distance behavior, initiative exemptions and transcript retention semantics. PR #299 initial checks passed; final six checks include the pending TASK-250 CI dependency and must pass before merge.
