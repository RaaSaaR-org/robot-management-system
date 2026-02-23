---
id: TASK-039
aliases:
- TASK-039
title: Robot Agent State Persistence
slug: robot-agent-state-persistence
status: done
priority: 3
owner: ''
projects: []
customers: []
tags:
- core
sprint: ''
depends_on:
- "[[TASK-003]]"
due_date: ''
created: 2026-02-19
updated: 2026-02-23
---



# Robot Agent State Persistence

## Description
Persist robot agent state (position, task queue, conversation context) across process restarts. Currently all state is in-memory and lost on restart.

## Details
**Gap identified from codebase review — no persistent state in robot-agent.**

### Current State
- `robot-agent/src/robot/RobotStateManager.ts` manages all state in-memory via `SimulatedRobotState` object
- `robot-agent/src/robot/SimulationEngine.ts` tracks position, battery, movement — all lost on restart
- `robot-agent/src/robot/TaskQueue.ts` holds task queue in-memory (max 5 tasks) — lost on restart
- `robot-agent/src/agent/agent-executor.ts` uses an in-memory `ContextCache` with `CONTEXT_MAX_ENTRIES = 100` and 1-hour TTL — conversation history lost on restart
- Robot re-registers with server on startup but starts from default state (position 0,0, battery 100%, no tasks)
- The server persists robot data in its Prisma DB, but the robot agent has no local persistence

### Robot Agent (`robot-agent/src/`)
- **State file**: Persist `SimulatedRobotState` to a local JSON file (e.g., `robot-agent/data/state.json`) on shutdown and state changes (debounced)
- **State recovery**: On startup, load persisted state before registering with server. Reconcile with server-side state if there's a conflict
- **Task queue persistence**: Save task queue to same or separate file so pending tasks survive restarts
- **Conversation context**: Persist `ContextCache` entries to file or lightweight SQLite DB. This enables conversation continuity across restarts
- **Graceful shutdown**: Handle `SIGTERM`/`SIGINT` to flush state to disk before exit

**Key Files:**
- Create: `robot-agent/src/robot/StatePersistence.ts` — load/save state with debounced writes
- Modify: `robot-agent/src/robot/RobotStateManager.ts` — integrate persistence on state changes
- Modify: `robot-agent/src/robot/SimulationEngine.ts` — load initial position from persisted state
- Modify: `robot-agent/src/robot/TaskQueue.ts` — persist queue on add/remove
- Modify: `robot-agent/src/agent/agent-executor.ts` — persist context cache
- Modify: `robot-agent/src/index.ts` — add graceful shutdown handler

**Storage options:**
- Simple: JSON file (good enough for single-agent development)
- Robust: SQLite via `better-sqlite3` (synchronous writes, good for SIGTERM handling)

## Test Strategy
Test state persists across agent restart (stop, start, verify position/battery/tasks). Test task queue survives restart. Test conversation context available after restart. Test graceful shutdown writes state. Test corrupt state file is handled (fallback to defaults). Test server-agent state reconciliation after restart.

## Notes
%% mc-links: [[TASK-003]] %%
