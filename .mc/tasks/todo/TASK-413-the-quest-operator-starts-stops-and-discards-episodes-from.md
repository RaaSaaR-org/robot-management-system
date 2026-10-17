---
id: "TASK-413"
aliases: []
title: "The Quest operator starts, stops and discards episodes from inside VR"
slug: "the-quest-operator-starts-stops-and-discards-episodes-from"
status: "review"
priority: 1
owner: "huhn511"
projects: []
customers: []
tags: ["core", "vr", "datacollection", "teleop"]
sprint: ""
parent: ""
depends_on: ["[[TASK-401]]", "[[TASK-407]]", "[[TASK-410]]", "[[TASK-411]]"]
spe: 8
effort: "high"
due_date: ""
created: "2026-10-17"
updated: "2026-10-18"
---

# The Quest operator starts, stops and discards episodes from inside VR

## Description

The operator in the headset should run the whole recording loop without taking the headset off or calling out to the assistant:
- see `● REC Take 7 00:42`;
- start a take, stop it, go to the next, or throw away the last one;
- get a two-line quick check after each take.

This task adds a world-space **session board** (built on the TASK-407 toolkit) with buttons, plus controller shortcuts, and feeds it the same shared session state the desktop uses (TASK-410). The robot panel gains the camera line and the server's readiness reason.

## Details

### Current state
- **VR toolkit (TASK-407)** in `app/src/features/robots/components/tabs/vr/`:
  - `VrPanel`, `VrButton` (`holdMs`, `allowWhenEstopped`), `VrUiRig` (ray, trigger-with-grip-free click), `vrUiRegistry`, `VrRobotPanel`, `vrWhy.ts`
  - `uiHover` / `uiClick` haptics
  - `window.__neodemXr` in DEV
  - the E-stop no longer exits XR
- **Store (TASK-410):** `app/src/features/datacollection/store/datacollectionStore.ts`
  - `live`, `lastQuickCheck`, `clientId`
  - actions `startTake / stopTake / nextTake / discardLastTake(source)`
  - selectors `selectLive`, `selectTakeElapsedS(nowServerMs)`, `selectKept`
  - 409s are adopted
- **Camera status (TASK-401):** `vr/vrCameraStatus.ts` `{robotId, state, detail, retryInS, fps}`.
- **Readiness (TASK-411):** `app/src/features/robots/hooks/useRobotReadiness.ts` → `RobotReadiness.reason {code, severity, text, source}`.
- **Today's VR session plumbing:**
  - `SessionDetailPage.tsx` passes `onNextEpisode` and `recording={episode, frames}` to `VRSessionPanel` (`app/src/features/datacollection/components/VRSessionPanel.tsx:78`).
  - From there: → `VRTeleopSection` → `VRTeleopModal` (`VRTeleopModalProps` ~:318) → `VrScene` → `VrTeleopRig`.
  - Left-stick click = `onNextEpisode` (`VrTeleopRig.tsx` ~:466-493, `episodeMark` haptic).
  - The controls card is in `VRTeleopModal.tsx` (~:262-286). The wrist HUD REC line is `vrHud.ts` ~:313.

### Frontend
**Data path**
- `VRSessionPanel.tsx` (datacollection) reads the store directly (`selectLive`, `lastQuickCheck`, the actions with `source:'vr'`).
- It passes **one** object, `vrSession: VrSessionBridge | undefined`, down through `VRTeleopSection` → `VRTeleopModal` → `VrScene`:
  `VrSessionBridge = { getState(): VrSessionView, actions: {start, stop, next, discardLast} }`
- `VrSessionView = {status, phase, take, takeElapsedS, kept, discarded, frames, fpsActual, degraded, autoStopInS, lastQuickCheck}`.
- A getter, not props: the render loop reads through refs and the canvas never re-renders on progress (the same pattern as `telemetryRef`).
- `onNextEpisode` and `recording` are removed. `SessionDetailPage.tsx` stops passing them (a two-line edit).
- `TeleopTab` (robot page, no session) passes nothing, and the session board is not shown.

**Session board** (new `VrSessionBoard.tsx`)
- World-locked, 0.5×0.34 m, about 0.9 m out and 30° to the **left** of the robot's forward. It sits inside the yaw group, mirroring the robot panel.
- Lines:
  1. `● REC  Take 7   00:42` (red, blinking dot) or `READY  Take 8 next` / `PAUSED` / `ENDED`
  2. `707 fr · 30 fps · OK|DEGRADED · auto-stop 12 s`
  3. `kept 6 · discarded 1`
  4–5. After a stop, for 6 s: `Take 6 · 23.4 s · 707 fr · L arm + R hand` and the warnings, or `✓ looks good`.
- Buttons (VrButton): **Start** (between) / **Stop** (capturing), shown in one slot by phase; **Next** (capturing); **Discard last** (`holdMs: 1000`, fill bar).
  - Each click gives the `uiClick` haptic. Success gives the `episodeMark` haptic. A 409 gives a double short buzz, and the board shows the adopted state.
- Hidden when there is no session. While the E-stop is latched, the buttons are disabled (not `allowWhenEstopped`).

**Controller shortcuts** (`VrTeleopRig.tsx`):
- **Left-stick click:** Start/Stop by phase. It was Next.
- **Right-stick click:** Next.
- **Right-stick held 1.5 s:** Discard last, with a haptic countdown of 3 pulses, then a confirm pulse.
- A/X recenter, B/Y E-stop, grip, trigger and the sticks are unchanged.
- Update the controls card in `VRTeleopModal.tsx` and the help overlay.

**Wrist HUD** (`vrHud.ts`). The REC line becomes `REC ● T7 00:42` or `READY T8`. It is still 5 lines.

**Robot panel** (`VrRobotPanel.tsx`)
- Add `CAMERA live 28 fps` / `retrying in 4 s` from `vrCameraStatus`.
- The why line prefers the server reason (`useRobotReadiness`, read once per second into a ref) when its `source` is the server or its severity is block. Otherwise it uses the local `whyNotFollowingVr`, which knows grip and tracking.

**Audio** in VR: none. Haptics only (the Quest browser's WebAudio is fine, but the operator wears the headset next to a loud robot; this is decided, not a limitation).

### Key files
- app/src/features/robots/components/tabs/vr/{VrSessionBoard.tsx (new), VrScene.tsx, VrTeleopRig.tsx, VRTeleopModal.tsx, VRTeleopSection.tsx, VrRobotPanel.tsx, vrHud.ts, vrHaptics.ts} + tests
- app/src/features/robots/components/tabs/vr/vrSessionBridge.ts (new; type plus the pure view builder)
- app/src/features/datacollection/components/VRSessionPanel.tsx
- app/src/features/datacollection/pages/SessionDetailPage.tsx (drop the two props)
- app/e2e/live/datacollection-vr.spec.ts (rewrite; fix the stale `/#/` route) and app/e2e/live/vr-session-board.spec.ts (new)

## Decisions
- **D1 Left-stick click is Start/Stop, right-stick click is Next, and a right-stick hold discards.** Rejected: putting Discard on a single click; an accidental click must not destroy a take.
- **D2 The board reads the store through a getter, with no props per frame.** Rejected: passing `live` as props, which would re-render the canvas at 1 Hz and drop frames.
- **D3 Two world-locked boards beside the robot**, session left and robot right. Rejected: a bigger wrist plate, whose 5 lines were already the limit.
- **D4 The server reason wins over the local one when it says block**, so the headset and the desktop show the same verdict. The local reason wins otherwise, because it knows the grip and tracking.

## Acceptance Criteria
- [ ] In IWER (Playwright live, branch app and server on free ports, sim robot):
  - enter VR via `window.__neodemXr`;
  - ray-click Start → the store and server live state read `capturing`, and the board shows `● REC Take 1`;
  - ray-click Stop → the quick-check lines appear;
  - right-stick hold 1.5 s → the take is discarded and `kept` is unchanged.
- [ ] Left-stick click toggles Start/Stop and right-stick click is Next (rig reducer test with fake gamepads).
- [ ] A 409 from a stale press shows the adopted state with no error dialog.
- [ ] While the E-stop is latched, the session buttons are disabled and Reset E-stop (TASK-407) still works.
- [ ] The robot panel shows the camera line and the server's block reason (fixture).
- [ ] `TeleopTab` (no session) renders no session board.
- [ ] `npx tsc` and vitest pass.

## Test Strategy
- **vitest:** the `vrSessionBridge` view builder, the board line composer, and stick shortcuts with fake gamepad frames.
- **Playwright live** with IWER (`?xremu`, `localhost`) against the sim robot `sim-robot-g1-edu`, through branch builds on free ports.
- Never the real robot. The B/Y E-stop is exercised only against the sim agent.

## Safety constraints (binding for this task)
- Never set `G1_READ_ONLY=0`, and never use `G1_ARM_ALLOW_UNKNOWN_FSM=1`.
- Never `kill -9` / SIGKILL a sidecar. Stop it with SIGTERM and let it ramp down.
- Starting or stopping services never commands motion and never switches the FSM. Mode changes go only through the existing confirmed, lease-checked base-mode route.
- No DDS publishing on domain 0 in development or tests. Use the sim on domain 42 / `lo`.
- Never run `xr_teleoperate` and the arm_sdk sidecar together.
- The E-stop stays reachable: B/Y and the two-hand pinch in VR, and a visible E-STOP on the desktop session page.
- Development and tests use the sim stack only: the sim agent :41246 and sim sidecar :8777, or branch builds on free ports. Never the real g1-edu-4 (:41245/:8767). Do not stop or restart the running dev stack.

## Implementation notes (2026-10-18)

Decisions made while implementing, and where the code differs from the spec:

- **The bridge answers `ok` or `refused`.** The TASK-410 store's take actions return a boolean, so a 409 it adopted, a busy store (`takePending`) and an error all read as `refused` (two short taps, `TAKE_REFUSED`); success plays `episodeMark`. `withTakeHaptics` wraps the bridge once in `VrScene`, so board buttons and stick shortcuts feel the same answer. The store is unchanged.
- **Right-stick Next fires on release.** A press that is held becomes the Discard countdown (ticks at 0.375/0.75/1.125 s, confirm at 1.5 s) and never also advances.
- **Shortcuts follow the board.** While the E-stop is latched or the session is not recording, a stick press does nothing but buzz `refused`, like the greyed-out buttons.
- **Next take left the robot panel.** Its slot was the TASK-407 placeholder; Next is on the session board now (D3).
- **Why-line rule (D4), concretely:** the server reason wins when it blocks, or when the server itself (not the agent it relays) says something at least as serious as the local reason; a latched E-stop is never outranked. The reason is read once a second from the readiness store, which the launcher card's `RobotReadinessPanel` keeps fresh while the modal is open — no second poll.
- **Recorder without explicit takes** (`phase` null): Start and Next draw the old boundary (`nextEpisode`), Stop and Discard are refused. The wrist HUD then shows `REC ● T3` without a timer.
- **No help overlay exists** in the VR code; the controls card in `VRTeleopModal.tsx` carries the new rows.
- **`SessionDetailPage`** keeps `handleNextEpisode` for the legacy N hotkey and the episode panel; its source changed from `vr` to `desktop`, since the headset no longer calls it.
- **`VrButton` gained `isDisabled()`**, read per frame like `isVisible()`, so a session button greys out without a React render.
- **AC "kept is unchanged"** is checked as: take 1 kept, take 2 started with the left stick, then discarded by the 1.5 s hold while open — `kept` stays 1, `discarded` becomes 1.
- **`datacollection-vr.spec.ts`**: route fixed (`/#/` → `/`), the robot picked by `VR_ROBOT_ID` instead of the first option, control taken before the simulated input can stream, and the session ended after a failure. The in-headset flow lives in the new `vr-session-board.spec.ts`.
- **Live check on this box:** the sim's head-camera render core-dumps under the mesa EGL override over ssh; started without `__EGL_VENDOR_LIBRARY_*`/`LIBGL_ALWAYS_SOFTWARE`, it renders.
