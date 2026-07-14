---
id: TASK-183
aliases:
- TASK-183
title: Real-Time Chunking (RTC) in skill-executor — no stalls at action-chunk boundaries
slug: real-time-chunking-rtc-in-skill-executor-for-groot-pi05-closed-loop-control
status: backlog
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
updated: 2026-07-12
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

- [ ] With `VLA_RTC_ENABLED=true`, `/predict` for chunk N+1 is issued while
      chunk N executes; boundary stall metric drops to ~0 in sim runs
      (before/after numbers recorded in the PR)
- [ ] Overlapping actions are blended — no discontinuity larger than the
      hardware `clipAction` bound at chunk boundaries
- [ ] Default off; disabled path byte-identical to current serial behavior;
      failed prefetch degrades gracefully to serial + existing retry logic
- [ ] Unit tests: prefetch trigger, blend math, fallback on prefetch failure,
      dagger/abort interplay
- [ ] Validated in a sim skill run with the GR00T backend (15 Hz, 8-step
      chunks) — smoother trajectory confirmed via the step event stream
- [ ] `npm run typecheck` + tests green in `robot-agent/`

## Test Strategy

Unit-test the queue/prefetch/blend logic with a mocked vla-server (delayed
responses to force boundary pressure). Then a sim A/B: same skill, RTC off vs
on, compare per-boundary stall ms and max inter-step action delta. Hardware
validation rides on the existing G1 bring-up tasks (TASK-169) — not a blocker
here.

## References

- RTC paper: "Real-Time Action Chunking with Large Models" (Physical
  Intelligence, 2025) — arXiv:2506.07339, https://huggingface.co/papers/2506.07339
- LeRobot RTC docs: https://huggingface.co/docs/lerobot/rtc
- LeRobot v0.5.0 release notes (RTC intro): https://huggingface.co/blog/lerobot-release-v050
- Retired origin: [[TASK-088]] (LeRobot 0.5.0 migration half superseded by
  [[TASK-179]]; hardware context pre-dated the G1 pivot and the dz-226 GPU box)
