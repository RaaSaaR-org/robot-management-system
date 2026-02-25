---
id: TASK-023
aliases:
- TASK-023
title: Device Identity & Secure Boot (Compliance)
slug: device-identity-secure-boot-compliance
status: done
priority: 2
owner: ''
projects: []
customers: []
tags:
- compliance
- deferred
sprint: ''
depends_on:
- "[[TASK-001]]"
due_date: ''
created: 2026-02-19
updated: 2026-02-25
---




# Device Identity & Secure Boot (Compliance)

## Description
Implement unique device certificates and secure boot verification per CRA Annex I, EN 18031, and MR Annex III.

## Details
**Regulatory Compliance Feature: CRA Annex I, EN 18031, MR Annex III**

### Robot Agent (`robot-agent/src/`)
- **Device certificates**: Generate and manage unique per-device X.509 certificates
- **No default passwords**: Implement unique credential generation per device
- **Secure boot verification**: Cryptographic signature verification at startup
- **Software integrity**: Display installed software version and integrity status
- **Anti-rollback**: Prevent installation of older vulnerable versions
- **TPM integration**: Optional TPM 2.0 support for key storage
- **Device identity API**: Expose device identity information securely

### Server (`server/src/`)
- **Device registry**: Store and validate device certificates
- **Certificate issuance**: PKI infrastructure for device certificate management
- **Device provisioning**: Secure device onboarding workflow
- **Integrity verification**: Verify device software integrity on connection

**Key Files:**
- Robot: Create `robot-agent/src/security/device-identity.ts`
- Robot: Create `robot-agent/src/security/secure-boot.ts`
- Robot: Update `robot-agent/src/api/server.ts` for certificate auth
- Server: Create `server/src/services/DeviceRegistryService.ts`
- Server: Update `server/prisma/schema.prisma` with DeviceCertificate model

## Test Strategy
Test unique certificate generation per device. Test certificate-based authentication. Test software integrity verification. Test anti-rollback protection. Test device provisioning workflow.
%% mc-links: [[TASK-001]] %%
