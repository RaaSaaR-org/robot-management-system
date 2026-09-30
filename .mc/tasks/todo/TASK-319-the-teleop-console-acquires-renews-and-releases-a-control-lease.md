---
id: "TASK-319"
aliases: []
title: "The teleop console acquires, renews and releases a control lease"
slug: "the-teleop-console-acquires-renews-and-releases-a-control-lease"
status: "in-progress"
priority: 2
owner: "huhn511"
projects: []
customers: []
tags: [core, safety]
sprint: ""
parent: "[[TASK-313]]"
depends_on: ["[[TASK-318]]"]
spe: 5
effort: "medium"
due_date: ""
created: "2026-09-30"
updated: "2026-09-30"
---

# The teleop console acquires, renews and releases a control lease

## Description

When the server advertises the control-lease capability, the keyboard teleop tab
and the VR teleop view take control explicitly, bind their agent socket to the
lease, renew it while eligible, and stop and release on every loss path — showing
who holds the robot, conflicts, and loss of control. Without the capability the
UI behaves as today.

## Details

### Current state

- `app/src/features/robots/components/tabs/TeleopTab.tsx` opens
  `${getWsBaseUrl(robot)}/ws/keyboard-teleop` directly to the agent on mount.
- VR: `app/src/features/robots/components/tabs/vr/VRTeleopModal.tsx` (~line 468)
  builds the same URL; `vrSession.ts` owns the socket (`socketFactory`).
- API modules live in `app/src/features/robots/api/` (e.g. `robotsApi.ts`),
  using the shared axios client.
- Server (TASK-317/318): `GET /robots/:id/control-lease` →
  `{capability:{version, enabled, ttlMs, renewEveryMs}, holder}`;
  `POST /robots/:id/control-lease` → 201 `{leaseId, generation, sessionId,
  ttlMs, renewEveryMs, expiresAt}` or 409 `{code:'lease_held', holder}`;
  `POST …/renew {leaseId, generation}`; `POST …/release {leaseId, generation}`;
  WS event `{type:'control_lease', robotId, state, generation, holder}`.
- Agent socket (TASK-315): `{bind:{leaseId, generation}}` →
  `{type:'lease', state:'bound'|'revoked'|'expired'|'unbound'}`; errors
  `lease_required`, `lease_invalid`.

### Frontend

- `app/src/features/robots/api/controlLeaseApi.ts` — the four calls.
- `app/src/features/robots/hooks/useControlLease.ts` — state machine
  `observing → acquiring → bound → (lost|released) → observing`:
  - `acquire()` only on an explicit click after a confirm; never automatically.
  - After 201: send `{bind}` on the socket; `bound` only on the agent's
    `{type:'lease', state:'bound'}`.
  - Renew every `renewEveryMs` while bound and the socket is open. **Local
    deadline** = last successful renew + `ttlMs − 2 × renewEveryMs`
    (performance clock); crossing it, or any renew refusal, gates motion
    (stop sending, send one zero `move`), releases, and shows "control lost".
  - `release()` on: user click, unmount, socket close, `visibilitychange` to
    hidden, `pagehide`, robot change, agent `revoked`/`expired`. Idempotent.
  - After loss or release: back to observing. No auto-reacquire, no retry that
    acquires.
  - Secret held only in hook memory — never stored, logged or put in a URL.
  - Exposes `{state, holder, acquire, release, bindSocket(ws)}`; `bindSocket`
    sends `{bind}` on an extra socket so other input views can join the same
    lease (TASK-320 uses it).
- `TeleopTab.tsx`: capability on → "Take control" button, holder badge
  ("Controlled by <displayName> · expires in n s" from the observer event),
  409 conflict message naming the holder, lost-control banner. Motion keys
  disabled unless `bound`. Capability off → unchanged.
- VR (`VRTeleopModal.tsx` / `vrSession.ts`): same hook; entering the session
  requires `bound`; headset exit, tracking loss and session end call `release()`.
- E-stop button stays enabled regardless of lease state.

**Key files**
- `app/src/features/robots/api/controlLeaseApi.ts` (new)
- `app/src/features/robots/hooks/useControlLease.ts` (new) + test
- `app/src/features/robots/components/tabs/TeleopTab.tsx`
- `app/src/features/robots/components/tabs/vr/VRTeleopModal.tsx`, `vrSession.ts`

## Acceptance Criteria

- [ ] Hook tests (fake timers, mock API + fake socket): acquire → bind → bound;
      renew cadence; a missed renew past the local deadline stops motion and
      releases; 409 surfaces the holder; `visibilitychange` hidden releases; no
      path re-acquires on its own.
- [ ] Release is called exactly once across overlapping loss paths.
- [ ] Capability `enabled:false`: TeleopTab and VR render and behave as before
      (existing tests pass unmodified).
- [ ] E-stop is clickable while observing.
- [ ] `npx tsc` and `npx vitest run` pass in `app/`.

## Test Strategy

Vitest + Testing Library for the hook and TeleopTab with mocked axios and a fake
WebSocket; `vrSession.ts` unit test via its existing `socketFactory` injection.
