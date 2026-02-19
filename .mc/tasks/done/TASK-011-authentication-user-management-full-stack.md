---
id: TASK-011
aliases:
- TASK-011
title: Authentication & User Management (Full Stack)
slug: authentication-user-management-full-stack
status: done
priority: 2
owner: ''
projects: []
customers: []
tags:
- core
sprint: ''
depends_on:
- "[[TASK-001]]"
- "[[TASK-002]]"
due_date: ''
created: 2026-02-19
updated: 2026-02-19
---



# Authentication & User Management (Full Stack)

## Description
Implement complete authentication system with user registration, password management, and account settings across frontend and server.

## Details
**Full-Stack Feature spanning Frontend + Server**

### Frontend (`app/src/features/auth/`)
- **Registration UI**: Create `RegistrationForm`, `RegisterPage` using types from `auth.types.ts` (`RegisterRequest`)
- **Password Reset UI**: Create `ForgotPasswordForm`, `ResetPasswordForm`, `ForgotPasswordPage`, `ResetPasswordPage`
- **Account Settings**: Create `AccountSettingsPanel`, `ChangePasswordForm`, `AccountPage`
- **auth/api**: Wire registration endpoint `POST /auth/register`, password reset endpoints
- **auth/store**: Add registration, password reset, account settings actions to `authStore.ts`
- **auth/hooks**: Add `useRegistration()`, `usePasswordReset()`, `useAccountSettings()` hooks

### Server (`server/src/`)
- **Auth routes**: `POST /auth/register`, `POST /auth/forgot-password`, `POST /auth/reset-password`, `POST /auth/change-password`
- **AuthService**: User CRUD, password hashing with bcrypt, JWT token generation
- **Auth middleware**: JWT validation on protected routes
- **Database**: User model with Prisma schema

**Key Files:**
- Frontend: `app/src/features/auth/types/auth.types.ts`, `app/src/features/auth/api/authApi.ts`, `app/src/features/auth/store/authStore.ts`
- Server: Create `server/src/routes/auth.routes.ts`, `server/src/services/AuthService.ts`, `server/src/middleware/auth.middleware.ts`
- Server: Update `server/prisma/schema.prisma` with User model

## Test Strategy
Frontend: Unit test auth store actions, React Testing Library for form components, E2E test registration/password reset flows. Server: Supertest for auth endpoints, test password hashing, test JWT validation, test token refresh flow.
%% mc-links: [[TASK-001]] [[TASK-002]] %%
