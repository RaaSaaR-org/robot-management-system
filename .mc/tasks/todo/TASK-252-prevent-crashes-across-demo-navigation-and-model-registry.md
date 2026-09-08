---
id: "TASK-252"
title: "Prevent crashes across demo navigation and Model Registry"
slug: "prevent-crashes-across-demo-navigation-and-model-registry"
status: "in-progress"
priority: 2
owner: "huhn511"
tags: ["core"]
created: "2026-09-08"
updated: "2026-09-08"
spe: 3
effort: "medium"
---

# Prevent crashes across demo navigation and Model Registry

## Description

Opening Digital Twin or Updates in the public demo replaces the entire application with a blank page because missing mock list handlers return objects where callers require arrays. Pipeline similarly receives the wrong jobs envelope. Model Registry also crashes the normal application: its Zustand selectors return fresh filtered arrays on every snapshot read, causing a React update loop.

## Details

- `app/src/mocks/handlers.ts`: return bare arrays for digital twins/updates and the simulation jobs envelope expected by the clients.
- `app/src/features/deployment/hooks/useModelVersions.ts`: subscribe to the stable versions array and derive status groups using useMemo.
- `app/src/features/deployment/hooks/__tests__/useModelVersions.test.ts`: render against the real store and verify status promotion updates.
- `app/e2e/demo-smoke.spec.ts`: actual sidebar navigation, explicit Model Registry navigation, uncaught error assertions, and return to dashboard to prove the existing React root stays usable.

## Acceptance Criteria

- [x] Digital Twin, Updates, Pipeline, Model Registry, Data Collection and Fleet Learning render without uncaught errors.
- [x] Mock responses match existing API contracts.
- [x] Model Registry derives filtered arrays outside Zustand snapshot selectors and still updates on promotion.
- [x] Browser smoke covers all primary sidebar destinations and Model Registry, including navigation back to the dashboard.
- [x] App typecheck/build and unit tests pass.
- [ ] Independent review and PR CI pass before merging.

## Test Strategy and Evidence

App unit suite: 2074 tests passed across 123 files, including two real-store hook regressions. Local Node24 requires NODE_OPTIONS=--no-experimental-webstorage so native experimental storage does not shadow jsdom; CI uses Node20. Original25 browser tests passed. Expanded browser suite: 45/45 passed. Screenshots of Digital Twin, Updates, Pipeline and Model Registry were reviewed and show usable pages with expected empty/prerequisite states.
