---
id: "TASK-391"
aliases: []
title: "The G1 sidecar drives the real arms and hands through arm_sdk, armed only on request"
slug: "the-g1-sidecar-drives-the-real-arms-and-hands-through-arm"
status: "review"
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

- [x] Default start (no env) is read-only exactly as before: `/action` and
      `/record/start` → 403, no DDS publisher is constructed.
- [x] `G1_READ_ONLY=0` without `G1_WRITE_MODE=arm_sdk` refuses to start with a
      message naming the removed `rt/lowcmd` path; no lerobot import remains.
- [x] arm_sdk mode refuses to start without an explicit DDS domain.
- [x] `/arm` seeds every arm target from the measured pose and ramps the weight
      0→1 in ~1.5 s; `/disarm` ramps 1→0 in ~1 s and then stops publishing.
- [x] `/action` before `/arm` → 409 `not_armed`; leg/waist keys are ignored and
      counted; targets are clamped and slew-limited.
- [x] Dead-man holds at 0.5 s and disarms at 1.0 s without `/action`.
- [x] `/estop` disarms and latches; `/arm` → 409 until `/estop/reset`.
- [x] A missing Dex3 state stream arms anyway, reports `teleop_mode`, and never
      publishes a command for that hand.
- [x] SIGTERM/SIGINT ramp the weight to 0 before the process exits.
- [x] Against the MuJoCo DDS sim on domain 1 / `lo`: arm, 3 s shoulder
      sinusoid, the arm moves, the legs do not, disarm → weight 0.
      (Run on domain **41** / `lo` instead — the dev stack's own sim occupies
      domain 1; same loopback-only guarantee.)
- [x] The robot-day start command is documented (written, not run).
- [ ] First armed run on the physical G1 (gantry, e-stop staffed) — robot day,
      not part of this branch's verification.

## Test Strategy

Unit (fake clock, fake state source, fake wire — no DDS):

```bash
cd robot-agent/hardware
server/curation/.venv/bin/python -m pytest tests -q          # 270 passed, 18 skipped (py3.14)
~/anaconda3/envs/unitree_sim_env6/bin/python -m pytest tests -q   # 279 passed, 17 skipped (py3.12)
```

`tests/test_g1_arm_sdk.py` (32): seed frame = measured pose (arms, waist, legs,
hands, mode_machine); weight 0→1 in 1.48–1.52 s; 503 without state; waist kp
300/kd 3, legs kp 0; clamp to limit − 0.05 rad; slew exactly 3 rad/s × dt per
tick; leg/waist keys ignored + counted + logged; unknown keys counted, NaN/inf/
strings/bools → 400; lease mismatch → 409; dead-man hold at 0.5 s (pose frozen)
and disarm at 1.0 s; disarm ramp 1→0 in ~1 s, exactly 5 zero frames, then
silence and 409 on /action; e-stop latch and reset; stale lowstate → disarm;
re-arm mid-ramp re-seeds; four hand-presence cases → teleop_mode, no frames for
a missing hand; a hand lost mid-session stops being commanded; runner shutdown
ramps to 0 in < 1.5 s and ends on weight-0 frames; a runner that never armed
writes nothing; a failing wire forces weight 0.
`tests/test_g1_sidecar_write_mode.py` (23): config matrix (`G1_READ_ONLY=0`
alone, unknown mode, arm_sdk without domain, arm_sdk + `G1_READ_ONLY=1` refuse);
`python g1_sidecar.py` exits 2 before binding anything; no lerobot import left;
read_only answers 403 on `/action` `/arm` `/record/start`, 200 on the stop
routes, and carries the write status on `/health` + `/state`; the arm_sdk
routes over real HTTP against a real controller.
`sim_g1_dds` pytest: 146 passed (unchanged). New files parse as Python 3.8.

Integration against the MuJoCo DDS sim, 2026-10-17. Domain **41** on `lo`, not
domain 1: the dev stack's own sim (`sim_node.py --domain 1 --iface lo`, :8777)
was running, and a second sim plus this sidecar on the same domain would have
driven its arms and mixed its `rt/lowstate` into the test.

```bash
cd robot-agent/hardware/sim_g1_dds
export CYCLONEDDS_HOME=~/Dokumente/Unitree/g1_quest_teleop/third_party/checkouts/cyclonedds/install
MUJOCO_GL=egl PYOPENGL_PLATFORM=egl LIBGL_ALWAYS_SOFTWARE=1 CUDA_VISIBLE_DEVICES= \
  ~/anaconda3/envs/unitree_sim_env6/bin/python sim_node.py --domain 41 --iface lo --http-port 8781 &
(cd .. && G1_WRITE_MODE=arm_sdk G1_DDS_DOMAIN=41 G1_DDS_IFACE=lo G1_NET_INTERFACE=lo \
  G1_SIDECAR_PORT=8791 G1_LOWSTATE_ENDPOINT=tcp://127.0.0.1:1 G1_ALLOW_LIDAR_SWITCH=0 \
  ~/anaconda3/envs/unitree_sim_env6/bin/python -u g1_sidecar.py &)
~/anaconda3/envs/unitree_sim_env6/bin/python arm_sdk_sim_check.py --domain 41 --iface lo \
  --sim http://127.0.0.1:8781 --sidecar http://127.0.0.1:8791 --sidecar-pid <pid>
```

Result (second run, all 13 PASS; a passive DDS subscriber recorded every frame):

| Check | Measured |
| --- | --- |
| /action before /arm | 409 `not_armed`, 0 frames on `rt/arm_sdk` |
| first frame vs measured pose | max diff 0.0 rad, weight 0.013 |
| arm ramp 0→1 | 1.48 s |
| 3 s sinusoid, A 0.3 rad @ 0.5 Hz, left shoulder pitch | sim shoulder p2p 0.584 rad (cmd 0.600) |
| legs during the sinusoid | max deviation 0.0026 rad |
| waist during the sinusoid | max 0.0122 rad (frames hold it exactly; actuator compliance) |
| frames' leg + waist slots vs measured | 0.0000 rad |
| /disarm ramp 1→0 | 1.0 s, then 0 frames in 0.5 s, last weight 0 |
| dead-man | ramp starts 0.98 s, weight 0 at 1.96 s after the last /action |
| SIGTERM while armed | weight 0 at +0.983 s, process gone at +1.174 s |

The first run failed two checks and changed the code: SIGTERM reached weight 0
only at +1.49 s (the ramp waited for `serve_forever`'s 0.5 s poll — now the
signal starts the ramp at once), and the waist bound was 0.02 rad against a
measured 0.0245 rad sway that the frames do not command (bound now 0.05 rad).

### Review, 2026-10-17

Changes made in review: in arm_sdk mode the HTTP API binds 127.0.0.1 unless
`G1_SIDECAR_HOST` says otherwise (the routes are unauthenticated and `/arm` +
`/action` move the arms; read_only keeps `0.0.0.0`); a JSON integer too large
for a float in `/action` is a 400, not an unhandled `OverflowError`; docs name
the residual risks (`kill -9` cannot ramp down; Dex3 has no blend weight).

Re-run after those changes: hardware pytest 288 passed / 17 skipped (py3.12,
`unitree_sim_env6`) and 279 / 18 (py3.14, curation venv); `sim_g1_dds` pytest
146 passed with `SIM_PYTHON=~/anaconda3/envs/unitree_sim_env6/bin/python` (CPU
render env); `arm_sdk_sim_check.py` on domain 41 / `lo` (sim :8782, sidecar
:8792, sidecar bound to 127.0.0.1): 13/13 PASS — ramp up 1.48 s, shoulder p2p
0.592 rad of 0.600, legs ≤ 0.0065 rad, waist ≤ 0.0208 rad, disarm 0.98 s,
dead-man 1.00 s → 0 at 1.99 s, SIGTERM weight 0 at +1.013 s, exit +1.164 s.

## Notes

- 2026-10-17 — Decisions taken while implementing (huhn511 to confirm):
  waist held at the `/arm` pose with kp 300/kd 3 rather than left at kp 0;
  slew defaults 3 rad/s arms / 6 rad/s fingers (xr_teleoperate allows
  20–30 rad/s; the doc's robot-day command starts at 1 rad/s); arm_sdk mode
  refuses to start without an explicit DDS domain; `G1_READ_ONLY=1` + arm_sdk refuses to start;
  `/record/start` refused in both modes; `/action` may carry an optional
  `lease_generation` (409 `lease_mismatch` when it differs).
- For TASK-393: `HardwareClient.releaseAction()` posts `/estop` on teleop end.
  `/estop` now LATCHES — the agent must call `/disarm` there, and `/estop` only
  for a real stop. Keep `/action` flowing ≥ 20 Hz while engaged (hold pose when
  idle) or the dead-man disarms after 1 s.

