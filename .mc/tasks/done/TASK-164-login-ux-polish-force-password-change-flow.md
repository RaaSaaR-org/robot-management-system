---
id: TASK-164
aliases:
- TASK-164
title: Login UX polish + force-password-change flow
slug: login-ux-polish-force-password-change-flow
status: backlog
priority: 3
owner: ''
projects: []
customers: []
tags:
- extended
sprint: ''
depends_on:
- TASK-162
- TASK-163
due_date: ''
created: 2026-04-12
updated: 2026-04-12
---


# Login UX polish + force-password-change flow

## Description

Close two loose ends in the login UX that are required for the team flow from TASK-163 to feel complete:

1. **Force-password-change on first login.** The `User.forcePasswordChange` field exists in the schema (`schema.prisma:311`, default `true`) but nothing reads it. Wire it through so a user added via the Team page (TASK-163) with a temp password is forced to set their own before they can reach any other page.
2. **Login-page copy + error hygiene.** Remove any mention of tenant/workspace from the login page (email auto-routes to the right tenant; the user shouldn't know a tenant exists). Error messages must never leak whether an email is registered or which tenant it belongs to — return a single generic `"Incorrect email or password."` on any failure.

## Current State

- `User.forcePasswordChange: Boolean @default(true)` at `server/prisma/schema.prisma:311`. Never read by any code path (verified via grep).
- `AuthService.login()` at `server/src/services/AuthService.ts:141` returns `{ user, accessToken, refreshToken, expiresIn }`. Doesn't include any "must change password" signal.
- `AuthService.changePassword()` at `server/src/services/AuthService.ts:238` takes `(userId, currentPassword, newPassword)`, updates `passwordHash`, and deletes refresh tokens. **Does not clear `forcePasswordChange`** — needs a patch so the flag goes false after the required change.
- Login page at `app/src/features/auth/pages/LoginPage.tsx` (find the exact path during implementation — `features/auth/pages/` is the expected location).
- Auth store at `app/src/features/auth/store/authStore.ts:35-46` holds `{ user, isAuthenticated, isLoading, isInitialized, error }`. No `mustChangePassword` state yet.
- Existing change-password form lives under `app/src/features/auth/components/ChangePasswordForm.tsx` — can be reused or wrapped in a "required" mode.
- Account page at `app/src/features/auth/pages/AccountPage.tsx` already renders `ChangePasswordForm` — it's the optional path. We need a **required** path that blocks navigation.

## Implementation Plan

### 1. Server — thread `mustChangePassword` through login response

File: `server/src/services/AuthService.ts`.

- Add `mustChangePassword: boolean` to the `AuthResponse` interface (line 29-35).
- In `login()` (around line 141), after fetching the user row, read `user.forcePasswordChange` and set it on the returned payload.
- Make sure the domain `User` type from `server/src/repositories/UserRepository.ts` exposes `forcePasswordChange` (it may not today — grep `dbUserToDomain` around line 61 and add the field).
- In `changePassword()` (around line 238), after `userRepository.updatePassword(...)`, also call `userRepository.update({ id: userId, forcePasswordChange: false })`. **Or** add a dedicated `userRepository.clearForcePasswordChange(userId)` helper — cleaner.

File: `server/src/routes/auth.routes.ts` (POST `/login`).

- Response shape unchanged except `mustChangePassword` now flows through.
- Verify `/me` also surfaces it (add to the response shape at around line 243).

### 2. Frontend — block navigation when `mustChangePassword` is true

File: `app/src/features/auth/store/authStore.ts`.

- Add `mustChangePassword: boolean` to the store state.
- After a successful login (`login()` action), pull the flag from the response and set it.
- After `/me` returns (`initialize()` or `getCurrentUser()` action), also hydrate from there — so a page refresh during the "required" state still works.
- New action `clearMustChangePassword()` to call after a successful password change.

File: `app/src/features/auth/pages/ForcePasswordChangePage.tsx` (new).

- Minimal page — logo + heading "Set a new password" + reuses `ChangePasswordForm` in a "required" variant (hide the "Cancel" button if any).
- Text: "Welcome to NeoDEM. Please set a new password before continuing."
- On success, calls `clearMustChangePassword()` and navigates to `/dashboard`.

File: `app/src/App.tsx`.

- Register `/set-password` route with a light guard: if the user is authenticated AND `mustChangePassword === true`, render `ForcePasswordChangePage`. Otherwise redirect to `/dashboard`.
- Modify `ProtectedAppRoute` to redirect to `/set-password` if `mustChangePassword === true` (and the current route isn't already `/set-password`). This is the blocking mechanism — any authenticated navigation re-routes to the password set page until the flag clears.

### 3. Login page copy + error hygiene

File: `app/src/features/auth/pages/LoginPage.tsx`.

- Headline: "Sign in to NeoDEM" (no "to your workspace", no "to your tenant").
- Subtext: something neutral like "Enter your email and password."
- Catch-all error handling: any 4xx from `/login` surfaces a single message: `"Incorrect email or password."` Do not branch on error codes.
- Do the same for the network-error case: `"Can't reach the server. Try again in a moment."`
- Remove any "sign up" link if it's still present (TASK-162 closes `/register` when the flag is on; even with the flag off, marketing-style signup is out of scope for this task).

### 4. Docs

File: `docs/multi-tenancy.md`.

Add a new section after §4 "Using the Organizations UI":

```
## 5. Login — your email finds your tenant

NeoDEM uses **email-based tenant routing**. A user signs in with email +
password on a single login page — no tenant picker, no workspace URL.
Behind the scenes:

1. The `User` model has a globally unique `email` field
2. `/login` looks up the user by email, verifies the password, reads
   `user.tenantId` off the row
3. The JWT is signed with that `tenantId` and every subsequent query
   through the Prisma isolation extension scopes to the correct tenant

For @emai.dev team members who need to access multiple tenants, the
super-admin + impersonation flow (TASK-160) is the supported path — not
a tenant picker at login.

### First login (new teammate)

When an owner adds a teammate via the Team page (TASK-163), the new
user is created with `forcePasswordChange = true`. On their first
login, they're redirected to a "Set a new password" screen and blocked
from any other page until they complete it. Once they set a new
password, the flag clears and normal navigation resumes.
```

Renumber the subsequent sections.

## Key Files to Create / Modify

- `server/src/services/AuthService.ts` — `mustChangePassword` in login response, clear-on-change logic
- `server/src/repositories/UserRepository.ts` — expose `forcePasswordChange` on domain type, add `clearForcePasswordChange` helper
- `server/src/routes/auth.routes.ts` — response shapes
- `app/src/features/auth/store/authStore.ts` — new state + actions
- `app/src/features/auth/pages/LoginPage.tsx` — copy + error hygiene
- `app/src/features/auth/pages/ForcePasswordChangePage.tsx` (new)
- `app/src/App.tsx` — `/set-password` route + ProtectedAppRoute guard
- `docs/multi-tenancy.md` — new §Login section

## Test Strategy (Playwright MCP)

Prereq: server running with `MULTI_TENANCY_ENABLED=true` + TASK-163 already shipped so the Team page can add users.

1. As MOCK_USER / owner, add a new teammate `alice@example.com` via the Team page with temp password `Temp1234!`
2. Log out (or open an incognito session)
3. Log in as `alice@example.com` with `Temp1234!` → land on `/set-password`, not `/dashboard`
4. Try navigating to `/dashboard` directly → bounced back to `/set-password`
5. Try navigating to `/team` directly → bounced back to `/set-password`
6. Fill out the password form with a new password `BetterPassword2026!` → submit
7. Auto-redirect to `/dashboard` after success
8. Log out, log back in with the new password → lands on `/dashboard` directly (no redirect to `/set-password`)
9. Assert DB: `SELECT forcePasswordChange FROM User WHERE email='alice@example.com'` returns `false`
10. Login with wrong password → see generic `"Incorrect email or password."` (not "user not found" or similar)
11. Login with a non-existent email → same generic message

## Dependencies

- **TASK-162** (role model) — not a hard dependency but the login page copy updates should land in a consistent sequence.
- **TASK-163** (team page) — this task only has a real test path once users can be added via the Team UI. Schedule this one immediately after TASK-163.

## Notes

- **MOCK_USER under AUTH_DISABLED**: ensure `MOCK_USER.forcePasswordChange = false` in `auth.middleware.ts` so dev sessions don't get trapped on the set-password page.
- **Existing seeded users**: verify the `default` dev user created by `/Database/ Dev user seeded` path has `forcePasswordChange = false` — if it's `true` (the schema default), patch the seeder to explicitly set `false` for seeded users. Otherwise the first `AUTH_DISABLED=false` login after a DB reset will be stuck on the set-password screen.
- **No `forgot-password` flow changes** in this task. That still relies on email delivery which is deferred (see plan file). Users who forget their password today can be reset by an owner via the Team page: owner deactivates then re-adds them, or a future task adds an inline "reset password" button.
- **Compliance log**: add an entry to `ComplianceLogService` when `forcePasswordChange` is cleared (first-time password set), same way TASK-163 logs add/change-role events. This is a meaningful audit event.
