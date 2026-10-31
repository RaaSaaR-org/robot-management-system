---
id: "TASK-443"
aliases: []
title: "The headset shows the wrist views below the head screen"
slug: "the-headset-shows-the-wrist-views-below-the-head-screen"
status: "in-progress"
priority: 2
owner: "claude"
projects: []
customers: []
tags: ["core"]
sprint: ""
parent: "[[TASK-439]]"
depends_on: ["[[TASK-441]]"]
spe: 5
effort: "medium"
due_date: ""
created: "2026-10-31"
updated: "2026-10-31"
---

# The headset shows the wrist views below the head screen

## Description

In the Quest 3 view, a session that records wrist cameras shows two small wrist panels below
the head camera screen, labelled L and R, so the operator sees the fingers up close while
teleoperating. A session without wrist cameras sees exactly today's scene.

## Details

### Current state

- `app/src/features/robots/components/tabs/vr/VrScene.tsx` mounts one `HeadCameraPanel`
  inside the robot's yaw group (~140-142), outside `modelRef` (anything inside `modelRef`
  shifts VrOrigin's eye measurement, see ~129-132).
- `HeadCameraPanel.tsx`: mono plane 0.8 x 0.6 m, 1.15 m ahead, centre y 0.4 (covers y
  0.1..0.7); hidden `<img>` on the ticketed MJPEG URL → `THREE.Texture`, upload capped at
  `PANEL_TEXTURE_HZ=20` and only on a changed 8x8 fingerprint (~386-394); liveness at 2 Hz,
  STALE badge + red surround + haptics `HAPTICS.linkLost` on both controllers (~415-470);
  `armStream` hard-codes `PANEL_CAMERA` (~120-134); offline plate (~495-508); the TASK-418
  take strip (REC / E-stop / verdict) on its top edge (~349-372); publishes into the single
  store `vrCameraStatus.ts` (`useVrCameraStatus`, ~12-60, "written ONLY by HeadCameraPanel").
- `vrConstants.ts:87-105` (`PANEL_CAMERA='head_camera'`, geometry, texture rate);
  `useCameraReconnect.ts` (per-`<img>`, unbounded retry, asks `/cameras` before each retry,
  `ArmFn` ~25-29); `vrCamera.ts` (pure helpers).
- Side panels (`VrRobotPanel.tsx` ~40-71) sit at ±40° bearing, 0.9 m out, y 0.08; the space
  directly below the head screen is free. Left of the robot model is −z (~59-63).
- Controller buttons are all bound (A/X recenter, B/Y E-stop, sticks, triggers, grips) —
  no new button bindings.
- Testing without a headset: dev `?xremu` (IWER metaQuest3 emulator, `vrConstants.ts:128-147`,
  `VRTeleopModal.tsx:414-443`) renders the same scene; `vrUiRegistry.ts:277-288` exposes
  `vrUiDebug` for Playwright. `VrScene.test.tsx:55` mocks `HeadCameraPanel`.
- The VR modal is opened from the session page (`SessionDetailPage.tsx` →
  `VRSessionPanel.tsx` → `VRTeleopSection` → `VRTeleopModal`). From TASK-441:
  `session.cameras` and `app/src/features/datacollection/utils/cameras.ts`
  (`sessionWristCameras`).

### Frontend

1. Extract the generic camera-screen logic from `HeadCameraPanel` (img/texture, upload
   gate, liveness, reconnect, offline plate, stale badge) so a second component can reuse it
   with a camera name parameter. `HeadCameraPanel` keeps `head_camera`, its strip, its
   haptics and its store writes — identical behaviour (existing tests unchanged).
2. New `WristCameraPanels({ robotId, cameras })`: one panel per given wrist name, ~0.36 m
   wide, 4:3, centred below the head screen (y ≈ −0.07, x ≈ 1.05, left at z ≈ −0.2, right at
   z ≈ +0.2, within ±20° bearing), pitched toward the eye (`EYE_Y_M`), each with a small
   L / R plate. No take strip, no red E-stop frame, **no haptics**, texture upload ≤ 10 Hz.
   Its status goes to a separate keyed store (never `useVrCameraStatus`).
3. Mount it in `VrScene` next to `HeadCameraPanel`, inside the yaw group, outside
   `modelRef`, **only** when the `wristCameras` prop is non-empty. Thread the prop from the
   session page (`sessionWristCameras(session)`) through `VRSessionPanel` /
   `VRTeleopSection` / `VRTeleopModal` to `VrScene`. Anywhere else (robot detail VR tab) the
   prop is absent → nothing mounts, no ticket, no stream.
4. Optional, only if a wrist camera is listed and not live: a line on the robot panel
   ("WRISTS L live · R offline"), following the rule that the camera line shows only when
   not live (`vrWhy.ts` ~488-520).
5. `vrUiDebug.wristCameras: string[]` lists the mounted wrist panels.
6. Docs: `docs/vr-teleop-data-collection.md` — a paragraph on the wrist panels; fix the
   side-panel bearing note (30° → 40°, ~232-240).

## Acceptance Criteria

- [ ] Without wrist cameras: `VrScene` renders exactly today's meshes; no wrist ticket or
      stream request is made (existing VR tests and `vrUiDebug` unchanged apart from
      `wristCameras: []`).
- [ ] With `['left_wrist_camera','right_wrist_camera']`: two panels below the head screen,
      left at −z, not overlapping the head screen, side panels or the grippers' area; a stale
      wrist shows its badge without any haptic pulse and without touching the head status.
- [ ] Under `?xremu` on the session page of a Head + wrists session, `vrUiDebug.wristCameras`
      lists both and a screenshot shows them.
- [ ] App typecheck + vitest green.

## Test Strategy

Vitest: `VrScene` gate (no prop → no wrist component; prop → two), the extracted camera
screen keeps the head behaviour, the keyed wrist store, no haptics on stale. Playwright
under `?xremu` (mocked cameras as in TASK-442's spec): `vrUiDebug.wristCameras` empty for a
head-only session and two names for a Head + wrists session; screenshot of the emulator view.
