---
id: TASK-031
aliases:
- TASK-031
title: Human Oversight Dashboard (Compliance)
slug: human-oversight-dashboard-compliance
status: done
priority: 2
owner: ''
projects: []
customers: []
tags:
- compliance
sprint: ''
depends_on:
- "[[TASK-003]]"
- "[[TASK-006]]"
- "[[TASK-030]]"
due_date: ''
created: 2026-02-19
updated: 2026-02-19
---



# Human Oversight Dashboard (Compliance)

## Description
Implement human oversight mechanisms per AI Act Art. 14 including intervention, override, and explainability.

## Details
**Regulatory Compliance Feature: AI Act Art. 14**

### App (`app/src/features/oversight/`)
- **Intervention capabilities**:
  - Stop/interrupt per robot and fleet-wide (Art. 14(4)(e))
  - Manual task reassignment (Art. 14(4)(d))
  - Local manual control mode activation
- **Capability understanding** (Art. 14(4)(a)):
  - Robot capabilities dashboard
  - Current limitations display
  - Confidence level indicators
  - Anomaly indicators with visual alerts
- **Output interpretation** (Art. 14(4)(c)):
  - Decision explanation interface
  - Input factors visualization
  - Decision logic display
  - Confidence scores
  - Alternatives considered
- **Automation bias prevention** (Art. 14(3)):
  - Confirmation prompts for safety-critical decisions
  - Periodic manual verification requirements
  - Training module on automation bias

### Server (`server/src/`)
- **Oversight API**: Endpoints for all intervention actions
- **Decision logging**: Store all oversight interactions
- **Alert integration**: Configurable alert thresholds

**Alert Response Times:**
- Safety violation: <=100ms
- Anomaly detection: <=1 second
- System failure: Immediate

**Key Files:**
- App: Create `app/src/features/oversight/` feature module
- App: Create `app/src/features/oversight/components/OversightDashboard.tsx`
- App: Create `app/src/features/oversight/components/DecisionExplainer.tsx`
- Server: Create `server/src/routes/oversight.routes.ts`

## Test Strategy
Test intervention actions complete within SLA. Test capability dashboard accuracy. Test decision explanation completeness. Test automation bias prevention prompts. Test alert response times.

## Notes
%% mc-links: [[TASK-003]] [[TASK-006]] [[TASK-030]] %%
