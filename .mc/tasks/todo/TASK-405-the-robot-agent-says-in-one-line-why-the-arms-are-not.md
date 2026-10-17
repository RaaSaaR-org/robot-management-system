---
id: "TASK-405"
aliases: []
title: "The robot agent says in one line why the arms are not following"
slug: "the-robot-agent-says-in-one-line-why-the-arms-are-not"
status: "review"
priority: 1
owner: "huhn511"
projects: []
customers: []
tags: ["core", "g1", "teleop", "safety"]
sprint: ""
parent: ""
depends_on: []
spe: 5
effort: "medium"
due_date: ""
created: "2026-10-17"
updated: "2026-10-17"
---

# The robot agent says in one line why the arms are not following

## Description

On 2026-10-16 the arms did not follow the Quest controllers, and nobody could tell why. Possible causes included a robot that was limp instead of in balance, a thumb fault, a cable dropout and a duplicate control lease. The sidecar already reports most of the reasons, but the agent drops them.

This task makes the agent:
- keep those fields;
- notice a lost sidecar within about a second instead of 10 s;
- serve one readiness snapshot with a single ordered "why not following" reason.

The server (TASK-409) and the VR panels (TASK-407, TASK-413) use it.

## Details

### Current state
- `robot-agent/src/hardware/arm-status.ts` `parseArmStatus` (~l.89):
  - keeps only `writeMode, armed, armWeight, estopLatched, hands, teleopMode, sim, readOnly`;
  - drops `arm_state, deadman, last_disarm_reason, track_err_rad, track_err_joint, fsm, lease_generation, ignored_joints, dds_domain`.
- `robot-agent/src/hardware/HardwareClient.ts` (1995 lines):
  - `_tryConnect` (~l.770) reads `/health`.
  - `startPolling` (~l.808) polls `/state` every 2 s (`POLL_INTERVAL_MS` ~l.477) with a 500 ms timeout.
  - **One** failed or slow poll clears imu, battery, base and pose, stops polling, and retries only every 10 s (~l.802).
  - `sidecarAvailable` is private.
- `robot-agent/src/teleop/arm-registry.ts`
  - `TeleopArmView` (~l.45) is `{writeMode, armed, arming, armWeight, estopLatched, hands, teleopMode, claims, lastError}`.
  - `view()` is at ~l.230. The `{type:'arm'}` teleop frame spreads it (`keyboard-teleop.ts` ~l.763).
- `robot-agent/src/control-lease/control-lease.ts:84` `LeaseObservation` is `{enforced, state, generation, userId, displayName, sessionId, expiresInMs, bound}`. `bound > 1` means a duplicate control socket.
- `GET /api/v1/robots/:id/base/mode` (`rest-routes.ts` ~l.1013): with the sidecar down it returns `capability.gate:"unknown", base:null`, with no hint that the sidecar is unreachable.
- `GET /api/v1/robots/:id/cameras` returns `{cameras, source, detail?}`. Today it is the only place that says "cannot reach the hardware sidecar".
- `GET /api/v1/robots/:id/telemetry` keeps serving synthetic battery and IMU while the sidecar is down. Only `simulated:true` gives that away.

### Robot Agent
**`arm-status.ts`.** `SidecarArmStatus` gains optional fields, and missing fields are `null`:
- `armState`, `deadman`, `lastDisarmReason`, `trackErrRad`, `trackErrJoint`
- `fsm: {id, ageS} | null`
- `leaseGeneration`, `ignoredJoints`, `ddsDomain`
- `lowstateAgeS`
- `handHealth: {left: HandHealth, right: HandHealth} | null`

`HandHealth = {present: boolean|null, ageS: number|null, error: [number, number]|null, motorFaults: {motor, joint, code, bits}[], powerV: number|null}`. The source fields are `hand_health` and `lowstate_age_s` from the sidecar, specified in TASK-404 (optional; older sidecars send none).

**`arm-registry.ts`.** `TeleopArmView` gains `armState`, `deadman`, `lastDisarmReason`, `trackErrRad`, `trackErrJoint` and `handHealth`, all optional. The teleop `{type:'arm'}` frame then carries them without any edit to `keyboard-teleop.ts`.

**`HardwareClient.ts`**
- Split `sidecarReachable` (the HTTP answered) from `connected` (lowstate fresh), and expose both read-only.
- One failed poll no longer tears down state. Two consecutive failures mark the sidecar unreachable.
- Reconnect with backoff 1 → 2 → 4 s, capped at 5 s (it was 10 s).
- Keep the last values, but flag them `stale` instead of clearing them silently.
- Expose `lastHealth()` (the parsed `/health`) and `lastHealthAt`.

**Pure reason function.** New file `robot-agent/src/readiness/why-not-following.ts` exports `explainNotFollowing(input) -> {code, severity:'block'|'warn'|'ok', text}`. It takes the first matching rule, in this order:

| # | code | severity | text (example) |
|---|------|----------|----------------|
| 1 | `sidecar_unreachable` | block | Can't reach the robot sidecar (8767). Start the robot side. |
| 2 | `no_lowstate` | block | The sidecar gets no robot state: cable, robot power or bridge. |
| 3 | `read_only` | block | The sidecar is read-only. Switch the robot side to arm control. |
| 4 | `estop_latched` | block | E-stop is latched. Reset it, then switch to Balance. |
| 5 | `mode_unknown` | block | The robot mode is unknown (<base.error>). |
| 6 | `mode_not_balance` | block | The robot is <limp\|stand>. Switch to Balance. |
| 7 | `lease_none` | block | Nobody has taken control. Press Take control. |
| 8 | `lease_duplicate` | block | Two control sockets are bound. Close the other VR window. |
| 9 | `hand_missing` | warn | Right hand sends no state (<age> s). Check the wrist cable. |
| 10 | `hand_fault` | warn | Right hand: thumb_1 motor fault 0x200. |
| 11 | `disarmed_reason` | block | Arms dropped: <tracking error on left_elbow 0.41 rad \| left balance \| dead-man \| stale state>. Squeeze the grip again. |
| 12 | `arming` | warn | Arming… <weight %> |
| 13 | `deadman_hold` | warn | Dead-man is holding. Keep the grip squeezed. |
| 14 | `not_engaged` | ok | Ready. Squeeze a grip to drive that arm. |
| 15 | `following` | ok | Following. |

- Rule 11 fires only when `armed:false`, `lastDisarmReason` is not `request`, and the operator has a claim.
- A sim sidecar (`sim:true`, no `write_mode`) skips rules 3, 5 and 6, and says `Ready (simulation)`.
- Each text is at most 72 characters, so it fits on one VR HUD line.

**Route.** New file `robot-agent/src/api/readiness-routes.ts`, mounted in `robot-agent/src/index.ts` next to `createRestRoutes`:
```
GET /api/v1/robots/:id/readiness → {
  robotId, at, simulated,
  sidecar: { reachable, connected, url, lowstateAgeS, writeMode, readOnly, bootId, sim },
  base: { gate, mode, fsmId, ageS, error } | null,
  arms: { armState, armed, arming, armWeight, deadman, lastDisarmReason, trackErrRad, trackErrJoint,
          estopLatched, sidecarEstopLatched, claims, lastError },
  hands: { left: HandHealth, right: HandHealth } | null,
  lease: { enforced, state, holder: {userId, displayName} | null, bound },
  camera: { source, cameras, detail },
  telemetrySynthetic: boolean,   // true while battery/IMU come from the simulator fallback
  reason: { code, severity, text }
}
```
- It needs the same auth as `GET /base/mode` and is read-only.
- Camera data comes from the existing cameras logic: call the shared function, don't duplicate it.

### Key files
- robot-agent/src/hardware/arm-status.ts (+ test)
- robot-agent/src/hardware/HardwareClient.ts (+ test)
- robot-agent/src/teleop/arm-registry.ts (+ test)
- robot-agent/src/readiness/why-not-following.ts (new) (+ test)
- robot-agent/src/api/readiness-routes.ts (new) (+ test)
- robot-agent/src/index.ts (mount only)

## Decisions
- **D1 One ordered reason, not a list.** The headset shows one line. The full snapshot stays available for the panel. Rejected: a list of everything that is wrong, which the operator cannot read in VR.
- **D2 Hand faults are warnings, not blockers.** The arms still follow with a hand fault; only the hand misbehaves.
- **D3 Operator-local reasons (controller untracked, grip not squeezed) stay in the headset (TASK-407).** The agent knows claims, not controllers.
- **D4 A new route file.** Rejected: adding to `rest-routes.ts`, which TASK-402 edits in the same wave.
- **D5 No change to `keyboard-teleop.ts` here.** TASK-407 owns it this wave. The arm view carries the new fields because the frame spreads `view()`.

## Acceptance Criteria
- [ ] `parseArmStatus` keeps every listed field from a TASK-398-era `/health` fixture and a TASK-404 fixture, and returns `null` for each one missing from an old fixture.
- [ ] Rule-table tests cover each of the 15 codes from a minimal input, and the order between rules 4/6, 6/7 and 9/11.
- [ ] With the sidecar killed in a test double, `sidecar.reachable` turns false within 2 poll periods. The client reconnects within 5 s of the double coming back, and imu/base keep their last values flagged `stale` in between.
- [ ] Live check: an agent built from this branch runs with `PORT=41297`, `ROBOT_ID=sim-readiness-check`, `ROBOT_TYPE=g1-edu` and `HARDWARE_SIDECAR_URL=http://localhost:8777`, and is stopped after the check. `GET /api/v1/robots/sim-readiness-check/readiness` returns `sidecar.sim:true` and `reason.code:'not_engaged'`, with text "Ready (simulation)…". (The dev stack on :41246 runs `main`, not this branch.)
- [ ] The `{type:'arm'}` teleop frame carries `deadman`, `lastDisarmReason` and `handHealth` when the sidecar reports them.
- [ ] `cd robot-agent && npm run typecheck` and vitest pass.

## Test Strategy
- **vitest:** parser fixtures, the rule table, a fake-timer HardwareClient against a stub HTTP server (fail, fail, recover), and the readiness route with supertest.
- **Live:** the branch agent on a free port against the sim sidecar :8777, with GET requests only. Stop it afterwards. Do not restart the dev stack. Leave the real g1-edu-4 agent (:41245) and sidecar (:8767) alone.

## Safety constraints (binding for this task)
- Never set `G1_READ_ONLY=0`, and never use `G1_ARM_ALLOW_UNKNOWN_FSM=1`.
- Never `kill -9` / SIGKILL a sidecar. Stop it with SIGTERM and let it ramp down.
- Starting or stopping services never commands motion and never switches the FSM. Mode changes go only through the existing confirmed, lease-checked base-mode route.
- No DDS publishing on domain 0 in development or tests. Use the sim on domain 42 / `lo`.
- Never run `xr_teleoperate` and the arm_sdk sidecar together.
- The E-stop stays reachable: B/Y and the two-hand pinch in VR, and a visible E-STOP on the desktop session page.
- Development and tests use the sim stack only: the sim agent :41246 and sim sidecar :8777, or branch builds on free ports. Never the real g1-edu-4 (:41245/:8767). Do not stop or restart the running dev stack.

## Implementation notes (2026-10-17)
Decisions taken while implementing, beyond D1–D5:
- **I1 Confirm probe instead of a faster poll.** `/state` stays at 2 s (the SO-101 serial port). After one failed poll a `/health` probe follows 250 ms later; it failing is the second consecutive failure. A dead sidecar is unreachable ~2 s after it dies (measured live: 1.9 s), at most 2 poll periods.
- **I2 Stale values stay out of the live getters.** `getImu/getBattery/getOdometry/getTouch/getBaseState/getMeasuredFsmId` answer `null` while stale, as before, so telemetry and safety never act on old data. The kept values are in `getLastKnownSensors()` with `stale: true`, and the readiness `base` carries `stale`. `/state` failing twice while `/health` answers marks the values stale too.
- **I3 `lease_none` fires only while the lease is enforced** (`CONTROL_LEASE_REQUIRED`); without enforcement nobody has to take control and the sim AC (`not_engaged`) holds.
- **I4 Mode for rules 5/6** comes from a fresh `base` block; without one, from the arm path's `fsm` reading mapped through the ids the sidecar resolved. Anything else, or a reading older than 4 s, is `mode_unknown`.
- **I5 Shared camera function.** `GET /cameras` had no shared function, so `src/hardware/camera-list.ts` (`readCameraList`) was extracted and the route in `rest-routes.ts` now calls it (one hunk). Readiness caches the list for 10 s.
- **I6 The long disarm line shortens its advice** ("Squeeze again.") before it would exceed 72 characters; `fitLine` is the last resort.
- **I7 Tests use a fetch double and an ephemeral Express server** rather than supertest, which the repo does not depend on.
