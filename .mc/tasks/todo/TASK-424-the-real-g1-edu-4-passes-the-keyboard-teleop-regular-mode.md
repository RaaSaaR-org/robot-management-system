---
id: "TASK-424"
aliases: []
title: "The real g1-edu-4 passes the keyboard-teleop, Regular Mode balance and link-flap checks"
slug: "the-real-g1-edu-4-passes-the-keyboard-teleop-regular-mode"
status: "todo"                # backlog | todo | in-progress | review | done | cancelled
priority: 1                   # 1=critical, 2=high, 3=medium, 4=low
owner: "huhn511"
projects: []
customers: []
tags: [core, g1-edu, hardware]
sprint: ""
parent: ""
depends_on: ["[[TASK-421]]", "[[TASK-422]]", "[[TASK-423]]"]
spe: 2
effort: "low"
due_date: "2026-10-30"
created: "2026-10-30"
updated: "2026-10-30"
---

# The real g1-edu-4 passes the keyboard-teleop, Regular Mode balance and link-flap checks

> **Merge state when this was filed (2026-10-30):** none of the three PRs this run
> sheet tests is on `main` yet. #445 (TASK-422), #446 (TASK-423) and #444
> (TASK-421) are reviewed, CI-green and mergeable, but each squash-merge is waiting
> for the user's approval. **Do not start the session until all three are merged**
> (order #445 → #446 → #444). If one of them does not land, skip the steps marked
> with its PR and leave its acceptance criteria unchecked.

## Description

The run sheet for the 2026-10-30 lab session on the real `g1-edu-4`. Three
merged changes were only verified in sim and pytest/vitest; each left an on-robot
acceptance criterion that moved here: the supervisor waits out a short link flap
and the bring-up starts from zero torque via Limp (TASK-423, #446), the
`g1-edu-4` profile balances in Regular Mode, FSM 501 (TASK-422, #445), and
keyboard teleop moves the real arms smoothly, with one ARM per session and a
DISARM when the tab closes (TASK-421, #444). This task is done when every check
below has been run and recorded on the real robot.

## Details

### Current state

- The robot side (camera → bridge → sidecar → agent) is started and stopped by
  the robot supervisor (`robot-agent/supervisor/`, unit
  `neodem-robot-supervisor@g1-edu-4`, `127.0.0.1:8766`), driven from the
  readiness panel on the session page. The sidecar `robot-agent/hardware/g1_sidecar.py`
  listens on `:8767`, DDS domain 0, on `enp131s0`.
- Profile: `robot-agent/hardware/profiles/g1-edu-4.yaml`. The supervisor reads it
  only at `/start` (preflight).
- **Logs:** `~/.local/state/neodem/logs/g1-edu-4-<proc>.log` (`<proc>` = `bridge`,
  `sidecar`, `agent`, `camera`); also over the supervisor:
  `curl -s -H "Authorization: Bearer $ROBOT_SUPERVISOR_TOKEN" localhost:8766/logs/sidecar?tail=50`
  (`/logs/<proc>/stream` is SSE). PID files are in `~/.local/state/neodem/g1-edu-4/`.
- Supervisor service log: `journalctl --user -u neodem-robot-supervisor@g1-edu-4`.
- Reference docs: `docs/g1-edu-lab-bringup.md` (supervisor, profiles, mode
  changes, runbook) and `docs/data-collection-two-person.md` (VR take flow).

### Preconditions and safety (every item, before anything moves)

1. At least two people present; one stays at the E-stop for the whole session.
   Physical remote in hand (L1+A, E-STOP), within reach at all times.
2. Gantry: both feet flat on the floor with **a hand's width of slack** in the
   strap. Never let the robot hang in the gantry; never let it carry its own
   weight without the gantry attached.
3. Robot out of debug mode (the sidecar's mode control needs the robot's own
   loco service).
4. **Never** set `G1_READ_ONLY=0` by hand. The sidecar starts in `read_only`;
   go to `arm_sdk` only through the panel's confirmed switch.
5. **Never** run Unitree `xr_teleoperate` while the arm_sdk sidecar is running:
   two writers on `rt/arm_sdk`.

### Lab PC preparation

1. In the primary checkout on the lab PC, deal with the uncommitted hand edits in
   `robot-agent/hardware/g1_loco_mode.py` and
   `robot-agent/hardware/profiles/g1-edu-4.yaml` (a hot patch that is a subset
   of #445): stash or discard them. Otherwise `git pull` aborts, or the run uses
   the hot patch and proves nothing about the committed profile.
2. `git pull` on `main`, then `git status` must be clean and `git log -1` must
   show the merge of #444.
3. `systemctl --user restart neodem-robot-supervisor@g1-edu-4`. TASK-423 changed
   the supervisor itself (the carrier wait). Stop + Start only restarts the
   children, and the stale-code check does not cover the supervisor. Check with
   `systemctl --user status neodem-robot-supervisor@g1-edu-4` that the unit's
   start time is after the pull.
4. In the readiness panel: **Stop robot side**, then **Start robot side**, so the
   profile is read again and the bridge, sidecar and agent run the merged code.
   The panel's stale-code check must be green (no "runs code from before …").

### Steps (in this order)

**1. Link flap during Start (TASK-423, #446).** With the robot side stopped:

- 1a. Pull the `enp131s0` cable **first**, then press **Start robot side**.
  Expect the Robot LAN row pending with `carrier down · IP — · ping —` and the
  detail `waiting for carrier on enp131s0 — link down (N s of 15 s)`, counting up.
- 1b. Re-plug within about 5 s. You may briefly see
  `carrier on enp131s0 is back; waiting for 192.168.123.222`. Expect the step ok
  with `... the robot answers at 192.168.123.161 (the link was down at start;
  waited N s for it to come back)`, then camera, bridge, sidecar (`read_only`),
  agent. Write down how long NetworkManager took to restore the IP. If the step
  ends in `no_host_ip`, press **LAN up** and consider raising
  `timeouts.carrierS` in the profile.
- 1c. Stop, leave the cable out, press Start. After about 15 s expect failed
  `no_carrier` with `Robot cable unplugged or robot off (enp131s0 no carrier).
  Interface operstate: down. Waited 15 s for the link to come back.` and no
  bridge PID. Start again and press **Stop** during the wait: expect
  `aborted by stop` within about 1 s.
- 1d. Re-plug and do a clean Start. **Do not pull the cable once the bridge or
  sidecar step has begun**: that window is not covered by the wait (expected
  result there is a fail-closed `dds_iface`, sidecar exit 3, or `no_lowstate`;
  with a sidecar already running a flap can give `safety_abort`).
- Known gap: the carrier wait has no debounce. A bouncing cable can pass the link
  step and fail later at bridge or sidecar start (fail-closed, but confusing).

**2. Sidecar banner reads balance 501 (TASK-422, #445).** In
`g1-edu-4-sidecar.log` expect:

- `[G1 Sidecar] /arm needs a MEASURED balance mode (FSM [501], fresh <= 1.5s)`
- `MODE CONTROL (G1_LOCO_ENABLED=fsm) on DDS domain 0 ... balance=501 (counts as balance: [501])`
- `arms slew <= 1.0 rad/s`

**Stop the session** if it shows `balance=500` or `REFUSING TO START`.
`curl -s localhost:8767/health` must show `loco.ids` balance `501`,
`balance_reported [501]`; `POST /loco/move` must answer 403. Then take the lease
and use the panel's confirmed switch to `arm_sdk`.

**3. Zero torque → Limp → Stand → Balance (TASK-423 #446, TASK-422 #445).**
Gantry at a hand's width of slack, feet flat.

- 3a. With the robot reading `Zero torque · FSM 0`, the panel shows the strip
  `Zero torque → Limp → Stand → Balance` (Zero torque bold), the line
  `The robot is in zero torque. Next: press Limp, then Stand up, then Balance.`,
  Limp ringed, and Stand up disabled with `press Limp first, then Stand up`.
  Optional: `curl -s -XPOST localhost:8767/loco/mode -d '{"mode":"stand"}'`
  answers 409 with `next: "limp"`, the sidecar log shows
  `MODE stand: refused bad_transition ... command limp first`, and no `SetFsmId`
  is sent.
- 3b. **Limp** and confirm: `MODE limp: from zero_torque(0) -> 1 confirmed`.
  Watch about 10 s: nothing else is sent by itself (no `MODE stand` line).
- 3c. **Stand up** and confirm: the legs stiffen within 1–3 s;
  `MODE stand: from limp(1) -> 4 confirmed in ...`, panel `Stand (locked) · FSM 4`.
  FSM 4 is not yet verified on this robot: if it reads anything else, press Limp.
  Wait at least 2 s.
- 3d. **Balance** and confirm: `MODE balance: from stand(4) -> 501 confirmed in ~0.2s`,
  panel `Balance · FSM 501` and `Bring-up done — the balance controller holds the robot.`
  No robot-mode hint line should appear (that hint is only for a 500 command).
  On a 504 the panel shows only `Not confirmed — the robot reports ...`: press
  **Limp**, record it, do not retry by hand.
- Caution: for any FSM id classed `other` (e.g. 801, or 500 on `g1-edu-4`), the
  strip rings Limp and says `Next: press Limp`. On a robot carrying its own
  weight, Limp drops it into the gantry slack; only the confirm dialog's gantry
  warning guards it. Check the slack before confirming any Limp.

**4. First /arm in FSM 501, watching the waist (TASK-422 #445, TASK-421 #444).**
Release, then squeeze (or the first keyboard press in step 5 arms it):

- The arms ramp in over 1.5 s from the measured pose (the `seed` in the `/arm`
  reply) with **no jump**, at the profile's 1.0 rad/s. A missing `seed` means a
  stale sidecar: Stop + Start the robot side.
- **Watch the torso.** On the 3-DoF waist, arm_sdk holds waist joints 12–14 at
  kp 300 / kd 3, weight 1. Look for the waist stiffening, the robot leaning, or
  the balance controller visibly fighting that hold. If so: E-stop, record it.
- The measured FSM must stay 501 for the whole session. Any other id disarms
  with `left_balance` (fails safe, but means 501 is not stable). If arm_sdk is not
  honoured in 501, expect a tracking-error disarm (0.35 rad for 0.3 s), not motion.

**5. Keyboard teleop on an arm joint (TASK-421, #444).** Teleop tab, after
taking control:

- The selection starts on `left_shoulder_pitch_joint`; legs and waist show
  `· not driven`, and the up/down arrows skip them.
- Hold → for about 1 s. Expect exactly one
  `[G1 arm_sdk] ARM (lease N): weight 0 -> 1 over 1.5s, teleop_mode=...` (sidecar
  log) and one `[ArmRegistry] arming the sidecar (lease generation N)` (agent
  log). The joint moves smoothly at about 0.8 rad/s, no buzz.
- Release, wait 2 s, press ←. **No second `ARM`**, and no `dead-man:` or
  `DISARM` line while the tab is open.
- Hold →, press ↓ during the hold, release, press → again: only the newly
  selected joint moves.
- Hold a key and click into another window: the joint stops, the arm stays armed
  and holds its pose (no DISARM).
- Judge "no jump" on a tap or after the 1.5 s ramp: during the first ramp a held
  key's joint keeps moving about 0.1 rad after release (ramp catch-up; sim
  measured 1.16 against 1.0 rad/s). That is not a jump.
- Any of these is a regression: `[G1 arm_sdk] dead-man: no /action`, a
  tracking-error disarm, `[RobotStateManager/Teleop] forwarding to the sidecar failed`,
  or the untouched arm moving at ARM.
- Watch for a small Dex3 finger flex on a re-arm (a finger driven earlier stays in
  the stream at its seed, clamped 0.05 rad off its stops).
- Over Tailscale, heartbeat jitter above 300 ms pauses the held joint (safe, looks
  like a stutter); run this step on the lab LAN.
- Between presses the arms stay at weight 1 holding their target for as long as
  the tab heartbeats. By design; the E-stop person stays put.

**6. Close the tab while armed (TASK-421, #444).** Expect
`DISARM (request): weight 1.00 -> 0 over <= 1.0s` in the sidecar log within
about 1 s. If missing, the agent log should show
`[KeyboardTeleop] no heartbeat for 1000 ms`.

**7. E-stop in balance (TASK-422 #445, TASK-421 #444).** Re-arm, then latch the
E-stop once while in Balance and armed: a DISARM, the robot damps
(`SetFsmId(1)`), and `/arm` answers 409 `estop_latched` until reset. After the
reset, a key held through it must not re-arm until released and pressed again.
Bring the robot back up Limp → Stand → Balance (step 3) before step 8.

**8. One short VR data-collection take, end to end.** Per
`docs/data-collection-two-person.md`: assistant on the session page
`/data-collection/<session id>`, operator on the Quest 3 at
`/data-collection/live?robot=g1-edu-4` (Quest plugged into the robot PC over USB,
**Open on headset**). Switch to arm control, then **Start take**, move the arms
with the grip clutch for a few seconds, **Stop take**, keep it in the quick check,
**End session**. The take must show in the session's take list and in the
dataset. Do not run `xr_teleoperate` for this.

**9. Finish.** Release the grip (the arms disarm), hoist the gantry until it
carries the robot, then press **Limp**. Stop the robot side from the panel.
Record any deviations in Notes below and tick the criteria that passed.

## Acceptance Criteria

- [ ] Step 1: a ~5 s cable pull during Start is waited out and the start completes; a cable left out fails `no_carrier` after 15 s; Stop aborts the wait within ~1 s ([[TASK-423]])
- [ ] Step 2: the sidecar banner reads `balance=501 (counts as balance: [501])` from a clean `/start` with the committed profile ([[TASK-422]])
- [ ] Step 3: from zero torque, Stand is refused with `next: limp`; Limp → Stand → Balance confirms `Balance · FSM 501` ([[TASK-423]], [[TASK-422]])
- [ ] Step 4: the first `/arm` in 501 ramps in from the seed with no jump, the 3-DoF waist does not fight the hold, and FSM stays 501 all session ([[TASK-422]], [[TASK-421]])
- [ ] Step 5: keyboard teleop moves an arm joint smoothly; the sidecar log shows ONE `ARM` for the session and no `dead-man` lines while the tab is open ([[TASK-421]])
- [ ] Step 6: closing the tab while armed logs `DISARM (request)` within about 1 s ([[TASK-421]])
- [ ] Step 7: E-stop in Balance damps, `/arm` answers 409 until reset, and a held key does not re-arm through the reset ([[TASK-422]], [[TASK-421]])
- [ ] Step 8: one short VR take records end to end and lands in the dataset ([[TASK-421]], [[TASK-422]])
- [ ] Step 9: the session ends with the grip released, the gantry carrying the robot and the robot in Limp ([[TASK-422]])

## Test Strategy

This task is its own test: run the steps above on the real `g1-edu-4` and tick
each criterion only on the observed UI text and log lines. Paste the relevant log
excerpts (from `~/.local/state/neodem/logs/g1-edu-4-<proc>.log`) into Notes. A
failed step is recorded here and filed as a new task against the PR it tests;
it does not get ticked.

## Notes

- Residual concern (all three reviews): FSM 501 = Regular Mode on the 3-DoF waist
  cannot be confirmed from any Unitree SDK source on this box
  (`unitree_sdk2_python` `g1_loco_client.py` only has `Start()` = `SetFsmId(500)`),
  and the MuJoCo sim and `sim-g1-edu-dev` stay at 500. This session is the first
  end-to-end run of the committed 501 path; the only prior evidence is the
  2026-10-29 lab observation recorded in TASK-422.
- FSM 4 (Stand locked) is likewise unverified on this robot; step 3c says what to
  do if it reads differently.
