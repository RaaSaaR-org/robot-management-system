---
id: "TASK-417"
aliases: []
title: "The operator recovers from an E-stop and sees why the arms stopped without taking the headset off"
slug: "the-operator-recovers-from-an-e-stop-and-sees-why-the-arms"
status: in-progress
priority: 1
owner: "huhn511"
projects: []
customers: []
tags: ["core", "vr", "teleop", "safety"]
sprint: ""
parent: ""
depends_on: []
spe: 5
effort: "high"
due_date: ""
created: "2026-10-18"
updated: "2026-10-18"
---

# The operator recovers from an E-stop and sees why the arms stopped without taking the headset off

## Description

After a VR E-stop on the G1, the base is damped. The arms stay refused until the robot is back in Balance. Today getting there takes all of this:

- the operator exits VR, which drops their control lease;
- they take control again, confirm Stand up, confirm Balance;
- they re-enter VR and re-squeeze.

The desktop assistant cannot help, because the operator holds the lease. Several in-VR texts name buttons that only exist on the 2D page ("press Stand", "Press Take control", "switch to Balance"). The robot panel puts the reason last, at the same size as low-value status lines.

Make the most stressful moment the easiest. The assistant, who watches the robot, asks for Stand up or Balance from the desktop. The operator allows it with a hold inside the headset. Every in-VR message names a button that exists in the headset, or names the person who acts. The panel and the HUD lead with the reason.

## Details

### Current state

- **No mode buttons in VR, by design.** `app/src/features/robots/components/RobotModeControl.tsx:1-8` (TASK-398) says: "there are no mode buttons inside the headset (a confirmation needs a mouse and a second person watching the robot)". TASK-414 D4 says: "Changing robot mode still needs the lease. Rejected: an assistant takeover of the lease."
- **The desktop is locked out.** On the session page the Robot mode card (`app/src/features/datacollection/pages/SessionDetailPage.tsx:547-553`, `data-testid="session-robot-mode"`) renders `<RobotModeControl robotId lease baseMode/>`. While the headset holds the lease, its buttons are disabled with "Take control first".
- **The headset's robot panel.** `app/src/features/robots/components/tabs/vr/VrRobotPanel.tsx` mounts only Recenter and Reset E-stop (hold 1 s, label "Reset E-stop", `holdLabel="Hold…"`).
- **Texts that point at missing buttons:**
  - `vrHud.ts:62-66`: "ROBOT LIMP — use the desktop window" and "BASE DAMPED — press Stand".
  - `vrWhy.ts:181`: "E-stop is latched. Reset it, then switch to Balance."
  - `vrWhy.ts:129`: "Nobody has taken control. Press Take control."
- **The robot panel** (`vrWhy.ts:362-398` `composeRobotPanel`, rendered at `linePx={52}` on a 0.5 x 0.244 m plate, `VrRobotPanel.tsx:146-153`):
  - eight equal rows: MODE, ARMS, GRIP, HANDS, LEASE·LINK, and the why line last;
  - shows "MODE unknown" in sim and "ARMS no arming needed";
  - shows an RTT that freezes while idle ("LINK live 234 ms" long after the last pose);
  - shows internal codes ("HELD R: ik_held").
- **The wrist HUD** (`vrHud.ts:313-322`) shows `LINK LIVE 4497ms` in green, rising while idle (`msSinceState` counts up when no pose is outstanding). It never says that B/Y is the E-stop until after a stop.
- **The 2D modal before control** (`VRTeleopModal.tsx`, readiness banner): "Ready (simulation). Squeeze a grip to drive that arm." It shows next to "OBSERVING — NOBODY HAS CONTROL" and a greyed Enter VR.
- **Existing relay** (TASK-414): the app socket `/api/a2a/ws` carries `teleop:watch`, `teleop:operator` and `teleop:session:presence` (`server/src/websocket/index.ts:~201,~695`, `server/src/websocket/sessionPresence.ts`, wire types in `app/src/shared/utils/sessionWatch.ts`). The headset sends `teleop:operator` from `vr/useOperatorPublisher.ts`.

### Server (`server/src/websocket/index.ts`, `sessionPresence.ts`)

- New client → server message `{type:'teleop:mode-request', sessionId, mode:'stand'|'balance', requestId}`. It is accepted only from a socket that declared `role:'assistant'` for that session.
- The server relays it as `teleop:mode-request` to the session's declared operator socket only. It answers the assistant with `teleop:mode-request:rejected` (`no_operator` | `not_assistant` | `invalid`) when it cannot.
- `{type:'teleop:mode-request:answer', sessionId, requestId, outcome:'allowed'|'declined'|'expired'|'failed', error?}` from the operator socket is relayed back to the assistant.
- The relay never calls the robot or the base-mode route. It carries a question and an answer, nothing else. Validate with zod, cap payloads, and rate-limit to 1 request per 2 s per session.

### Frontend: desktop

- `RobotModeControl` gets an optional `requestFromHolder?: (mode) => Promise<Outcome>`. When the lease is held by someone else, the session's operator is present and in VR, and the button would otherwise be enabled by mode and E-stop state, Stand up and Balance become "Ask the headset: Stand up" / "Ask the headset: Balance".
- They keep the existing confirm dialog, now worded "the operator confirms in the headset".
- The card shows "Waiting for the operator… (10 s)" and then the outcome. Limp is never relayed: Limp stays lease-gated as today.
- `SessionDetailPage.tsx` passes `requestFromHolder` to the Robot mode card only. Keep the edit to that block, because TASK-418/419 touch other parts of this file.

### Frontend: headset

- When a `teleop:mode-request` arrives, the robot panel shows a prompt line "DESKTOP ASKS: Balance" and one hold button "Hold to allow Balance" (`holdMs` 1000, `tone` normal). It expires after 10 s.
- Allowing it calls the same base-mode request `RobotModeControl` uses (`useRobotBaseMode` → the lease-checked route) with the headset's own grant, then answers `allowed`/`failed`. Letting it expire answers `expired`.
- The prompt never appears during a latched E-stop, without the lease, or for a mode the measured state does not allow next (Stand up only from limp/damped, Balance only from stand).
- Wire the handler from `VRTeleopModal.tsx` into `VrRobotPanel.tsx` (new prop). Do not change the panel's placement constants (`VrRobotPanel.tsx:33-45`), which TASK-418 owns.

### Frontend: texts and order

- `vrWhy.ts` texts:
  - estop + controlled: "E-stop latched — hold Reset for 1 s. Then the desktop asks for Balance."
  - estop uncontrolled: "E-stop latched — hold Reset for 1 s."
  - limp/damped while controlled: "Robot limp — the desktop asks for Stand up, then Balance."
  - lease in VR: "You lost control — exit VR and press Take control."
  - Keep each at most 72 characters.
- `vrHud.ts`:
  - "ROBOT LIMP — desktop asks for Balance" and "BASE DAMPED — desktop asks for Stand";
  - a permanent compact `B/Y = STOP` tag in the HUD's last row;
  - `LINK OK` while no pose is outstanding (same rule as `meterLink`), and the age only while poses are outstanding.
- `VrRobotPanel.tsx`: the reset button label becomes "Hold 1 s to reset" (`holdLabel` stays "Hold…").
- `composeRobotPanel`:
  - the why line comes **first**, about 1.5x larger (2 wrapped rows max);
  - then one compact row of chips showing only the non-ok facts (MODE when not balance and mode-controlled, ARMS, GRIP held, LINK when not live, LEASE when not you);
  - drop "MODE unknown" when the robot has no mode control, "ARMS no arming needed" and the idle RTT;
  - replace held-reason codes with the `HELD_TEXT` words.
  - `VrPanel` supports per-line size; add it if it does not.
- `VRTeleopModal.tsx` readiness banner: before the lease is held, it reads "Take control, then Enter VR".

### Key files

- server/src/websocket/{index.ts, sessionPresence.ts} + `__tests__`
- app/src/shared/utils/sessionWatch.ts (wire types)
- app/src/features/robots/components/RobotModeControl.tsx + `__tests__`
- app/src/features/datacollection/pages/SessionDetailPage.tsx (Robot mode card block only)
- app/src/features/robots/components/tabs/vr/{VRTeleopModal.tsx, VrRobotPanel.tsx, vrWhy.ts, vrHud.ts, useOperatorPublisher.ts, VrPanel.tsx (per-line size only, if needed)} + `__tests__`
- docs/data-collection-two-person.md ("After an E-stop" section: who presses what)

Overlap with parallel tasks:
- TASK-418 changes `VrRobotPanel.tsx` placement constants and `VrPanel.tsx`/`VrButton.tsx` materials.
- TASK-419 edits other sections of `docs/data-collection-two-person.md`.
- Keep this task's edits to the regions named here.

## Decisions

- **D1 The desktop asks, the headset allows.** This keeps both earlier rules:
  - the request comes from the person watching the robot, with a mouse confirm (TASK-398);
  - the command is sent only with the lease holder's own grant, through the existing lease-checked route (TASK-414 D4: no lease takeover).
  - Rejected: free-standing Stand/Balance buttons in VR. Nobody watching would confirm.
  - Rejected: letting the assistant act under the operator's lease. That is a lease takeover.
- **D2 Only Stand up and Balance are relayed.** Limp stays a direct, lease-gated desktop action. Walking is never offered.
- **D3 The reason comes first.** A glance must find why the arms stopped. Status lines that are fine are not shown.

## Acceptance Criteria

- [ ] Server tests:
  - `teleop:mode-request` from a non-assistant socket is rejected;
  - with no operator → `no_operator`;
  - a request reaches only the declared operator socket;
  - answers reach only the requester;
  - the 2 s rate limit holds;
  - nothing calls the base-mode route.
- [ ] Live, two contexts, sim agent only:
  - A (IWER) holds the lease and latches the E-stop with B, then holds Reset;
  - B presses "Ask the headset: Stand up" and confirms; A holds "Hold to allow Stand up";
  - then the same for Balance;
  - A re-squeezes and the arm follows, all without A leaving VR. Record the total time; target under 15 s of script time.
- [ ] A request that A ignores expires after 10 s, and B's card says so. During a latched E-stop no prompt appears in VR.
- [ ] No in-VR text (vrWhy, vrHud, panel) tells the operator to press Stand, Balance or Take control inside the headset (unit test over all texts).
- [ ] The why line is the robot panel's first row. The idle RTT and `ik_held`-style codes are gone (vitest on `composeRobotPanel`).
- [ ] The wrist HUD shows `B/Y = STOP` at all times, and `LINK OK` without a number while idle.
- [ ] `npm run typecheck` (server), `npx tsc` (app), and the server and app vitest suites pass.

## Test Strategy

- **vitest:**
  - the relay (validation, routing, rate limit);
  - `RobotModeControl` in request mode;
  - the VR prompt state machine (arrive, allow, expire, suppressed during E-stop);
  - `composeRobotPanel` and the HUD composer snapshots.
- **Playwright live** with two contexts on branch app/server on free ports, sim robot, IWER `?xremu`. Screenshot the robot panel at 2064x2208 before and after for the PR.
- No real robot. The Stand up/Balance path is exercised only against the sim agent and sim sidecar.

## Safety constraints (binding for this task)

- Mode changes go only through the existing confirmed, lease-checked base-mode route, sent with the lease holder's grant. The relay carries no command.
- Never offer walking, Limp or zero-torque through the relay. Never show the prompt while an E-stop is latched.
- The E-stop stays reachable: B/Y and the two-hand pinch in VR, and the visible E-STOP on the desktop session page. Nothing in this task may delay or gate it.
- Never set `G1_READ_ONLY=0`, never use `G1_ARM_ALLOW_UNKNOWN_FSM=1`, never `kill -9` a sidecar, no DDS on domain 0.
- Development and tests use the sim stack only (branch builds on free ports). Never the real g1-edu-4 (:41245/:8767). Do not stop or restart the running dev stack.
