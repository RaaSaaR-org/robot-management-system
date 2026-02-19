---
id: TASK-034
aliases:
- TASK-034
title: Compliance Monitoring Dashboard (Compliance)
slug: compliance-monitoring-dashboard-compliance
status: done
priority: 3
owner: ''
projects: []
customers: []
tags:
- compliance
sprint: ''
depends_on:
- "[[TASK-024]]"
- "[[TASK-027]]"
- "[[TASK-033]]"
due_date: ''
created: 2026-02-19
updated: 2026-02-19
---



# Compliance Monitoring Dashboard (Compliance)

## Description
Implement unified compliance monitoring dashboard tracking all regulatory frameworks and deadlines.

## Details
**Regulatory Compliance Feature: All Frameworks**

### App (`app/src/features/compliance/`)
- **Regulatory tracker**:
  - Timeline of regulatory deadlines
  - Status per framework (AI Act, MR, GDPR, NIS2, CRA, RED, DGUV)
  - Gap analysis reporting
- **Document management**:
  - Document expiry alerts
  - Certification status
  - Missing document identification
- **Training compliance** (DGUV):
  - Training record tracking
  - Annual refresh reminders
  - Competence verification status
- **Inspection schedules** (DGUV Vorschrift 3):
  - Electrical inspection (every 4 years)
  - Force verification (annual)
  - Biomechanical verification (annual)
- **Risk assessment tracking**:
  - Due date monitoring
  - Update trigger tracking

### Server (`server/src/`)
- **Compliance API**: Aggregate compliance status
- **Alert generation**: Deadline and expiry alerts
- **Report generation**: Compliance reports for auditors

**Key Dates Tracked:**
- April 2025: NIS2 registration
- August 2025: RED EN 18031
- January 2027: Machinery Regulation
- August 2027: EU AI Act
- December 2027: CRA

**Key Files:**
- App: Create `app/src/features/compliance/` feature module
- App: Create `app/src/features/compliance/components/ComplianceDashboard.tsx`
- Server: Create `server/src/services/ComplianceTrackerService.ts`
- Server: Create `server/src/routes/compliance.routes.ts`

### Current State
- No compliance UI exists — `app/src/features/` has no `compliance/` module
- Regulatory deadline status (as of 2026-02-19):
  - NIS2 registration (April 2025) — **already past, mark as overdue**
  - RED EN 18031 (August 2025) — **already past, mark as overdue**
  - Machinery Regulation (January 2027) — upcoming, 11 months
  - EU AI Act (August 2027) — upcoming, 18 months
  - CRA (December 2027) — upcoming, 22 months
- Existing `docs/regulatory-compliance.md` has structured compliance requirements that could seed initial data

## Test Strategy
Test deadline tracking accuracy. Test alert generation for approaching deadlines. Test gap analysis reporting. Test training record management. Test inspection schedule tracking.

## Notes
%% mc-links: [[TASK-024]] [[TASK-027]] [[TASK-033]] %%
