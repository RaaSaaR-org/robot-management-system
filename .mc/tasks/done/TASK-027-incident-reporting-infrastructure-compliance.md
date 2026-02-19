---
id: TASK-027
aliases:
- TASK-027
title: Incident Reporting Infrastructure (Compliance)
slug: incident-reporting-infrastructure-compliance
status: done
priority: 2
owner: ''
projects: []
customers: []
tags:
- compliance
sprint: ''
depends_on:
- "[[TASK-012]]"
- "[[TASK-024]]"
due_date: ''
created: 2026-02-19
updated: 2026-02-19
---



# Incident Reporting Infrastructure (Compliance)

## Description
Implement incident detection and multi-authority reporting per AI Act Art. 73, GDPR Art. 33-34, NIS2 Art. 23, and CRA Art. 14.

## Details
**Regulatory Compliance Feature: AI Act Art. 73, GDPR Art. 33-34, NIS2 Art. 23, CRA Art. 14**

### Server (`server/src/`)
- **Incident detection**:
  - Safety incident triggers (force/collision events)
  - Security incident triggers (intrusion, auth failures)
  - Anomaly detection in robot behavior
- **Evidence preservation**:
  - Immutable incident logging
  - System state snapshots on incident
- **Breach assessment**:
  - Risk scoring matrix
  - Automated severity classification
- **Notification workflows** with authority-specific timelines:
  - **AI Act**: 2/10/15 days depending on severity
  - **GDPR**: 72 hours to DPA, immediate to data subjects if high risk
  - **NIS2**: 24h early warning, 72h notification, 1 month final
  - **CRA**: 24h for exploited vulnerabilities
- **Timeline tracking**: Dashboard for deadline compliance
- **Template system**: Pre-built notification templates per authority

### App (`app/src/features/incidents/`)
- **Incident dashboard**: View and manage incidents
- **Reporting workflow**: Guide through notification process
- **Timeline tracker**: Visual timeline of required actions
- **Template editor**: Customize notification templates

**Key Files:**
- Server: Create `server/src/services/IncidentService.ts`
- Server: Create `server/src/services/BreachAssessmentService.ts`
- Server: Create `server/src/routes/incident.routes.ts`
- Server: Update `server/prisma/schema.prisma` with Incident, IncidentNotification models
- App: Create `app/src/features/incidents/` feature module

## Test Strategy
Test incident auto-detection triggers. Test evidence preservation immutability. Test severity classification. Test notification timeline tracking. Test template generation. Test multi-authority workflow.

### Current State
- `server/src/services/AlertService.ts` and `server/src/routes/alert.routes.ts` exist — operational alerts with severity/title/message/source
- `Alert` model in Prisma has `severity`, `acknowledged`, `dismissable` fields
- Incidents are distinct from alerts: alerts are operational events, incidents are regulatory reports with preservation, timeline, and notification requirements
- Incident detection triggers (force/collision, auth failures) may use existing alert data as input signals

## Notes
%% mc-links: [[TASK-012]] [[TASK-024]] %%
