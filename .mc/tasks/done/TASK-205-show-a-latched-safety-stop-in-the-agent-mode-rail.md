---
id: TASK-205
aliases:
- TASK-205
title: Show a SafetyMonitor-latched stop in the Agent Mode rail — and give the operator a reset button
slug: show-a-latched-safety-stop-in-the-agent-mode-rail
status: done
priority: 1
owner: ''
projects: []
customers: []
tags:
- core
- safety
- g1
- agentmode
sprint: ''
depends_on: []
status_note: 'DONE 2026-08-23. The code half shipped ahead of the task file, in 599f2c2f (post-merge review of TASK-206..212): getState() reports the effective latch as estopActive / estopSource / estopReason (agent-mode-controller.ts, latchedEstop + getState), and the flip is pushed the moment it happens by a two-feed latch watcher (publishLatchChange, wired to RobotStateManager.subscribe AND onSafetyEvent) rather than the onSafetyStop hook this task proposed — broader, because it also catches an operator reset on the safety route. The banner (EstopBanner.copyFor) names the safety monitor, quotes the reason, says one reset clears both latches and offers the existing button; no endpoint URL is quoted at a human any more. DESIGN DIVERGENCE on step 3: no eighth ConditionKey was added — the attribution rides on the existing `estop` condition as a separate store field, so the conditions.ts rule still holds (only notices.estop is coloured, rendered strictly by CONDITION_ORDER) and every hardcoded "seven" stays correct; the Test Strategy line about updating those counts is moot as built. Known and accepted consequence: CONDITION_ACTIVE_HEADLINE.estop stays source-agnostic, so the screen-reader announcement and the drawer checklist do not name the safety monitor the way the banner does. Closed by the test PR that covered the one hop nobody asserted — the server mirror carrying estopSource/estopReason through, and never inventing one.'
due_date: ''
created: 2026-08-09
updated: 2026-08-23
---


# Show a SafetyMonitor-latched stop in the Agent Mode rail — and give the operator a reset button

## Description

When `SafetyMonitor` latches a protective stop, the Agent Mode rail says nothing. The operator finds
out only when the **next** command is refused, and the refusal reads:

> *"E-Stop is latched on the safety monitor, not by Agent Mode — clear it there
> (POST /robots/:id/safety/estop/reset) before sending a new command."*

An API call, quoted at a human, with no button in the console.

Split out of TASK-201 (2026-08-09). It is a different defect from the geofence one and much smaller:
**the state already exists and is simply never published.** TASK-201 is about state that exists
nowhere at all.

## Details

### Why this is small

`latchedEstop()` at `robot-agent/src/agent-mode/agent-mode-controller.ts:701-705` already computes the
answer, and four call sites already use it (`:949`, `:1817`, `:1853`, `:1963`). It just never reaches
the wire.

**The reset path already works end to end** — the operator needs no new endpoint and no URL from a
refusal string:

```
AgentModePage.tsx:226 -> agentmodeStore.ts:503 -> POST /agent-mode/estop/reset
  -> resetEstop() (agent-mode-controller.ts:1119-1160) -> rsm.resetEmergencyStop() (:1122)
```

### What to build (~4 touches)

1. **`agent-mode-controller.ts:675-687`** — put the latched flag on `getState()`.
2. **`agent-mode-controller.ts:530-532`** — `this.emit('agent:state:changed')` from the `onSafetyStop`
   listener, so the rail updates immediately instead of waiting up to 15 s for the liveness re-push
   (`MIRROR_REPUSH_INTERVAL_MS`, `:195`).
3. **`app/src/features/agentmode/utils/conditions.ts`** — one new `ConditionKey`. Note `conditions.ts:27-31`
   states that nothing outside that list may put amber or red on the page, so a chip that is not a
   `ConditionKey` breaks the page's own rule. The one union edit also buys the notice slot
   (`EstopBanner.tsx:619-635`), the screen-reader announcement (`ConditionAnnouncer.tsx:52`) and the
   drawer checklist row (`RobotDetailsDrawer.tsx:136-161`).
4. **`EstopBanner.copyFor`** — a variant whose copy names the *source* of the latch (safety monitor,
   not Agent Mode) and offers the existing reset button rather than an endpoint.

### Do this BEFORE TASK-201

Decided 2026-08-09. It lands on the same three frontend files TASK-201's visibility work touches —
`agent-mode/types.ts`, `conditions.ts`, `EstopBanner.tsx` — so `CONDITION_ORDER` and `AgentModeState`
get edited once each instead of twice in the same week. TASK-201's frontend step then becomes "add a
second condition to a stack that already has the right shape".

It also needs the same hook TASK-201 needs and cannot confirm it has: whether
`RobotStateManager.notifyListeners()` reaches `AgentModeController` as an `agent:state:changed` at
all. Establish it here.

### Wire-compatibility constraint (same as TASK-201)

Add the field as **optional** on all three hand-mirrored `AgentModeState` copies
(`robot-agent/src/agent-mode/types.ts`, `server/src/types/agent-mode.types.ts`,
`app/src/features/agentmode/types/agentmode.types.ts`). Required would make
`isValidAgentModeSnapshot` (`server/src/services/AgentModeService.ts:43-53`) reject an older agent,
and would break six typed literals in tests and mocks.

`emptyState()` (`AgentModeService.ts:283-292`) must **not** fabricate a value — absent means unknown,
never "no stop is latched". There is already a test guarding exactly this for `estopActive`
(`AgentModeService.test.ts:120-169`).

### Key files

- `robot-agent/src/agent-mode/agent-mode-controller.ts` (`latchedEstop` :701-705, `getState` :675-687,
  `onSafetyStop` :530-532, `resetEstop` :1119-1160)
- `robot-agent/src/agent-mode/types.ts` and the two mirrors above
- `app/src/features/agentmode/utils/conditions.ts`, `components/EstopBanner.tsx`
- `app/src/features/agentmode/store/agentmodeStore.ts` (`:503`)

## Test Strategy

Unit: a latched SafetyMonitor stop appears on `getState()`; an absent field must not render as "no
stop latched"; `emptyState()` does not fabricate one.

Integration: latch a stop on the SafetyMonitor (not through Agent Mode), assert the rail reflects it
**without** a command having been refused first, and that the flip is emitted rather than waiting for
the 15 s re-push.

Frontend: the banner names the safety monitor as the source and renders the reset button; clicking it
reaches `POST /agent-mode/estop/reset`. Update the hardcoded condition count — `conditions.test.ts:52,63`
and the prose at `RobotDetailsDrawer.tsx:321-324` both say "seven".
