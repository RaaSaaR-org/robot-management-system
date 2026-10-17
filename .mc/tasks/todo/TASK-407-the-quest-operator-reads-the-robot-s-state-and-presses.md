---
id: "TASK-407"
aliases: []
title: "The Quest operator reads the robot's state and presses buttons inside VR"
slug: "the-quest-operator-reads-the-robot-s-state-and-presses"
status: "review"
priority: 1
owner: "huhn511"
projects: []
customers: []
tags: ["core", "g1", "teleop", "vr", "datacollection"]
sprint: ""
parent: ""
depends_on: []
spe: 8
effort: "high"
due_date: ""
created: "2026-10-17"
updated: "2026-10-17"
---

# The Quest operator reads the robot's state and presses buttons inside VR

## Description

Inside the headset the operator sees a five-line wrist HUD and nothing else. There are no buttons, no reason why the arms are not following, and a link readout that flickers between "Link lost" and "Link live" whenever an arm is refused.

This task adds three things:
- an in-VR UI toolkit: world-space text panels plus buttons pressed with a custom controller ray;
- a **robot panel** showing mode, arms, dead-man, grip, hands, lease, link and a one-line "why not following";
- a fix for the link flicker at its root.

TASK-413 builds the session panel on the same toolkit.

## Details

### Current state
Paths are relative to `app/src/features/robots/components/tabs/vr/`.
- **Libraries:** `@react-three/xr` / `@pmndrs/xr` 6.6.30, `@react-three/fiber` 9.4.2, `three` ^0.160.1.
  - No uikit is installed.
  - drei `<Text>` is avoided on purpose, because troika fetches a font over the network (`VrTextPlate.tsx:43-51`). All XR text uses `useTextPlate()` (`VrTextPlate.tsx:60`): a canvas → `CanvasTexture` plane, redrawn on change.
- **Tree:**
  - `VRTeleopModal.tsx:321` `VRTeleopModalBody` → `VrScene.tsx:72`.
  - `VrScene` holds `<Canvas><XR store>`, a yaw group (`RobotModel`, `HeadCameraPanel`), `VrOrigin` → `VrWristHud`, `Grid`, `OrbitControls`, and `VrTeleopRig`.
  - The XR store (`VRTeleopModal.tsx:424-438`) has every pointer off (`rayPointer:false` etc.).
- **Robot facts** come only from the agent teleop socket (`createTeleopLink` ~:747, `handleMessage` ~:508): `config`, `state`, `arm`, `heartbeat`, `control`, `estop`, `base`, `error`, `lease`.
  - They are copied into `telemetryRef` (`createRigTelemetry`, `VrTeleopRig.tsx:161`; type `VrRigTelemetry` ~:74) by the meters effect (`VRTeleopModal.tsx:710-720`).
- **Wrist HUD** (`VrWristHud.tsx`, `vrHud.ts` `composeHud` ~:297) is capped at `HUD_MAX_LINES = 5` (`vrHud.ts:52`).
- **Controller map** (`VrTeleopRig.tsx`):
  - grip ≥ 0.5 = clutch
  - trigger = grasp, only while the grip is held (~:659, ~:738)
  - stick = walk / elbow roll
  - A/X = recenter (~:459)
  - B/Y = E-stop, then the session ends (~:498; modal `onStopButton` ~:752)
  - left-stick click = `onNextEpisode` (~:466-493)
  - both-hand pinch = E-stop (~:509-525)
  - **The trigger with the grip free is unused, and so is the right-stick click.**
- **Link flicker, root cause**
  - `meterLink` (`VRTeleopModal.tsx:161-171`, thresholds in `vrSession.ts:44-62`: 500 ms stale, 2000 ms lost) uses the age of the last `{type:'state'}` within 500 ms of a pose send.
  - The agent answers a pose frame only `if (solved) sendState()` (`robot-agent/src/api/keyboard-teleop.ts` ~:1527-1530). Every refusal path returns silently: unclutched side (~:740 / ~:1476 / ~:1522), `armGate()` false (~:671-731), `sideMayDrive` false, IK `held`.
  - So a refused arm reads as a lost network and fires the `linkLost` haptic (`VrTeleopRig.tsx:528-531`).
- **E-stop reset** exists only as a DOM button (`resetEstop`, `VRTeleopModal.tsx:771`). B/Y also ends the XR session, so a latched operator is thrown out.
- **IWER** (`iwer` 2.2.1) is enabled in DEV with `?xremu` on `localhost` (`resolveXrEmulator`, `vrConstants.ts:128-146`). The emulator (`xrStore.getState().emulator`) is not reachable from a test.

### Robot Agent (`robot-agent/src/api/keyboard-teleop.ts`)
- Every `{wrists}` / `{positions}` frame gets an answer:
  - either the existing `state`;
  - or `{type:'state', held:true, side:'left'|'right'|'both', reason}`, where `reason` is one of `'unclutched'|'arm_gate'|'not_armed'|'side_refused'|'ik_held'|'estop'|'lease'`.
- Throttle the held answers to at most 20 Hz per socket.
- The existing deduplicated `sendError` stays as it is.

### Frontend
**Link meter** (`VRTeleopModal.tsx`, `vrSession.ts`)
- LINK means transport health: the socket is open and the age of **any** agent frame (state, held, heartbeat, arm, base) is below the threshold.
- A `held` answer is not a link problem. It sets `telemetryRef.armHeld = {side, reason, at}`.
- The `linkLost` haptic fires only on a real loss.

**UI toolkit (new)**
- `VrPanel.tsx`: a world-space plate built on `useTextPlate`. It takes lines, each with an optional colour, a title and a background.
- `VrButton.tsx`: a 12×6 cm plate.
  - States: idle, hover, pressed, disabled.
  - Optional `holdMs`: a hold-to-confirm drawn as a fill bar.
  - It registers its mesh in a `vrUiRegistry` (a module-level set, no React context needed inside the rig).
- `VrUiRig.tsx`: the custom ray.
  - Each XR frame, for each controller whose squeeze is below `GRIP_THRESHOLD`, it builds a ray from `inputSource.targetRaySpace` via `frame.getPose(targetRaySpace, referenceSpace)` and raycasts against the registry.
  - It draws a thin line and a cursor dot only while it hits something.
  - A click is the **rising edge of `xr-standard-trigger` while the grip is free**. A hold keeps firing `onHoldProgress`.
  - The ray is hidden and hits are disabled while that side's grip is held. While the E-stop is latched, only buttons flagged `allowWhenEstopped` stay live.
  - Tracked hands are out of scope; they keep the pinch E-stop.
- `VrTextPlate.tsx`: `draw` accepts a background colour and a highlight.
- `vrHaptics.ts:71`: add `uiHover` (short, weak) and `uiClick`.
- `VrTeleopRig.tsx`: assert the trigger with the grip free never reaches `wrist.grip`. Add a unit test on the pure input reducer so a UI click can never close a hand.

**Robot panel (new `VrRobotPanel.tsx`)**
- World-locked, 0.5×0.32 m, about 0.9 m out and 30° to the right of the robot's forward. It is mounted inside the yaw group in `VrScene.tsx`, so it follows recenter.
- Lines, from the teleop frames already in `telemetryRef`:
  1. `MODE balance (measured)` / `limp` / `unknown` (`base` frame)
  2. `ARMS armed 100 %` / `arming 40 %` / `disarmed: <lastDisarmReason>`, plus `· dead-man OK|HOLD` when `deadman` is present (fields from TASK-405; show `—` when absent)
  3. `GRIP L ●  R ○` (clutch) and `HELD R: arm_gate` from `armHeld`
  4. `HANDS L ok · R THUMB_1 0x200` from `handHealth` when present, else the existing `hands` booleans and `teleopMode`
  5. `LEASE you · LINK live 42 ms`
  6. **Why line** (bold, coloured by severity), computed by a new pure `vrWhy.ts` `whyNotFollowingVr(local)` from local facts in this order:
     - E-stop latched
     - socket closed
     - no lease
     - base not balance (when the gate is fsm)
     - arm refused (last `error` code or `held` reason)
     - `deadman` hold
     - controller untracked
     - grip not squeezed
     - following

     The wording matches TASK-405's table, so both views say the same thing. TASK-413 later prefers the server's reason when it is present.
- Buttons:
  - **Recenter** (same as A/X).
  - **Next take**: calls the existing `onNextEpisode`, shown only when a session passes it.
  - **Reset E-stop**: shown only while latched, `holdMs: 1000`, calls the existing `resetEstop`, `allowWhenEstopped`.

**E-stop stays in VR.** B/Y and the pinch E-stop still latch, disarm and damp through the existing path, but they no longer end the XR session. The robot panel turns red with the hold-to-reset button. Streaming is already gated by `shouldStream({estopLatched})`.

**Wrist HUD.** Unchanged, but line 1 becomes the why line when the severity is block.

**Test hook.** In DEV only, `window.__neodemXr = xrStore` (in `VRTeleopModal.tsx`, behind `import.meta.env.DEV`). Playwright can then drive `emulator.controllers.left|right` and `store.enterVR()`.

### Key files
- robot-agent/src/api/keyboard-teleop.ts (+ test)
- app/src/features/robots/components/tabs/vr/{VRTeleopModal.tsx, vrSession.ts, VrScene.tsx, VrTeleopRig.tsx, VrTextPlate.tsx, vrHaptics.ts, vrHud.ts}
- app/src/features/robots/components/tabs/vr/{VrPanel.tsx, VrButton.tsx, VrUiRig.tsx, vrUiRegistry.ts, VrRobotPanel.tsx, vrWhy.ts} (new) + tests
- app/e2e/live/vr-robot-panel.spec.ts (new)

## Decisions
- **D1 A custom ray, not the library's `rayPointer`.** `@pmndrs/xr` clicks on `select`, which is the trigger, and the trigger is the grasp (`@pmndrs/xr/dist/vanilla/default.js:15`). Rejected: installing uikit; it is a new dependency and brings a font fetch.
- **D2 The click is the trigger with the grip free.** It is the only spare analog input, and the rig already ignores it. Rejected: A/X/B/Y, which are taken (recenter, E-stop).
- **D3 E-stop keeps the operator in VR.** Rejected: today's behaviour of exiting XR, which hides the state and the reset from the person who pressed it. Safety is unchanged: the latch, disarm and damp path is the same, and streaming stays gated.
- **D4 The agent always answers a pose frame**, and LINK measures transport only. Rejected: a client-only fix that stamps `lastSendAt` only for clutched sides, which leaves IK `held` flicker in place.
- **D5 This task uses no server data.** It runs in wave 1. The server readiness reason is merged in TASK-413.

## Acceptance Criteria
- [ ] Holding the grip while the agent refuses the arm (sim agent with no lease, or a fake socket in vitest) never shows LINK stale or lost and never fires `linkLost`. The robot panel shows `HELD …` and the why line.
- [ ] Every pose frame receives `state` or `held` within one tick, and held answers stay at or below 20 Hz (agent vitest).
- [ ] With the grip free, the ray hits a button and a trigger rising edge clicks it. With the grip held, no ray is drawn and no click fires. A trigger click never changes `wrist.grip` (reducer test).
- [ ] Reset E-stop needs a 1 s hold and is the only live button while latched. B/Y latches without leaving VR.
- [ ] `whyNotFollowingVr` table test covers each rule and its order.
- [ ] A Playwright live spec (IWER, `localhost`, sim robot, branch app on a free port): enter VR via `window.__neodemXr`, point the right controller at Recenter, press the trigger, and assert the click handler ran. Then squeeze the grip and assert the ray is hidden.
- [ ] `npx tsc` (app), `npm run typecheck` (robot-agent), and the vitest suites pass.

## Test Strategy
- **vitest:** the pure parts (`vrWhy`, the input reducer, ray/registry hit selection with a fake pose, the hold-to-confirm timer) and the agent held-answer path with a fake socket.
- **Playwright** under `app/playwright.live.config.ts`, with IWER via `?xremu` on `localhost` against the sim robot `sim-robot-g1-edu`. Headless WebGL (SwiftShader) must render; if it does not, record that here and run headed.
- **Hardware:** no real robot. The B/Y E-stop is tested against the sim agent only.

## Safety constraints (binding for this task)
- Never set `G1_READ_ONLY=0`, and never use `G1_ARM_ALLOW_UNKNOWN_FSM=1`.
- Never `kill -9` / SIGKILL a sidecar. Stop it with SIGTERM and let it ramp down.
- Starting or stopping services never commands motion and never switches the FSM. Mode changes go only through the existing confirmed, lease-checked base-mode route.
- No DDS publishing on domain 0 in development or tests. Use the sim on domain 42 / `lo`.
- Never run `xr_teleoperate` and the arm_sdk sidecar together.
- The E-stop stays reachable: B/Y and the two-hand pinch in VR, and a visible E-STOP on the desktop session page.
- Development and tests use the sim stack only: the sim agent :41246 and sim sidecar :8777, or branch builds on free ports. Never the real g1-edu-4 (:41245/:8767). Do not stop or restart the running dev stack.

## Implementation notes (2026-10-17)

Decisions taken while implementing, beyond D1–D5:

- **I1 An `arming` rule in the why line.** Between dead-man and controller-untracked, severity warn, text `Arming… 40 %` — TASK-405's rule 12. The spec's list had no rule for a real robot's arms ramping in.
- **I2 The E-stop text depends on mode control.** Where NeoDEM controls the mode it is TASK-405's `E-stop is latched. Reset it, then switch to Balance.`; on the sim (no mode control) `E-stop is latched. Reset it.`
- **I3 The wrist HUD uses a short form.** `whyNotFollowingVr` returns `text` (≤ 72 chars, the panel) and `short` (≤ 26 chars, e.g. `HELD R: lease`), because a 72-character line does not fit the 12 cm wrist plate.
- **I4 The desktop STOP no longer ends the session either.** One stop path for B/Y, the pinch and the desktop button; the lease motion gate still ends the session as before.
- **I5 Trigger routing is its own pure module** (`vrInput.ts` `routeControllerInput`), used by both retargetings and the ray, so the reducer test covers every consumer.
- **I6 Held answers are coalesced, not dropped.** A refusal inside the 50 ms slot waits and goes out on the next agent tick (33 ms); a real `state` answer supersedes it. Held answers also close the RTT probe.
- **I7 One dev emulator store per page.** StrictMode ran `createXRStore({emulate})` twice, installing two IWER devices; the session sometimes belonged to the one the modal did not keep, so emulated buttons never arrived. Found by the live spec; DEV-only path.
- **I8 DEV debug snapshot** `window.__neodemVrUi` (clicks, ray state, button centres, panel lines), read by `app/e2e/live/vr-robot-panel.spec.ts`. The IWER DevUI overwrites controller rotations from its transform handles every frame, so the spec aims through `window.transformHandles`.
- **Headless WebGL renders** under Playwright's headless Chromium (SwiftShader); no headed run was needed.
