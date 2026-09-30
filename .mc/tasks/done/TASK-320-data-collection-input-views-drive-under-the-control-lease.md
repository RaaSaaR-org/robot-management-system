---
id: "TASK-320"
aliases: []
title: "Data-collection input views drive under the control lease"
slug: "data-collection-input-views-drive-under-the-control-lease"
status: "done"
priority: 3
owner: "huhn511"
projects: []
customers: []
tags: [core, safety]
sprint: ""
parent: "[[TASK-313]]"
depends_on: ["[[TASK-319]]"]
spe: 3
effort: "low"
due_date: ""
created: "2026-09-30"
updated: "2026-09-30"
---

# Data-collection input views drive under the control lease

## Description

The gamepad and simulated-VR inputs of the data-collection session page open
their own `/ws/keyboard-teleop` sockets; with leases enforced those would be
refused. Route them through the same `useControlLease` hook so they either hold
their own lease or join the session's lease explicitly.

## Details

### Current state

- `app/src/features/datacollection/hooks/useGamepadJoints.ts` (~line 114) and
  `app/src/features/datacollection/hooks/useSimulatedVrInput.ts` each open
  `${getWsBaseUrl(robot)}/ws/keyboard-teleop`, used by
  `app/src/features/datacollection/pages/SessionDetailPage.tsx`.
- TASK-319 ships `app/src/features/robots/hooks/useControlLease.ts`
  (`acquire`, `release`, `state`, the lease `{leaseId, generation}` in memory,
  `bindSocket(ws)`), and the agent accepts several sockets bound to one
  generation (explicit join).

### Frontend

- `SessionDetailPage.tsx` owns one `useControlLease` for the page, shows the
  same "Take control" / holder / lost UI as TeleopTab (reuse its component if
  TASK-319 extracted one), and passes the lease to both hooks.
- Both hooks call `bindSocket(ws)` on open and stop forwarding input unless the
  socket is bound; on `revoked`/`expired` they go quiet. Capability off →
  unchanged behaviour.

**Key files**
- `app/src/features/datacollection/pages/SessionDetailPage.tsx`
- `app/src/features/datacollection/hooks/useGamepadJoints.ts`
- `app/src/features/datacollection/hooks/useSimulatedVrInput.ts`
- tests next to the hooks

## Acceptance Criteria

- [ ] With the capability on, neither hook sends motion frames on an unbound
      socket; both send once bound to the page's lease.
- [ ] Revocation silences both hooks; nothing re-acquires automatically.
- [ ] Capability off: existing data-collection tests pass unmodified.

## Test Strategy

Hook tests with a fake WebSocket and a stubbed `useControlLease`.
