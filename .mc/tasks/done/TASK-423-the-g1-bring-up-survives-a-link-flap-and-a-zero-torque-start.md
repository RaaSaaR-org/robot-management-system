---
id: "TASK-423"
aliases: []
title: "The G1 bring-up survives a link flap and a zero-torque start"
slug: "the-g1-bring-up-survives-a-link-flap-and-a-zero-torque-start"
status: "done"
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
updated: "2026-10-30"
---

# The G1 bring-up survives a link flap and a zero-torque start

## Description

Two frictions from the 2026-10-29 bring-up of `g1-edu-4`:

1. The robot LAN `enp131s0` dropped its carrier for ~8 s and the supervisor's
   `/start` failed at once with `no_carrier`; a manual retry worked. The `link`
   step now waits out a short carrier loss (`timeouts.carrierS`, default 15 s),
   gives the host IP the rest of that budget to come back after a flap, shows
   "waiting for carrier" in its `detail` while it waits, and says how long it
   waited. A link that stays down still fails `no_carrier`, naming the wait.
2. The robot sat at FSM 0 (zero torque) and `stand` was refused with a bare
   `bad_transition`. The transition rule stays as it is (stand only from
   limp) — every motion remains an explicit operator action — but the refusal
   now names the next step (`next: "limp"`, "command limp first"), and the app's
   mode panel shows the bring-up strip (zero torque → limp → stand → balance)
   with the next button marked and "press Limp first" as the Stand up reason.

## Acceptance Criteria
- [x] A carrier loss shorter than `timeouts.carrierS` does not fail `/start`; the link step reports `checks.carrierWaitS` and says it waited
- [x] A link that stays down fails `no_carrier` after `timeouts.carrierS`, with the wait in the detail
- [x] `stand` from zero torque answers `bad_transition` with `next: "limp"` and sends no RPC
- [x] The mode panel shows the current bring-up step and the next button; each step still needs its own confirmation
- [ ] Checked on `g1-edu-4`: unplug the robot cable for ~5 s during `/start`, and stand up from zero torque via Limp — moved to [[TASK-424]] (g1-edu-4 check on 2026-10-30)

## Test Strategy

- **Unit:** the supervisor vitest suite (`robot-agent/supervisor`,
  `__tests__/sequence.test.ts`: carrier flap shorter than `carrierS` passes,
  a link that stays down fails `no_carrier` with the wait), the hardware pytest
  suite (`robot-agent/hardware/tests/test_g1_loco_mode.py`: `next_step`, the
  zero-torque refusal naming Limp with no RPC sent, a hint-less next step still
  refusing cleanly) and the app vitest suite
  (`RobotModeControl.test.tsx`: the bring-up strip and the marked next button).
- **Live:** the `g1-edu-4` check (cable pulled ~5 s during `/start`, stand up
  from zero torque via Limp) moved to TASK-424.

## Notes

- Supervisor: `robot-agent/supervisor/src/steps.ts` (`stepLink`), `src/profile.ts` (`carrierS`).
- Sidecar: `robot-agent/hardware/g1_loco_mode.py` (`next_step`, `_check`). The balance FSM id is untouched (separate work).
- App: `app/src/features/robots/components/RobotModeControl.tsx` (`bringUpNext`, `BRING_UP_STEPS`).
- The supervisor vitest suite needs Linux (`/proc`); run it in a Linux container on a Mac.
