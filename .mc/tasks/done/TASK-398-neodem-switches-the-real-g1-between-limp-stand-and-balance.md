---
id: "TASK-398"
aliases: []
title: "NeoDEM switches the real G1 between limp, stand and balance without the remote"
slug: "neodem-switches-the-real-g1-between-limp-stand-and-balance"
status: "done"
priority: 1
owner: "huhn511"
projects: []
customers: []
tags: ["core", "g1", "teleop", "safety", "datacollection"]
sprint: ""
parent: ""
depends_on: []
spe: 8
effort: "high"
due_date: "2026-10-18"
created: "2026-10-17"
updated: "2026-10-17"
---

# NeoDEM switches the real G1 between limp, stand and balance without the remote

## Description

There is no Unitree remote on site, so NeoDEM must change the real G1's mode to Limp (damp, FSM 1), Stand up (lock stand, FSM 4, the remote's L2+Up) or Balance (main operation, FSM 500, R1+X) behind lease, confirmation and guards. Walking and turning stay blocked. Every E-stop must end in "disarm the arms, then damp". On 2026-10-17 the full Quest → arm_sdk chain worked, but the robot hung in damp: it ignored rt/arm_sdk while the command drifted 0.7 rad from the measured pose. That would have been an arm jump the moment the robot switched to balance.

## Details

### Current state
- `robot-agent/hardware/g1_sidecar.py`: `/loco/*` sits behind an all-or-nothing `G1_LOCO_ENABLED` (:237). `/loco/fsm` passes any id (:2393-2419). The LocoClient is built lazily on a request thread with a silent domain "0" default (:2205-2248). Nothing reads the FSM back; `/health` and `/state` carry no mode. `/estop` in read-only mode is a no-op (:796-801), and no path damps.
- `robot-agent/hardware/g1_arm_sdk.py`: `/arm` does not know the FSM (:224-277), and nothing compares commanded with measured.
- Agent E-stop paths damp before they disarm (Agent Mode `estop` :2047-2109) or run both in parallel (REST `safety/estop` :873). The teleop `{estop}` never damps. `isDamped` and `standBase` use commanded, never measured, state, and stand-up jumps 1→500.
- VR: `{move}` frames from head turns and thumbsticks stamp `lastSendAt` without a state echo, so the link meter flaps to "Link lost" (VRTeleopModal `send()`).
- FSM 4 for G1 is unverified on disk; the only source is the H2 client (`h2_loco_client.py:125`).

### Sidecar
`G1_LOCO_ENABLED=fsm`; the mode route `POST/GET /loco/mode` with a transition table and GetFsmId confirmation; a FSM monitor at 2 Hz; `base`/`loco` blocks in `/health` and `/state`; an explicit domain, loopback bind and main-thread LocoClient when the gate is on; `/estop` = latch, disarm, then damp (read-only mode too); reset never stands the robot. Full contract: spec §2.1–2.5.

### arm_sdk
An `fsm_source` drives `/arm` refusals (`not_in_balance`, `fsm_unknown`), auto-disarm (`left_balance`, `fsm_stale`) and a drift guard (`tracking_error`, 0.35 rad for 0.3 s). Spec §2.6.

### Simulator
`--initial-fsm`, FSM 4, and arm_sdk ignored off balance. Spec §2.7.

### Robot Agent
Base and capability parsing; a single E-stop order with `sendEstop` first on every path; the `POST/GET /robots/:id/base/mode` route, lease-verified; measured `isDamped`; `standBase` returns `two_step_required` under `fsm`; disabled moves are idle on the socket. Spec §3.

### Server
`GET/POST /api/robots/:id/base-mode` (viewer / member, lease passthrough, compliance audit). Spec §4.

### Frontend
`RobotModeControl` plus `useRobotBaseMode`, shown in the VR window header and the VR data-collection session page; confirmation dialogs; disabled reasons; HUD readout only; Link-lost fix. Spec §5.

### Key files
- robot-agent/hardware/g1_sidecar.py
- robot-agent/hardware/g1_arm_sdk.py
- robot-agent/hardware/sim_g1_dds/{sim_node.py,loco_state.py,loco_mode_sim_check.py (new),test_loco_state.py}
- robot-agent/hardware/tests/{test_g1_loco_mode.py (new),test_g1_arm_sdk.py}
- robot-agent/src/hardware/HardwareClient.ts
- robot-agent/src/robot/state.ts, robot-agent/src/robot/CommandExecutor.ts
- robot-agent/src/agent-mode/agent-mode-controller.ts
- robot-agent/src/api/{rest-routes.ts,keyboard-teleop.ts}
- server/src/routes/base-mode.routes.ts (new) + mount
- app/src/features/robots/components/RobotModeControl.tsx (new), app/src/features/robots/hooks/useRobotBaseMode.ts (new)
- app/src/features/robots/components/tabs/vr/{VRTeleopModal.tsx,VrTeleopRig.tsx,vrHeading.ts,vrHud.ts}
- app/src/features/datacollection/pages/SessionDetailPage.tsx
- docs/g1-edu-lab-bringup.md

## Acceptance Criteria
- [x] With `G1_LOCO_ENABLED=fsm`, the only RPCs the sidecar can send are SetFsmId({1, stand id, 500}), GetFsmId and GetFsmMode. move, action (incl. stop), stand-height and legacy fsm answer 403 (pytest asserts zero SetVelocity/SetTaskId calls).
- [x] Stand is accepted only from measured limp, Balance only from stand held ≥ 2 s. Neither runs while the arms are engaged or the E-stop is latched. Limp always runs, disarming first. Every change is confirmed by GetFsmId or answers 504 `unconfirmed`.
- [x] `/arm` is refused unless the measured FSM is in BALANCE_REPORTED and fresh. The arms auto-disarm on leaving balance, on a stale FSM, and on a sustained tracking error. The re-engage latch prevents re-arm loops.
- [x] Every E-stop path (app STOP, VR B/Y, Safety page, `emergency_stop` command, Agent Mode, socket) reaches sidecar `/estop`, which disarms and then damps, latched. Reset leaves the robot limp.
- [x] Mode buttons need a valid lease and a confirmation, show the measured mode, and state their disabled reason.
- [x] Head turns and thumbsticks against a moves-disabled sidecar produce no error spam, no sidecar HTTP calls and no "Link lost".
- [x] `loco_mode_sim_check.py` passes against sim_g1_dds on domain 42 (`lo`), and `./scripts/test-all.sh --skip-pw` passes with no stage SKIPPED.
- [x] The runbook section exists, including the FSM-4 verification step and the no-remote recovery table.

## Test Strategy
pytest with a fake LocoClient for the sidecar gate, transitions, E-stop order and arm guards; sim e2e on domain 42 with a passive rt/arm_sdk recorder for the disarm-before-damp order; vitest for agent E-stop ordering, the route lease checks, the move short-circuit, server passthrough and audit, the app disabled-reason table, confirmation, and the link meter. Nothing is published on domain 0 during implementation. The operator runs the on-robot verification of FSM 4/500 tomorrow (runbook steps 2–5) and records it here.

## Notes
- Too big to grow: if the implementing session nears the ceiling, keep §2 (sidecar, arm_sdk, sim, pytest) and §3.2 (E-stop order) as the first commits. They make the robot safe on their own, and the curl fallbacks in the runbook work with them alone. §4/§5 can then move to a child task without leaving anything unsafe.
- Follow-up TASK-399 (backlog): MotionSwitcher CheckMode, passive lowcmd kp cross-check, per-hand state-rate logging, sim damp/stand physics and odom mode, in-headset mode controls, flipping `FSM_STAND_VERIFIED` after the robot check.
- Right Dex3 publishes nothing on rt/dex3/right/state (driver alive, no samples). Reseat the right wrist connector and power-cycle. This is not a NeoDEM change.
- FSM 4: unitree_sdk2 (C++) `include/unitree/robot/g1/loco/g1_loco_client.hpp` maps `StandUp()` to `SetFsmId(4)` on the G1 (checked 2026-10-17, cited in `g1_loco_mode.py`). Whether that is the remote's L2+Up lock stand is still settled on the robot (runbook step 4).

## Implementation notes (2026-10-17)

- **Sidecar.** The DDS-free logic lives in a new `robot-agent/hardware/g1_loco_mode.py` (gate parsing, allowlisted FSM ids, `FsmMonitor`, `ModeController`), wired by `g1_sidecar.py`. The E-stop waits for at most two publish ticks (≤ 0.1 s) so the first falling-weight arm_sdk frame is on the wire before `SetFsmId(1)` — it does not wait out the 1 s ramp (D6). A Limp request preempts a stand/balance confirmation, which then answers `409 preempted`. `/loco/odom` stays behind the full gate (`1`) only.
- **Protective stops (category 2) do not damp.** Only emergency stops (category 0) post the sidecar `/estop`; a protective stop (server link lost, tilt warning, geofence) on a sidecar with mode control disarms the arms instead. Damping there would drop a robot in balance into the gantry on every transient stop.
- **Limp stays available while the mode reads unknown** in the UI (reason 2 of the disabled-reason table does not apply to Limp), matching the sidecar, which always accepts Limp.
- **The older "Base damped" panel and Stand button** remain on a robot whose sidecar reports no mode control (the MuJoCo sim, gate off); the mode control replaces them wherever the gate is `fsm` or `full`.
- **Session page.** For a real headset the lease lives in the VR window (TASK-396), so the session page's mode panel reads "Take control first" unless the page holds the lease (simulated VR input); the VR window header is the working place for the buttons.
- **Compliance entry.** The typed `AccessAuditPayload.result` is `allowed`/`denied`; the three-way `ok`/`denied`/`failed` is in `metadata.result`.
- **FSM 4.** unitree_sdk2 (C++) `include/unitree/robot/g1/loco/g1_loco_client.hpp` maps `StandUp()` to `SetFsmId(4)` on the G1 (cited in `g1_loco_mode.py`). `FSM_STAND_VERIFIED` stays `False` until the on-robot check below.
- Follow-up: TASK-399 (backlog).

## On-robot verification (runbook "Mode changes without the remote", steps 2–5)

To be filled in by the operator:
- Step 2 `/health`: gate / base.mode / fsm_id / age_s —
- Step 4 Stand up: reported id —, what the robot did —
- Step 5 Balance: reported id —
- `base.fsm_mode` and `base.odom_mode` per mode —
- `track_err_rad` seen while armed —
