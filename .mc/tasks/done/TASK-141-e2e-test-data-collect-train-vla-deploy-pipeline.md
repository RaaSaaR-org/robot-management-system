---
id: TASK-141
aliases: []
title: 'E2E test: data collection → training → VLA deploy pipeline'
slug: e2e-test-data-collect-train-vla-deploy-pipeline
status: done
priority: 2
owner: ''
projects: []
customers: []
tags:
- core
- testing
sprint: ''
depends_on: []
due_date: ''
created: 2026-04-06
updated: 2026-04-06
---


# E2E test: data collection → training → VLA deploy pipeline

## Description

Create an automated end-to-end test that validates the full "collect data → train model → deploy to VLA server" pipeline. This extends the existing `training-worker/scripts/test-e2e.sh` (which only covers import → train → artifact upload) to cover the complete lifecycle including video dataset handling and adapter deployment to the VLA inference server.

### Context

We now have the full pipeline working manually:
1. **Import** HF dataset (with videos) → RustFS
2. **Train** SmolVLA LoRA adapter (500 steps, ~25 min on MPS)
3. **Deploy** adapter to VLA server (download tarball, wrap base with PeftModel)
4. **Run** inference on the real SO-101 arm

Each step was validated manually during TASK-136. The existing `test-e2e.sh` covers steps 1-2 only (3-step quick run). We need to extend it to cover the video import + adapter loading path, and decide how Playwright UI tests fit in.

### Current test landscape

| Test | Location | What it covers | Runtime |
|------|----------|----------------|---------|
| `training-worker/scripts/test-e2e.sh` | Shell | RustFS + server + dataset import + 3-step training + artifact upload | ~40s |
| `app/playwright-tests/dashboard.spec.ts` | Playwright | Screenshots of dashboard (11 lines, minimal) | ~10s |
| `app/playwright-tests/shot.spec.ts` | Playwright | Single screenshot (6 lines) | ~5s |

The existing Playwright tests are minimal screenshots — not real functional tests. They overlap with `test-frontend` agent usage (which runs Playwright MCP interactively) but don't test the training/dataset UI flows.

## Details

### Part 1: Extend `test-e2e.sh` to cover video datasets + adapter loading

**Current state:** `test-e2e.sh` imports `lerobot/svla_so101_pickplace` without videos, runs 3 training steps, verifies job completion + artifact URI.

**Needed:**
- Import with `includeVideos: true` (tests the v3 video path fix in `HuggingFaceImportService.buildFileList`)
- Verify RustFS has 7 files (data parquet + 3 meta files + 2 video mp4s)
- After training completes, verify the VLA server can load the adapter:
  - Write a temporary `config.yaml` with `adapter_path`, `dataset_stats_path`, `camera_names`, `empty_cameras`
  - Start VLA server on a test port (e.g. 8001)
  - Hit `/health` → verify `model_loaded: true`
  - Hit `/predict` with synthetic image + state → verify response has valid 6-dim actions in degree range (not normalized ~0 values)
  - Stop VLA server
- Exit with pass/fail

**Key files:**
- `training-worker/scripts/test-e2e.sh` — extend
- `vla-server/config.yaml` — generate test config
- `vla-server/models/smolvla.py` — adapter loading + stats un-normalization (already implemented, needs test coverage)

### Part 2: Review Playwright tests vs test-frontend agent — eliminate duplication

**Question:** Do we need `app/playwright-tests/*.spec.ts` as checked-in Playwright specs, given that the `test-frontend` agent already runs Playwright MCP interactively?

**Analysis:**
- `test-frontend` agent runs ad-hoc during PRs — it's interactive, not CI-reproducible
- Checked-in Playwright specs can run in CI (`npx playwright test`)
- Current specs are 17 lines total — too thin to be useful
- The training/dataset UI was manually tested via Playwright MCP (job submission, history view, dataset import) but none of that is codified

**Recommendation:**
1. **Keep `app/playwright-tests/`** as the CI-runnable test dir
2. **Replace the minimal screenshots** with real functional tests:
   - `training-flow.spec.ts` — open training page, verify history loads, open "New Training Job" wizard, select dataset + SmolVLA + LoRA, submit, verify job appears as "pending"
   - `datasets-page.spec.ts` — open datasets page, verify imported datasets render with status badges, frame counts, v3 tags
3. **`test-frontend` agent** stays as the interactive PR review tool — it runs MORE than the specs (visual inspection, mobile responsive, etc.)
4. **No overlap** — specs test core flows reproducibly; agent does exploratory UI review

### Part 3: Single "test-all" entry point

Create `scripts/test-all.sh` at the repo root that runs:
1. `server/npm run typecheck`
2. `app/npx tsc --noEmit`
3. `training-worker/scripts/test-e2e.sh`
4. `cd app && npx playwright test` (if Playwright is installed)
5. Exit with combined pass/fail status

This gives a single command for CI and for agents to validate before merging.

## Acceptance Criteria

- [x] `test-e2e.sh` imports a dataset WITH videos and verifies all 7 files land in RustFS
- [x] `test-e2e.sh` spins up VLA server with trained adapter + verifies `/predict` returns un-normalized actions (degree-scale, not ~0)
- [x] `app/e2e/training-flow.spec.ts` exists and tests: training history renders, job wizard submission works (SmolVLA + LoRA)
- [x] `app/e2e/datasets-page.spec.ts` exists and tests: datasets list renders with status + frame counts
- [x] Old minimal screenshot specs (`dashboard.spec.ts`, `shot.spec.ts`) removed
- [x] `scripts/test-all.sh` runs typecheck + e2e + playwright and reports combined result
- [x] CLAUDE.md updated to document `scripts/test-all.sh`
- [x] All tests pass on Mac dev setup (e2e passed, 7/7 video flows passed, typechecks clean)

## Test Strategy

Run `scripts/test-all.sh` on a clean checkout with:
- Docker Desktop running (for RustFS)
- Node 22+ with `server/node_modules` installed
- Python 3.12+ venv in `training-worker/.venv` with lerobot[smolvla]
- Verify exit code 0

## Notes

- The VLA server adapter-loading test can use a tiny 3-step adapter (already produced by test-e2e.sh) — no need for a long training run
- Camera name override (`camera_names: [up, side]`) + `dataset_stats_path` must be part of the test config
- SmolVLA base model (~4GB) is cached after first download — subsequent runs skip the download
- The Playwright tests need the server + app running — test-all.sh should start them if not already up (similar to how test-e2e.sh handles RustFS + server)
