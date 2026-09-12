---
id: "TASK-255"
title: "Repair real backend browser workflows"
slug: "repair-real-backend-browser-workflows"
status: "done"
priority: 2
owner: "huhn511"
tags: [browser, integration]
spe: 8
created: "2026-09-08"
updated: "2026-09-12"
---

# Repair real backend browser workflows

Exercise the production frontend and real local server using Playwright MCP, with an isolated database and no demo mocks. Fix reproducible failures and improve the affected workflows.

## Acceptance Criteria
- [x] Exercise authentication, navigation and representative record creation/editing through Playwright MCP against the real backend.
- [x] Fix reproduced product defects with appropriate regression coverage.
- [x] Record browser evidence, verification results and unavailable integrations.

## Verification

- Playwright MCP: production build + real JWT backend + isolated SQLite; 20 navigation destinations, Model Registry, registration/login/reload, tour and zone persistence, viewer denial and owner writes, mobile layout, paced outage recovery.
- App: typecheck, 2,086 tests; server: typecheck, 5,822 tests (one existing optional Cosmos skip).
- Standard demo browser regression suite: 45 tests passed.
- Independent frontend/backend review: no material findings.
- Details and reproduction: `docs/testing/real-backend-browser-audit.md`.
- No robot hardware, training worker, or object storage exercised. Authorization changes cover zones, tours, and patrol routes, not an audit of every server endpoint.

PR: https://github.com/RaaSaaR-org/robot-management-system/pull/301
