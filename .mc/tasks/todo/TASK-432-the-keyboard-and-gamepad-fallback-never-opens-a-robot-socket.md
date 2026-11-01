---
id: "TASK-432"
aliases: []
title: "The keyboard and gamepad fallback never opens a robot socket on a hard-coded port"
slug: "the-keyboard-and-gamepad-fallback-never-opens-a-robot-socket"
status: "todo"                # backlog | todo | in-progress | review | done | cancelled
priority: 2                   # 1=critical, 2=high, 3=medium, 4=low
owner: "huhn511"
projects: []
customers: []
tags: [core, safety]
sprint: ""
parent: ""
depends_on: []
spe: 2
effort: "medium"
due_date: ""
created: "2026-10-30"
updated: "2026-10-30"
---

# The keyboard and gamepad fallback never opens a robot socket on a hard-coded port

## Description

The session page's keyboard and gamepad fallback opens
`ws://<agent host>:8766/ws/keyboard-teleop` whenever no control lease is
enabled. 8766 was the SO-101 sidecar's default port. On the lab PC it is the real
`g1-edu-4` robot supervisor. So the demo build and the Playwright demo gate open
a socket to whatever listens on :8766 of the box that runs them. On the lab PC
the supervisor rejected it ("HTTP Authentication failed"). That was harmless, but
wrong: a page must never guess a robot port, and the demo must open no robot
socket at all. This task makes the fallback use the same socket as every other
teleop input, and keeps the demo off robot sockets.

Branch: `fix/task-432-the-keyboard-and-gamepad-fallback-never-opens-a-robot-socket`.

## Details

### Current state

- `app/src/features/datacollection/hooks/useGamepadJoints.ts:96-105`,
  `getWsBaseUrl()`: takes the agent URL (`robot.a2aAgentUrl`, default
  `http://localhost:41243`), keeps its hostname and puts port 8766 on it
  (`:102`).
- `useGamepadJoints.ts:128` picks the socket:
  `leaseEnabled ? openTeleopSocket(robot) : new WebSocket(`${getWsBaseUrl(robot)}/ws/keyboard-teleop`)`.
  Under the lease (TASK-320) it already goes through the server's same-origin
  proxy (TASK-393). Without a lease it goes to the guessed port.
- `app/src/features/datacollection/pages/SessionDetailPage.tsx`:
  - `:417`: `gamepadEligible` is true for session types `gamepad`,
    `keyboard_mouse` and `bilateral_aloha`;
  - `:437-441`: `useGamepadJoints({ robot: gamepadEligible ? robot : null,
    enabled: gamepadEligible && (status === 'recording' || status === 'paused'),
    lease })`.
- The proxy helper: `openTeleopSocket(robot)` in
  `app/src/features/robots/components/tabs/vr/vrUrls.ts:91-93`. Its URL comes
  from `getTeleopSocketUrl()` (`:61-67`): `/api/robots/<id>/teleop/ws` on the
  page's own origin, or the agent's `/ws/keyboard-teleop` when `teleopDirect()`.
  The access token rides as a subprotocol (`teleopSocketProtocols`), never in
  the URL.
- The demo:
  - `app/src/mocks/teleopTakesDemoHandlers.ts` serves `demo-session-takes`, a
    `keyboard_mouse` session in `recording` (`:65-66`), on a robot whose URL is
    localhost;
  - `app/e2e/datacollection-takes.spec.ts:15` and
    `app/e2e/datacollection-console.spec.ts:29` open it;
  - so every demo run opens `ws://localhost:8766/ws/keyboard-teleop`.
- The demo build flag is `import.meta.env.VITE_DEMO_MODE === 'true'`. Other hooks
  already skip their sockets with it (`hooks/useTeleopEvents.ts:35`,
  `hooks/useSessionPresence.ts:91`).
- Nothing else in `app/src` names port 8766 (`grep -rn 8766 app/src`).
- Existing test: `app/src/features/datacollection/hooks/__tests__/useGamepadJoints.lease.test.ts`.

### Frontend

- `useGamepadJoints.ts`:
  - delete `getWsBaseUrl()` and the 8766 port;
  - open the socket with `openTeleopSocket(robot)` with or without a lease. That
    is the server's same-origin proxy, or the agent's own `/ws/keyboard-teleop`
    under `teleopDirect()`. Never a port the hook derives;
  - in the demo build (`VITE_DEMO_MODE`), open no socket: return before
    `new WebSocket`. The demo fixture records without one.
- Check that the agent's `/ws/keyboard-teleop` drives an SO-101 the way the old
  sidecar socket did (the SO-101 is still supported). If it cannot, use the
  sidecar URL the robot reports, never a constant, and say so in Notes.
- Update the file header: the socket is the agent's, through the proxy.

### Key files

- `app/src/features/datacollection/hooks/useGamepadJoints.ts`
- `app/src/features/datacollection/hooks/__tests__/useGamepadJoints.lease.test.ts`
  (or a new `useGamepadJoints.socket.test.ts`)
- `app/e2e/datacollection-takes.spec.ts`

## Acceptance Criteria

- [ ] No app code builds a robot URL from a hard-coded port: `grep -rn 8766 app/src`
  finds nothing outside tests.
- [ ] Without a lease, the fallback opens its socket through `openTeleopSocket(robot)`
  (or a URL the robot reports), with the access token as a subprotocol.
- [ ] With a lease, nothing changes.
- [ ] The demo build opens no robot socket from this hook.
- [ ] A demo e2e run asserts that no WebSocket goes to `:8766` or to
  `/ws/keyboard-teleop`.
- [ ] Vitest covers both lease states and demo mode.

## Test Strategy

- `cd app && npx tsc --noEmit && npx vitest run`. In the hook test, stub
  `WebSocket` and assert the URL: the proxy URL with the lease on and off, no
  `:8766`, and no socket at all with `VITE_DEMO_MODE=true`.
- Playwright: in `datacollection-takes.spec.ts`, collect `page.on('websocket')`
  while the demo `keyboard_mouse` session records, and assert that no URL
  contains `:8766` or `/ws/keyboard-teleop`.
- On the lab PC, a `keyboard_mouse` session that records shows no failed
  `ws://…:8766` socket in the browser console.

## Notes

- Found on 2026-10-30, while the session page ran on the lab PC next to the real
  `g1-edu-4` supervisor. Filed from the TASK-424 preparation.
