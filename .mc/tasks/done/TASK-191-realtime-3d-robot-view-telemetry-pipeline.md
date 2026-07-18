---
id: TASK-191
aliases:
- TASK-191
title: Real-time 3D robot view — high-rate telemetry channel + client-side interpolation
slug: realtime-3d-robot-view-telemetry-pipeline
status: done
priority: 2
owner: ''
projects: []
customers: []
tags:
- core
- frontend
sprint: ''
depends_on: []
due_date: ''
created: 2026-07-17
updated: 2026-07-18
status_note: 'Implemented 2026-07-18: wall-clock sim phase, 10 Hz telemetry_fast
  channel (agent WS -> server robot_telemetry_fast broadcast, never persisted),
  transient client store off the React render path, damp-based joint interpolation
  in the 3D viewer with 2 s-frame fallback. Verified live end-to-end on the dev
  stack (29 fast frames/3 s at every hop, 0 console errors).'
---

## Description

Make the 3D robot viewer move smoothly and near-real-time. Today the robot-agent pushes one
telemetry frame every 2 s, and the viewer hard-sets joint values on arrival — the model visibly
teleports between poses. Fix it end-to-end: interpolate in the viewer, raise the push rate with a
fast/slow channel split, take telemetry frames off the React render path, and fix the sim-phase
bug that makes joint motion jumpy independent of network timing.

## Details

**Current state (traced 2026-07-17, all file:line refs verified):**

```
robot-agent ──WS push every 2000 ms──► server (relays immediately) ──► app store ──► 3D viewer (hard snap)
                                          fallback: HTTP poll every 5000 ms (30 s after 3 failures)
```

- `robot-agent/src/api/websocket.ts:15` — `TELEMETRY_INTERVAL_MS = 2000` (0.5 Hz push on `/ws/telemetry/:robotId`).
- `robot-agent/src/robot/telemetry.ts:103` — the joint-animation phase `simulationTime` is a
  **module global advanced +0.1 on every `getTelemetry()` call** (WS interval + every REST poll +
  server ingestion all advance the same counter → non-monotonic, jumpy motion).
- `robot-agent/src/robot/SimulationEngine.ts:38` — engine already ticks at 100 ms / 10 Hz, but does
  NOT drive telemetry sampling.
- `server/src/services/TelemetryIngestionService.ts:287-289` — server re-broadcasts every frame
  immediately (no throttle); DB persistence is already downsampled to ≥10 s and is off this path.
- `app/src/features/robots/hooks/useTelemetryStream.ts:106,:62,:65` — poll fallback 5000 ms,
  failure backoff 30000 ms, WS freshness window 10000 ms.
- `app/src/features/robots/components/visualization/RobotModel.tsx:174-204` — a `useEffect` on
  `[robot, jointStates]` calls `robot.setJointValue()` directly: **zero interpolation**. The
  `useFrame` loop (:208-245) never touches joints except idle "breathing" when jointStates is empty.
- `app/src/features/robots/components/visualization/Robot3DViewer.tsx:47` — `memo` is defeated
  because each frame delivers a fresh `jointStates` array reference → whole Canvas subtree
  re-renders per frame.
- Store: `app/src/store/robotsStore.ts:307-311` keeps latest frame only (fine); frames arrive via
  the single app-wide socket in `useRobotWebSocket.ts:109-118`.

### Robot Agent

1. **Fast/slow channel split.** Push `jointStates` + `imu` + `odometry` at **10 Hz (100 ms)**,
   matching the SimulationEngine tick; keep the full frame (motor temperatures, battery, touch
   pads, sensors) at the existing 2000 ms cadence. Implement in
   `robot-agent/src/api/websocket.ts` — either two intervals on the same socket with a
   `type: 'telemetry_fast' | 'telemetry'` discriminator, or one 100 ms interval that attaches the
   slow fields every 20th frame. Keep the message shape backward-compatible (fast frame = subset
   of the full `TelemetryFrame`).
2. **Fix the phase bug.** Advance `simulationTime` from the SimulationEngine 100 ms tick (or derive
   phase from wall-clock inside `generateTelemetry`), NOT per `getTelemetry()` call
   (`robot-agent/src/robot/telemetry.ts:31,:103`). Sampled motion must be monotonic regardless of
   how many consumers poll.
3. Make both intervals configurable via env (`TELEMETRY_FAST_INTERVAL_MS`, default 100;
   `TELEMETRY_FULL_INTERVAL_MS`, default 2000) in `robot-agent/src/config/`.

### Server

4. **Relay fast frames without touching persistence.** In
   `server/src/services/TelemetryIngestionService.ts`, forward `telemetry_fast` frames straight to
   the broadcast path (`RobotManager.emitTelemetry` → `server/src/websocket/index.ts:169-175`) but
   keep the ≥10 s DB downsampling keyed off full frames only — fast frames must NEVER hit Prisma.
5. Broadcast fast frames with a distinct WS event (e.g. `robot_telemetry_fast`) so existing
   consumers (dashboard cards, sparklines) keep their 2 s cadence and only the 3D viewer opts in.

### Frontend

6. **Interpolation in the viewer (do this first — it works even at today's 0.5 Hz).** In
   `RobotModel.tsx`, stop hard-setting joints in the effect. Store incoming `jointStates` as a
   target map in a ref; in `useFrame`, move each joint toward its target with
   `THREE.MathUtils.damp(current, target, lambda, delta)` (lambda ≈ 6 feels right at 10 Hz input;
   tune so 2 s-cadence input still converges visibly). Idle breathing keeps its current guard.
7. **Take frames off the React render path.** Route `robot_telemetry_fast` frames into a transient
   store (Zustand `subscribe` with selector, or a plain ref map keyed by robotId) that `RobotModel`
   reads inside `useFrame` — telemetry frames must no longer re-render the Canvas subtree. Handle
   the new event in `app/src/features/robots/hooks/useRobotWebSocket.ts`; the existing
   `telemetryCache` path stays as-is for all non-3D consumers.
8. `useTelemetryStream` stays the fallback: if no fast frame arrived within ~2 s, the viewer falls
   back to the regular cached frame (still interpolated per item 6), so behavior degrades to
   today's plus smoothing when the fast channel is absent (older agents, poll-only mode).

### Key files

- `robot-agent/src/api/websocket.ts` — fast/slow push intervals
- `robot-agent/src/robot/telemetry.ts` — phase-advance fix
- `robot-agent/src/robot/SimulationEngine.ts` — tick-driven phase (option)
- `robot-agent/src/config/environment.ts` — new env vars
- `server/src/services/TelemetryIngestionService.ts` — fast-frame relay, persistence guard
- `server/src/websocket/index.ts` — `robot_telemetry_fast` broadcast event
- `app/src/features/robots/hooks/useRobotWebSocket.ts` — handle fast event → transient store
- `app/src/features/robots/hooks/useTelemetryStream.ts` — freshness/fallback wiring
- `app/src/features/robots/components/visualization/RobotModel.tsx` — damp-based interpolation
- `app/src/features/robots/components/visualization/Robot3DViewer.tsx` — memo/props cleanup

**Real-robot note:** when real G1 `rt/lowstate` data flows through the TASK-184 sensor contract,
DDS already delivers 500 Hz — this task's fast channel + interpolation is exactly the path it will
ride. Nothing here is sim-only except the phase-bug fix.

## Test Strategy

1. **Phase monotonicity (unit):** call `getTelemetry()` from two interleaved consumers; assert
   joint phase never goes backward and advances with time, not call count.
2. **Persistence guard (unit/integration):** feed 100 fast frames + 1 full frame through
   `TelemetryIngestionService`; assert exactly the full frame reaches the repository.
3. **Smoothness (manual/Playwright):** open `/robots/:id` 3D tab with the sim agent walking.
   Before: pose jumps every 2 s. After: continuous motion; kill the fast channel (env interval
   = 0) and verify the viewer still animates smoothly from 2 s frames via damping.
4. **Render-path check:** React DevTools profiler — telemetry frames at 10 Hz must produce zero
   re-renders of the Canvas subtree.
5. **Regression:** dashboard cards, sparklines, and cockpit stats still update at the old cadence;
   `./scripts/test-all.sh --skip-pw` clean.
