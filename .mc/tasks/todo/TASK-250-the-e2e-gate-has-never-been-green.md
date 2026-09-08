---
id: "TASK-250"
aliases: []
title: "The e2e gate has never been green, and CI never ran the half of the suite that could tell"
slug: "the-e2e-gate-has-never-been-green"
status: "in-progress"
priority: 2
owner: "huhn511"
projects: []
customers: []
tags: ["core", "testing"]
sprint: ""
parent: ""
depends_on: []
spe: 3
effort: "medium"
due_date: ""
created: "2026-09-06"
updated: "2026-09-08"
---

# The e2e gate has never been green, and CI never ran the half of the suite that could tell

## Description

`npx playwright test` on clean `main` is 14 failed / 28 passed. Not one of those failures is
a regression: every one has been failing since the day the spec was written. They survived
because `.github/workflows/check.yml` runs no Playwright and no python at all — so a suite
can be red from birth and a `check` tick still goes green.

## Details

### Current state, measured 2026-09-06 on clean `main`

`./scripts/test-all.sh --skip-pw` passes: 5721 + 2072 + 2332 vitest, 48 curation pytest, 131
sidecar pytest, 273 Isaac verifier checks. Then `npx playwright test` fails 14 of 42.

The whole of it is one defect: **`playwright.config.ts` has `testDir: './e2e'` and no
`testIgnore`.** Three sibling suites live under `e2e/`, each already has a correct config of
its own, and the default run sweeps all of them up and runs them with the wrong settings.

| what got swept up | its real home | what happens under the default config |
|---|---|---|
| `e2e/videos/**` (7 files) | `playwright.videos.config.ts` — timeout 120 s, actionTimeout 10 s | Recordings with ZERO `expect()` calls. The default config sets no `actionTimeout`, so it is 0 = infinite; `smoothClick`'s `.catch(() => {})` at `e2e/helpers/videoHelpers.ts:39` then cannot swallow a click that matches nothing, and the recording dies on the 30 s test timeout. Flows 1-3 pass by luck, 4-7 fail. |
| `e2e/live/**` | `playwright.live.config.ts` — baseURL `:1420`, no webServer | Their own headers say "Requires dev servers on :3001/:1420". Pointed at the demo preview, their absolute `page.goto('/datasets')` escapes that server's `/robot-management-system` base path and lands on vite's "public base URL" **notice page**, which serves no app bundle. `waitForSelector('text=Datasets')` then passes on the notice page's own link text, so the failure surfaces a line later and reads like a missing element. |
| `e2e/datasets-shot.spec.ts` | nowhere — it is a utility, not a test | Reads `/tmp/dev-token.txt` and targets a hard-coded LAN address `192.168.178.76:1420`. Can only pass on one developer's machine. |

Two more specs were in the default set and cannot pass there either, for a different reason:

- `datasets-page.spec.ts` and `training-flow.spec.ts` assert the real Dataset Hub and
  Training Studio. `DatasetsPage.tsx:43` and `TrainingPage.tsx:36` return
  `<DemoFeaturePlaceholder>` before their first hook when `VITE_DEMO_MODE` is set, and
  `playwright.config.ts:17` builds *and* previews with exactly that flag. The gate landed in
  `bdea0ec6` (#59, 2026-02-28); the specs were added in `09623810` (#109, 2026-04-06), a
  month later. **They have never had a passing run under their own config.** The demo
  placeholder is a deliberate product decision that ships to GitHub Pages via
  `deploy-demo.yml` and 13 pages use it, so this is not a product bug — the specs simply need
  a non-demo app, which is what `playwright.live.config.ts` serves.
- `datacollection-vr.spec.ts` fails for the reason its own header already states: it needs a
  live stack. On this box it dies on a drifted local `dev.db` (`TeleoperationSession` has no
  `recorderKind` column, so `POST /api/teleoperation/sessions` 400s). That drift is local
  only — the column ships in `prisma/schema.prisma` and in migration
  `20260823010000_task_220_dataset_mixture`, and the `migrations` CI job proves the committed
  migrations match the schema.

### The CI half

`check.yml` gates on server/app/robot-agent typecheck + vitest + build, and the Prisma drift
job. It runs **no python and no Playwright**. So the 73 sim, 131 sidecar and 48 curation
tests plus 273 Isaac verifier checks — over 500 assertions — hold up no PR, and neither does
the e2e suite. Worse, both python stages in `test-all.sh` report SKIPPED rather than failed
when their interpreter is missing, which is the trap `CLAUDE.md` already warns about in
writing: a run that says "all tests passed" may have run none of them. On this box
`SIM_PYTHON` was never set, so the sim suite had never run here at all — it needs only
mujoco + numpy + pytest, and passes 73/4-skipped in 0.3 s once given any interpreter that has
them.

### Key files

- `app/playwright.config.ts` — the missing `testIgnore`
- `app/playwright.live.config.ts`, `app/playwright.videos.config.ts` — already correct
- `.github/workflows/check.yml` — the two new jobs
- `scripts/test-all.sh` — `--python-only`, so the CI job and a local run cannot disagree
  about what "the python suites" are

## Acceptance Criteria

- [x] `cd app && npx playwright test` is green on clean `main`
- [x] Nothing is deleted: every excluded file still runs from the entry point it was written
      for, and the config says which one and why
- [x] `datasets-page`, `training-flow` and `datacollection-vr` live under `e2e/live/`;
      `datasets-shot` is `e2e/scripts/datasets-shot.ts`, not a spec
- [x] `check.yml` runs the Playwright gate on every PR — workflow job applied; remote execution remains a separate criterion.
- [x] `check.yml` runs all four python stages on every PR; missing interpreters or
      sim-node dependencies fail the gate. Optional individual integrations are
      explicitly reported; they are not counted as passed.
- [x] `scripts/test-all.sh --python-only` runs stages 3a-3d and nothing else
- [ ] CI is green on the PR that carries this

## Test Strategy

```bash
cd app && npx playwright test                      # the gate: 25 passed
./scripts/test-all.sh --python-only                # requires all Python stages
SIM_PYTHON=<python with MuJoCo + Unitree SDK> ./scripts/test-all.sh
```

The live suite still needs the real stack and is not part of the gate:

```bash
cd server && npm run dev      # :3001
cd app && npm run dev         # :1420
cd app && npx playwright test --config=playwright.live.config.ts
```

## Notes

Found by running the suite rather than by reading it. The five failure clusters were
root-caused in parallel and each root cause was then handed to a second agent whose only job
was to refute it; the "stale test" verdicts survived that, and one — the live specs — was
corrected by it (the browser was on vite's notice page, not on a demo-gated component).

## Demo-day completion — 2026-09-08

The existing CI patch is now applied to `.github/workflows/check.yml`. This session uses
the authenticated GitHub CLI account, whose token has workflow scope; the old GitHub App
permission blocker no longer applies. The Playwright runner also gets an explicit port
override and refuses to reuse unrelated servers: port 4173 on this workstation was serving
another project and silently attracted this suite.

Validation and PR CI results are recorded below before closing the task.

### Resumed verification — 2026-09-08

The original Linux run's `73 passed, 4 skipped` concealed four entire test modules:
`sim_node` imports the Unitree SDK and CycloneDDS. CI now builds CycloneDDS 0.10.2,
installs the SDK at commit `65691c8a8bc53b98d3976dba4dbf9d5d20b2e7f5`, and uses OSMesa.
The strict Python gate imports `sim_node` before pytest and fails unavailable stages;
local optional stage skips are counted in the summary. Pytest `-rs` records individual
skip reasons. Deliberately invalid interpreter paths return nonzero.

Local strict validation: sim **141 passed**, curation **48 passed / 1 optional LeRobot
integration skipped**, hardware **122 passed / 1 pyzmq module skipped**. Evidence:
`/tmp/neodem-task250-local-strict.log`. Linux and remote CI results follow separately.
Shell syntax and `git diff --check` passed. Original dedicated-port demo gate: **25/25**
(`/tmp/neodem-demo-correct.log`); expanded navigation coverage belongs to TASK-252.

Clean Linux validation completed with exit 0 using `python:3.12-bookworm`, a read-only
repository mount, and the workflow's CycloneDDS build, pinned SDK and OSMesa dependencies:
**141 sim passed / no skips**, **48 curation passed / 1 optional LeRobot integration
skipped**, **131 hardware passed / no skips**. All four Isaac offline verifier scripts
passed; the scene verifier reported **273 passed / 1 optional out-of-repository scene
check skipped**. Evidence: `/tmp/neodem-task250-linux-complete.log`. Read-only pytest
cache warnings do not affect assertions. This validates Linux dependency/render coverage;
GitHub's Ubuntu runner and the final PR SHA still require remote CI before task closure.
