---
id: TASK-026
aliases:
- TASK-026
title: GDPR Rights Self-Service Portal (Compliance)
slug: gdpr-rights-self-service-portal-compliance
status: done
priority: 2
owner: ''
projects: []
customers: []
tags:
- compliance
sprint: ''
depends_on:
- "[[TASK-011]]"
- "[[TASK-016]]"
due_date: ''
created: 2026-02-19
updated: 2026-02-19
---



# GDPR Rights Self-Service Portal (Compliance)

## Description
Implement GDPR data subject rights portal per Articles 15-22 (access, rectification, erasure, portability, objection).

## Details
**Regulatory Compliance Feature: GDPR Articles 15-22**

### Server (`server/src/`)
- **Art. 15 Access**: Self-service data export endpoint
  - Compile all user data
  - Third-party pixelation for CCTV
  - 30-day response SLA tracking
- **Art. 16 Rectification**: Data correction interface
  - Edit interface for correctable data
  - Audit trail of corrections
- **Art. 17 Erasure**: Automated deletion workflows
  - Right to be forgotten requests
  - Exception handling (legal retention)
- **Art. 18 Restriction**: Data flagging mechanism
  - Processing limitation during disputes
- **Art. 20 Portability**: Machine-readable export
  - JSON/CSV export formats
  - Automated data only
- **Art. 21 Object**: Objection registration
  - Re-assessment workflow
- **Art. 22 ADM Safeguards**: Automated decision making
  - Human intervention queue
  - Contest workflow
  - 72-hour acknowledgment SLA

### App (`app/src/features/privacy/`)
- **Privacy portal**: Self-service GDPR rights interface
- **Data export**: Download personal data
- **Deletion request**: Submit erasure requests
- **Consent management**: View and manage consents
- **Request tracking**: Track GDPR request status

**Key Files:**
- Server: Create `server/src/services/GDPRService.ts`
- Server: Create `server/src/routes/gdpr.routes.ts`
- Server: Update `server/prisma/schema.prisma` with GDPRRequest model
- App: Create `app/src/features/privacy/` feature module
- App: Create `app/src/features/privacy/components/PrivacyPortal.tsx`

## Test Strategy
Test data export completeness. Test erasure workflow including exceptions. Test portability export formats. Test request SLA tracking. Test human intervention queue for ADM. Test third-party data pixelation.

## Notes
%% mc-links: [[TASK-011]] [[TASK-016]] %%
