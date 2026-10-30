---
id: "TASK-438"
aliases: []
title: "Ending teleop never latches a read-only sidecar's E-stop"
slug: "ending-teleop-never-latches-a-read-only-sidecar-s-e-stop"
status: "in-progress"
priority: 1
owner: "huhn511"
projects: []
customers: []
tags: ["core", "safety"]
sprint: ""
parent: ""
depends_on: []
spe: 1
effort: "medium"
due_date: ""
created: "2026-10-30"
updated: "2026-10-30"
---

# Ending teleop never latches a read-only sidecar's E-stop

## Description

The supervisor sim robot `sim-g1-edu-dev` reported a latched sidecar E-stop
after its robot side started read-only, although nobody pressed an E-stop. The
robot agent caused it: when teleop ends it hands the joints back with the
sidecar's `/estop`, and on a read-only `g1_sidecar.py` that is the latched
emergency stop. This task makes the agent send nothing there, because a
read-only sidecar has no command path to hand back. The real `g1-edu-4` runs the
same agent code and the same read-only sidecar, so it latches the same way.

Branch: `fix/task-438-ending-teleop-never-latches-a-read-only-sidecar-s-e-stop`.

## Details

### Current state

- `~/.local/state/neodem/logs/sim-g1-edu-dev-sidecar.log` has no timestamps,
  so the latch looked like it came "right after the start". The file's mtime
  dates the last latch: 2026-10-30 19:51:37.914Z, 47 s after the 19:50:48Z
  start. The line is
  `ESTOP: latched, was_armed=False, damped=False, confirmed=False — mode control disabled (G1_LOCO_ENABLED)`.
  - `damped=False … mode control disabled` means that the caller asked for a
    damp. A protective stop (`{"damp": false}`) would print
    `not requested (protective stop)` instead.
  - The session page acquired lease generation 28 at 19:51:32.928Z
    (`dev-server.log`). The agent log then reads
    `[ControlLease] generation 28 expired` (its TTL is 5 s, so about
    19:51:37.9Z). That matches the latch.
- The chain in the robot agent:
  - `robot-agent/src/api/keyboard-teleop.ts`: a lease that is fenced or expires
    runs `unbind()`, then `releaseHolder()`. A socket that closes runs
    `cleanup()`, then `releaseHolder()`. The last `teleop` holder calls
    `robotStateManager.disableTeleop()`.
  - `robot-agent/src/robot/state.ts` `disableTeleop()` →
    `stopTeleopForwarding()` → `hardwareClient.releaseAction()`.
  - `robot-agent/src/hardware/HardwareClient.ts` `releaseAction()` disarms only
    when `requiresArming()`, which means `writeMode === 'arm_sdk'`. In every
    other case it POSTs `/estop` with `{}`. On a read-only sidecar, that is the
    full latched E-stop (`g1_sidecar.py` `estop()`).
- Neither agent sets `CONTROL_LEASE_REQUIRED` (`robot-agent/.env.g1-edu`,
  `.env.g1-edu-sim`). So every keyboard-teleop socket claims `teleop` when it
  connects, and the next close latches the read-only sidecar.
- The 2026-10-30 18:12Z run in arm_sdk did not latch: there `releaseAction()`
  disarms.
- `g1-edu-4` (`robot-agent/hardware/profiles/g1-edu-4.yaml`) starts read-only
  with `G1_LOCO_ENABLED: "0"`.
  - Its sidecar has no mode control in read-only, so the stray `/estop` latches
    but cannot damp the robot.
  - The latch shows as "E-stop latched" in readiness and in Set up step 3.
  - It clears when the sidecar restarts in arm_sdk ("Switch to arm control"),
    or with Reset E-stop.
  - On 2026-10-29 the real robot did not latch only because nothing closed a
    teleop socket while it was still read-only. The code path is the same.

### Robot Agent

- `HardwareClient.releaseAction()` returns before any request while the
  sidecar reports read-only (`armStatus.readOnly`: `write_mode: read_only`, or
  the older `read_only: true`). That sidecar has no publisher and refuses
  `/action`, so there is nothing to hand back.
- No other change:
  - arm_sdk still disarms;
  - the legacy MuJoCo facade (`sim_node.py`, no `write_mode`) and the Isaac
    bridges still get `/estop` as their release;
  - a real E-stop (`sendEstop()`) still latches a read-only sidecar.

### Key files

- `robot-agent/src/hardware/HardwareClient.ts`
- `robot-agent/src/hardware/__tests__/hardware-arm.test.ts`

## Acceptance Criteria

- [ ] On a read-only sidecar (`write_mode: read_only`, or the older
      `read_only: true`), `releaseAction()` sends no request.
- [ ] On an arm_sdk sidecar it still disarms and never posts `/estop`.
- [ ] On the legacy sim it still posts `/estop`.
- [ ] `sendEstop()` still reaches a read-only sidecar's `/estop`.
- [ ] robot-agent typecheck and vitest pass.

## Test Strategy

- `hardware-arm.test.ts`:
  - "HardwareClient on a read-only sidecar" covers both read-only shapes. It
    failed before the change (`[ '/estop' ]`) and passes after it.
  - An E-stop still posts `/estop`.
  - The existing arm_sdk and legacy-sim cases are unchanged.
- On the robot, after a robot-side restart on this code: start read-only, take
  control on the session page, then release it (or close the page) before
  switching. The sidecar's `/health` keeps `estop_latched: false`.

## Notes

- The running sim and the real robot pick this up only after the robot side
  restarts on the merged code. TASK-430's "Restart robot side" offers that when
  the robot side runs stale code.
