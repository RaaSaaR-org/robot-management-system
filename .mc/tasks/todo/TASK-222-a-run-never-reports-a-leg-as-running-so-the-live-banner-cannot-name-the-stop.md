---
id: TASK-222
aliases:
- TASK-222
title: A run never reports a leg as running, so the live banner on /tour (and /patrol) cannot name the stop the robot is at
slug: a-run-never-reports-a-leg-as-running-so-the-live-banner-cannot-name-the-stop
status: todo
priority: 3
owner: ''
projects: []
customers: []
tags:
- core
- agentmode
- g1
- hri
sprint: ''
depends_on:
- '[[TASK-213]]'
due_date: ''
created: 2026-08-25
updated: 2026-08-25
---


# A run never reports a leg as running, so the live banner on /tour (and /patrol) cannot name the stop the robot is at

## Description

`TourRunner` marks a leg `running` and emits nothing; the only `agent:tour:leg`
event goes out after that leg has SETTLED. Every run snapshot the UI ever sees
therefore reads "legs 0..i done, i+1..n pending" and no leg is `running`, so
`/tour`'s live banner falls back to a generic string for almost the whole visit
instead of naming the stop the robot is standing at. `PatrolRunner` has the
identical shape and `/patrol`'s banner the identical symptom.

Found while building the Agent Mode rail's tour chip in PR #252 (TASK-213), and
deliberately NOT fixed there: emitting on leg start changes the live behaviour
of a shipped feature and wants a PR of its own.

## Details

### Current state

**The robot never says "I have started this leg".**

- `robot-agent/src/agent-mode/host.ts:1290` — `TourRunner.drive` sets
  `leg.status = 'running'`, stamps `leg.startedAt`, calls `this.persist(run)`
  and emits NOTHING.
- `robot-agent/src/agent-mode/host.ts:1349` — the one and only
  `emit('agent:tour:leg', ...)`, reached after `leg.status` has been set to
  `done` / `failed` (`:1343`).
- `robot-agent/src/agent-mode/patrol.ts:872` and `:929` — the same two lines,
  the same way round. Every other emit in both runners is `started`, `turn` or
  `finished`.

Every `host.ts` line number here is as of PR #252, which added nine lines to
`buildTourBlocks` above them; on `main` before that merge the same two lines are
`:1281` and `:1340`.

**So the snapshot the UI folds in is always between legs.** After leg *i*
settles the run reads `0..i` settled and `i+1..n` pending: there is no
`running` leg in it. During a visit the only other event carrying a run is
`agent:tour:turn` (`host.ts:1509`), emitted while a leg IS running — which is
why the symptom is intermittent rather than total, and why it disappears on any
tour where a visitor happens to ask a question at the right moment.

**What that costs, on the page built for watching a tour:**

- `app/src/features/tour/utils/tourFormat.ts:231` — `currentLeg(run)` looks for
  `l.status === 'running'` and answers `null`.
- `app/src/features/tour/components/ActiveRunBanner.tsx:99` — the stop clause
  degrades to `· walking` (via `currentStopText`, TASK-213/#252).
- `app/src/features/tour/components/ActiveRunBanner.tsx:94` — worse and less
  obvious: `RoutePath`'s `activeIndex={current?.index}` is `undefined`, so the
  numbered stepper — the one live-progress affordance on the page — never
  highlights the stop in progress either.
- `app/src/features/patrol/components/ActiveRunBanner.tsx:67` computes `current`
  the same way inline; `:95` and `:96` have the same two symptoms.

**The store was written expecting live `running` legs.** The memoisation
signature at `app/src/features/tour/store/tourStore.ts:572-578` carries every
leg's status one character at a time, and its comment says why: "a leg going
`running` → `done` leaves that count unchanged, so the banner went on naming a
stop the robot had already left". That guard is correct and stays correct — it
is simply defending against a transition the wire never delivers today.

**The asymmetry, stated plainly.** After PR #252, `/agent` names the stop
correctly for the whole time the robot is standing at it, because the Agent Mode
rail watches BLOCKS and blocks *are* reported as they start
(`exec.begin` → `agent:block:started`), and because `buildTourBlocks` now puts
`stopIndex`/`stopName` on every block of a stop. `/tour` — the page actually
built for watching a tour — does not. The cockpit is better informed about a
visit than the visit's own page.

### Robot Agent

The fix, and the whole of it:

- `host.ts` `TourRunner.drive` — emit `agent:tour:leg` right after
  `leg.status = 'running'` / `leg.startedAt = this.stamp()` / `persist` at
  `:1290-1292`.
- `patrol.ts` `PatrolRunner` — the same at `:872-874`, emitting
  `agent:patrol:leg`.

Both are `this.deps.emit('agent:…:leg', cloneRun(run))`, i.e. two lines. What
makes this a task rather than a one-liner is everything below: it is a live
behaviour change on a released feature (patrol, v2026.08.09) and an unreleased
one (host mode, pending v2026.08.25), and it doubles the leg-event count on the
wire.

**This must not be done as a drive-by.** It ships in its own PR, reviewed on
its own, with the checks in the Test Strategy actually run against the sim.

### Server

**No change is expected.** What has to be VERIFIED, because an extra event per
leg is a new input to code that has only ever seen settled snapshots:

- `server/src/routes/agent-mode.routes.ts:104-111` fans `agent:tour:*` to
  `tourService.ingest` and `agent:patrol:*` to `patrolService.ingest`,
  fire-and-forget, then broadcasts.
- `server/src/services/TourService.ts:167-176` (`isRunDowngrade`) rejects a
  snapshot that walks progress backwards. A leg-START snapshot carries the SAME
  settled-leg count as the settle before it, the same `turns.length`, no
  `finishedAt` and status `running`, so it is not a downgrade and is applied —
  which is what we want. Confirm that reading with a test rather than by
  inspection.
- The reverse case is the one that matters: a leg-start snapshot DELAYED past
  the settle it precedes must still be rejected. It should be, because
  `settledLegCount(incoming) < settledLegCount(stored)` by exactly one — pin it.
- `TourService.ingestRun` writes the compliance record and raises the run alert
  ONLY on `agent:tour:finished` (`:609-611`), so an extra leg event cannot
  duplicate either. Re-check the patrol equivalent, which also owns findings.
- Cost: one extra upsert and one extra broadcast per leg. Legs are minutes
  apart, so this is nothing next to the existing heartbeat and block traffic —
  but the run payload carries the whole transcript, so state the measured size
  for a long tour rather than assuming.

### Frontend

**No change is expected if the robot emits.** What has to be re-checked:

- `app/src/features/tour/store/tourStore.ts:146-160` (`isRunDowngrade`) and
  `:163-172` (`isProgressDowngrade`) — the same analysis as the server's, plus
  the transcript clause. A leg-start snapshot must be accepted; a late one must
  not resurrect a stop the robot has left.
- `app/src/features/patrol/store/patrolStore.ts:162` — the patrol twin.
- `app/src/features/tour/store/tourStore.ts:572-578` — `selectActiveRuns`
  already re-memoises on a leg status change, so the banner will actually
  re-render. Confirm it does not now re-render (and restart its 1 s clock) more
  often than intended.
- Nothing in `ActiveRunBanner`, `currentLeg` or `currentStopText` should need
  touching: they have been waiting for this event all along.

**The frontend-only alternative, and why it is second best.** The banner could
infer the leg from the settled prefix — the first non-settled leg is where the
robot is heading — with no wire change at all. It is honest about "heading to
stop 3" but cannot tell walking-TO a stop from standing-AT one, which is exactly
the distinction an operator watching a visitor wants, and it would put a second,
divergent definition of "current leg" next to `currentLeg()`. Take it only if
the robot-side emit is rejected for a reason this task does not anticipate.

## Test Strategy

**Unit — robot agent** (`host.test.ts`, `patrol.test.ts`): drive a scripted
run through `TourRunner.drive` / `PatrolRunner` and assert the emitted event
sequence is `started`, then per leg a `leg` event whose own leg reads `running`
followed by one whose leg reads `done`, then `finished`. The existing suites
already collect events into an array (`rig()` in `host.test.ts`), so this is an
assertion on the order and on `legs[i].status` inside each payload — the exact
tripwire that would have caught this when host mode was written.

**Unit — server** (`server/src/__tests__/TourService.test.ts`): a leg-start
snapshot is applied on top of the previous settle; the same snapshot arriving
AFTER the settle it precedes is rejected as a downgrade; neither raises an
alert nor writes a compliance record. Repeat for `PatrolService`.

**Unit — app** (`tourStore.test.ts`, `patrolStore.test.ts`): a leg-start event
puts a `running` leg into the active run; a late one does not walk it back; the
banner then renders `at stop 2: …` and `RoutePath` receives `activeIndex`.

**Live, in sim** (`.env.g1-edu-agent-warehouse`, warehouse scene): start a tour
from `/tour` and watch the banner for a whole visit — the stepper must highlight
each stop as the robot walks to it and the sentence must name it, with no
flicker back to the generic string between blocks of the same stop. Watch
`/agent` at the same time: the two pages must never disagree about which stop
the robot is at (they now share `currentStopText`, so a disagreement is a data
bug, not a wording one). Repeat for a patrol run on `/patrol`. Record the event
count for a four-stop tour before and after.

**Not needed:** hardware. This is a wire-and-UI change; the G1 adds nothing to
it that the sim does not show.

## Notes

- Origin: found while implementing the Agent Mode tour chip for [[TASK-213]] in
  PR #252, and reported in that PR's description. #252 did NOT fix it: it worked
  around it by reading the live plan instead of the run, which is the right
  answer for the Agent Mode rail and no answer at all for `/tour`.
- The patrol half was not in the original report. It was found while filing this
  task, by reading `patrol.ts` to check whether host mode had deviated from its
  own model — it had not, both runners are wrong in the same way. Fixing only
  the tour would leave a known defect on released code unfiled for the second
  time.
- **Priority 3, deliberately.** Nothing here is unsafe or untrue: the banner
  falls back to a generic string rather than naming the WRONG stop, "End tour"
  and "End patrol" work throughout, and the run detail page reconstructs the
  full leg timeline afterwards from `startedAt`/`finishedAt`. It is a legibility
  defect on a live page during a visit with a member of the public — worth
  fixing, not worth interrupting anything for. Raise it if a tour is ever
  demonstrated to an audience watching `/tour` rather than `/agent`.
- One knock-on worth knowing: today the server only learns a leg's `startedAt`
  when that leg settles. After the fix it learns it at the start, which makes
  "how long has the robot been at this stop" answerable live — a small thing the
  run detail page could use later.
