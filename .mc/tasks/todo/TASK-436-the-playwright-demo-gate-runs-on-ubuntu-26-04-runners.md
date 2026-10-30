---
id: "TASK-436"
aliases: []
title: "The Playwright demo gate runs on Ubuntu 26.04 runners"
slug: "the-playwright-demo-gate-runs-on-ubuntu-26-04-runners"
status: "in-progress"
priority: 1
owner: "huhn511"
projects: []
customers: []
tags: ["core", "ci"]
sprint: ""
parent: ""
depends_on: []
spe: 2
effort: "low"
due_date: ""
created: "2026-10-30"
updated: "2026-10-30"
---

# The Playwright demo gate runs on Ubuntu 26.04 runners

## Description

GitHub moved the `ubuntu-latest` runner image to Ubuntu 26.04 on 2026-10-30. Since then the
CI job "Playwright (demo gate)" fails on every PR before any test runs. The repo's Playwright
(1.58.2) has no browser build or system-dependency list for `ubuntu26.04-x64`. This task
upgrades the app's Playwright to the smallest release that supports Ubuntu 26.04, so the demo
gate runs again without any change to the workflow file. It also fixes a vitest flake that
failed the App job on this PR's first run: a fake socket in `KeyboardTeleopLease.test.tsx`
leaked the keyboard teleop heartbeat timer.

Branch: `chore/task-436-the-playwright-demo-gate-runs-on-ubuntu-26-04-runners`.

## Details

### Current state

- `.github/workflows/check.yml`, job `e2e` ("Playwright (demo gate)"):
  - `runs-on: ubuntu-latest`, Node 20, `npm ci` in `app/`;
  - then `npx playwright install --with-deps chromium`, then `npx playwright test`.
- `app/package.json` pins `"@playwright/test": "^1.58.2"`. `app/package-lock.json` locks
  `@playwright/test`, `playwright` and `playwright-core` at 1.58.2. No other package.json,
  lockfile, Dockerfile or script pins Playwright. The `@vitest/browser-playwright` entries in
  `server/package-lock.json` and `robot-agent/package-lock.json` are optional peer metadata of
  vitest and install nothing.
- The install step fails on the 26.04 runner. It was first seen on PR #453 (run 41110217854,
  job 124251058380). PR #452 still passed earlier the same day on a 24.04 runner:

  ```
  BEWARE: your OS is not officially supported by Playwright; installing dependencies for ubuntu26.04-x64 as a fallback.
  Cannot install dependencies for ubuntu26.04-x64 with Playwright 1.58.2!
  Error: ERROR: Playwright does not support chromium on ubuntu26.04-x64
  ```

- Pinning the job to `runs-on: ubuntu-24.04` would also fix it, but this box cannot do it.
  The bot's GitHub App has no `workflows` permission, so a push that touches
  `.github/workflows/` is rejected.
- The `playwright-core` tarballs of 1.58.2 to 1.60.0 have no `ubuntu26.04` entries. 1.61.0,
  1.61.1, 1.62.1 and 1.64.1 do: a chromium download for `ubuntu26.04-x64` and a native
  dependency list for `--with-deps`. 1.61.1 is the 1.61 patch release. It brings chromium
  revision 1228 (Chrome for Testing 149.0.7827.55) and still requires only Node >= 18.

### App

- Upgrade `@playwright/test` to `^1.61.1` with npm. `npm install --save-dev
  @playwright/test@1.61.1` in `app/` updates `package.json` and moves all three locked
  packages to 1.61.1, so `npm ci` in CI installs the new version.
- No spec uses visual snapshots (`toHaveScreenshot`, `toMatchSnapshot`). A newer chromium
  therefore cannot fail a baseline. Fix a spec only for a Playwright API or behaviour change,
  and change product code only if the run shows a real bug.

### App job flake (found on this PR's first CI run)

- On this PR's first run, the Playwright gate passed on the 26.04 runner. The App job
  ("App typecheck + build (dev + demo)", Node 20) failed in its Test step. All 3479 tests
  passed, but vitest caught 2 unhandled errors:

  ```
  ReferenceError: WebSocket is not defined
   ❯ Timeout._onTimeout src/features/robots/components/tabs/TeleopTab.tsx:160:31
  This error originated in "src/features/robots/components/tabs/__tests__/KeyboardTeleopLease.test.tsx" test file.
  ```

- Cause: `FakeSocket.close()` in `KeyboardTeleopLease.test.tsx` set `readyState` and never
  fired `onclose`. In `TeleopTab.tsx`, `onclose` and `onerror` are the only places that clear
  the 100 ms heartbeat interval, so every connected test leaked one interval. When an
  interval fired after the jsdom teardown, `WebSocket` was gone. Node 22 (the dev box) has a
  native global `WebSocket`, so this never shows locally. Node 20 (CI) has none. Whether it
  fires inside that window is timing, which is why #453's App job passed on the same runner.
- The product code is right: a real socket fires `close` after `close()`. The fix is in the
  test. The fake's `close()` now fires `onclose` once. A new test, "stops its heartbeat when
  the section unmounts", fails without that fix and passes with it.
- The bot's GitHub App cannot rerun a job (`POST .../actions/jobs/<id>/rerun` answers 403), so
  this fix is also what gives the PR a new CI run.

### Key files

- `app/package.json`
- `app/package-lock.json`
- `app/src/features/robots/components/tabs/__tests__/KeyboardTeleopLease.test.tsx`

## Acceptance Criteria

- [ ] `app/package.json` asks for `@playwright/test` `^1.61.1`, and `app/package-lock.json`
  locks `@playwright/test`, `playwright` and `playwright-core` at 1.61.1. `npm ci` in `app/`
  installs 1.61.1.
- [ ] No file under `.github/workflows/` changes.
- [ ] `cd app && npx tsc --noEmit && npx vitest run` passes.
- [ ] `KeyboardTeleopLease.test.tsx` leaks no heartbeat interval: its `FakeSocket.close()`
  fires `onclose`, and "stops its heartbeat when the section unmounts" asserts that unmount
  clears the 100 ms interval. The app suite also passes with
  `NODE_OPTIONS=--no-experimental-websocket`, which removes Node 22's global `WebSocket` the
  way Node 20 lacks one.
- [ ] The full Playwright demo gate (`app/playwright.config.ts`: demo build, vite preview, MSW)
  passes locally on 1.61.1 with `CI=true`.
- [ ] On this PR, the CI check "Playwright (demo gate)" gets past
  `npx playwright install --with-deps chromium` on the `ubuntu-latest` (26.04) runner and
  passes. Every other check on the PR passes too.

## Test Strategy

- `cd app && npm ci && npx playwright --version` prints 1.61.1.
- `cd app && npx playwright install chromium`, then
  `CI=true PLAYWRIGHT_PORT=<free port> npx playwright test`. This is the whole default suite,
  the way CI runs it.
- `cd app && npx tsc --noEmit && npx vitest run`, and once more with
  `NODE_OPTIONS=--no-experimental-websocket`.
- Revert the `FakeSocket.close()` fix alone. "stops its heartbeat when the section unmounts"
  must then fail.
- Push, then read the e2e job's log on the PR. The install step must name `ubuntu26.04-x64`
  without the "does not support chromium" error, and the test step must pass.

## Notes

- The keyboard teleop session in the demo gate opens `ws://localhost:8766`. On the lab box
  that port is the real robot's supervisor, which rejects the socket. This is known and
  harmless to the gate, and is filed as TASK-432.
- Pinning `runs-on: ubuntu-24.04` stays an option for someone with the `workflows`
  permission. It is not needed once the gate is green on 26.04.
