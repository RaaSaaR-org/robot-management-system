---
id: TASK-019
aliases:
- TASK-019
title: Session Security (Full Stack)
slug: session-security-full-stack
status: backlog
priority: 3
owner: ''
projects: []
customers: []
tags:
- extended
- deferred
sprint: ''
depends_on:
- "[[TASK-001]]"
- "[[TASK-002]]"
- "[[TASK-011]]"
due_date: ''
created: 2026-02-19
updated: 2026-02-22
---




# Session Security (Full Stack)

## Description
Implement advanced session security with timeout detection, remember me, and account lockout.

## Details
**Full-Stack Feature spanning Frontend + Server**

### Frontend (`app/src/features/auth/`)
- **Session timeout**: Implement idle detection with auto-logout after inactivity
- **Timeout warning**: Create session timeout warning modal before logout
- **Remember me**: Add "Remember Me" checkbox to `LoginForm.tsx` (type already in `LoginRequest`)
- **Idle detection**: Use `react-idle-timer` or custom hook in `AuthProvider.tsx`

### Server (`server/src/`)
- **Token refresh**: Implement refresh token rotation
- **Session expiry**: Configure short-lived access tokens (15min) + longer refresh tokens
- **Remember me**: Extend refresh token lifetime when remember me is checked (14 days vs 1 day)
- **Account lockout**: Lock account after N failed login attempts (error type `ACCOUNT_LOCKED` exists)
- **Lockout recovery**: Implement lockout timeout or admin unlock

**Note**: Robot client not affected - robots use URL-based registration, no user auth

**Key Files:**
- Frontend: `app/src/features/auth/components/LoginForm.tsx`, `app/src/app/providers/AuthProvider.tsx`
- Frontend: `app/src/features/auth/store/authStore.ts` - Add session timeout logic
- Server: Update `server/src/services/AuthService.ts` - Add lockout logic
- Server: Update `server/src/middleware/auth.middleware.ts` - Token validation

### Current State
- `authStore.ts` already maps `ACCOUNT_LOCKED` error message (line 36) — frontend display is ready, but server never triggers it
- `User` model in Prisma has no `failedLoginAttempts`, `lockedAt`, or `lockedUntil` fields — schema must be extended first
- JWT access tokens already use configurable `JWT_ACCESS_EXPIRES` (default 15min); refresh tokens have `expiresAt` in DB (default 7 days)
- `LoginForm.tsx` has no "Remember Me" checkbox; `LoginRequest` type may need extending
- `AuthProvider.tsx` calls `initialize()` on mount but has no idle timer or session timeout
- Token refresh rotation already works (`authStore.refreshSession()` → `authApi.refresh()`)

## Test Strategy
Frontend: Test session timeout triggers logout, test warning modal appears, test idle detection resets. Server: Test token refresh flow, test remember me extends session, test account locks after failed attempts, test lockout recovery.
%% mc-links: [[TASK-001]] [[TASK-002]] [[TASK-011]] %%
