---
id: TASK-224
aliases:
- TASK-224
title: EpisodeRecorder tests spend a 10 s retry budget in 200 ms of wall clock
slug: episoderecorder-test-flake-virtual-clock
status: done
priority: 3
owner: ''
projects: []
customers: []
tags:
- core
- test
sprint: ''
depends_on: []
due_date: ''
created: 2026-08-28
updated: 2026-08-28
status_note: 'Sibling of TASK-218 — same family (a test measuring wall clock it does
  not control), different mechanism. Found and fixed in one pass, so filed closed.'
---


# EpisodeRecorder tests spend a 10 s retry budget in 200 ms of wall clock

## Description

`robot-agent/src/recording/__tests__/EpisodeRecorder.test.ts` failed intermittently under load —
33/33 alone, but up to 4 failures per run on a busy machine. Typical error:
`recorder never reached 4 frame(s) in 10000 ms: frames=0 dropped=499 last=behind: the previous
frame had not finished`.

## Details

### Root cause

The retry budgets were denominated in **virtual** milliseconds, which cost almost no wall clock.

`run()`, `runUntilFrames()` and `quiesce()` advanced the fake clock in 10 ms steps without ever
waiting for the recorder's tick to finish. A tick with a camera attached does a real `writeFile` of
a real JPEG (`EpisodeRecorder.ts:721`). `vi.advanceTimersByTimeAsync(ms)` yields only about one real
macrotask turn, while the tick that writes that JPEG needs **up to 49 turns on an idle box** —
measured by counting them — and far more when the disk is busy: up to 8950 under the forced load
below.

Size is not what makes it slow. The fixture is `testsrc` at 64x48, which encodes to **~2 KB**, so
the cost is the file-system round trip itself — the `writeFile` is dispatched to the thread pool and
its completion lands a turn of the real loop later, whatever the byte count. Reducing the picture
would not have helped; only waiting for the write does.

So the write outlived the advance, `tickInFlight` stayed set, and the next tick was dropped by the
recorder's own backpressure as `"behind: the previous frame had not finished"`
(`EpisodeRecorder.ts:657`) — correct production behaviour, driven into a corner by the test.
`runUntilFrames`'s "10 s" budget is 1000 virtual iterations that elapse in **~200 ms of wall clock**,
so whether the first write landed inside it was purely a question of machine load.

### The fix

Wait for the **event**, not for a duration. A new `advance(h, rec, ms)` advances one step, then
yields real event-loop turns via `vi.advanceTimersByTimeAsync(0)` — which fires no timer and moves
no clock — until the tick it fired has settled. Settlement is detected exactly: the harness counts
ticks entering capture, and every tick ends by bumping `totalFrames` or `totalDropped` by exactly
one.

Consequences: no test-driven tick overlap, so backpressure drops can no longer occur;
`runUntilFrames`'s budget counts attempts the recorder actually got rather than wall clock the disk
ate; and `quiesce`'s polling loop and its 50 ms real sleep became unnecessary and are gone.

The drain is bounded, at 250_000 turns. The loop yields turns but moves no clock, so a tick that
awaited a **faked** timer could never be reached by it and would spin forever — a hang, which is
worse than a flake, because CI burns its whole timeout and reports nothing. On exceeding the bound
`advance()` throws naming the counts that did not converge. The number is measured, not guessed:
49 turns idle, 8950 under the forced load below, ~1100 turns/ms when the loop is stalled — so the
bound is ~28x the worst real case, and firing it costs ~0.2 s, verified by putting a faked
`setTimeout` on the snapshot hook: the test fails in under two seconds with the counts named. The
harness's unused `snapshotDelayMs` knob was exactly such a faked wait, set by no test, and is gone.

No assertion weakened, no retry added, no timeout raised, no production code touched.

### The obvious suspect was not the cause

A real-timer `setTimeout(50)` sitting inside a fake-timer file looked like the whole story. It is a
genuine wall-clock dependency and was removed — but the test containing it
(`leaves per-episode image directories while recording`) **passed in every loaded iteration** and
never appeared in any failure list. Fixing only that would have left the flake in place.

## Test Strategy

Measured A/B under identical forced load (48 CPU spinners + 4 concurrent `dd`/`sync` loops), because
an idle 24-core box does not reproduce it — two clean full-suite runs pass 2073/2073:

| | result |
|---|---|
| original file, under load, 3 runs | **3/3 failed** (1, 4 and 3 failures) |
| fixed file, under load, 4 runs | **4/4 passed**, 33/33 each |
| fixed file, alone | 33/33 |
| full suite, unloaded, ×2 | 2073/2073, 125/125 files |

Two other tests (`agent-mode/patrol.test.ts`, `agent-mode/workspace.test.ts`) also fail under that
artificial load on the default 5 s timeout. They are outside `recording/`, pass in every unloaded
run, and were deliberately left alone — see [[TASK-218]] for the same family.
