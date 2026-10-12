---
id: "TASK-377"
aliases: []
title: "The keyboard teleop lease test is not flaky"
slug: "the-keyboard-teleop-lease-test-is-not-flaky"
status: in-progress
priority: 3
owner: "huhn511"
projects: []
customers: []
tags: ["core"]
sprint: ""
parent: ""
depends_on: []
spe: 2
effort: "low"
due_date: ""
created: "2026-10-12"
updated: 2026-10-12
---

# The keyboard teleop lease test is not flaky

## Description

`app/src/features/robots/components/tabs/__tests__/KeyboardTeleopLease.test.tsx`,
case "ignores motion keys until bound, then drives", failed in CI on unrelated PRs
(#389, #393, #395) with `expected [] to deep equally contain { bind: { leaseId: 'L', … } }`
and passed on rerun. Find the real race and fix its root cause — no retries, no
longer timeouts.

## Details

**Current state.** The test stubs `WebSocket` with a `FakeSocket` that records every
instance. Its `connect()` helper clicks Connect and then drives
`FakeSocket.instances[length - 1]`, assuming the last socket made is the section's
`/ws/keyboard-teleop` socket.

With the lease capability on, `useControlLease`
(`app/src/features/robots/hooks/useControlLease.ts`) also opens an observer socket on
`/api/a2a/ws` in a `useEffect` keyed on `enabled`. `getControlLease` resolves outside
`act` (inside `findByTestId`), so React commits the lease bar in a scheduler task
(`setImmediate`) and defers the passive effects to *another* `setImmediate`. RTL's
`waitFor` then resumes the test after a `setTimeout(0)`. On an idle machine the
`setImmediate` wins and the observer socket exists before Connect; on a busy CI runner
more than 1 ms passes, the timer wins, the test clicks Connect first, and the observer
effect runs during that click's re-render. The "last socket" is then the observer:
the test opens and feeds the observer, the teleop socket is never opened, no socket is
attached to the lease, and "Take control" never sends `bind`.

This is a test bug, not a component bug: in the app the observer and the teleop
socket are independent, and the order in which they are created does not matter.

### Frontend

- `connect()` picks the socket by URL (`/ws/keyboard-teleop`) and asserts that the
  click opened exactly one new one.
- `renewControlLease` gets a resolved value in `beforeEach`, so a renew timer that
  fires on a slow run gets an answer instead of `undefined.then`.

**Key files**

- `app/src/features/robots/components/tabs/__tests__/KeyboardTeleopLease.test.tsx`

## Acceptance Criteria

- [x] The test drives the `/ws/keyboard-teleop` socket regardless of whether the
      observer socket is created before or after Connect.
- [x] With the bad ordering forced (a 5 ms busy-wait right after the lease bar
      commits), the old test fails with the CI error and the fixed test passes.
- [x] The file passes 50 consecutive runs under CPU load.
- [x] No retries and no longer timeouts are added; the component is unchanged.

## Test Strategy

Force the ordering with a temporary `MutationObserver` that busy-waits 5 ms once the
lease bar appears (reproduces the CI failure on the old helper), then run the file 50
times under `yes` load, then the full app vitest suite once.

## Notes
