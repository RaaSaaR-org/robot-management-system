---
id: "TASK-338"
aliases: []
title: "The App CI job has room under its time limit"
slug: "the-app-ci-job-has-room-under-its-time-limit"
status: "done"
priority: 2
owner: "claude"
projects: []
customers: []
tags: ["core", "ci"]
sprint: ""
parent: ""
depends_on: []
spe: 1
effort: "low"
due_date: ""
created: "2026-09-30"
updated: "2026-09-30"
---

# The App CI job has room under its time limit

## Description

The `app` job in `.github/workflows/check.yml` ("App typecheck + build (dev + demo)")
has `timeout-minutes: 5`, and a passing run takes 3-5 minutes. Runs whose tests all
pass get cancelled mid demo-build, so every PR on 2026-09-30 needed one or two
`gh run rerun --failed`. Give the job headroom, and check whether
`HFDatasetBrowserModal.test.tsx` is the flake it was suspected to be.

## Details

**Current state (measured 2026-09-30):**

- Green run on main (36730371394): install 6 s, typecheck 12 s, vitest 93 s, dev build
  27 s, demo build 28 s — about 3 min.
- Cancelled runs (e.g. 36725963424, attempt 1 of 36727552967 and 36708790103): vitest
  137-167 s (`Tests 2641 passed`), dev build 45 s, then the demo build was killed at
  the 5-minute mark. Every test passed; the "failure" was the job timeout.
- vitest's own breakdown on CI: tests 97 s, environment 113 s, setup 58 s, import 55 s
  — most of the time is jsdom set-up per file, not test bodies. No single cheap fix.
- `HFDatasetBrowserModal.test.tsx` passed in every inspected CI log (15 tests, ~3 s).
  It was blamed because its stderr sits near the end of the output: `emit()`/`drop()`
  on its `FakeWebSocket` fire handlers outside `act()`, logging three "not wrapped in
  act(...)" warnings per run.

### CI

- Raise the `app` job's `timeout-minutes` from 5 to 10, with a comment giving the
  measured step times.

### Frontend

- Wrap `FakeWebSocket.emit()` and `.drop()` in `act()` so the file runs warning-free.

**Key files:**

- `.github/workflows/check.yml`
- `app/src/features/training/components/__tests__/HFDatasetBrowserModal.test.tsx`

## Acceptance Criteria

- [x] The `app` job's `timeout-minutes` is 10, with a comment explaining the number.
- [x] `HFDatasetBrowserModal.test.tsx` passes and logs no act() warnings.
- [x] CI is green on the PR without a rerun.

## Test Strategy

- `cd app && npx vitest run src/features/training/components/__tests__/HFDatasetBrowserModal.test.tsx`
  three times: 15 passed, `grep -c 'not wrapped in act'` is 0.
- The PR's own check run: the App job completes within the new limit.

## Notes

The `server` and `robot-agent` jobs also have `timeout-minutes: 5`; neither was seen
timing out, so they are left alone.
