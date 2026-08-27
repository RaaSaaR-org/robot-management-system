---
id: TASK-183
aliases:
- TASK-183
title: Real-Time Chunking (RTC) in skill-executor — no stalls at action-chunk boundaries
slug: real-time-chunking-rtc-in-skill-executor-for-groot-pi05-closed-loop-control
status: review
priority: 2
owner: ''
projects: []
customers: []
tags:
- extended
- vla
- lerobot
- robot
sprint: ''
depends_on: []
due_date: ''
created: 2026-07-12
updated: 2026-08-27
status_note: ''
---

## Description

Remove the inference stall at action-chunk boundaries in the live VLA rollout
loop: prefetch the next chunk *while* the current one executes and blend
predictions across the boundary (Real-Time Chunking). Salvaged from retired
TASK-088 — the RTC idea is the only part of that task that survived the G1
pivot and the LeRobot 0.6.0 upgrade (TASK-179), and it matters *more* now:
GR00T-N1.7 closed-loop control on the G1 runs 8-step chunks at 15 Hz, so every
chunk boundary today costs a full `/predict` round-trip of dead air.

## Details

**Current state (serial, stalls by design):**
- The live rollout loop is `robot-agent/src/vla/skill-executor.ts` (NOT
  `robot-agent/hardware/vla_runner.py`, orphaned since TASK-146). Flow: pop
  actions from `actionsQueue`; when empty, `await this.predict(...)` against
  vla-server `/predict` (line ~364), then refill (line ~391). During that await
  the robot receives no new actions — the stall equals full inference latency,
  every `chunkSize` steps.
- (Line numbers above are from when this task was written and have moved.)
- `chunkSize` comes from vla-server `/health` (default 50, line ~747); loop
  pacing is `LOOP_PERIOD_MS`; hardware path clips actions via `clipAction`
  against the last applied action.
- LeRobot 0.6.0 (installed everywhere since TASK-179) ships RTC support
  upstream; the RTC algorithm (inference/execution overlap + boundary
  blending) is from the Physical Intelligence paper below.

**Approach — two cooperating layers:**

### Robot Agent (`robot-agent/src/vla/skill-executor.ts`)
1. **Prefetch:** when `actionsQueue.length` drops below an overlap threshold
   (e.g. `chunkSize * VLA_RTC_OVERLAP`), fire the next `/predict` *without*
   awaiting it inline; keep executing the current queue. On resolve, splice the
   new chunk in.
2. **Blend:** the prefetched chunk was predicted from an observation ~N steps
   old, so its first actions overlap the tail of the current chunk. Blend the
   overlap window (linear crossfade per joint is the RTC baseline;
   `clipAction` still applies after blending on hardware).
3. **Config (env, `robot-agent/src/config/`):** `VLA_RTC_ENABLED` (default
   `false`), `VLA_RTC_OVERLAP` (fraction of chunk, e.g. 0.25),
   `VLA_RTC_BLEND_STEPS`. Document in the `.env.*.example` files (g1-edu +
   so101).
4. **Metric:** log per-boundary stall time (ms with an empty queue) so the
   improvement is measurable; emit on the existing `skill:step` event stream
   or a summary in the run result.
5. Respect existing semantics: abort re-check before hardware send, dagger
   teleop pre-emption, predict-failure retry logic (a failed prefetch falls
   back to the current serial behavior, never crashes the run).

### vla-server (separate repo `../vla-server`)
- Optional second step: thread an `rtc_config` (enabled, blend window) through
  policy loading for backends whose lerobot policies support native RTC
  (pi0.5, SmolVLA), exposed via `config.yaml`. Client-side prefetch alone
  already removes the stall, so treat this as a follow-up within the task —
  do it only if the lerobot-native path measurably beats the client blend.

**Key files:**
- `robot-agent/src/vla/skill-executor.ts` — prefetch + blend + metric
- `robot-agent/src/vla/__tests__/skill-executor.test.ts` — extend
- `robot-agent/.env.g1-edu.example` (+ so101) — new env vars
- `../vla-server/server.py`, `config.yaml.example` — optional rtc_config

## Acceptance Criteria

Status below is what the code on `feat/vla-realtime-chunking` actually does,
checked against the suite in `robot-agent/src/vla/__tests__/skill-executor.test.ts`.

**Read every number below as a 5 Hz number.** `LOOP_PERIOD_MS = 200` in
`skill-executor.ts` is a module constant with no env var and no run option
behind it — every use is internal — so this executor cannot be run at any other
rate, and nothing on this branch has been. The crossfade's reach, the
prefetch break-even and the choice of `RTC_PAYOFF_MARGIN` are all functions of
`LOOP_PERIOD_MS`; none of that tuning has been checked at the 15 Hz the fifth
criterion names.

The timing figures come from `skill-executor.test.ts` run on Vitest's virtual
clock, so they are exact integers reproducible run to run, not stopwatch
readings. They are still measurements of a **mocked** vla-server, not of a
backend or a robot.

- [x] With `VLA_RTC_ENABLED=true`, `/predict` for chunk N+1 is issued while
      chunk N executes; boundary stall metric drops to ~0 in sim runs
      — **met, with a caveat on "before/after numbers".** The A/B in the suite
      reads elapsed time and stall off the virtual clock, not a self-reported
      baseline: at a mocked 300 ms `/predict` over 8 steps at 200 ms, off is
      2000 ms with serial `/predict` at steps 0 and 4; on is 1700 ms with 0
      stalls, 0 ms total, 3 chunks prefetched — the whole 300 ms boundary,
      exactly. The latency sweep says the same at 600 ms: 4200 ms serial
      against 3600 ms with RTC, zero stall. Every number in this task is
      against a **mocked** vla-server. None was measured against a real
      backend, and none at anything but 5 Hz.
- [ ] Overlapping actions are blended — no discontinuity larger than the
      hardware `clipAction` bound at chunk boundaries
      — **NOT met.** Two independent reasons, both verified against the suite.

      *One: past 400 ms of latency there is no crossfade at all.* A prefetched
      chunk is merged as soon as it lands, and `blendChunks` can only weigh
      against actions still queued at that moment, so the fade reaches
      `chunk_size x overlap x LOOP_PERIOD_MS` and no further — 400 ms at the
      shipped chunk 8 / overlap 0.25. Asserted exactly, over 16 steps: 4
      blended steps at 100 ms of latency, **0 at 600 ms**, and 6 at 600 ms once
      overlap is raised to 0.5 (`RTC crossfade reach`). All four arms of the
      latency sweep likewise report `blended: 0`. Every boundary past the reach
      is a free hard splice, not a blended one.

      Whether a real backend's round trip clears 400 ms is **not measured
      anywhere on this branch**, and this repo does not settle it either:
      `docs/vla-integration-guide.md` says GR00T "should be <20ms" on an NVIDIA
      GPU, `docs/real-g1-apple-runbook.md` asks operators for "ideally < 300
      ms" against a 1 s watchdog. Both are expectations, not measurements. So
      the honest statement is about the mechanism, not about GR00T: above 400 ms
      the crossfade does nothing, and nothing here establishes which side of
      400 ms the deployed policy falls on.

      *Two: the criterion's actual test does not exist.* The criterion is worded
      as a bound — "no discontinuity larger than the hardware `clipAction`
      bound". `MAX_DELTA_DEGREES = 5` (`skill-executor.ts`) is named in **no
      assertion anywhere** in `robot-agent/src`. Its *value* is pinned
      incidentally by a pre-existing hardware test ("fetches real frames +
      state, applies delta-clipped actions": a 60 degree prediction is required
      to arrive as `[5,5,5,5,5,5]` then `[10,...]`), but that test predates
      TASK-183 and has nothing to do with a chunk boundary. **No assertion
      anywhere relates a boundary discontinuity to the clip bound**, blended or
      spliced, so even below 400 ms this criterion has never been checked, only
      reasoned about.

      Two candidate remedies, neither taken here: raise the default `overlap`
      (buys reach directly, costs more `/predict` calls per step and so more
      inference load), or shorten `LOOP_PERIOD_MS` (buys reach and moves the
      criterion toward the 15 Hz it names, but re-opens every timing constant
      above). Both are tuning decisions with their own latency cost and neither
      was asked for; they belong in a follow-up task, together with a test that
      actually measures a discontinuity against `MAX_DELTA_DEGREES`.
- [x] Default off; disabled path byte-identical to current serial behavior;
      failed prefetch degrades gracefully to serial + existing retry logic
      — met for the wire shapes, which are the part that leaves the process.
      Every RTC branch is gated on an `rtc` that is `null` when disabled;
      `result.rtc` is attached only on an RTC run. Asserted: the `skill:step`
      payload keys, the run-result keys, both `/skills/execute` response bodies
      and the evaluation-episode POST (`skill-rtc-payload.test.ts`), and that a
      failed prefetch never touches `predictFailures` and never fails a run.
      The three **log lines** that also carry the block are gated on the same
      `result.rtc` but have no test of their own — see "Where the run's `rtc`
      block surfaces" below.
- [x] Unit tests: prefetch trigger, blend math, fallback on prefetch failure,
      dagger/abort interplay — met, plus the payoff policy, the one-attempt-per-
      boundary rule, the latency sweep, the crossfade-reach measurement, and
      the hardware-mode sidecar concurrency tests added for fix group C.
- [ ] Validated in a sim skill run with the GR00T backend (15 Hz, 8-step
      chunks) — smoother trajectory confirmed via the step event stream
      — **NOT met, and as written it cannot be met by this executor.** Three
      separate reasons; an earlier draft of this file gave a fourth that was
      simply false ("there is no `../vla-server` checkout") and it is retracted.

      *Structural, and the one that matters most: the criterion names 15 Hz and
      this loop runs at 5.* `LOOP_PERIOD_MS = 200` is a module constant with no
      env or option override, so there is no configuration of this branch that
      produces a 15 Hz rollout. Every figure in this task is a 5 Hz figure, and
      the crossfade reach, the prefetch break-even and `RTC_PAYOFF_MARGIN` are
      all functions of the loop period, so none of the tuning transfers to
      15 Hz unchecked. Reaching this criterion needs a loop-period knob first.

      *The GR00T backend is not runnable from this box.* The checkout at
      `/home/humanoid/develop/vla-server` is real and complete — `server.py`,
      `configs/`, `models/groot.py`, `models/pi05.py`, `models/smolvla.py`. But
      `models/groot.py` is a **ZMQ client** to a separate Isaac-GR00T
      `PolicyServer`; it loads no weights itself, and the checkpoint paths in
      `configs/g1_apple_pnp.yaml` are Windows paths (`C:\Unitree\...`) that do
      not resolve here. Weights are *not* the blocker — GR00T-N1.7-3B and three
      fine-tuned checkpoints are on this box under `~/.cache/huggingface/hub`
      and `~/models/finetunes`, and two pi0.5 checkpoints resolve from the
      `.local.yaml` configs. What is missing is a running PolicyServer, and
      nothing in this worktree was ever pointed at one.

      *Nothing was run against any backend.* Every number here is against a
      scripted mock inside vitest. This is the criterion that most needs a real
      machine before the feature is turned on anywhere.
- [ ] `npm run typecheck` + tests green in `robot-agent/` — **typecheck clean;
      the suite is NOT green on this box.** `npm run typecheck` in
      `robot-agent/` exits clean. `npx vitest run`, three consecutive full runs
      after the fixes above:

      | run | test files | tests |
      |-----|-----------|-------|
      | 1 | 1 failed, 121 passed (122) | 1 failed, 2005 passed (2006) |
      | 2 | 1 failed, 121 passed (122) | 1 failed, 2005 passed (2006) |
      | 3 | 1 failed, 121 passed (122) | 2 failed, 2004 passed (2006) |

      The failing file is `src/recording/__tests__/EpisodeRecorder.test.ts`
      every time, with a different number of its cases failing per run — a
      known pre-existing flake, **untouched by this branch**
      (`git diff --stat -- robot-agent/src/recording/` is empty). Every RTC
      test passes in all three runs, and `skill-executor.test.ts` is 41/41.

      An earlier draft of this line said "met: typecheck clean, `npx vitest
      run` 2006 tests across 122 files passing". The counts were right; the
      word "passing" was not, and it is retracted. The box has not produced a
      green full suite. Ticking this criterion needs the EpisodeRecorder flake
      dealt with in its own task.

### Hardware mode (fix group C)

Not in the original criteria, and it should have been: RTC is the rollout
loop's first attempt to do two things at once, and the second thing was
reaching for the robot's own sidecar.

- [x] The prefetch's observation is captured on the loop's thread, so the
      executor issues **at most one sidecar request at a time**, in the loop's
      own order, with RTC on or off. The capture is paid out of that step's
      sleep rather than on top of it, so the `/action` cadence
      `g1_sidecar.py`'s ramp depends on is unchanged. The shipped assertion for
      this is "serialises the prefetch capture against the loop action send",
      which records observed sidecar overlap and requires it to stay empty. An
      earlier draft cited "a probe in hardware mode measured 2 concurrent
      sidecar requests" — that probe is not in the tree, nothing in the suite
      reproduces it, and it is retracted as evidence. Reproducing the overlap
      needs `captureObservation` moved back inside the background promise by
      hand.
- [x] Hardware-mode RTC tests exist and assert on observed concurrency:
      `skill-executor.test.ts` → "RTC never gives the sidecar a second caller"
      (prefetch vs. action send, abort mid-prefetch, prefetch whose capture
      fails). These assert call ordering and observed concurrency, not elapsed
      time. The counterfactual — what the first one reports without the fix —
      is not something the shipped suite produces; it needs the fix reverted by
      hand.
- [ ] **NOT VERIFIABLE here: none of this ran on a real G1 or SO-101.** The
      sidecar in those tests is a mock. Two pre-existing overlaps are also
      untouched and out of scope: `captureHardware`'s own `Promise.all` fan-out
      of snapshots and `/state/fast` (TASK-146), and `HardwareClient`'s 2 s
      telemetry poll. The claim is about the rollout loop, not the process.

### Where the run's `rtc` block surfaces

All four channels, and only when RTC ran: the `[Skill]` log line and both
`/skills/execute` response bodies (`rest-routes.ts`), the per-episode metadata
POSTed to `/api/evaluation/episodes`, the `[RobotStateManager/VLA] Loop
finished` line (`state.ts` — the `/vla/start` path, which has no response body
and no emitter, so its log line is the only channel it has), and a
`[AgentMode/VLA]` line for a `demo` block. Agent Mode's spoken narration
deliberately does **not** carry it: a visitor watching the robot is not the
audience for boundary counters.

**Two of those four are untested.** The response bodies and the
evaluation-episode POST are asserted in
`robot-agent/src/api/__tests__/skill-rtc-payload.test.ts`, on and off. The
`[RobotStateManager/VLA] Loop finished` line and the `[AgentMode/VLA]` demo
line are not: nothing in `robot-agent/src/robot/__tests__/` or
`robot-agent/src/agent-mode/__tests__/` mentions `rtc` at all. Both are
one-line `if (result.rtc)` guards over a template string, which is why they
were written without one — but "all four channels" is an argument about the
code, not a result the suite proves.

### vla-server side (optional second step)

Not done. The earlier claim that there is no `../vla-server` checkout was
wrong and is retracted: `/home/humanoid/develop/vla-server` is a real checkout
with `server.py`, `configs/` and the three model backends. What is missing is a
*running* backend to measure against — `models/groot.py` needs a separate
Isaac-GR00T PolicyServer over ZMQ that is not up here. Client-side prefetch
alone removes the stall, which the task called sufficient; whether a
lerobot-native RTC path beats the client blend remains unmeasured.

## Test Strategy

Unit-test the queue/prefetch/blend logic with a mocked vla-server (delayed
responses to force boundary pressure). Then a sim A/B: same skill, RTC off vs
on, compare per-boundary stall ms and max inter-step action delta. Hardware
validation rides on the existing G1 bring-up tasks (TASK-169) — not a blocker
here.

Done, except for one half: the A/B compares stall ms and wall clock, but
**nothing compares max inter-step action delta**. That is the missing measurement
behind the second acceptance criterion, and it is the first thing a follow-up
task should add. The timing arms run on Vitest's virtual clock so their figures
are exact and reproducible; every other RTC test uses real timers and asserts
call ordering, counters and payload shapes rather than durations.

## References

- RTC paper: "Real-Time Action Chunking with Large Models" (Physical
  Intelligence, 2025) — arXiv:2506.07339, https://huggingface.co/papers/2506.07339
- LeRobot RTC docs: https://huggingface.co/docs/lerobot/rtc
- LeRobot v0.5.0 release notes (RTC intro): https://huggingface.co/blog/lerobot-release-v050
- Retired origin: [[TASK-088]] (LeRobot 0.5.0 migration half superseded by
  [[TASK-179]]; hardware context pre-dated the G1 pivot and GPU_BOX)
