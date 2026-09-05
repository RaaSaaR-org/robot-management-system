---
id: "TASK-231"
aliases: []
title: "Odometry reports the command, not the robot"
slug: "odometry-reports-the-command-not-the-robot"
status: "todo"
priority: 1
owner: "huhn511"
projects: []
customers: []
tags: ["core", "sim", "agent-mode"]
sprint: ""
parent: ""
depends_on: []
spe: 1
effort: ""
updated: "2026-09-05"
---

## Description

On the Isaac factory rig, `/loco/odom` x/y are dead reckoned from the velocity our own
bridge commanded, so they report the command back rather than what the base did. Measured
on 2026-08-30: the robot was commanded 8.00 m forward and dead reckoning reported 7.995 m
travelled; the sim's true root pose moved **0.113 m**. The published position was wrong by
a factor of **71**, and nothing downstream could tell.

This is worse than having no odometry. Agent Mode's `goto` believes it has arrived while
the robot is still metres away, and every "N% of commanded" figure ever derived from
`/loco/odom` x/y is circular — dead reckoning MUST report ~100% of the command no matter
what happened.

## Details

### Current state

`robot-agent/hardware/isaac_odom.py` integrates the COMMANDED velocity (`OdomIntegrator.tick`
calls `reckoner.step(vx, vy, ...)` with the commanded vx) and `isaac_loco_bridge.py`
publishes the result on `rt/odommodestate`. `yaw` is genuinely MEASURED off the sim's base
orientation and is trustworthy — this task is about x/y only.

`block-executor.ts:314-316` states the opposite in a comment: "what the robot is believed to
have travelled is the measured one" / "Measured, never derived from the command". That is
false against the Isaac bridge and must be corrected, because it is the reason the circular
figures were believed.

### The fix: the sim already publishes ground truth

`sim_main.py:537-548` writes `env.scene.get_state()` to DDS topic **`rt/sim_state`** every
iteration (~59 Hz measured), on domain 1, as a JSON `String_`. It carries the true world
root pose:

    init_state.articulation.robot.root_pose[0] = [x, y, z, qx, qy, qz, qw]   # xyzw

It also carries `pause_room_door` joint positions and the apple's pose
(`rigid_object.object.root_pose`). Verified live with a read-only subscriber; no restart and
no sim change is needed to consume it.

So `isaac_loco_bridge.py` should publish TRUE x/y from `rt/sim_state` when it is available,
and fall back to dead reckoning only when it is not — saying which, loudly, on startup and
in the message, exactly as `--odom-origin` already does. This is legitimate: it is a
simulator, the pose is free, and `rt/odommodestate` exists to carry the robot's pose. On
real hardware the sidecar reads real odometry and none of this applies.

### Key files

- `robot-agent/hardware/isaac_odom.py` — add a ground-truth source alongside `DeadReckoner`
- `robot-agent/hardware/isaac_loco_bridge.py` — subscribe `rt/sim_state`, prefer it, say so
- `robot-agent/hardware/verify_isaac_odom_offline.py` — cover the new source and the fallback
- `robot-agent/src/agent-mode/block-executor.ts:314-316` — correct the false comment

Note the ORIGIN interaction: `--odom-origin` exists to move dead reckoning's zero into world
coordinates. Ground truth is ALREADY world, so the origin must NOT be applied to it. Applying
both would double the offset — this is the single most likely way to get this wrong.

## Test Strategy

- Offline: a fake `rt/sim_state` payload drives the new source; assert the published pose is
  the ground-truth pose, that `--odom-origin` is NOT added to it, and that losing the topic
  falls back to dead reckoning with the degradation stated on the wire and in the log.
- Live: command 8 m forward and confirm the published displacement now matches the true root
  pose to within a few cm, where it previously differed by 71x.


## What is actually left — 2026-09-05 audit

This task was proposed for closure on the strength of c44e900a + f3c3f7e7 and a green
`verify_isaac_odom_offline.py`. Three independent reviewers were asked to refute that; two
did, and the strongest refutation is that **the defect this task is named for still lives in
the same DDS message, one field over.**

- On a frame stamped `error_code = 0x600D` "ground truth", `isaac_odom.py:655-656` still
  builds the `OdomFrame` velocity as `vx*c - vy*s, vx*s + vy*c` — the **commanded** velocity
  rotated by measured yaw — and `fill_odom_msg` (:696) writes it to `msg.velocity`.
  `g1_sidecar.py:639-644` surfaces it as `odometry.velocity` / `yawSpeed`, and
  `robot-agent/src/hardware/HardwareClient.ts:177-181` parses it into robot state. The true
  base velocity is in the same payload and unused: the verifier's own capture
  (`verify_isaac_odom_offline.py:630`) shows `root_velocity` alongside the `root_pose` the
  parser reads. `OdomFrame.source` is documented "for x/y only" (`isaac_odom.py:461`) while
  the wire marker is message-level, so a consumer reading a frame labelled *measured* is
  still handed the command back.
- **Provenance stops at the sidecar.** `grep -c error_code robot-agent/hardware/g1_sidecar.py`
  returns 0; `/loco/odom`'s `source` field (:2554) reports the transport (`dds` / `zmq`), not
  `0x600D` vs `0xDEAD`. Agent Mode therefore still cannot tell an exact pose from a
  dead-reckoned one — the literal harm in the Description.
- **The regression guard is in no gate.** `scripts/test-all.sh` never invokes
  `verify_isaac_odom_offline.py`, and `robot-agent/hardware/tests/` has no odometry test, so
  section 8 passes only when a human runs it by hand.
- **Stale text the fix left behind.** `isaac_loco_bridge.py:841` still describes
  `--publish-odom` as "yaw is measured; x/y are dead reckoned and drift", and
  `factory_mission_bringup.sh:220-226` and :272 still tell the operator the bridge dead-reckons
  from zero. That is the same class of false statement the task required fixing in
  `block-executor.ts:314-316`.
- **The live 8 m check was never recorded.** The Test Strategy asks for a commanded 8 m
  forward compared against the true root pose. The nearest evidence is
  `~/factory-mission-logs/20260831-004842/loco_bridge.log`, which shows the ground-truth path
  active and non-circular — but it is the publisher's own log, not an independent comparison,
  and no number was written down.

Everything above except the live check is offline work.
