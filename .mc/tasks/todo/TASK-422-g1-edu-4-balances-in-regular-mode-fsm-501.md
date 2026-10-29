---
id: "TASK-422"
aliases: []
title: "g1-edu-4 balances in Regular Mode (FSM 501)"
slug: "g1-edu-4-balances-in-regular-mode-fsm-501"
status: "review"
priority: 2
owner: "huhn511"
projects: []
customers: []
tags: ["core", "g1-edu", "hardware"]
sprint: ""
parent: "[[TASK-169]]"
depends_on: []
spe: 3
effort: "medium"
due_date: ""
created: "2026-10-29"
updated: "2026-10-29"
---

# g1-edu-4 balances in Regular Mode (FSM 501)

## Description

Lab test on 2026-10-29 with the real G1 EDU `g1-edu-4` (29 DoF, 3-DoF waist,
motion switcher `{'form':'0','name':'ai'}`): the sidecar's `/loco/mode` balance
sent `SetFsmId(500)`. The robot accepted it but stayed in FSM 4 (locked stand),
so balance never confirmed and the arm gate, which needs a measured balance,
never opened. On the 3-DoF-waist G1, Regular Mode (the remote's R1+X) is FSM
**501**; 500 is the 1-DoF-waist variant. With 501 the robot confirmed balance
in 0.2 s and stood stable. A hot patch ran on the lab PC; this task lands it
cleanly.

FSM ids: 0 zero torque, 1 limp (damp), 4 locked stand, 500/501 Regular Mode,
801 running mode.

## Acceptance Criteria

- [x] `G1_FSM_ID_BALANCE` accepts 500 and 501 (nothing else); the commanded id
      is what `SetFsmId` receives.
- [x] `G1_FSM_BALANCE_REPORTED` defaults to the commanded balance id, and the
      sidecar refuses to start when an explicit list leaves it out.
- [x] `profiles/g1-edu-4.yaml` (arm_sdk block) resolves to balance 501;
      covered by a pytest and the supervisor's profile test.
- [x] Limp → stand → balance 501 confirms and `/arm` opens (pytest, fake loco
      client).
- [x] A balance that stays unconfirmed after `SetFsmId(500)` while the robot
      still reports FSM 4 answers 504 with a `hint` (also in `error`) naming
      the 3-DoF waist and `G1_FSM_ID_BALANCE=501`.
- [x] `docs/g1-edu-lab-bringup.md` and `docs/data-collection-two-person.md`
      describe the balance id per waist and the lab findings: feet flat on the
      floor with a hand's width of slack (not hanging), no stand from zero
      torque, finish = hoist the gantry, then Limp.
- [ ] Verified on g1-edu-4 from a clean `/start` with the committed profile.

## Notes

- The supervisor reads the profile only at its preflight (`/start`), so the
  profile change needs a stop/start of the robot side.
- Other lab findings, same day: Stand up from zero torque (FSM 0) is refused
  (`bad_transition`), so the sequence is limp → stand → balance; standing or
  balancing a robot hanging in the gantry is wrong — feet flat on the floor,
  a hand's width of slack; ending a session = hoist the gantry until it carries
  the robot, then Limp.
- Left at 500 on purpose: the default `FSM_ID_BALANCE` (1-DoF waist, Unitree's
  `Start()`), the MuJoCo sim (`sim_g1_dds/loco_state.py`, `--initial-fsm 500`)
  and Agent Mode's `G1_FSM_IDS.stand` (only used under `G1_LOCO_ENABLED=1`, the
  sim; under `fsm` it refuses the jump), plus test fixtures that model a
  500-robot.
