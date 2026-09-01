---
id: "TASK-230"
aliases: []
title: "The simulated arms have no command inlet"
slug: "the-simulated-arms-have-no-command-inlet"
status: "done"
priority: 1
owner: ""
projects: []
customers: []
tags: ["core", "sim", "vla", "agent-mode"]
sprint: ""
depends_on: ["[[TASK-229]]"]
due_date: ""
created: "2026-08-29"
updated: "2026-08-29"
---

# The simulated arms have no command inlet

## Description

TASK-229 makes the robot agent emit correct joint targets. They still reach
nothing: in the Isaac factory rig the agent's `POST /action` is proxied to a
sidecar path built for the real robot, which cannot work — and the one process
that *can* move the sim's arms and hands has no way to be told anything.

## Details

### Current state — traced end to end

`SkillExecutor` sends a name-keyed dict via `HardwareClient.sendJointTargets` →
`sendAction` → `POST {HARDWARE_SIDECAR_URL}/action`. The bringup points that at
the camera facade on :8779. `isaac_camera_facade.py`'s `do_POST` owns no routes
and proxies everything to `--sidecar-url` (:8777). The sidecar answers **403**,
because `G1_READ_ONLY` defaults to 1 (`g1_sidecar.py:93`, and a second refusal
inside `send_action` at `:658`). That is loud and correct — `SkillExecutor` ends
the run with `Send action failed: G1_READ_ONLY — command path disabled`.

**Setting `G1_READ_ONLY=0` does not help, and is dangerous.** Three independent
blockers, none of which is the flag:

1. `send_action` → `_connect_unlocked()` imports `lerobot.robots.unitree_g1`.
   `lerobot` is **not installed** in the interpreter the bringup runs the sidecar
   under (`$HOME/anaconda3/envs/unitree_sim_env6/bin/python`). The bare `except`
   swallows it and every step returns `{"ok": false, "error": "not connected"}`.
2. The constructor passes `net_interface=`, which `UnitreeG1Config` does not
   have. `TypeError`, into the same `except`.
3. The driver hardcodes **DDS domain 0 — the real robot** — on both branches of
   `UnitreeG1.connect`, publishes `rt/lowcmd` keyed `f"{motor.name}.q"` while the
   sidecar builds `f"{k}.pos"` (so nothing would match and it would publish 29
   zeros), and has no `rt/dex3/*/cmd` publisher at all, so the 14 hand joints
   have nowhere to go.

Note the asymmetry that decides the design: the sidecar's `/action` path has **no
domain guard at all** and hardcodes 0, while `isaac_manip_bridge.py` refuses
domain 0 outright (`ValueError` in `ManipPublisher.__init__`), on top of the
bringup's own numeric refusal.

**The only process that can move the sim's arms and hands** is
`robot-agent/hardware/isaac_manip_bridge.py`. It publishes `rt/lowcmd` slots
`[15:29]` plus `rt/dex3/{left,right}/cmd`, sets the CRC, applies the right-hand
NeoDEM→Isaac slot remap, rate-limits, and rests on death. Isaac's wholebody
provider (`action_provider_wh_dds.py`) reads exactly those. But the bridge has
**no HTTP server and no DDS command inlet**: with no `--probe` it prints
*"holding the rest pose — set_targets() from a policy, or --probe"* and idles at
`M.REST` at 50 Hz forever. Its only producer APIs are in-process Python
(`set_targets`, `set_action31`).

Three constraints the design has to respect:

- **Both hands must be published every frame.** The provider's guard is
  `if left_hand_cmd and right_hand_cmd:` — publishing one moves neither.
- **The waist cannot be delivered.** The wholebody provider overwrites the waist
  indices with `default_joint_pos` on every step, *after* the arm copy. The 3
  waist keys in a 31-dim action go nowhere.
- **`rt/lowcmd` latches.** An un-stopped bridge holds a mid-reach pose forever,
  so E-Stop has to reach a ramp-to-rest, not just stop publishing.

### Key files

- `robot-agent/hardware/isaac_manip_bridge.py` — add `--serve <port>` (8778 is
  free between the sidecar and the facade): `POST /action` taking the same
  name-keyed dict, `GET /health`, `POST /estop` → ramp to rest.
- `robot-agent/hardware/isaac_camera_facade.py` — add `--manip-url`; route
  `/action` and `/estop` there, everything else to `--sidecar-url`. Callers must
  keep ONE base URL: repointing `HARDWARE_SIDECAR_URL` at 8778 breaks `/state`,
  `/state/fast`, `/loco/*` and the cameras.
- `robot-agent/hardware/factory_mission_bringup.sh` — `--serve 8778` on the
  bridge, `--manip-url` on the facade, an 8778 readiness probe, and
  **`G1_READ_ONLY=1` left exactly as it is**.
- `robot-agent/src/vla/action-contracts.ts` — the comment claiming the waist is
  commanded and that "nothing on NeoDEM's write path drops it" is wrong for the
  wholebody provider. Correct it.

### The double-decode trap

The hand values arriving over HTTP are **radians** — `action-contracts.ts` has
already decoded the left-hand grip code. The inlet must use `HandUnits.RADIANS`
and must not go through `set_action31`, whose mandatory-kwarg design exists
precisely to stop this. Decoding twice opens the hand where the policy meant to
close it, which is the same failure TASK-229 measured at 0/4 versus 2/4.

## Test Strategy

- Offline, DDS off (`init_dds=False`, as `verify_isaac_manip_offline.py` already
  does): a good dict applies 28 joints and **reports** the 3 ignored waist keys;
  an unknown joint name is reported rather than silently skipped; a hand value is
  treated as radians and not re-decoded; `/health` answers; `/estop` rests.
- `domain=0` still raises.
- Live: bring the rig up with `NEODEM_ROBOT_SPAWN=table_front` (TASK-227 work)
  and run a `vla_skill` rollout against a GR00T server. Recorded.

## Acceptance Criteria

- [ ] A `vla_skill` rollout moves the simulated G1's arms and Dex3 hands
- [ ] Ignored and unknown joint names are named in the response, never dropped
      in silence
- [ ] Hand values are radians on this path, decoded exactly once
- [ ] `G1_READ_ONLY` stays 1 and the domain-0 refusals stay intact
- [ ] E-Stop ramps the latched `rt/lowcmd` pose back to rest

## Not verified / open questions

- Whether the scene's arm PD gains track a 50 Hz position target well enough for
  a grasp — the provider ignores kp/kd from `rt/lowcmd` and uses the scene's own
  actuator config. Unmeasured.
- Whether a reach destabilises the stand: the legs come from `policy.onnx` driven
  by `rt/run_command/cmd` and are unaware of the arm targets.
- Whether `ManipTargets.make()`'s per-call validation is cheap enough at the
  rollout's step rate. Unbenchmarked.
