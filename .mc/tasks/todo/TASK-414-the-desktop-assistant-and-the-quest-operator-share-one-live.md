---
id: "TASK-414"
aliases: []
title: "The desktop assistant and the Quest operator share one live data-collection session"
slug: "the-desktop-assistant-and-the-quest-operator-share-one-live"
status: "in-progress"
priority: 1
owner: "huhn511"
projects: []
customers: []
tags: ["core", "vr", "datacollection", "teleop"]
sprint: ""
parent: ""
depends_on: ["[[TASK-410]]", "[[TASK-411]]", "[[TASK-413]]"]
spe: 8
effort: "high"
due_date: ""
created: "2026-10-17"
updated: "2026-10-18"
---

# The desktop assistant and the Quest operator share one live data-collection session

## Description

Data collection is a two-person job: one person wears the Quest 3, and the other watches and assists in NeoDEM in a normal desktop browser. After TASK-408/410/413 both can control takes and see the same take state. This task completes the experience so it feels seamless and is fun:
- the assistant sees what the operator sees and does: grip, arm refusals, link, and a live 10 Hz robot twin with the operator's targets;
- both see who is present;
- the desktop page becomes an assistant layout;
- a two-browser end-to-end test proves it converges.

## Details

### Current state
- **`app/src/features/datacollection/pages/SessionDetailPage.tsx`**
  - The 3D twin (~l.404) is `<Robot3DViewer robotType jointStates={telemetry?.jointStates}/>` with **no `robotId`**. `RobotModel` (`app/src/features/robots/components/visualization/RobotModel.tsx:27-33`) reads the 10 Hz `robot_telemetry_fast` channel only when `robotId` is set, so the assistant sees a 2 s twin.
  - The lease panel (~l.374) shows only when `leaseInputs` (~l.219) is true, so in a real VR session the assistant does not see who holds control.
  - `RobotModeControl` (~l.391) gets the page's inert lease.
  - The Quest renders the same page behind the full-screen VR modal, including the desktop 3D viewer and camera tiles.
- **Operator state.** Clutch, grip, `armHeld`, link/RTT, the local why line and the headset pose live only in the headset's teleop socket and `telemetryRef` (`VRTeleopModal.tsx`, TASK-407). The server proxy (`server/src/websocket/teleopProxy.ts`, `bridgeSockets` ~l.123) taps nothing.
- **Presence.** None. Only `operatorId` is on the session.
- **App socket** `/api/a2a/ws` (`server/src/websocket/index.ts`): tenant broadcast, no per-topic subscriptions, `safeSend` backpressure at 64 KB. A client `subscribe` message only gets `{type:'subscribed'}` back.
- **Already shared after TASK-408/410/411/413:** `teleop:session:live`, `teleop:episode:*`, `robot:readiness`, `control_lease`, `robot_telemetry_fast`.
- **Cues and controls on the session page:** `app/src/shared/utils/sessionCues.ts` (TASK-410) and the E-STOP button (TASK-410).

### Server (`server/src/websocket/index.ts` plus a new `server/src/websocket/sessionPresence.ts`)
- **Client → server messages** on `/api/a2a/ws`:
  - `{type:'teleop:watch', sessionId, role:'operator'|'assistant'}` on page mount and every 10 s.
  - `{type:'teleop:unwatch', sessionId}` on unmount.
  - `{type:'teleop:operator', sessionId, state: OperatorState}` at most 5 Hz, accepted only from a socket that declared `role:'operator'` for that session.
- **Presence:** the server keeps `sessionId → Map<socket, {userId, displayName, role, since}>`, drops entries on close or after 25 s without a watch, and broadcasts `teleop:session:presence {sessionId, viewers:[{userId, displayName, role, since}]}` on change.
- **Operator relay:** the server rebroadcasts `teleop:operator {sessionId, robotId, state, at}` to the tenant, throttled to 5 Hz per session and validated with zod (drop unknown keys, cap the payload at 2 KB).
```
OperatorState = {
  inVr: boolean, link: 'live'|'stale'|'lost', rttMs: number|null,
  clutch: {left: boolean, right: boolean}, grip: {left: number, right: number},
  held: {side: 'left'|'right'|'both', reason: string} | null,
  why: {code: string, severity: 'block'|'warn'|'ok', text: string},
  head: {p: [x,y,z], q: [x,y,z,w]} | null,           // robot-frame, for the frustum
  targets: {left: {p,q}|null, right: {p,q}|null}      // commanded wrist targets, robot-frame
}
```
- Neither message type changes robot state. It is display-only, and the relay never forwards anything to the agent.

### Frontend
**Operator publisher.** A new `vr/useOperatorPublisher.ts` is used in `VRTeleopModal.tsx`. While a session is attached (`vrSession` from TASK-413), it sends `teleop:watch` with `role:'operator'` when VR is entered, and `teleop:operator` at 5 Hz from `telemetryRef` (no React state). It sends only while `inVr`.

**Presence hook.** New `datacollection/hooks/useSessionPresence.ts`. `SessionDetailPage` declares `role:'assistant'`, unless the page's VR modal is open (then the publisher has claimed operator).

**Store.** `datacollectionStore` gains `presence` and `operator` (the latest `OperatorState` plus `receivedAt`; stale after 2 s).

**Assistant layout** (`SessionDetailPage.tsx`, desktop width ≥ 1024 px). Three areas:
- **Left, large:** the robot twin. `Robot3DViewer` gets `robotId={session.robotId}` (10 Hz fast channel). New `OperatorOverlay.tsx` draws the operator's wrist targets as translucent ghost hands, and the head as a small frustum, from `operator.targets/head`. This is "where the operator wants the hands" vs "where the robot is".
- **Right, top:** the head camera tile (`CameraStreamView`, retrying per TASK-401), then the session HUD with the take timer and big REC state (TASK-410).
- **Right, middle:** an **Operator card**: `In VR · link live 38 ms`, grip L/R bars, the operator's why line (amber/red), and `held: arm_gate`. If there is no operator, "Waiting for the headset — open `/data-collection/live?robot=<id>` on the Quest" with the Copy/Open buttons from TASK-412.
- **Right, bottom:** episode controls and list (TASK-410) and the compact readiness panel (TASK-411).
- **Header:** presence avatars ("Anna · headset", "Ben · desktop"), the read-only lease holder (`ControlLeaseBar` read-only whenever `lease.enabled`, not only when `leaseInputs`), and the E-STOP.

**On the Quest.** While the VR modal is open, the page behind it unmounts the 3D viewer and camera tiles (`hidden` / not rendered), so the headset does not render two scenes.

**VR robot panel.** Add `WATCHING Ben (desktop)` from `presence` (one line, `VrRobotPanel.tsx`).

**Cues** (desktop, `sessionCues`):
- a soft chime when the operator enters VR;
- a double low tone when the operator's why turns block for more than 1 s while a take is capturing ("arms stopped following during a take");
- a tone when the link turns lost.

**Fun touches** (cheap, keep them small): a take streak counter ("5 kept in a row") in the HUD, and a session summary toast at End (takes kept, total minutes, best streak).

### Docs
- New `docs/data-collection-two-person.md`:
  - roles;
  - setup: start the robot side → connect the Quest → open live on the headset → assistant opens the copied link;
  - who presses what, with the VR controls table and the desktop hotkeys;
  - what each warning means.
- Link it from `docs/g1-edu-lab-bringup.md`.

### Key files
- server/src/websocket/{index.ts, sessionPresence.ts (new)} + tests
- app/src/features/robots/components/tabs/vr/{useOperatorPublisher.ts (new), VRTeleopModal.tsx, VrRobotPanel.tsx}
- app/src/features/datacollection/hooks/useSessionPresence.ts (new)
- app/src/features/datacollection/store/datacollectionStore.ts
- app/src/features/datacollection/pages/SessionDetailPage.tsx
- app/src/features/datacollection/components/{OperatorCard.tsx, OperatorOverlay.tsx, PresenceBar.tsx} (new) + tests
- app/e2e/live/two-person-session.spec.ts (new)
- docs/data-collection-two-person.md (new), docs/g1-edu-lab-bringup.md

## Decisions
- **D1 The operator's state is relayed by the headset over the app socket, with the server only fanning it out.** Rejected: tapping the teleop proxy's binary stream (couples the proxy to the frame format). Rejected: a second teleop socket on the desktop (it gets no `state` frames and counts toward `bound`).
- **D2 Presence via `teleop:watch` heartbeats on the existing socket.** Rejected: a REST presence table, which is more moving parts for a 2-person view.
- **D3 Ghost hands, not a full avatar.** The assistant needs "target vs robot", and an avatar is decoration.
- **D4 The assistant can press the same take buttons and the E-STOP.** Changing robot mode still needs the lease. Rejected: an assistant takeover of the lease, which is a separate safety decision and stays out of scope.
- **D5 The Quest page unmounts the desktop 3D viewer behind the modal.** It saves GPU on the headset.

## Acceptance Criteria
- [ ] Two Playwright contexts on one session (branch app and server on free ports, sim robot `sim-robot-g1-edu`). Context A is the Quest via IWER `?xremu` on `localhost`, with `window.__neodemXr`; context B is the desktop.
  - A enters VR → B shows "In VR" and the presence `operator` within 2 s.
  - A ray-clicks Start → B shows `● REC Take 1` and a toast "started from the headset". B presses Stop → A's board shows the quick check.
  - B presses Discard last → A's `kept` updates within 1.5 s.
  - A presses B on the emulated right controller (E-stop, sim agent only) → B's operator card shows the block why line "E-stop is latched", and A's session buttons disable. B resets the E-stop afterwards through the existing reset.
- [ ] The relay rejects `teleop:operator` from a socket that is not the declared operator, and payloads over 2 KB. It is throttled to 5 Hz (server tests).
- [ ] Presence drops a closed socket within 1 s and a silent one within 25 s.
- [ ] `Robot3DViewer` on the session page receives `robotId`, and the twin updates at the fast-channel rate.
- [ ] The read-only lease holder is visible on the desktop during a real-VR session.
- [ ] The headset page does not render the desktop 3D viewer while the VR modal is open.
- [ ] The docs page exists and is linked.
- [ ] `npm run typecheck` (server), `npx tsc` (app), vitest, and the new live spec pass.

## Test Strategy
- **vitest:** sessionPresence (join, leave, timeout), relay validation and throttle, the store reducers, OperatorCard/OperatorOverlay rendering from a fixture.
- **Playwright live**, two contexts, IWER, sim robot only, branch builds on free ports.
- No real robot. The E-STOP is exercised against the sim agent only.

## Safety constraints (binding for this task)
- Never set `G1_READ_ONLY=0`, and never use `G1_ARM_ALLOW_UNKNOWN_FSM=1`.
- Never `kill -9` / SIGKILL a sidecar. Stop it with SIGTERM and let it ramp down.
- Starting or stopping services never commands motion and never switches the FSM. Mode changes go only through the existing confirmed, lease-checked base-mode route.
- No DDS publishing on domain 0 in development or tests. Use the sim on domain 42 / `lo`.
- Never run `xr_teleoperate` and the arm_sdk sidecar together.
- The E-stop stays reachable: B/Y and the two-hand pinch in VR, and a visible E-STOP on the desktop session page.
- Development and tests use the sim stack only: the sim agent :41246 and sim sidecar :8777, or branch builds on free ports. Never the real g1-edu-4 (:41245/:8767). Do not stop or restart the running dev stack.

## Implementation notes (2026-10-18)

Decisions made while building, and where the code differs from the spec above:

- **Wire shapes.** Server → client events use the `teleop:*` data envelope like every other teleop event: `{type:'teleop:session:presence', data:{sessionId, robotId, viewers}}` and `{type:'teleop:operator', data:{sessionId, robotId, state, at}}`. The server answers a watch with `teleop:watched` (or `teleop:watch:rejected` with `unauthenticated` / `session_not_found` / `forbidden` / `invalid`) and a refused relay with `teleop:operator:rejected` (`not_operator` / `too_large` / `invalid`), so the headset sends states only after its watch was accepted.
- **Who is who.** The server knows only a socket's `userId`; the display name comes from the client's `teleop:watch` (`displayName`, cleaned, max 40 chars, falling back to the user id). Presence is per socket, so two tabs of one user are two entries. The session's robot (for routing and the tenant check) is read once from the database (`lookupTeleopSessionRobot`).
- **Timeouts.** A silent watcher is dropped after 24 s by a 1 s sweep, so it is gone within 25 s; a closed socket leaves at once. The relay is a trailing 5 Hz throttle per session (the latest state always goes out).
- **Shared socket helper.** `app/src/shared/utils/sessionWatch.ts` owns the watching socket, because both the datacollection page and the robots-feature VR publisher use it (no robots → datacollection import). The `OperatorState` wire type lives there too.
- **Head and targets.** The rig now writes `head` and `targets` into `VrRigTelemetry` every frame (IK mode; orientation mode has no wrist targets, so no ghost hands there). The head's position is the eye point itself; only its orientation is drawn.
- **Twin overlay.** `Robot3DViewer` / `RobotModel` gained `linkOverlay` (content portalled into a URDF link, here `torso_link` + the agent's eye point `HEAD_SITE_IN_TORSO`). Overlay meshes carry `userData.keepMaterial`, because the twin restyles every mesh in its tree. Ghost hands and the frustum use the *estimated* signal colour (the robot is drawn in the measured colour). The viewer root exposes `data-robot-id` / `data-fast-channel` for the live spec.
- **Readiness panel.** The compact readiness panel moved into the session page's side column (VR sessions); the VR launcher card hides its own copy there (`showReadiness={false}`), so it is not shown twice. It stays mounted while the VR modal is open, which keeps the readiness store fresh for the headset's robot panel.
- **Read-only lease holder.** `ControlLeaseBar readOnly` shows only who holds the robot, without the "expires in" countdown: renewals are not broadcast, so an observer's deadline read "expires in 0 s" while the lease was held.
- **VR robot panel.** `WATCHING Ben (desktop)` is in the panel's title (`ROBOT · WATCHING …`), not an extra line: the 0.24 m text plate is already full. The bridge got `sessionId` and `watching()`.
- **Streak.** Counted from the server's live `kept` / `discarded` (high-water marks), not from episode events: a take the recorder did not keep (no frames — the agent records only while teleop is engaged) must not extend it, and out-of-order REST/WebSocket states must not count twice.
- **E-stop reset in the live spec.** The desktop session page has no reset button; the assistant resets through the existing safety reset (`POST /api/safety/robots/:id/estop/reset`), and both pages follow the agent's `{type:'estop', active:false}` frame.
