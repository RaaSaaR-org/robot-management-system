# Two-person data collection

*Added 2026-10-18 (TASK-414).*

Recording demonstrations on the G1 is a two-person job. One person wears the
Meta Quest 3 and drives the arms; the other sits at a desktop browser in
NeoDEM, watches the robot and runs the session. Both people see the same
session on their screen, and either of them can start, stop or discard a take.

## Roles

| Role | Where | Does |
| --- | --- | --- |
| **Operator** | Quest 3, inside VR, on `/data-collection/live?robot=<id>` | drives the arms (grip clutch), starts and stops takes from the session board or the sticks, and presses **B / Y** if anything goes wrong |
| **Assistant** | a desktop browser, on the session page `/data-collection/<session id>` | watches the twin and the camera, reads the operator card, starts, stops and discards takes, keeps notes, and presses **E-STOP** if anything goes wrong |

Both people can press the take buttons and the E-STOP. Changing the robot's
mode (Limp, Stand up, Balance) still needs the control lease, and the operator
in the headset holds it. The assistant cannot take the lease away from the
operator.

## What the assistant sees

The session page on a desktop (1024 px wide or more) has three areas:

- **Left:** the robot twin. It moves at the robot's fast telemetry rate
  (about 10 Hz). While the operator is in VR, two translucent **ghost hands**
  show where the operator wants the robot's hands to be, and a small wireframe
  pyramid at the robot's eyes shows where the operator is looking. A ghost
  hand that stays away from the robot's real hand means the arm is not
  following.
- **Right, top:** the head camera, then the session HUD with the big
  `● REC` / `READY` state, the take timer, and the number of takes kept.
  From two kept takes in a row, the HUD also shows the streak ("5 kept in a
  row").
- **Right, middle:** the **Operator** card. It shows `In VR · link live 38 ms`,
  a grip bar for each hand (filled in the accent colour while that grip
  clutches the arm), the headset's own why line (amber for a warning, red when
  the arm is blocked), and `held: <reason>` when the robot refused an arm.
- **Right, bottom:** the take controls and the list of takes, the robot-side
  readiness panel, and the quality panel.
- **Header:** who is in the session ("Anna · headset", "Ben · desktop"), who
  holds the robot's control lease (read only), and the **E-STOP**.

The headset shows `ROBOT · WATCHING Ben (desktop)` as the robot panel's
title, so the operator knows someone is watching.

## Setup

1. **Start the robot side.** On the robot's page, or in the session's
   readiness panel, press **Start robot side**. See
   [Start the robot side from NeoDEM](g1-edu-lab-bringup.md#start-the-robot-side-from-neodem-task-403).
2. **Connect the Quest.** Plug the Quest into the robot PC over USB and press
   **Connect** (this runs `adb reverse` for the page port).
3. **Open the session on the headset.** Press **Open on headset**. The Quest
   browser opens `/data-collection/live?robot=<id>`, which always lands on the
   robot's live session. Put on the headset, press **Launch VR**, then
   **Enter VR**. The Enter VR press has to happen inside the headset, because
   WebXR only starts after a user gesture.
4. **The assistant opens the session.** Press **Copy viewer link** and open
   the copied link on the desktop. While no headset is in VR, the Operator card
   reads "Waiting for the headset" and shows the same buttons.

When the operator enters VR, the assistant hears a soft chime, and the
Operator card switches to `In VR`.

## Who presses what

### In the headset

| Control | Does |
| --- | --- |
| **B / Y** | **E-STOP**, on either hand and either button |
| Pinch (thumb to little finger), both hands, hold | E-STOP when you hold no controller |
| Grip | Hold to take that arm. Release it and the arm holds its pose |
| Trigger (grip held) | Close the hand |
| Trigger (grip free) | Point at a panel and pull to press a button. Hold **Reset E-stop** for 1 s |
| A / X | Recenter the view inside the robot's head |
| L-Stick click | Start a take. Click again to stop it |
| R-Stick click | End this take and start the next one |
| R-Stick, hold 1.5 s | Discard the last take (three ticks) |
| Session board (left of the robot) | Start / Stop, Next, Discard last (hold 1 s) |

### At the desktop

| Key | Does |
| --- | --- |
| **Escape** twice within 1 s | **E-STOP** (the red button in the header does the same) |
| Space | Start or stop a take (Start session before the first take) |
| N | Next take |
| Backspace | Discard the last take. You can undo it for 5 s |
| E | End the session (asks first) |

When the session ends, a toast sums it up: takes kept, total minutes, and the
best streak.

## What the warnings mean

| You see | Means | Do |
| --- | --- | --- |
| Operator card, red: "E-stop is latched. Reset it." | Someone pressed B / Y or the E-STOP. Every take button is disabled | Check that everyone is clear, then reset the E-stop from the desktop banner or with **Reset E-stop** (hold 1 s) in the headset |
| Operator card, red: "Arm refused …" and `held: arm_gate` | The robot refused an arm, for example because it is not in Balance | Read the line. Most often: switch the robot to Balance, then release and squeeze the grip again |
| Double low tone during a take | The operator's arms have been blocked for more than 1 s while a take is recording. The take is still recording | Stop the take and discard it if the motion is spoiled |
| Falling low tone, the card shows `link lost` | The headset lost its link to the robot agent. The arms hold and the dead-man hands them back | Wait for the link to come back, or end the take |
| `link stale` (amber) | The link is slow; frames are late | Move closer to the Wi-Fi access point, or use USB |
| Operator card: "Waiting for the headset" | No headset is in VR on this session | Open the live link on the Quest (Setup, step 3) |
| HUD `Degraded` | The robot agent is unreachable; frames are being missed | Check the agent in the readiness panel |

All of the operator information is display only. The server passes the
operator's state on to the other browsers, and it never sends any of it to
the robot.

Related: [VR teleoperation data collection](vr-teleop-data-collection.md) (the
single-operator runbook and the real-robot path) ·
[G1 EDU lab bringup](g1-edu-lab-bringup.md).
