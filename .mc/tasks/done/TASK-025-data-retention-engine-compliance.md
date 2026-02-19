---
id: TASK-025
aliases:
- TASK-025
title: Data Retention Engine (Compliance)
slug: data-retention-engine-compliance
status: done
priority: 2
owner: ''
projects: []
customers: []
tags:
- compliance
sprint: ''
depends_on:
- "[[TASK-016]]"
- "[[TASK-024]]"
due_date: ''
created: 2026-02-19
updated: 2026-02-19
---



# Data Retention Engine (Compliance)

## Description
Implement automated data retention enforcement per AI Act Art. 19, GDPR Art. 5(1)(e), and MR Annex III.

## Details
**Regulatory Compliance Feature: AI Act Art. 19, GDPR Art. 5(1)(e), MR Annex III**

### Server (`server/src/`)
- **Retention policies**: Create RetentionPolicyService
  - Configurable retention periods per data type
  - Automated deletion scheduling (cron jobs)
  - Exception handling for legal holds
- **Data categories and periods:**
  - Technical documentation: 10 years
  - Safety software versions: 5 years per upload
  - AI decision logs: 1 year minimum
  - Deployer operational logs: 6 months
  - CCTV/video (no incident): 72 hours-7 days
  - Training records: 2 years
  - First aid/incident records: 5 years
- **Deletion audit**: Create proof-of-deletion logs
- **Legal hold**: Suspend deletion for data under legal hold
- **Archive tier**: Move data to cold storage before deletion

**Key Files:**
- Server: Create `server/src/services/RetentionPolicyService.ts`
- Server: Create `server/src/jobs/retention-cleanup.ts`
- Server: Create `server/src/routes/retention.routes.ts`
- Server: Update `server/prisma/schema.prisma` with RetentionPolicy, LegalHold models

## Test Strategy
Test automated deletion at retention periods. Test deletion audit logging. Test legal hold prevents deletion. Test archive tier functionality. Test configurable retention per data type.

## Notes
%% mc-links: [[TASK-016]] [[TASK-024]] %%
