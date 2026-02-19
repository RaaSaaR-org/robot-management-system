---
id: TASK-030
aliases:
- TASK-030
title: Enhanced E-Stop & Safety Monitoring (Compliance)
slug: enhanced-e-stop-safety-monitoring-compliance
status: done
priority: 2
owner: ''
projects: []
customers: []
tags:
- compliance
sprint: ''
depends_on:
- "[[TASK-006]]"
due_date: ''
created: 2026-02-19
updated: 2026-02-19
---



# Enhanced E-Stop & Safety Monitoring (Compliance)

## Description
Enhance emergency stop and safety monitoring per MR Annex III, ISO 10218-1, and ISO/TS 15066 requirements.

## Details
**Regulatory Compliance Feature: MR Annex III, ISO 10218-1, ISO/TS 15066**

### Robot Agent (`robot-agent/src/`)
- **Safety monitoring at 1kHz**:
  - Force/torque monitoring (Butterworth 100Hz filter)
  - Speed limiting (<=250 mm/s TCP in manual mode)
  - Position/proximity monitoring
- **Communication timeout**: Safe state on server disconnect (1s default)
- **Protective stop logging**: Full context capture on stop events
- **Safety-rated monitored stop**: Stop Category 2 implementation
- **Fail-safe**: Automatic protective stop on any safety system failure

### Server (`server/src/`)
- **E-stop endpoints**:
  - Individual robot halt
  - Fleet-wide emergency stop
  - Geographic zone stop
- **E-stop status**: Real-time status via WebSocket
- **Reset workflow**: Deliberate separate start action required
- **E-stop logging**: Capture all e-stop events with context

### App (`app/src/features/safety/`)
- **Enhanced E-stop button**: Per-robot and fleet-wide
- **Zone-based stop**: Stop robots in specific zones
- **Safety status dashboard**: Real-time safety metrics
- **Stop confirmation**: Visual confirmation of stop state

**ISO/TS 15066 Force Limits** (stored in config):
- Skull/Forehead: 130N (contact not permissible)
- Hands/Fingers: 140N quasi-static, 280N transient

**Key Files:**
- Robot: Update `robot-agent/src/tools/navigation.ts` for speed limits
- Robot: Create `robot-agent/src/safety/force-monitor.ts`
- Server: Create `server/src/routes/safety.routes.ts`
- Server: Update WebSocket for e-stop status
- App: Update `app/src/features/robots/components/EmergencyStopButton.tsx` (currently only in Commands tab, needs global placement)

## Test Strategy
Test e-stop response time (<100ms). Test fleet-wide stop. Test zone-based stop. Test reset workflow. Test communication timeout triggers safe state. Test force limit enforcement. Test protective stop logging.

## Notes
%% mc-links: [[TASK-006]] %%
