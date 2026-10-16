---
id: "TASK-391"
aliases: []
title: "The G1 sidecar drives the real arms and hands through arm_sdk, armed only on request"
slug: "the-g1-sidecar-drives-the-real-arms-and-hands-through-arm"
status: "in-progress"
priority: 1
owner: "huhn511"
projects: []
customers: []
tags: ["core", "hardware", "g1", "safety", "teleop"]
sprint: ""
parent: "[[TASK-169]]"
depends_on: []
spe: 8
effort: "high"
due_date: "2026-10-18"
created: "2026-10-17"
updated: "2026-10-17"
---

# The G1 sidecar drives the real arms and hands through arm_sdk, armed only on request

## Description

Collecting real teleop data on the Unitree G1 EDU (+Dex3-1) through NeoDEM needs
a write path from `robot-agent/hardware/g1_sidecar.py` to the robot that leaves
the legs under Unitree's balance controller. Replace the sidecar's lerobot
`rt/lowcmd` write path with Unitree's arm-only channel `rt/arm_sdk` (+ Dex3
`HandCmd`), behind an explicit opt-in mode and an explicit arm/disarm handshake,
with a dead-man, a latched e-stop and a ramp back to Unitree's control on every
exit path.

## Details

### Current state

- Field test 2026-10-16 ran Unitree's own `xr_teleoperate` outside NeoDEM. It
  writes `rt/lowcmd` (debug mode), which bypasses the balance controller — only
  acceptable because the robot hung on the gantry. Nothing was recorded.
- `g1_sidecar.py` has two modes: `G1_READ_ONLY=1` (default; state from the
  read-only ZMQ bridge `g1_state_bridge_readonly.py` on :6001, `/action` → 403)
  and `G1_READ_ONLY=0`, which loads lerobot's `UnitreeG1` driver. That driver
  opens an `rt/lowcmd` publisher — a standing robot falls — and lerobot is not
  even installed on the lab box. `/estop` only clears a ramp dict.
- `/record/start` with `G1_READ_ONLY=0` spawns `lerobot-record
  --robot.type=unitree_g1`, i.e. the same `rt/lowcmd` driver.
- `real_g1_bridge/bridge.py` already has a proven `rt/arm_sdk` + Dex3 publisher
  (weight in `motor_cmd[29].q`, CRC, gains from `xr_teleoperate`, ramp-down on
  every exit). `sim_g1_dds/sim_node.py` consumes exactly those topics and
  blends all 29 body slots with the weight.
- On 2026-10-16 the right Dex3 published no state; `xr_teleoperate` hung until
  run arms-only.

### Contract (shared with TASK-393, the agent/app side)

- `G1_WRITE_MODE=arm_sdk` opts in; default stays `read_only` with the
  `G1_READ_ONLY=1` behaviour unchanged. The lerobot `rt/lowcmd` path is removed;
  `G1_READ_ONLY=0` without `G1_WRITE_MODE=arm_sdk` refuses to start with a clear
  error.
- arm_sdk mode publishes `unitree_hg LowCmd_` on `rt/arm_sdk` — only the 14 arm
  joints take targets — and `HandCmd_` on `rt/dex3/{left,right}/cmd` for hands
  whose state is present.
- `POST /arm {"lease_generation": int|null}` → weight ramp 0→1 over ~1.5 s,
  seeded from the measured arm positions (never 0). `POST /disarm` → ramp 1→0
  over ~1 s, then stop publishing. `POST /estop` → immediate disarm ramp,
  latched until `POST /estop/reset`. `POST /action` → only while armed, else
  409 `{"error":"not_armed"}`; clamped to joint limits, slew-limited; leg/waist
  keys ignored and counted.
- Dead-man: no `/action` for 0.5 s → hold; 1.0 s → disarm ramp (reason
  `deadman`).
- `GET /health` and `/state` report `write_mode`, `armed`, `arm_weight`,
  `estop_latched`, `hands: {left, right}` (state within 0.5 s) and
  `teleop_mode` (`arms+hands` | `arms+left_hand` | `arms+right_hand` |
  `arms_only`).

### Robot Agent / hardware (this task)

- New `robot-agent/hardware/g1_arm_sdk.py`: a DDS-free controller
  (`ArmSdkController`: arm/disarm/estop/action/tick with an injected clock,
  state source and wire) plus the DDS pieces (`DdsArmWire`, `DdsStateSource`)
  built only in arm_sdk mode.
- `g1_sidecar.py`: mode selection and refusal, new routes, the publish thread,
  the health/state fields, `/record/start` refused in arm_sdk mode (it would
  spawn the lerobot `rt/lowcmd` driver), SIGTERM/SIGINT → disarm ramp before exit.
- Waist slots of the `rt/arm_sdk` frame hold the waist at the pose measured at
  `/arm` (xr_teleoperate's motion-mode lock, kp 300 / kd 3) — leaving them at
  kp 0 would hand a limp waist to the blend at weight 1. `/action` never moves it.
  Leg slots carry the measured pose at kp = kd = 0 (ignored by the robot's
  arm_sdk blender; the MuJoCo sim blends them, so they must not read 0).
- State for the controller comes straight from DDS (`rt/lowstate` with CRC
  check, `rt/dex3/*/state`) on the same participant as the publisher: seeding
  and hand presence must not depend on a second process and a JSON hop, and the
  LowCmd needs `mode_machine`. `/state` keeps the ZMQ bridge as its source and
  falls back to that DDS feed when the bridge is silent.

### Key files

- `robot-agent/hardware/g1_arm_sdk.py` (new)
- `robot-agent/hardware/g1_sidecar.py`
- `robot-agent/hardware/tests/test_g1_arm_sdk.py` (new)
- `robot-agent/hardware/tests/test_g1_sidecar_write_mode.py` (new)
- `robot-agent/hardware/sim_g1_dds/arm_sdk_sim_check.py` (new, integration check)
- `docs/g1-edu-lab-bringup.md`

## Acceptance Criteria

- [ ] Default start (no env) is read-only exactly as before: `/action` and
      `/record/start` → 403, no DDS publisher is constructed.
- [ ] `G1_READ_ONLY=0` without `G1_WRITE_MODE=arm_sdk` refuses to start with a
      message naming the removed `rt/lowcmd` path; no lerobot import remains.
- [ ] arm_sdk mode refuses to start without an explicit DDS domain.
- [ ] `/arm` seeds every arm target from the measured pose and ramps the weight
      0→1 in ~1.5 s; `/disarm` ramps 1→0 in ~1 s and then stops publishing.
- [ ] `/action` before `/arm` → 409 `not_armed`; leg/waist keys are ignored and
      counted; targets are clamped and slew-limited.
- [ ] Dead-man holds at 0.5 s and disarms at 1.0 s without `/action`.
- [ ] `/estop` disarms and latches; `/arm` → 409 until `/estop/reset`.
- [ ] A missing Dex3 state stream arms anyway, reports `teleop_mode`, and never
      publishes a command for that hand.
- [ ] SIGTERM/SIGINT ramp the weight to 0 before the process exits.
- [ ] Against the MuJoCo DDS sim on domain 1 / `lo`: arm, 3 s shoulder
      sinusoid, the arm moves, the legs do not, disarm → weight 0.
- [ ] The robot-day start command is documented (written, not run).

## Test Strategy

- `pytest robot-agent/hardware/tests/test_g1_arm_sdk.py
  robot-agent/hardware/tests/test_g1_sidecar_write_mode.py` with a fake clock,
  fake wire and fake state source.
- Full `robot-agent/hardware/tests/` (incl. `test_fstring_portability.py`).
- Integration against the MuJoCo DDS sim on domain 1 / `lo` — commands and
  results below.

## Notes
