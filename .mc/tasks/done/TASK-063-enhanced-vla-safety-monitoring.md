---
id: TASK-063
aliases:
- TASK-063
title: Enhanced VLA Safety Monitoring
slug: enhanced-vla-safety-monitoring
status: done
priority: 1
owner: ''
projects: []
depends_on_note: TASK-082 — VLA Server Consolidation muss zuerst done sein
customers: []
tags:
- vla
sprint: ''
depends_on:
- "[[TASK-030]]"
- "[[TASK-051]]"
due_date: ''
created: 2026-02-19
updated: 2026-07-12
status_note: 'CLOSED 2026-07-12 as delivered-elsewhere — this task was never executed as written (it sat blocked on TASK-082 and a stale duplicate lingered in deferred/, now deleted), but every listed feature has since shipped via other tasks: network watchdog (100 ms) + graceful degradation events tested in robot-agent/src/vla/__tests__/safety.test.ts; action validation + rate limiting via clipAction, hard /predict timeout and pre-send abort re-check in src/vla/skill-executor.ts (the live loop since TASK-146; vla_runner.py is orphaned); crash-recovery watchdog hardening in TASK-075; workspace boundaries via the zone runtime (TASK-038, zoneUtils.ts).'
---





# Enhanced VLA Safety Monitoring

## Resolution (2026-07-12)

Closed as **delivered-elsewhere** — see `status_note`. The original blocker
(TASK-082 / `vla_runner.py`) is long resolved and that runner was itself
replaced by `src/vla/skill-executor.ts` (TASK-146). Feature-by-feature
evidence in today's code:

- **Network watchdog (50–100 ms) + graceful degradation** —
  `robot-agent/src/vla/__tests__/safety.test.ts` (watchdogHealthy,
  watchdogTimeoutMs 100 ms, degradationEvents incl. sidecar field mapping)
- **Action validation + rate limiting for sudden movements** —
  `skill-executor.ts`: `clipAction` against the last applied action, hard
  timeout on `/predict`, abort re-check immediately before hardware send
- **Crash recovery / sidecar watchdog** — TASK-075 (VLA production hardening)
- **Workspace boundary enforcement** — zone runtime (TASK-038,
  `src/robot/zoneUtils.ts`)

## Description
Extend robot safety monitoring for VLA control with action validation, rate limiting for sudden movements, workspace boundary enforcement, network watchdog (50-100ms timeout), and graceful degradation. Implements safety-critical extensions for VLA-based robot control.

## Notes
Migrated from task-master TM-50. Status: deferred.
%% mc-links: [[TASK-030]] [[TASK-051]] %%
