---
id: "TASK-421"
aliases: []
title: "Keyboard teleop moves the real G1 arms smoothly"
slug: "keyboard-teleop-moves-the-real-g1-arms-smoothly"
status: "in-progress"
priority: 1
owner: "huhn511"
projects: []
customers: []
tags: ["core", "g1-edu", "teleop", "hardware"]
sprint: ""
parent: "[[TASK-169]]"
depends_on: []
spe: 4
effort: "high"
due_date: ""
created: "2026-10-29"
updated: "2026-10-29"
---

# Keyboard teleop moves the real G1 arms smoothly

## Description

### Symptom (lab test 2026-10-29, `g1-edu-4` on the gantry)

Keyboard teleop on the robot page's Teleop tab, sidecar in `G1_WRITE_MODE=arm_sdk`. The operator held the arrow keys to move one joint; the arms only twitched. The sidecar log shows 44 cycles of:

```
[G1 arm_sdk] ARM (lease 25): weight 0 -> 1 over 1.5s, teleop_mode=arms+left_hand ...
[G1 arm_sdk] dead-man: no /action for 0.52s — holding
[G1 arm_sdk] DISARM (deadman): weight 0.67 -> 0 over <= 1.0s
```

and the agent log alternates `[ArmRegistry] arming the sidecar` with `[KeyboardTeleop] arms handed back (...)`, with no `/disarm` and no forwarding error in between. Weight 0.67 at the disarm is exactly 1.0 s of the 1.5 s ramp: **not a single `/action` reached the sidecar after any of the arms.** Every press armed, the dead-man disarmed one second later, and the arm blended in and back out. That was the twitch.

### Root cause

Reproduced end to end (real `HardwareClient` + `ArmRegistry` + `RobotStateManager` + `/ws/keyboard-teleop`, against the real `ArmSdkController` behind the real `g1_sidecar.Handler`): the same log, line for line, when the held key drives a joint the arm path never commands, and a working stream when it drives an arm joint.

1. **The forwarder sent nothing while armed.** `RobotStateManager.forwardTeleopToHardware` (`robot-agent/src/robot/state.ts`) sends only the joints this session touched that `forwardableTeleopPose` lets through: arm joints and fingers of a hand with live state. With nothing of that kind touched it returned early ("the sidecar holds the measured pose on its own"). That is true for the sim, and false for `arm_sdk`: the sidecar disarms one second after the last `/action` (`docs/g1-edu-lab-bringup.md`: "The agent must keep `/action` flowing while engaged").
2. **The keyboard armed for joints that never move.** `KeyboardTeleopSection` (`app/.../tabs/TeleopTab.tsx`) starts on joint 0, which on a G1 EDU is `left_hip_pitch_joint`; the first 15 entries are legs and waist. The agent's `direction` handler (`robot-agent/src/api/keyboard-teleop.ts`) armed the real arms for any joint. A leg key therefore armed, integrated a leg target nobody forwards, and the dead-man undid it.
3. Nothing told the operator: the Teleop tab drops every `{type:'error'}` frame.

The candidates in the brief were checked and ruled out. Browser key auto-repeat does not matter: the client sends one `{direction}` per press and the agent integrates the velocity on its own timer. The agent does not forward only on change: the forwarder posts at 50 Hz. Heartbeats and Tailscale latency were fine (no `heartbeat_lost` in the agent log).

### Further causes of jerky motion on the same path

- **Stale start target.** The teleop map was seeded once per session (at `bind`) from the 2 s `/state` cache, and the keyboard kept integrating while nothing was armed. After each disarm Unitree's controller moves the arm again, so the next arm started its targets from a pose that no longer existed. The result was a slew-limited lurch, then a tracking-error disarm. In the repro the target ran from 0.19 rad to the 2.09 rad joint limit across three presses without the arm moving.
- **30 Hz target against a 50 Hz slew.** Held keys were integrated on the 33 ms tick (26 mrad steps) while the sidecar slews at most 20 mrad per 20 ms frame. The commanded velocity therefore alternated between the slew limit and a fraction of it.
- **Lost keyup.** A key held while the window loses focus never sends its keyup. The joint kept moving until the heartbeat dead-man fired (1 s at 0.8 rad/s).
- **Poll race on `/arm`.** A status read sent while `/arm` was in flight, served before the arm and answered after it, could clear `armedLocal` under a freshly armed sidecar.

### Fix

- Sidecar: a fresh `/arm` reply carries `seed`, `{joint: rad}` of the pose the arm was seeded from (14 arm joints plus the fingers of each commanded hand). The reply contract only gains a field. The dead-man, slew limits and E-stop are unchanged.
- `HardwareClient`: counts fresh arms (`getArmEpoch`), keeps the seed (`getArmSeed`), and bumps the arm-op sequence again when `/arm` returns.
- Forwarder: once per fresh arm on an arm-only G1 sidecar, it seeds the arm joints (and the seeded fingers) from the sidecar's seed, falling back to the measured joints, and marks them touched. While armed, the stream therefore always holds the arm pose, and every arm starts where the arm is.
- Keyboard socket: refuses `direction`/`position`/`delta` for a joint the arm path never commands (`joint_not_drivable`) before arming, and advertises `drivable` per joint in `config`. Held-key joints are integrated on a 50 Hz timer (16 mrad steps). A client that reports its clutch moves a joint only while its last clutch-closed beat is under 300 ms old, so an open clutch or a frozen tab stops the joint and the arm holds. The heartbeat dead-man still hands the arms back after 1 s.
- Teleop tab: starts on the first drivable joint, ↑/↓ skip non-drivable joints (shown as "not driven"), agent errors appear as a toast (one per code per 3 s), and window blur or a hidden tab releases a held key.
- Between presses the arm stays armed and holds its target, as `teleop/reengage.ts` already intends ("releasing the grip is not a disarm"). It is handed back by the heartbeat dead-man (tab closed, link gone), lease loss, E-stop or socket close. All of these gates are unchanged.

## Acceptance Criteria

- [x] On an armed arm-only G1 sidecar, the forwarder streams `/action` continuously even when the operator touched no forwardable joint (vitest: `state-teleop-forwarding.test.ts` "on an armed arm-only sidecar").
- [x] Every fresh arm starts its teleop targets from the sidecar's `seed` (fallback: measured joints), seeded once per arm (vitest + pytest `test_a_fresh_arm_reply_carries_the_pose_it_seeded_from`, `test_a_rearm_reseeds_from_where_the_arm_is_now`).
- [x] A keyboard press on a leg, the waist or an uncommanded hand's finger arms nothing and answers `joint_not_drivable` (vitest `keyboard-teleop-arming.test.ts` "TASK-421").
- [x] Presses on arm joints and the gaps between them arm once and never disarm while the console heartbeats (vitest).
- [x] Held-key steps are 16 mrad at 50 Hz; an open clutch or 300 ms without a clutch-closed beat stops the joint; 1 s without a heartbeat still disarms (vitest).
- [x] The Teleop tab starts on and steps between drivable joints, shows agent errors and releases a held key on blur (vitest `KeyboardTeleopLease.test.tsx`).
- [ ] On `g1-edu-4` in Balance: hold → on an arm joint, and the joint moves smoothly. Release, wait 2 s and press again: the sidecar log shows ONE `ARM` for the whole session, no `dead-man` lines while the tab is open, and the arm does not jump on the first press.
- [ ] On `g1-edu-4`: close the tab while armed. `DISARM (request)` appears within about 1 s.

## Notes

- Evidence: `g1-edu-4-sidecar.log` / `g1-edu-4-agent.log` from the 2026-10-29 run. The 21 disarms at exactly weight 0.67 are arms that never saw an `/action`. The others are re-arms that started during a disarm ramp, with weight above 0.
- The selected joint on the robot cannot be read from the logs. The repro shows that only a non-forwardable joint produces this exact signature. If the operator had an arm joint selected, the robot-side checks above will show it.
