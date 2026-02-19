---
id: TASK-035
aliases:
- TASK-035
title: Human Approval Workflows (Compliance)
slug: human-approval-workflows-compliance
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
- "[[TASK-031]]"
due_date: ''
created: 2026-02-19
updated: 2026-02-19
---



# Human Approval Workflows (Compliance)

## Description
Implement human approval workflows for automated decisions per GDPR Art. 22 and AI Act Art. 14.

## Details
**Regulatory Compliance Feature: GDPR Art. 22, AI Act Art. 14**

### Server (`server/src/`)
- **Approval workflows**:
  - Performance evaluation affecting worker: 48-hour SLA human review
  - Shift/role change based on performance: Supervisor approval required
  - Disciplinary action trigger: Manager sign-off mandatory (cannot proceed without)
  - Safety parameter modification: Dual approval (safety officer + admin)
  - Software update affecting safety: Change control board + rollback plan
- **Worker rights** (EDPB WP251):
  - Obtain human intervention endpoint
  - Express viewpoint submission
  - Contest decision workflow
- **Approval tracking**:
  - SLA monitoring
  - Escalation paths
  - Audit trail of approvals
- **Meaningful oversight**:
  - Active engagement verification
  - No rubber-stamping detection
  - Authority and competence verification

### App (`app/src/features/approvals/`)
- **Approval queue**: Pending approvals dashboard
- **Review interface**: Decision review with context
- **Escalation management**: Handle overdue approvals
- **Worker portal**: Submit viewpoints, contest decisions

**Key Files:**
- Server: Create `server/src/services/ApprovalWorkflowService.ts`
- Server: Create `server/src/routes/approval.routes.ts`
- Server: Update `server/prisma/schema.prisma` with Approval, ApprovalChain models
- App: Create `app/src/features/approvals/` feature module
- App: Create `app/src/features/approvals/components/ApprovalQueue.tsx`

## Test Strategy
Test approval workflow routing. Test SLA enforcement and escalation. Test dual approval for safety changes. Test worker viewpoint submission. Test contest workflow. Test meaningful oversight verification.

## Notes
%% mc-links: [[TASK-011]] [[TASK-031]] %%
