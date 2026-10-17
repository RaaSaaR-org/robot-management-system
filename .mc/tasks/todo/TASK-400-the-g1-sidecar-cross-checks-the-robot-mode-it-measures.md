---
id: "TASK-399"
aliases: []
title: "The G1 sidecar cross-checks the robot mode it measures"
slug: "the-g1-sidecar-cross-checks-the-robot-mode-it-measures"
status: "backlog"
priority: 2
owner: "huhn511"
projects: []
customers: []
tags: ["core", "g1", "teleop", "safety"]
sprint: ""
parent: ""
depends_on: ["[[TASK-398]]"]
spe: 5
effort: "medium"
due_date: ""
created: "2026-10-17"
updated: "2026-10-17"
---

# The G1 sidecar cross-checks the robot mode it measures

## Description

TASK-398 lets NeoDEM switch the real G1 between limp (FSM 1), lock stand (FSM 4) and balance (FSM 500) without the remote, and gates arm_sdk on the FSM the sidecar measures with `GetFsmId`. This follow-up adds the independent checks and the on-robot facts TASK-398 deliberately left out, so the measured mode is not a single source of truth.

## Details

### Current state
- `robot-agent/hardware/g1_loco_mode.py` (TASK-398): `FsmMonitor` polls `GetFsmId` + `GetFsmMode` at 2 Hz; `FSM_STAND_VERIFIED = False`; `G1_FSM_ID_STAND` defaults to 4 (from unitree_sdk2 C++ `g1_loco_client.hpp`, `StandUp() = SetFsmId(4)`), unverified on our robot.
- `/health.base` carries `fsm_mode` (GetFsmMode) and `odom_mode` (`rt/odommodestate.mode`) as diagnostics only; nothing gates on them.
- A robot in **debug mode** shows up only as `mode: unknown` with "sport service not answering (rpc 3104)".
- The sim (`robot-agent/hardware/sim_g1_dds/sim_node.py`) drops arm_sdk outside FSM 500 but does not model the sag in damp, the lock-stand physics, or the FSM in `odommodestate.mode`.
- The VR HUD (`app/src/features/robots/components/tabs/vr/vrHud.ts`) shows the mode only; all mode buttons are on the desktop.

### Sidecar
- `MotionSwitcherClient.CheckMode` (api 1001) at startup and every few seconds: tell debug mode from normal mode explicitly, report it in `/health.base`, refuse `/loco/mode` stand/balance in debug mode with its own code.
- A passive `rt/lowcmd` subscriber (domain 0, read-only) that reports the robot-internal leg kp: kp 0 on the legs = damp, regardless of what `GetFsmId` says. Cross-check against the measured FSM; a disagreement makes `base.mode` `unknown` and disarms.
- Log each Dex3 hand's state rate around arm_sdk sessions (the right hand published nothing on 2026-10-17).
- After the on-robot check (docs/g1-edu-lab-bringup.md, "Mode changes without the remote", step 4): set `FSM_STAND_VERIFIED = True`, document the ids, `GetFsmMode` and `odommodestate.mode` per mode in the runbook's "Not yet verified" list.

### Simulator
- Damp sags the body; lock stand holds it; `odommodestate.mode` follows the FSM.

### Frontend
- In-headset mode controls, if the operators ask for them after the first sessions (TASK-398 decision D8 kept them out: a confirmation needs a mouse and a second person).

### Key files
- robot-agent/hardware/g1_loco_mode.py
- robot-agent/hardware/g1_sidecar.py
- robot-agent/hardware/sim_g1_dds/{sim_node.py,loco_state.py}
- robot-agent/hardware/tests/test_g1_loco_mode.py
- app/src/features/robots/components/tabs/vr/vrHud.ts
- docs/g1-edu-lab-bringup.md

## Acceptance Criteria
- [ ] Debug mode is reported as such in `/health.base` and blocks stand/balance with a distinct code.
- [ ] A leg-kp/FSM disagreement reads `unknown` and disarms the arms (pytest with a fake lowcmd feed).
- [ ] `FSM_STAND_VERIFIED` flipped only with the on-robot record in TASK-398.
- [ ] The sim models damp sag and lock stand well enough for `loco_mode_sim_check.py` to assert them.

## Test Strategy
pytest with fakes for MotionSwitcher and the lowcmd feed; the sim check extended; the on-robot facts recorded from the runbook session. Nothing published on DDS domain 0.
