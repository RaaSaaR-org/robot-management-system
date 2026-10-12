---
id: "TASK-380"
aliases: []
title: "A bad place-graph answer does not slow the agent's poll"
slug: "a-bad-place-graph-answer-does-not-slow-the-agent-s-poll"
status: "done"
priority: 3
owner: "huhn511"
projects: []
customers: []
tags: ["core"]
sprint: ""
parent: ""
depends_on: []
spe: 3
effort: "low"
due_date: ""
created: "2026-10-12"
updated: "2026-10-12"
---

# A bad place-graph answer does not slow the agent's poll

## Description

The robot agent polls the platform for its place graph and its frame registration
through `startBackoffPoll` (TASK-372). Backing off while the platform cannot be
reached is right. But a platform that *answers* with a payload that fails
validation was reported as a failure too, so the poll backed off up to 5 min and a
site map fixed in the UI took up to 5 min to reach the robot.

## Details

**Current state**

- `robot-agent/src/utils/backoff-poll.ts` — the loop; `{ ok: false }` grows the delay.
- `robot-agent/src/agent-mode/place-graph-source.ts` — `refresh()` folds a 2xx with an
  invalid graph into the same catch as a network failure (`origin: 'cache' | 'none'`).
- `robot-agent/src/agent-mode/frame-registration.ts` — a 2xx with a malformed
  registration returns `{ kind: 'error' }`, same as a 5xx.
- `robot-agent/src/robot/state.ts` — `startFrameRegistrationRefresh` and
  `startPlaceGraphRefresh` map those to `{ ok: false }`.

### Robot Agent

- `PlaceGraphResult` gains `invalid: true` when the platform answered 2xx but the
  graph failed validation; the cached graph is still returned, nothing is adopted or
  cached, and the line is logged once per distinct error.
- `FrameRegistrationFetch` gains `{ kind: 'invalid'; error }` for a 2xx whose body is
  not a registration.
- Both ticks in `state.ts` treat an invalid answer as "the platform answered": the
  poll keeps its base interval, keeps what it had, and logs the invalid answer once
  per distinct error.
- `federated/RoundLifecycle.ts` is not analogous: `getOpenRounds()` does no payload
  validation that could fail on a 2xx, so it is left as is.

## Acceptance Criteria

- [x] A place-graph answer that fails validation keeps the poll at its base interval.
- [x] A frame-registration answer that fails validation keeps the poll at its base interval.
- [x] An unreachable platform / 5xx / timeout still backs off.
- [x] An invalid answer never replaces the cached graph or the held registration.
- [x] The invalid answer is logged once per distinct error, not every tick.
- [x] Once the platform serves a valid graph again it is adopted on the next tick.

## Test Strategy

robot-agent vitest: source tests classify a 2xx-invalid answer apart from a
network/5xx failure; state tests with a short `refreshMs` count fetches to show an
invalid answer keeps the base interval, an unreachable server backs off, and a valid
graph is adopted after an invalid one.

## Notes
