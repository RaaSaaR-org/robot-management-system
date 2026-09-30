---
id: "TASK-315"
aliases: []
title: "Keyboard teleop drives only on a lease-bound socket"
slug: "keyboard-teleop-drives-only-on-a-lease-bound-socket"
status: "done"
priority: 2
owner: "huhn511"
projects: []
customers: []
tags: [core, safety]
sprint: ""
parent: "[[TASK-313]]"
depends_on: ["[[TASK-314]]"]
spe: 5
effort: "medium"
due_date: ""
created: "2026-09-30"
updated: "2026-09-30"
---

# Keyboard teleop drives only on a lease-bound socket

## Description

When `CONTROL_LEASE_REQUIRED` is on, a `/ws/keyboard-teleop` socket is an
observer until it binds to the installed control lease, and loses motion
authority the instant that lease is fenced, released or expires. With the flag
off the socket behaves exactly as today.

## Details

### Current state

`robot-agent/src/api/keyboard-teleop.ts`: on `connection` it calls
`controlOwnerLock.claim('teleop')` (always succeeds, preempts `agent`/`vla`),
`robotStateManager.enableTeleop()`, sends `{type:'config'}`, `{type:'control',
owner, preempted}`, `{type:'estop'}`, `{type:'base'}`. Messages handled include
`estop` (~line 724), `move` (~811), key/joint/pose/wrist/hand/preset/posture
frames. `cleanup()` (~966) stops the base if this socket drove, releases one
`teleop` holder, and disables teleop when the last holder leaves. The lease
registry is `controlLease` from `robot-agent/src/control-lease/control-lease.ts`
(TASK-314): `verify(rawLeaseId, generation)`, `subscribe(cb)`,
`setBoundCount(generation, n)`, `observe()`.

### Robot Agent — only when `config.controlLease.required` is true

- **Connect:** do not claim `teleop`, do not `enableTeleop()`. Send `config`,
  `estop`, `base` as today, plus `{type:'lease', state:'unbound',
  required:true, holder: observe() minus nothing secret}`. `{type:'control'}` is
  sent at bind time instead.
- **Bind:** new message `{bind:{leaseId:string, generation:number}}`. On
  `controlLease.verify` success: if the claim preempts `agent`/`vla`, await a
  zero-velocity stop (`hardwareClient.locoMove(0,0,0,0)`) **before** replying;
  then claim `teleop`, `enableTeleop()`, reply `{type:'lease', state:'bound',
  generation}` and `{type:'control', owner, preempted}`. On failure reply
  `{type:'error', code:'lease_invalid'}` and stay unbound. Several sockets may
  bind to the same generation (explicit join); each is one `teleop` holder.
- **Admission:** every motion frame (everything except `estop`, `bind` and
  read-only/keepalive frames) is checked **at processing time** against the
  socket's bound generation *and* `verify` still holding. Otherwise discard and
  send error code `lease_required` (add it to `TeleopErrorCode`; once-per-socket
  like other codes, reset on a successful bind).
- **E-stop:** `{estop}` is accepted from bound and unbound sockets alike.
- **Fence:** on registry `fenced` / `expired` for the socket's generation: clear
  the pending `SetVelocity` slot, stop the base, release this socket's `teleop`
  holder (disable teleop when it was the last), mark the socket unbound, send
  `{type:'lease', state:'revoked'|'expired', generation}`. No auto-rebind.
- **Bound count:** keep `controlLease.setBoundCount(generation, n)` accurate on
  bind, fence and close.
- **Close:** as today, but release a holder only if this socket held one.

### Flag off

No new messages, claim-on-connect unchanged; a `{bind}` frame is ignored.

**Key files**
- `robot-agent/src/api/keyboard-teleop.ts`
- `robot-agent/src/api/__tests__/keyboard-teleop-lease.test.ts` (new; copy the
  harness of the existing keyboard-teleop tests in that folder)

## Acceptance Criteria

- [x] Flag on: an unbound socket's `move`/joint frames never reach the state
      manager or `hardwareClient`, and it receives `lease_required`.
- [x] Flag on: a socket binding with the right secret/generation drives; a wrong
      secret, old generation, or expired lease gets `lease_invalid`.
- [x] Flag on: installing generation N+1 makes a socket bound to N stop the base,
      receive `revoked`, and drop its frames — including a `move` already queued
      behind an in-flight RPC.
- [x] Flag on: connecting does not preempt Agent Mode; binding does, and the
      stop resolves before `{type:'lease', state:'bound'}` is sent.
- [x] Flag on: `{estop}` from an unbound socket latches the E-stop.
- [x] Two sockets bound to the same generation: closing one leaves the other
      driving; `bound` count tracks both.
- [x] Flag off: all existing keyboard-teleop tests pass unmodified.

## Test Strategy

Vitest with a real `ws` client against the server built by
`createKeyboardTeleopWebSocket`, a fresh `ControlLeaseRegistry` on a temp file,
and a stubbed `hardwareClient`.
