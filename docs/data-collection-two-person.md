# Two-person data collection

*Added 2026-10-18 (TASK-414). Updated 2026-10-19 (TASK-420): the whole session
in order, takes and the quick check, and remote testing over Tailscale. Updated
2026-10-30 (TASK-426 to TASK-429): the session page as a live console in three
phases (Set up, Record, Wrap up).*

Recording demonstrations on the G1 is a two-person job. One person wears the
Meta Quest 3 and drives the arms; the other sits at a desktop browser in
NeoDEM, watches the robot and runs the session. Both people see the same
session on their screen, and either of them can start, stop or discard a take.

A session is open-ended: you do not choose a number of episodes up front. You
record takes until you press **End session**. Each take runs from **Start take**
to **Stop take**, or until the optional auto-stop ends it.

**Once per machine, before the first session:** the robot supervisor runs as a
systemd user unit on the robot PC, and the lab's `server/.env` points at it. See
[Install (once, no sudo)](g1-edu-lab-bringup.md#install-once-no-sudo). To
rehearse without the robot, use the sim robot `sim-g1-edu-dev`
([Rehearsal against the MuJoCo DDS sim](g1-edu-lab-bringup.md#rehearsal-against-the-mujoco-dds-sim)).
The steps below are the same for both robots.

## Roles

| Role | Where | Does |
| --- | --- | --- |
| **Operator** | Quest 3, inside VR, on `/data-collection/live?robot=<id>` | drives the arms (grip clutch), starts and stops takes from the session board or the sticks, and presses **B / Y** if anything goes wrong |
| **Assistant** | a desktop browser, on the session page `/data-collection/<session id>` | watches the twin and the camera, reads the operator chip, starts, stops and discards takes, keeps notes, and presses **E-STOP** if anything goes wrong |

Both people can press the take buttons and the E-STOP. Changing the robot's
mode (Limp, Stand up, Balance) still needs the control lease, and the operator
in the headset holds it. The assistant cannot take the lease away from the
operator.

## What the assistant sees

The session page is a live console with one layout per phase of the session:
**Set up** (the session is created, nothing records yet), **Record** (the
session is recording or paused) and **Wrap up** (completed or failed). In every
phase exactly one button carries the bright primary fill, and it is the next
thing to do.

**The command bar, in every phase.** One bar at the top of the page stays in
place while the page scrolls. On its left: the back arrow, the task (the
session's name), the status tag, and the robot, input and frame rate. Right
after them sit the normal actions: who is in the session ("Anna · headset",
"Ben · desktop", one avatar each), the sound-cue mute (Record), **Testing
tools** (Set up, Record) and **End session** (Record only, asks first). On the
far right, alone in its own zone, is the **E-STOP**: one press, no
confirmation, and no other control within 64 px of it, so it is never hit by
accident and never missed. A 2 px line on the bar's top edge tells the room
the state from across it: amber while getting ready (mint once every step is
done), breathing red while a take records, quiet grey between takes, red on a
fault, mint when the session is complete.

**Testing tools** is a button on the bar that opens one popover holding the
developer tools: Simulate VR input (a "Simulated input" tag then shows in the
bar), the desktop VR window with **Launch VR**, the keyboard fallback and the
joint states. None of them is needed for a normal session.

**On a phone** (below 640 px) the E-STOP is a bar pinned to the bottom of the
screen that holds nothing else; End session, Testing tools and the mute move
into the bar's ⋯ menu, and the phase's own action stays in the page.

**Set up** is a "Get ready" checklist in bring-up order, next to a preview of
the robot twin and the head camera:

1. **Start the robot side**
2. **Switch to arm control** (Take control, then Switch to arm control)
3. **Stand up and balance** (Limp, Stand up, Balance)
4. **Connect the Quest** (Connect, Open on headset, Copy viewer link)
5. **Operator enters VR**

The current step is the first one not done; it is expanded and holds the
page's one primary button. A step after a failed one reads "Waits for step N",
and a problem is stated once, in the step it belongs to. **Start session**
sits under the steps: secondary while steps are open, primary once all are
done.

**Record** is one console that fits the screen: from 1024 px wide the page does
not scroll while you record (the console never gets shorter than 520 px, so
only a window shorter than that scrolls), and an alarm banner above it shrinks
the console, never the page.

- **The live view** leads with the head camera. The twin, with the operator's
  ghost hands, is the picture-in-picture in a corner; its swap button trades
  the two. A switch on the picture picks the twin or any camera the robot
  serves, and **Expand the view** takes it full screen. While a take records,
  the view is ringed in red. On a VR session the operator chip sits on its
  bottom-left: the operator's initials, the link latency (mint; amber when the
  link is stale, `Link lost` in red) and the grip bars L and R, each filling
  mint while that grip holds the arm.
- **The systems strip** under the view is the Set up checklist folded into
  cells: Robot side, Control, Arm control, Mode, Headset, Arms and Hands on a
  VR session (Robot side, Control and Input otherwise). Each cell is a dot and
  a short value, amber when it needs attention and red when it failed. A click
  opens that step's controls from Set up in a popover (Start robot side, Take
  control, Switch to arm control, Limp / Stand up / Balance, the Quest
  buttons), so every control stays one click away. On a phone the strip is one
  summary row ("All 7 systems ok", or the worst cell) that expands it.
- **The take dock** on the right, under the E-STOP: the state (`● REC`,
  `READY` or `PAUSED`) and the take number, the big take timer (with
  "Auto-stop in N s" under it when an auto-stop is set), **Start take** /
  **Stop take** (Space), **Next take** (N) while a take records, **Discard**
  (⌫) for the last take, and the readouts: session time, frames, frame rate,
  takes kept and the Motion meter.
- **The dock's slot** shows one thing, in this order: the **recovery** when
  the E-stop is latched or the robot is not in Balance ("E-stop is latched.",
  or "The robot is in Stand. The arms follow only in Balance."), with
  **Reset E-stop** first while a stop holds, then Limp, Stand up and Balance;
  else a **blocker**: frames being missed, a
  readiness problem with a button that opens its cell, the headset's arms
  blocked, or jerky motion; else, after each take, the **quick check**, in the
  timer's place.
- **The takes list** under the dock, newest first: a thumbnail, the length and
  frames (or "Recording" with the timer for the live take), what moved, dropped
  frames, who started it, and a trash button that asks first. It scrolls
  inside its column.

**Wrap up** is one summary band: "Session complete" (or "Session failed" with
the reason), one sentence on when it ended and what was kept, five readouts
(takes kept, recorded time, frames, frame rate, motion) and one action in its
own column: **Open dataset** when the session was packed into one, **New
session** when it recorded no frames, otherwise **Create dataset**. Under the
band: the takes table (a thumbnail, length, frames, dropped, frame rate, the
body parts that moved, who started it and the input) and a details list (the
task with **Edit**, robot and input, start and end, the session id, and the
dataset).

The headset shows `ROBOT · WATCHING Ben (desktop)` as the robot panel's
title, so the operator knows someone is watching.

## Setup

0. **Create the session** (assistant). Data collection → **New session**: pick
   the robot, the task and the input device. There is no episode count. Under
   the advanced options, **Stop each take automatically after (s)** sets the
   optional auto-stop (5–600 s); leave it empty and the operator ends each take.
   The session page opens in **Set up**, on the "Get ready" checklist: steps
   1–6 below are its five steps, in the same order.
1. **Start the robot side** (Get ready step 1). In the step, on the robot's
   **Teleop** tab, or under the robot field of **New session** when the robot
   is offline, press **Start robot side**. It always starts read-only. See
   [Start the robot side from NeoDEM](g1-edu-lab-bringup.md#start-the-robot-side-from-neodem-task-403).
2. **Switch to arm control** (Get ready step 2). In the step, or on the
   robot's **Teleop** tab, press **Take control** (it connects the page to the robot agent and
   takes the control lease), then **Switch to arm control** and confirm. The
   sidecar restarts in `arm_sdk`; nothing moves yet.
3. **Stand the robot up** (Get ready step 3, "Stand up and balance"). If the
   E-stop is latched (the robot comes back latched from an E-stop before a
   restart), step 3 says so with the reason and leads with **Reset E-stop**.
   That clears the latch in the robot agent and the sidecar and moves nothing;
   the robot stays damped. Check that everyone is clear before pressing it, and
   wait until steps 4 and 5 stop reading "Waits for step 3". Then, in the
   step (or the VR window on the robot's Teleop tab), press **Stand up** and confirm, wait until the robot measures
   Stand, then **Balance** and confirm. Before Stand up, lower the gantry until
   both feet are flat on the floor with a hand's width of slack — the robot must
   **not** hang in the gantry. Start from Limp: Stand up from zero torque (FSM 0)
   is refused (`bad_transition`), so press **Limp** first if the mode reads
   zero torque. Balance is FSM 501 on g1-edu-4 (3-DoF waist), set in its
   profile; see [the balance id](g1-edu-lab-bringup.md#what-the-sidecar-does).
   Stand up uses FSM id 4, which is not yet verified on the robot: watch the
   robot, and keep the remote's L1+A / the E-STOP within reach.
4. **Connect the Quest** (Get ready step 4). Plug the Quest into the robot PC over USB and press
   **Connect** (this runs `adb reverse` for the page port). **Connect** and
   **Open on headset** run `adb` on the robot PC, so they only work for a Quest plugged into that PC. For a Quest on another computer
   see [Remote testing over Tailscale](#remote-testing-over-tailscale).
5. **Open the session on the headset** (Get ready step 4). Press **Open on
   headset**. The Quest
   browser opens `/data-collection/live?robot=<id>`, which lands on the robot's
   live session: a session that is recording or paused, or a READY one created
   in the last 4 hours. With exactly one such session it opens it; with more it
   lists them and the operator picks one; with none it waits, looks again every
   2 s, and names any older READY session it is ignoring. So the headset can be
   opened before the session exists.
6. **Enter VR** (operator, inside the headset; Get ready step 5, "Operator
   enters VR", turns done when the headset is in VR). Press **Launch VR**, then
   **Take control**, then **Enter VR**. Enter VR stays disabled until this
   headset holds the control lease. The robot never takes a held lease away,
   so the desktop has to give its own back first: the session page does that
   on its own as soon as arm control is on and the robot balances (steps 2
   and 3 done), and when the session starts. If it still holds control after
   that (you took it again), its Set up steps show **Release control**, lit in
   the current step; press it before the operator presses Take control. A
   Teleop tab releases when you leave it.
   The Enter VR press has to happen inside the headset, because WebXR only
   starts after a user gesture.
7. **The assistant opens the session.** Press **Copy viewer link** (Get ready
   step 4) and open the copied link on the desktop. While no headset is in VR,
   step 5 reads "Waiting for the headset".
8. **Start session** (assistant, or Space on the desktop), in the start bar
   under the steps. You can start with steps still open; it asks first.
   Starting records nothing yet: it opens the session for takes, and the page
   switches to **Record**.

When the operator enters VR, the assistant hears a soft chime, Get ready step 5
turns done ("… is in VR"), and in Record the **Headset** cell reads `In VR`.

## Recording takes

Either person starts, stops and discards takes: the assistant with the take
buttons or the keys below, the operator with the sticks or the session board
left of the robot. Both views show the same take within about a second, and a
toast says who did what ("Take 5 started from the headset", "Anna discarded
take 4").

- **Start take** → the take dock shows `● REC`, the take number and the take
  timer. With an auto-stop set, it also counts down "Auto-stop in N s".
- **Stop take** → the quick check appears in the take dock (below).
- **Next take** ends the take that is recording and starts the next one.
- **Discard** (the take dock's, for the last take) throws it away. On the
  desktop the button turns into **Undo discard** for 5 s; the discard is only
  sent when that window closes. In the headset it
  is a hold (R-stick 1.5 s, or the board button 1 s), never a click.
- **End session** (desktop only, asks first) ends the session; a toast sums up the takes kept,
  the total minutes and the best streak.

**The quick check after every take.** When a take stops, the quick check takes
the timer's place in the take dock, and the headset's session board shows the
same check: a thumbnail, the length, frames and frame rate, which body parts
moved (arms, hands), the five joints that moved most (behind **Top 5 joints**
on the desktop), and the robot's warnings (**Short**, **No motion**,
**Dropped frames**). **Keep** is the default and only dismisses the check;
**Discard** throws the take away. A take that is short or did not move turns
the check's border red and puts the focus on Discard, but nothing is ever
discarded automatically. The check stays until Keep, a discard, or the next
Start, and starting the next take keeps it: the dock says so ("Starting take 6
keeps take 5.").

**An E-stop during a take** stops and discards that take at once. Every view
says "Take N stopped by the E-stop — discarded", and the take is not in the
exported dataset. The next take after the reset records normally.

**Stopping for the day.** On the robot's Teleop tab press **Stop robot side**.
While the robot stands or balances, the dialog offers **Limp first, then stop**
(when it is disabled, press **Take control** next to it first): it switches the
robot to Limp, waits until the robot measures Limp, and only then stops the robot
side.
Hoist the gantry until it carries the robot before you press it — gantry
first, then Limp.

## Who presses what

### In the headset

| Control | Does |
| --- | --- |
| **B / Y** | **E-STOP**, on either hand and either button |
| Pinch (thumb to little finger), both hands, hold | E-STOP when you hold no controller |
| Grip | Hold to take that arm. Release it and the arm holds its pose |
| Trigger (grip held) | Close the hand |
| Trigger (grip free) | Point at a panel and pull to press a button. Hold **Hold 1 s to reset** for 1 s after an E-stop, or **Hold to allow …** when the desktop asks for a mode |
| A / X | Recenter the view inside the robot's head |
| L-Stick click | Start a take. Click again to stop it |
| R-Stick click | End this take and start the next one |
| R-Stick, hold 1.5 s | Discard the last take (three ticks) |
| Session board (left of the robot) | Start / Stop, Next, Discard last (hold 1 s) |

### At the desktop

| Key | Does |
| --- | --- |
| **Escape** twice within 1 s | **E-STOP** (the red button alone at the right end of the command bar does the same; on a phone, the bar pinned to the bottom) |
| Space | Start or stop a take (Start session before the first take) |
| N | Next take |
| Backspace | Discard the last take. You can undo it for 5 s |
| E | End the session (asks first) |

When the session ends, a toast sums it up: takes kept, total minutes, and the
best streak, and the page switches to **Wrap up**: press the band's one action,
**Create dataset**, to pack the kept takes into a dataset (or **Open dataset**
once it exists).

## After an E-stop

An E-stop damps the base, and the arms stay refused until the robot is back in
Balance. The operator stays in VR the whole time: the assistant, who can see
the robot, asks for each mode from the desktop, and the operator allows it in
the headset. The change is sent from the headset, under the operator's own
control lease, through the same confirmed route as the desktop buttons.

| Step | Who | Where | Presses |
| --- | --- | --- | --- |
| 1 | Operator, or assistant | headset, robot panel; or the take dock | **Hold 1 s to reset** (trigger, 1 s). The panel turns from red to dark. On the desktop: **Reset E-stop** in the take dock |
| 2 | Assistant | session page, the take dock's recovery | **Ask the headset: Stand up**, then confirms. The dock shows "Waiting for the operator… (10 s)" |
| 3 | Operator | headset, robot panel | **Hold to allow Stand up** (trigger, 1 s), under "DESKTOP ASKS: Stand up" |
| 4 | Assistant | session page | **Ask the headset: Balance** once the robot has stood for 2 s, then confirms |
| 5 | Operator | headset | **Hold to allow Balance**, then release and squeeze the grip to take the arm again |

Rules the relay keeps:

- Only **Stand up** and **Balance** are ever asked for. **Limp** stays a direct
  desktop button and needs the lease. Walking is never offered.
- No prompt appears in the headset while the E-stop is latched, while the
  headset does not hold control, or for a mode that is not next (Stand up only
  from limp, Balance only from stand). The desktop then hears "declined" at once.
- A request the operator does not allow within 10 s expires, and the desktop
  page says so. One request per session every 2 s.
- The server only carries the question and the answer. It never calls the
  robot or the mode route itself.
- **B / Y** and the desktop **E-STOP** work at every step.

## What the warnings mean

| You see | Means | Do |
| --- | --- | --- |
| Take dock, red: "E-stop is latched."; the **Arms** cell red | Someone pressed B / Y or the E-STOP. Every take button is disabled, and a take that was recording is discarded | Check that everyone is clear. Then the operator holds **Hold 1 s to reset** on the headset's robot panel, or the assistant presses **Reset E-stop** in the take dock. After that, see [After an E-stop](#after-an-e-stop) |
| Take dock, red: "Protective stop." | The robot reports a protective stop, but neither the robot agent nor the sidecar holds a latch | Press **Reset E-stop** in the take dock. It clears the stop and moves nothing |
| Take dock or the **Arms** cell, red: "Arm refused …" and `held: arm_gate` | The robot refused an arm, for example because it is not in Balance | Read the line. Most often: switch the robot to Balance, then release and squeeze the grip again |
| Double low tone during a take | The operator's arms have been blocked for more than 1 s while a take is recording. The take is still recording | Stop the take and discard it if the motion is spoiled |
| Falling low tone, the operator chip shows `Link lost` | The headset lost its link to the robot agent. The arms hold and the dead-man hands them back | Wait for the link to come back, or end the take |
| `link stale` (amber) | The link is slow; frames are late | Move closer to the Wi-Fi access point, or use USB |
| Get ready step 5: "Waiting for the headset" (in Record, the **Headset** cell: `No headset`) | No headset is in VR on this session | Open the live link on the Quest (Setup, step 5) |
| Take dock: "Frames are being missed." | The robot agent is unreachable; frames are being missed | Check the agent in the **Robot side** cell |

All of the operator information is display only. The server passes the
operator's state on to the other browsers, and it never sends any of it to
the robot.

## Remote testing over Tailscale

To try the flow from a laptop that is not in the lab, reach the lab PC (the one
running `npm run dev` in `app/` and `server/`) over Tailscale. Use the sim robot
`sim-g1-edu-dev` for this, never the real one, unless people are at the robot.

**Only port 1420 is needed.** The Vite dev server proxies `/api`, including the
event socket and the teleop socket, to the server on :3001
(`app/vite.config.ts`), and the app builds every API and WebSocket URL from the
page's own origin. The head camera and the take thumbnails also come through
`/api`. Forward :3001 as well only if the app was started with
`VITE_API_BASE_URL` or `VITE_WS_URL` pointing at it (the default leaves both
unset).

- **Desktop only (no VR):** `http://<tailscale-ip>:1420` works as is, because
  the dev server listens on every interface. WebXR is not available there: the
  page is not a secure origin, so there is no Enter VR and no `?xremu`.
- **With VR, through an SSH tunnel** (on the laptop):

  ```bash
  ssh -N -L 1420:localhost:1420 <user>@<tailscale-ip>
  ```

  Then open `http://localhost:1420`. `localhost` is a secure origin, so WebXR
  works.
- **Emulated Quest (no headset):** in a second browser window, open the session
  page itself with `?xremu`, e.g.
  `http://localhost:1420/data-collection/<session id>?xremu`. The WebXR emulator
  then simulates a Meta Quest 3 in that tab, and **Enter VR** works without a
  headset. It only runs in the dev build and only on `localhost` /
  `127.0.0.1`. Open the session URL directly: the live link redirects without
  the query. The first window is the assistant's desktop view.
- **A real Quest plugged into the laptop:** keep the tunnel open, then forward
  the headset's port 1420 to the laptop over USB — `adb reverse tcp:1420
  tcp:1420`, or `./scripts/quest-connect.sh` from a checkout on the laptop. In
  the Quest browser, open `http://localhost:1420/data-collection/live?robot=<id>`.
  The chain is Quest → laptop :1420 → SSH tunnel → lab PC :1420. The
  readiness panel's **Connect** and **Open on headset** do not apply here: they
  run `adb` on the robot PC and only see a Quest on its USB.
- **Fallback without a tunnel:** in desktop Chrome, enable
  `chrome://flags/#unsafely-treat-insecure-origin-as-secure`, add
  `http://<tailscale-ip>:1420`, and relaunch. The page then counts as secure
  and WebXR is offered. `?xremu` still stays off, because the host is not
  `localhost`.

Related: [VR teleoperation data collection](vr-teleop-data-collection.md) (the
single-operator runbook and the real-robot path) ·
[G1 EDU lab bringup](g1-edu-lab-bringup.md).
