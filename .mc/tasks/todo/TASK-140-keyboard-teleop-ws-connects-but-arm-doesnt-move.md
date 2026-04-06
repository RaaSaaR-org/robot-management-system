---
id: TASK-140
aliases:
- TASK-140
title: 'Keyboard Teleop: arm moves but too slowly'
slug: keyboard-teleop-ws-connects-but-arm-doesnt-move
status: todo
priority: 2
owner: ''
projects: []
customers: []
sprint: ''
tags:
- core
depends_on: []
due_date: ''
created: '2026-04-06'
---

## Description
Keyboard Teleop via WebSocket works end-to-end (WS connects, messages arrive, `send_action()` executes, arm moves) but the arm moves too slowly — only ~3-4° per keypress instead of the configured delta (10°).

## What was fixed so far (2026-04-06)
1. **WS server added** to sidecar on port 8766 (`_keyboard_teleop_handler`)
2. **TeleopTab URL** changed to point to sidecar:8766 instead of agent:41243
3. **`_teleop_active` flag** — `get_state()` skips `disable_torque()` when teleop WS is connected
4. **Idle watchdog** — skips disconnect when `_teleop_active=True`
5. **Position-relative deltas** — handler reads actual position before applying delta (prevents target runaway)
6. **Delta increased** from 3° to 10° per keypress

## Remaining problem
The Feetech STS3215 servos are slow — they have a max velocity and can only move ~3-4° before the next `get_state()` call reads back the position. Each keypress effectively only achieves a fraction of the requested delta.

## Root cause analysis
- `send_action()` sends target position → motor starts moving
- But the handler immediately reads back with `get_state()` which returns the CURRENT position (not target)
- Next keypress adds delta to current position → motor barely progresses
- The motor needs ~500ms to reach a 10° target but we read back after ~100ms

## Recommended fix approach
1. **Don't read back immediately** — keep the target position, let the motor catch up over multiple frames. Only read back actual state for the status response, not to update the target.
2. **Or use velocity mode** — instead of position deltas, set motor velocity while key is held, stop when released. This requires `keydown`→start / `keyup`→stop protocol.
3. **Or increase servo speed** — write to STS3215 speed register (Profile Velocity) to allow faster movement. Default may be conservative.

Option 2 (velocity mode) would give the best UX — the arm moves while you hold the key, stops when you release. Requires:
- Frontend: send `{joint, direction: 1/-1}` on keydown, `{joint, direction: 0}` on keyup
- Sidecar: run a position-increment loop at 20Hz while direction != 0

## Key files
- `robot-agent/hardware/so101_sidecar.py` — `_keyboard_teleop_handler()` (line ~455)
- `app/src/features/robots/components/tabs/TeleopTab.tsx` — `KEY_BINDINGS`, keydown/keyup handlers

## Test Strategy
1. Connect via Teleop tab on robot detail or data collection session page
2. Press and HOLD W → shoulder_lift should move smoothly upward
3. Release W → arm stops
4. Press S → shoulder_lift moves down
5. Test all 6 joints (W/S, A/D, Q/E, Z/X, Up/Down, O/C)
