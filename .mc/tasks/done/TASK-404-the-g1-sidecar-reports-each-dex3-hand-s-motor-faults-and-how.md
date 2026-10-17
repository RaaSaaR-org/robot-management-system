---
id: "TASK-404"
aliases: []
title: "The G1 sidecar reports each Dex3 hand's motor faults and how fresh the robot state is"
slug: "the-g1-sidecar-reports-each-dex3-hand-s-motor-faults-and-how"
status: "done"
priority: 2
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

# The G1 sidecar reports each Dex3 hand's motor faults and how fresh the robot state is

## Description

On 2026-10-16 a Dex3 thumb motor reported fault `0x200`, and the right hand once published nothing at all. Nobody could see either, because every layer throws away the hand's error bits and per-motor state. The sidecar must report, per hand: whether it is present, how old its data is, its error words, and the decoded per-motor faults. It must also report how old the body lowstate is. The read-only bridge must stop listening on the campus LAN. The MuJoCo sim sidecar gets the same fields, plus a way to inject a fault, so the readiness UI can be tested without the robot.

## Details

### Current state
- `robot-agent/hardware/g1_state_bridge_readonly.py`
  - `handstate_to_dict` (~l.172) keeps `q, dq, tau_est, temperature, imu, press, power_v/a`. It drops `HandState_.error[2]` and per-motor `motorstate` (uint32).
  - `lowstate_to_dict` (~l.143) drops body `motorstate`.
  - It binds `tcp://0.0.0.0:6001` (~l.381).
- `robot-agent/hardware/g1_arm_sdk.py` `_motors` / `_on_hand` (~l.866, ~l.900) keep `q, dq, tau_est, temperature` only.
  - `ArmSdkController._snapshot_locked` (~l.599) reports `hands:{left:bool,right:bool}` (fresh within 0.5 s).
- `robot-agent/hardware/g1_sidecar.py`
  - `/health` (`do_GET` ~l.3035) is `{status, connected, read_only, boot_id, …write_status(), loco, base}`.
  - In read-only mode `write_status()` (~l.791) uses `_hands_present_zmq` (~l.781).
  - It has no `lowstate_age_s`.
- `robot-agent/hardware/sim_g1_dds/sim_node.py` `/health` (~l.1689) is `{status, connected, sim, scene, odom_frame, behind_s, boot_id}`, with no hands group.

### Hardware (Python, must stay 3.9-compatible; `tests/test_fstring_portability.py`)
- **New shared decoder** `robot-agent/hardware/dex3_faults.py` (pure, stdlib):
  - `decode_hand(side, error_words, motor_states, joint_names) -> {"error": [int, int], "motor_faults": [{"motor": i, "joint": name, "code": "0x200", "bits": [...]}]}`.
  - Bit meanings go in a table with a source comment. Unknown bits are reported as hex, never dropped.
  - The Dex3 joint order (thumb_0..2, index_0..1, middle_0..1) is taken from the existing joint config. Do not invent it; cite the file it comes from.
- **Bridge**
  - Keep `error` and per-motor `motorstate` in `handstate_to_dict`, and `motorstate` in `lowstate_to_dict`. These are additive keys.
  - Add `--bind` with default `127.0.0.1`.
- **arm_sdk**
  - `_on_hand` keeps `error`, `motorstate` and the receive time.
  - `_snapshot_locked` adds `hand_health: {left: H, right: H}`, where `H = {"present": bool, "age_s": float|None, "error": [u32,u32]|None, "motor_faults": [...], "power_v": float|None}`.
  - The existing `hands` booleans stay unchanged for old clients.
- **Sidecar `/health` and `/state`**
  - Add `lowstate_age_s` (float or null) and `hand_health`. Build them from the arm_sdk snapshot in arm_sdk mode, and from the ZMQ hand messages in read-only mode.
  - `connected` keeps its meaning.
- **Sim (`sim_node.py`)**
  - `/health` adds `lowstate_age_s: 0.0` and `hand_health` with both hands present, `error:[0,0]` and no faults.
  - Env `SIM_DEX3_FAULT="right:thumb_1:0x200"` injects a fault, so the UI and agent can be tested. `SIM_DEX3_MISSING=right` reports that hand as absent with `age_s: null`.
  - These env vars are read at startup only.

### Key files
- robot-agent/hardware/dex3_faults.py (new)
- robot-agent/hardware/g1_state_bridge_readonly.py
- robot-agent/hardware/g1_arm_sdk.py
- robot-agent/hardware/g1_sidecar.py (`/health`, `/state`, read-only hand path; nothing else)
- robot-agent/hardware/sim_g1_dds/sim_node.py (`/health` only)
- robot-agent/hardware/tests/{test_dex3_faults.py (new), test_g1_arm_sdk.py}
- robot-agent/hardware/sim_g1_dds/test_*.py (sim health fields)

## Contract consumed by TASK-405
```
hand_health: { left: H, right: H }
H = { present: bool, age_s: number|null, error: [number, number]|null,
      motor_faults: { motor: number, joint: string, code: string, bits: string[] }[],
      power_v: number|null }
lowstate_age_s: number|null
```
Every field is optional for older sidecars. TASK-405 treats a missing field as "unknown", never as "ok".

## Decisions
- **D1 Additive fields only.** `hands:{left,right}` booleans stay. Rejected: changing their shape, which would break the agent before TASK-405 lands.
- **D2 Decode faults in the sidecar**, next to the DDS types. Rejected: decoding in TypeScript, which would duplicate the bit table.
- **D3 The bridge binds loopback by default.** The supervisor (TASK-403) runs on the same box.
- **D4 Fault injection in the sim lives in env at startup.** Rejected: a runtime route, which is one more write surface on a sidecar-shaped server.

## Acceptance Criteria
- [ ] `decode_hand` returns `code:"0x200"` with the right joint name for a motorstate fixture with that bit, and `[]` for zeros (pytest).
- [ ] With a fake DDS feed, `/health.hand_health.right.present` turns false 0.5 s after the last right-hand message, and `age_s` grows.
- [ ] `/health.lowstate_age_s` grows when lowstate stops.
- [ ] The bridge started without flags listens on 127.0.0.1 only (pytest on the arg parser and bind address).
- [ ] Started with `SIM_DEX3_FAULT=right:thumb_1:0x200`, sim `/health` reports that fault. Without it, sim reports both hands present and fault-free.
- [ ] No f-string in `robot-agent/hardware/` uses 3.12-only syntax (the portability test passes).
- [ ] The hardware pytest stage and the `sim_g1_dds` pytest stage of `./scripts/test-all.sh --skip-pw` pass, with no stage SKIPPED.

## Test Strategy
- **pytest** with fake DDS message objects for the bridge serializers, `_on_hand` and the snapshot, and with the sidecar handler under test doubles (as `test_g1_arm_sdk.py` does today).
- **Sim check:** start a second sim instance on domain 42 / `lo` on a free port with `SIM_DEX3_FAULT` set, then GET `/health`. Do not restart the running sim on :8777.
- Nothing is published on domain 0, and nothing touches the real robot.

## Safety constraints (binding for this task)
- Never set `G1_READ_ONLY=0`, and never use `G1_ARM_ALLOW_UNKNOWN_FSM=1`.
- Never `kill -9` / SIGKILL a sidecar. Stop it with SIGTERM and let it ramp down.
- Starting or stopping services never commands motion and never switches the FSM. Mode changes go only through the existing confirmed, lease-checked base-mode route.
- No DDS publishing on domain 0 in development or tests. Use the sim on domain 42 / `lo`.
- Never run `xr_teleoperate` and the arm_sdk sidecar together.
- The E-stop stays reachable: B/Y and the two-hand pinch in VR, and a visible E-STOP on the desktop session page.
- Development and tests use the sim stack only: the sim agent :41246 and sim sidecar :8777, or branch builds on free ports. Never the real g1-edu-4 (:41245/:8767). Do not stop or restart the running dev stack.

## Implementation notes (2026-10-17)

- **Bit table.** Unitree documents no bit layout for the hg `MotorState_.motorstate` word. `dex3_faults.MOTORSTATE_BITS` holds the one observed bit only: `0x200` → `latched` (TASK-399, 2026-10-16). Every other set bit is reported as `"0x<bit>:unknown"`. Each `bits` entry is `"0x<hex>:<meaning>"`, so the hex is always there.
- **A silent hand keeps its last fault.** `present: false` with a growing `age_s` still carries the last `error` and `motor_faults` it published. The fault that made the hand go quiet is the one the operator needs. A hand that never published has `age_s: null`, `error: null` and `motor_faults: []`.
- **Freshness in read-only mode never opens a socket.** `_state_entry` reads the bridge cache only once `_lowstate_reader` is started. `/health` and `/state` start it first, through `_state_latest`.
- **`hand_health.<side>.present` is computed from the same booleans as `hands`.** The two can never disagree within one reply.
- **Bridge on PC2.** The default `--bind 127.0.0.1` means a bridge on PC2 needs `--bind 192.168.123.164`. The docstring says so. The workstation setup already reads `tcp://127.0.0.1:6001`.
- **Live sim check.** The sim was started on domain 54 / `lo` with HTTP on :8804, the reserved ports, not domain 42. With `SIM_DEX3_FAULT=right:thumb_1:0x200`, `/health` reported the fault. Without it, both hands were present and fault-free. A bad spec exits with code 2 before DDS init.
- The sim injects the fault into `/health` only. Its DDS `rt/dex3/*/state` messages are unchanged.
