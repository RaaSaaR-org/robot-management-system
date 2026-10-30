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
due_date: "2026-10-31"
created: "2026-10-30"
updated: "2026-10-30"
---

# The real g1-edu-4 passes the keyboard-teleop, Regular Mode balance and link-flap checks

> **Merge state (2026-10-30):** the three PRs this run sheet tests are merged:
> #445 (TASK-422), #446 (TASK-423) and #444 (TASK-421). So is the session-page
> redesign: the TASK-425 epic with #448, #450, #449 and #451, and #452
> (TASK-430: Set up offers **Restart robot side** when a process runs stale
> code). The last one to land is #453 (TASK-431, in CI on 2026-10-30): a desktop
> **Reset E-stop** on the session page, and a restart no longer invents a
> protective stop. **If #453 is
> not on `main` when the session starts**, the session page has no Reset
> E-stop. Reset the latch under **Testing tools → Launch VR → Reset E-stop**
> instead, and leave the TASK-431 part of Step 0 unchecked.

## Description

The run sheet for the 2026-10-31 lab session on the real `g1-edu-4`. Three
merged changes were only verified in sim and pytest/vitest; each left an on-robot
acceptance criterion that moved here: the supervisor waits out a short link flap
and the bring-up starts from zero torque via Limp (TASK-423, #446), the
`g1-edu-4` profile balances in Regular Mode, FSM 501 (TASK-422, #445), and
keyboard teleop moves the real arms smoothly, with one ARM per session and a
DISARM when the tab closes (TASK-421, #444). The session is also the first run
of the redesigned session page's **Get ready** checklist (TASK-427) on the real
robot, starting from the E-stop latched on 2026-10-29 (TASK-431). This task is
done when every check below has been run and recorded on the real robot.

## Details

### Current state

- The robot side (camera → bridge → sidecar → agent) is started and stopped by
  the robot supervisor (`robot-agent/supervisor/`, unit
  `neodem-robot-supervisor@g1-edu-4`, `127.0.0.1:8766`). The session page's Get
  ready step 1 drives it; the readiness panel on the robot's Teleop tab still
  does too. The sidecar `robot-agent/hardware/g1_sidecar.py` listens on
  `:8767`, DDS domain 0, on `enp131s0`.
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
   Physical remote in hand (L1+A, E-STOP), within reach at all times. The remote
   is the primary E-stop; the session page's E-STOP is the second.
2. Gantry: both feet flat on the floor with **a hand's width of slack** in the
   strap. Never let the robot hang in the gantry; never let it carry its own
   weight without the gantry attached.
3. Robot out of debug mode (the sidecar's mode control needs the robot's own
   loco service).
4. **Never** set `G1_READ_ONLY=0` by hand. The sidecar starts in `read_only`;
   go to `arm_sdk` only through the confirmed **Switch to arm control**.
5. **Never** run Unitree `xr_teleoperate` while the arm_sdk sidecar is running:
   two writers on `rt/arm_sdk`.
6. While a confirm dialog is open on the session page (Start session, End
   session, Stop robot side, a mode change), its overlay covers the page's
   E-STOP: it cannot be clicked ([[TASK-435]]). Use the remote then.

### Lab PC preparation

1. **The hot patch is already stashed.** `git stash list` in the primary
   checkout shows `lab hot patch 2026-10-29 (FSM 501; superseded by #445)`
   (`stash@{0}` on 2026-10-30). Keep it until step 3 confirms
   `Balance · FSM 501`, then drop that entry and only that one:
   `git stash drop stash@{N}`, with N read from `git stash list`. The entry
   under it is unrelated WIP.
2. **Pull.** The checkout is on `main`. Run `git pull`. Then `git status` must be
   clean and `git log -1` must show the merge of #453 or a later commit. If
   #453 is missing, read the merge-state note at the top.
3. **The supervisor already runs the merged code.** The unit
   `neodem-robot-supervisor@g1-edu-4` restarts on every boot. The PC was
   cold-booted on 2026-10-30 at 16:42, so the supervisor runs the merged
   supervisor code, and yesterday's robot-side processes are gone. Restart the
   unit by hand (`systemctl --user restart neodem-robot-supervisor@g1-edu-4`)
   only if the pull changed `robot-agent/supervisor/`
   (`git diff --stat HEAD@{1} HEAD -- robot-agent/supervisor/`). Stop + Start on
   the page restarts only the children. #453 changes the agent, not the
   supervisor.
4. **After any reboot,** start the API server (:3001) and the app (:1420) with
   `neodem-dev-up` (in `~/.local/bin`). It skips whatever already listens, logs to
   `~/.local/state/neodem/logs/dev-server.log` and `dev-app.log`, and runs the
   server with `NODE_OPTIONS=--unhandled-rejections=warn`: on 2026-10-29 a
   database timeout in a background job killed the server ([[TASK-433]]). The
   supervisor units and RustFS come back on their own.
5. **Create the session.** At `/data-collection/new`, pick robot `g1-edu-4` and
   input Meta Quest VR. Its page `/data-collection/<id>` opens in Set up. Its
   **Get ready** checklist drives steps 1–3 and 8 below. Press **Start session**
   only in step 8.

### Yesterday's E-stop is still latched

- `robot-agent/data/state-g1-edu-4.json` holds `estopLatched: true` from
  2026-10-29 17:12 (`estopAt` 16:12:52Z), reason "Platform E-Stop: Emergency stop
  triggered for G1-EDU-4 (real)".
- The agent restores it on every start. That is deliberate (TASK-382): only a
  reset lifts a latch. Do not edit the file.
- Once step 1 has started the robot side, Get ready step 3 "Stand up and
  balance" shows **E-stop is latched.** with the reason and a lit **Reset
  E-stop**. Steps 4 and 5 wait for step 3.
- Press Reset E-stop deliberately, at the start of step 3 below: people at the
  robot, the gantry checked (a hand's width of slack, feet flat), the remote in
  hand. The reset asks for no confirm. Step 3 then says to stand the robot up
  again: Limp → Stand up → Balance (step 3 of this run sheet).
- Step 2's Switch to arm control does not wait for step 3. If the switch is
  refused because of the latch, reset first, then switch.
- The physical remote remains the primary E-stop.
- Without #453: Testing tools → Launch VR → Reset E-stop.

### Where each step lives on the session page

The session page `/data-collection/<id>` has one command bar on top: every normal
action on the left (Testing tools in Set up and Record, End session in Record),
the E-STOP alone on the right (one click, or Esc Esc).

- **Start / Stop / Restart robot side:** Get ready step 1 "Start the robot
  side". Restart replaces Start when a process runs stale code. Stop robot side
  is under step 1's Details while the robot side runs, behind a confirm. The
  readiness rows (Robot LAN, bridge, sidecar, agent) and **Bring up LAN** are
  under the same Details.
- **Take control, then Switch to arm control** (`arm_sdk`, confirmed): step 2.
- **Reset E-stop; Zero torque → Limp → Stand up → Balance:** step 3.
- **Connect the Quest / Open on headset:** step 4. The Quest must be on the LAB
  PC's USB (the PC the supervisor runs on).
- **Operator enters VR:** step 5. In the headset the operator presses Launch VR,
  Take control and Enter VR; a chime sounds when they are in.
- **Start session:** Get ready's primary, once every step is done.
- **The Record console:** Start take / Stop take (Space), Next take (N), Discard
  (Backspace), a status strip at the bottom, E-STOP alone top right (Esc Esc).
- **Wrap up:** one summary band, **Create dataset**.
- **Keyboard teleop (step 5 below)** is not on the session page. It is still on
  the robot's Teleop tab, `/robots/g1-edu-4?tab=teleop`, whose readiness panel
  keeps the old wording (Start robot side, Stop robot side, Take control, the
  confirmed arm_sdk switch). Once arm control is on and the robot balances, the
  session page gives its control back, so the Teleop tab can take it.

### Remote over Tailscale

- The desktop page is `http://100.111.233.0:1420` (the app that `neodem-dev-up`
  starts). See `docs/data-collection-two-person.md`, "Remote testing over
  Tailscale".
- Keyboard teleop measured 18–34 ms over a direct Tailscale connection, well
  below the 300 ms heartbeat jitter at which a held joint pauses (a stutter).
  Steps 5–7 can run from a remote desktop.
- VR (step 8) needs the Quest on the lab PC's USB. The lab PC runs no SSH
  server, so the runbook's SSH tunnel is not available. Tailscale HTTPS
  certificates are off on the tailnet (CertDomains empty), so there is no
  secure remote origin for WebXR either.
- Someone must be at the robot with the remote the whole time, wherever the
  desktop is.

### Steps (in this order)

**1. Link flap during Start (TASK-423, #446).** After the cold boot the robot
side is stopped. Work in Get ready step 1, with its Details open.

- **Pull the cable at the ROBOT end, never at the PC's network card.** Incident
  on 2026-10-30:
  - At 15:48 both NICs of the lab PC lost link at once. The robot NIC is an
    Aquantia AQC113 10G card at PCIe `0000:83:00.0`, behind root port `80:1d.0`
    (ACPI RP09).
  - At 16:09 the PC froze with nothing logged.
  - After a warm reboot the card was missing ("retraining failed", link
    width 0). A cold power-off with the PSU switched off brought it back.
  - If `enp131s0` is missing (`ip -br link | grep enp131`): do a cold power-off.
    `sudo ~/.local/bin/robot-nic-recover` prints the kernel lines and retries the
    link on that root port only. After the power-off, run `neodem-dev-up` again.
  - Cause unknown. Check the card's seating and cooling: it sits near an RTX
    5090.
- 1a. Pull the `enp131s0` cable (robot end) **first**, then press **Start robot
  side**. Expect the Robot LAN row pending with `carrier down · IP — · ping —`
  and the detail `waiting for carrier on enp131s0 — link down (N s of 15 s)`,
  counting up.
- 1b. Re-plug within about 5 s. You may briefly see
  `carrier on enp131s0 is back; waiting for 192.168.123.222`. Expect the step ok
  with `... the robot answers at 192.168.123.161 (the link was down at start;
  waited N s for it to come back)`, then camera, bridge, sidecar (`read_only`),
  agent. Write down how long NetworkManager took to restore the IP. If the step
  ends in `no_host_ip`, press **Bring up LAN** on the Robot LAN row and consider
  raising `timeouts.carrierS` in the profile.
- 1c. Press **Stop robot side** under Details and confirm. Leave the cable out
  and press **Start robot side**. After about 15 s expect failed `no_carrier`
  with `Robot cable unplugged or robot off (enp131s0 no carrier). Interface
  operstate: down. Waited 15 s for the link to come back.` and no bridge PID.
  Start again and, during the wait, press **Stop robot side** under Details and
  confirm: expect `aborted by stop` within about 1 s.
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
`balance_reported [501]`; `POST /loco/move` must answer 403. Then, in Get ready
step 2, press **Take control**, then **Switch to arm control** and confirm
(`arm_sdk`).

**3. Zero torque → Limp → Stand → Balance (TASK-423 #446, TASK-422 #445).**
Get ready step 3. Gantry at a hand's width of slack, feet flat. First press
**Reset E-stop** (see "Yesterday's E-stop is still latched").

- 3a. With the robot reading `Zero torque · FSM 0`, step 3 shows the strip
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
  `MODE stand: from limp(1) -> 4 confirmed in ...`, step 3 reads
  `Stand (locked) · FSM 4`. FSM 4 is not yet verified on this robot: if it reads
  anything else, press Limp. Wait at least 2 s.
- 3d. **Balance** and confirm: `MODE balance: from stand(4) -> 501 confirmed in ~0.2s`,
  step 3 reads `Balance · FSM 501` and `Bring-up done — the balance controller holds the robot.`
  No robot-mode hint line should appear (that hint is only for a 500 command).
  On a 504 step 3 shows only `Not confirmed — the robot reports ...`: press
  **Limp**, record it, do not retry by hand.
- 3e. Once 501 is confirmed, drop the hot-patch stash (Lab PC preparation 1).
- Caution: for any FSM id classed `other` (e.g. 801, or 500 on `g1-edu-4`), the
  strip rings Limp and says `Next: press Limp`. On a robot carrying its own
  weight, Limp drops it into the gantry slack; only the confirm dialog's gantry
  warning guards it. Check the slack before confirming any Limp.

**4. First /arm in FSM 501, watching the waist (TASK-422 #445, TASK-421 #444).**
Release, then squeeze (or the first keyboard press in step 5 arms it):

- The arms ramp in over 1.5 s from the measured pose (the `seed` in the `/arm`
  reply) with **no jump**, at the profile's 1.0 rad/s. A missing `seed` means a
  stale sidecar: Get ready step 1 then offers **Restart robot side**; press it.
- **Watch the torso.** On the 3-DoF waist, arm_sdk holds waist joints 12–14 at
  kp 300 / kd 3, weight 1. Look for the waist stiffening, the robot leaning, or
  the balance controller visibly fighting that hold. If so: E-stop, record it.
- The measured FSM must stay 501 for the whole session. Any other id disarms
  with `left_balance` (fails safe, but means 501 is not stable). If arm_sdk is not
  honoured in 501, expect a tracking-error disarm (0.35 rad for 0.3 s), not motion.

**5. Keyboard teleop on an arm joint (TASK-421, #444).** On the robot's Teleop
tab, `/robots/g1-edu-4?tab=teleop`, after pressing **Take control** there:

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
- Heartbeat jitter above 300 ms pauses the held joint (safe, looks like a
  stutter). Over a direct Tailscale connection it measured 18–34 ms, so this
  step can run remotely (see "Remote over Tailscale"); someone stays at the
  robot with the remote.
- Between presses the arms stay at weight 1 holding their target for as long as
  the tab heartbeats. By design; the E-stop person stays put.

**6. Close the tab while armed (TASK-421, #444).** Close the Teleop tab. Expect
`DISARM (request): weight 1.00 -> 0 over <= 1.0s` in the sidecar log within
about 1 s. If missing, the agent log should show
`[KeyboardTeleop] no heartbeat for 1000 ms`.

**7. E-stop in Balance (TASK-422 #445, TASK-421 #444).** Reopen the Teleop tab,
take control and re-arm with a key press, then latch the E-stop once while in Balance and armed (the session page's
E-STOP, top right): a DISARM, the robot damps (`SetFsmId(1)`), and `/arm`
answers 409 `estop_latched` until reset. Reset with **Reset E-stop** in Get
ready step 3 (without #453: Testing tools → Launch VR → Reset E-stop). After
the reset, a key held through it must not re-arm until released and pressed
again. Bring the robot back up Limp → Stand up → Balance in step 3 before
step 8.

**8. One short VR data-collection take, end to end.** Per
`docs/data-collection-two-person.md`: assistant on the session page
`/data-collection/<session id>`, operator on the Quest 3.

- Get ready: steps 1–3 are done; if arm control is off again, step 2 lights
  **Switch to arm control**. Step 4: plug the Quest into the lab PC's USB, then
  **Connect the Quest** and **Open on headset** (it opens
  `/data-collection/live?robot=g1-edu-4`). Step 5: the operator presses Launch
  VR, Take control and Enter VR in the headset.
- Press **Start session** and confirm. In the Record console press **Start
  take** (Space), move the arms with the grip clutch for a few seconds, then
  **Stop take** (Space), and keep it in the quick check.
- The dock's Frames must count up during the take. If it stays at 0, the agent
  is dropping every frame (`lastDropReason` in the agent's
  `/api/v1/robots/g1-edu-4/recording/status`, e.g. `teleop is not engaged`;
  the page does not say why yet, [[TASK-434]]).
- **End session** (command bar) and confirm. In Wrap up press **Create
  dataset**.
- The take must show in the session's take list and in the dataset. Do not run
  `xr_teleoperate` for this.

**9. Finish.** Release the grip (the arms disarm), then hoist the gantry until it
carries the robot. Wrap up has no mode control, so finish on the Teleop tab:
**Take control**, **Stop robot side**, and in its confirm press **Limp first,
then stop**. Record any deviations in Notes below and tick the criteria that
passed.

## Acceptance Criteria

- [ ] Step 0: Get ready walks the bring-up on the real robot: step 1 starts the robot side, step 3 shows yesterday's latch and Reset E-stop clears it, Limp → Stand → Balance confirms 501 on the page ([[TASK-427]], [[TASK-431]])
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
- Known issues filed on 2026-10-30, none of them blocks this run:
  [[TASK-432]] (the keyboard/gamepad fallback opens a socket on the hard-coded
  port 8766), [[TASK-433]] (the API server dies on a database timeout in a
  background job; `neodem-dev-up` works around it), [[TASK-434]] (session-page
  rough edges from the sim walkthrough) and [[TASK-435]] (the E-STOP cannot be
  clicked while a confirm dialog is open; see Preconditions 6).
