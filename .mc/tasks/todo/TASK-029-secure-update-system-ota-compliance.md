---
id: TASK-029
aliases:
- TASK-029
title: Secure Update System OTA (Compliance)
slug: secure-update-system-ota-compliance
status: backlog
priority: 2
owner: ''
projects: []
customers: []
tags:
- compliance
- deferred
sprint: ''
depends_on:
- "[[TASK-023]]"
- "[[TASK-028]]"
due_date: ''
created: 2026-02-19
updated: 2026-02-19
---



# Secure Update System OTA (Compliance)

## Description
Implement secure over-the-air updates with signing, rollback, and approval workflows per CRA Art. 13 and MR Art. 10.

## Details
**Regulatory Compliance Feature: CRA Art. 13, MR Art. 10, Annex I**

### Server (`server/src/`)
- **Update packages**: Signed update package creation
  - Ed25519 signature on all packages
  - Version metadata and changelog
- **Update distribution**:
  - TLS 1.3 delivery only
  - Integrity verification endpoint
  - Update availability notification
- **Approval workflows**:
  - Safety update impact assessment
  - Change control board approval for safety updates
  - Dual approval for critical updates
- **Rollback management**:
  - Previous version storage
  - Rollback trigger conditions

### Robot Agent (`robot-agent/src/`)
- **Secure update client**:
  - Signature verification before install
  - Atomic updates (all-or-nothing)
  - Automatic rollback on failure
  - Anti-rollback for security updates
- **Update notifications**: User notification of available updates
- **Opt-out support**: Allow update deferral (not default)

### App (`app/src/features/updates/`)
- **Update management**: Admin interface for updates
- **Rollback controls**: Trigger rollback for fleet
- **Approval UI**: Approve pending updates

**Update Support Period: 5-10 years after market placement**

**Key Files:**
- Server: Create `server/src/services/UpdateService.ts`
- Server: Create `server/src/routes/update.routes.ts`
- Robot: Create `robot-agent/src/updates/secure-update.ts`
- App: Create `app/src/features/updates/` feature module

## Test Strategy
Test package signing and verification. Test atomic update installation. Test rollback on failure. Test anti-rollback protection. Test approval workflow. Test TLS-only delivery.

## Notes
%% mc-links: [[TASK-023]] [[TASK-028]] %%
