---
id: "TASK-231"
aliases: []
title: "Odometry reports the command, not the robot"
slug: "odometry-reports-the-command-not-the-robot"
status: "todo"
priority: 1
owner: ""
projects: []
customers: []
tags: ["core", "sim", "agent-mode"]
sprint: ""
parent: ""
depends_on: []
spe: 1
effort: ""
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
