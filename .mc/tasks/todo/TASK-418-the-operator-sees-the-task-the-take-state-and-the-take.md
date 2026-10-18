---
id: "TASK-418"
aliases: []
title: "The operator sees the task, the take state and the take result where they are looking"
slug: "the-operator-sees-the-task-the-take-state-and-the-take"
status: in-progress
priority: 2
owner: "huhn511"
projects: []
customers: []
tags: ["core", "vr", "datacollection"]
sprint: ""
parent: ""
depends_on: []
spe: 5
effort: "medium"
due_date: ""
created: "2026-10-18"
updated: "2026-10-18"
---

# The operator sees the task, the take state and the take result where they are looking

## Description

Rendering the headset view at Quest 3 resolution (2064x2208 per eye, IWER) showed that the operator's information sits where they are not looking, or behind the robot's own arms:

- The robot model's raised arms and hands are drawn in front of both side panels. That includes the REC line and the Stop button.
- The camera screen, where the operator actually looks, never shows REC, an E-stop or the take result.
- The quick check vanishes after 6 s.
- The board never shows what to demonstrate.
- The side panels cover the bottom corners of the camera feed, which is exactly where the grippers appear.
- When the assistant ends the session, the operator is thrown out of VR without a word.
- The desktop's completed summary reads FRAMES 0 until a reload.

Put the take state where the eyes are, keep the controls visible, and end the session gracefully.

## Details

### Current state (all under `app/src/features/robots/components/tabs/vr/` unless noted)

- **Depth.** `VrPanel.tsx:78` and `VrButton.tsx:128` use depth-tested `meshBasicMaterial`. The robot arm meshes occlude them (screens validate-headset-05/05b/06b/07/07b).
- **Wrist HUD.** It sits in front of the left wrist and overlaps the board in the forward view. Its placement is in `VrWristHud.tsx` / `vrWrist.ts`.
- **Side panels.**
  - `VrRobotPanel.tsx:33-45`: `DISTANCE_M 0.9`, `BEARING_RAD 30°`, `CENTRE_Y_M 0.08`, a 0.5 m plate, and `sidePanelPlacement()`.
  - `VrSessionBoard.tsx:30-33`: the mirror-image board.
  - In validate-headset-03/03d both top corners overlap the camera screen's lower corners.
- **Camera screen.** `HeadCameraPanel.tsx`: the frame stays mint while recording and while the E-stop is latched.
- **Board.** `vrSessionBridge.ts:225` sets `QUICK_CHECK_SHOW_MS = 6_000`. `composeSessionBoard` (`:289-312`) shows:
  - the status,
  - `N fr total · 0 fps · OK` (noise between takes),
  - `kept · discarded`,
  - and the quick check for 6 s.
  - It does not show the task instruction (`session.languageInstr`, e.g. "pick up the red cube and place it in the bin").
  - After an undone desktop discard the headset dropped the quick-check line while the desktop still showed it. That is the 6 s timeout, not the undo.
- **Session end.** `app/src/features/datacollection/pages/SessionDetailPage.tsx`:
  - `isCompleted` (`:421`) switches the page to the completed view, which unmounts the VR modal;
  - the immersive session ends with no message in the headset;
  - `statusLine()` in `vrSessionBridge.ts` already has an `ENDED` state that never gets shown.
- **FRAMES 0.** `app/src/features/datacollection/components/session/SessionCompleted.tsx:81` reads FRAMES 0 right after End. The server's `frameCount` was 1523 moments later, and a reload shows 1,523. The session object is not refetched after the agent finishes packing.

### Frontend: headset layout

- Render all VR UI on top of the robot: panels, buttons, the text plates, the wrist HUD and the ray hit marker. Use `depthTest:false`, `depthWrite:false` and a `renderOrder` above the robot model. Keep the panels' relative order stable (button above plate).
- Move the side panels clear of the camera screen. Keep them out of the camera image, and verify in a 2064x2208 render that no panel pixel overlaps the screen. Either:
  - widen the bearing to ±38–40°, or
  - lower `CENTRE_Y_M` by about 0.06 m so the top edges sit below the screen's bottom edge.
- Move the wrist HUD off the board's sightline (e.g. on top of the wrist, facing the eyes, instead of in front of it).

### Frontend: the camera screen strip

A strip along the top edge of `HeadCameraPanel`, and the frame colour:

- capturing: `● REC  Take 3  00:12`, red frame;
- E-stop latched: `E-STOP — hold Reset (right panel)`, red frame. This takes priority over REC;
- for 3 s after a stop: `✓ Take 3 kept · 13.5 s`, or the first quick-check warning (`⚠ No motion — Discard on the board`), or `Take 3 discarded`;
- otherwise no strip and the normal frame.

Read the state from the existing session bridge view and the telemetry ref. Do not open a new subscription.

### Frontend: the board

- Line 1 is the task instruction (wrapped, 2 rows max), if the session has one. Then the status line. Then `kept 2 · discarded 1`. Show fps/frames only while capturing or when degraded.
- The quick check stays until the next Start, or until the session ends, instead of 6 s.
- On session end, the status line reads `ENDED by <name> · 9 kept · 1523 fr` (name from presence, if known).

### Frontend: session end

- When the session becomes completed while the VR modal is open, keep the modal and the immersive session mounted for 5 s. The board shows the ENDED line and the camera strip shows `Session ended — take the headset off`. Then exit VR as today.
- Refetch the session after completion until `frameCount` is final (or listen for the existing session update event), so `SessionCompleted` never shows FRAMES 0 for a session with frames. Do not show 0 while loading; show "…".

### Key files

- app/src/features/robots/components/tabs/vr/{VrPanel.tsx, VrButton.tsx, VrTextPlate.tsx, VrWristHud.tsx, vrWrist.ts, VrSessionBoard.tsx, vrSessionBridge.ts, HeadCameraPanel.tsx} + `__tests__`
- app/src/features/robots/components/tabs/vr/VrRobotPanel.tsx (placement constants `:33-45` only)
- app/src/features/datacollection/pages/SessionDetailPage.tsx (completion → VR unmount only)
- app/src/features/datacollection/components/session/SessionCompleted.tsx
- app/src/features/datacollection/store/datacollectionStore.ts (refetch after completion, if needed)

Overlap with parallel tasks:
- TASK-417 adds a button and changes the text composition in `VrRobotPanel.tsx`, `vrWhy.ts` and `vrHud.ts`. Do not touch those beyond the placement constants.
- TASK-416 touches `datacollectionStore.ts` (stop-reason text).

## Decisions

- **D1 UI always draws over the robot.** The operator needs the controls more than they need to see their arm occlude a panel. Rejected: fading the arm meshes, which costs more per frame and still hides text.
- **D2 The camera screen carries the take state.** That is where the operator looks during a take. The side panels keep the detail.
- **D3 The quick check persists until the next Start.** Both views then show the same last result. This also removes the undo mismatch.
- **D4 A 5 s goodbye before VR closes.** Enough to read "ended", short enough not to strand the operator.

## Acceptance Criteria

- [ ] IWER renders at 2064x2208 (attach them to the PR):
  - recording with the left hand raised in front of the board: the REC line and the Stop button are fully visible;
  - looking forward: no side-panel pixel overlaps the camera screen;
  - the wrist HUD does not overlap the board.
- [ ] The camera strip shows REC with the take number and clock while capturing; shows E-STOP (red frame) while latched; shows the kept/warning/discarded verdict for 3 s after a stop; shows nothing otherwise (vitest on the strip composer, plus live screenshots).
- [ ] The board's first line is the session's instruction. The quick check is still shown 30 s after a stop and disappears on the next Start.
- [ ] Live, two contexts: B ends the session → A's board shows `ENDED by …` and the camera strip says the session ended, for about 5 s, before the immersive session ends.
- [ ] Right after End, the desktop completed view shows the real frame count (never 0 for a session with frames) without a reload.
- [ ] `npx tsc` (app) and the app vitest pass.

## Test Strategy

- **vitest:**
  - `composeSessionBoard` (instruction, persistence, ENDED);
  - the camera strip composer (priority E-stop > REC > verdict);
  - `SessionCompleted` loading/refetch;
  - render order and material flags on `VrPanel`/`VrButton`.
- **Playwright live** with IWER `?xremu` on GPU WebGL (Vulkan; SwiftShader drops to 1.5 fps and loses the lease), branch app/server on free ports, sim robot. Take before/after screenshots.

## Safety constraints (binding for this task)

- The E-stop stays reachable and visible: B/Y and the two-hand pinch in VR, and the Reset hold on the robot panel. Rendering on top must never hide the E-stop state.
- Never set `G1_READ_ONLY=0`, never use `G1_ARM_ALLOW_UNKNOWN_FSM=1`, never `kill -9` a sidecar, no DDS on domain 0.
- Development and tests use the sim stack only (branch builds on free ports). Never the real g1-edu-4 (:41245/:8767). Do not stop or restart the running dev stack.

## Implementation notes (2026-10-18)

Decisions taken while building, and where the code differs from the spec:

- **Side panels:** bearing widened to ±40° (`SIDE_PANEL_BEARING_RAD` in `VrRobotPanel.tsx`, mirrored by the board); `CENTRE_Y_M` unchanged. In a 2064x2208 IWER render looking forward, no side-panel pixel touches the camera screen.
- **Render order (D1):** `VR_UI_MATERIAL` (`depthTest:false`, `depthWrite:false`) and `VR_UI_RENDER_ORDER` in `VrPanel.tsx`. The wrist HUD draws over the robot but **under** the panels (18 < 20), so a raised wrist can never hide a board button; buttons over plates, the camera strip over the screen, the ray and its hit marker (`VrUiRig.tsx`) over everything.
- **Wrist HUD:** 17 cm off the back of the hand, 5 cm toward the wrist (grip space), billboarded to the eyes. Measured in the IWER neutral pose it sits above the board's top edge and left of the camera screen. The tracked-hand offset is unchanged (9 cm).
- **Camera strip:** sits just above the screen's top edge, outside the picture (the stale badge keeps the inside). Priority is E-stop > session ended > REC > the 3 s verdict; "ended" was added for D4.
- **Quick check (D3):** the board shows it until the next Start. The desktop `QuickCheckCard` used to dismiss the shared quick check after 8 s, which cleared the headset's copy too. The card now stays until Keep, a discard or the next Start (the auto-hide is opt-in through `visibleMs`). The store clears `lastQuickCheck` on `episode:started`.
- **ENDED by:** the end event names no actor, so the bridge remembers the first desktop assistant in presence. The wearer has no End in VR, so an end they did not cause came from a desktop.
- **Goodbye (D4):** the decision is made during render in `SessionDetailPage` (`endsUnderVr`), not in an effect. An effect runs after the commit that already unmounted the VR panel, and the immersive session ends with it. A page test checks for exactly that (no remount).
- **FRAMES 0, root cause:** the server emits one last live state *after* `session:completed`. An ended session's live state counts 0 frames, and the store's `session:progress` handler copied that 0 over the final `frameCount`. The handler now only copies while the session records or is paused. As a fallback, `SessionCompleted` refetches while the count reads 0 but kept takes hold frames, and shows "…" meanwhile.
- **Files outside the spec's list:** `VrUiRig.tsx` (ray render order), `vrUiRegistry.ts` (`strip` debug field), `VrScene.tsx` (wiring), `VRSessionPanel.tsx` (bridge fields), `QuickCheckCard.tsx` (D3).
