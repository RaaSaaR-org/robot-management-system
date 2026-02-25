---
id: TASK-022
aliases:
- TASK-022
title: Multi-Factor Authentication (Compliance)
slug: multi-factor-authentication-compliance
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
- "[[TASK-011]]"
- "[[TASK-019]]"
due_date: ''
created: 2026-02-19
updated: 2026-02-25
---




# Multi-Factor Authentication (Compliance)

## Description
Implement FIDO2/WebAuthn and TOTP MFA per NIS2 Art. 21(2)(j) and CRA Annex I requirements.

## Details
**Regulatory Compliance Feature: NIS2 Art. 21(2)(j), CRA Annex I**

### Server (`server/src/`)
- **FIDO2/WebAuthn**: Primary MFA method implementation
  - Registration flow for security keys
  - Authentication flow with challenge/response
  - Multiple key support per user
- **TOTP fallback**: RFC 6238 TOTP as fallback option
  - Secret generation and QR code display
  - 6-digit code verification with time window
- **Account lockout**: Lock after 5 failed MFA attempts
- **Password requirements**: Minimum 12 characters, complexity rules
- **First-use credential change**: Force password change on first login
- **Privileged access management**: Enhanced auth for admin operations

### App (`app/src/features/auth/`)
- **MFA enrollment UI**: Security key registration, TOTP setup
- **MFA challenge UI**: WebAuthn prompt, TOTP code input
- **Recovery codes**: Display and manage recovery codes
- **MFA settings**: Enable/disable MFA methods

**Key Files:**
- Server: Create `server/src/services/MFAService.ts`
- Server: Update `server/src/routes/auth.routes.ts` with MFA endpoints
- Server: Update `server/prisma/schema.prisma` with MFACredential model
- App: Create `app/src/features/auth/components/MFAEnrollment.tsx`
- App: Create `app/src/features/auth/components/MFAChallenge.tsx`

## Test Strategy
Test FIDO2 registration and authentication flow. Test TOTP code generation and verification. Test account lockout after failed attempts. Test password complexity requirements. Test recovery code usage.
%% mc-links: [[TASK-011]] [[TASK-019]] %%
