---
id: TASK-167
aliases:
- TASK-167
title: 'OIDC social login: frontend Google + GitHub login buttons'
slug: oidc-social-login-frontend
status: todo
priority: 3
owner: ''
projects: []
customers: []
sprint: ''
tags:
- frontend
- auth
- deferred
depends_on:
- TASK-166
due_date: ''
created: '2026-04-12'
---

## Description

Add "Login with Google" and "Login with GitHub" buttons to the NeoDEM
login page. These redirect to the server's OAuth endpoints (TASK-166).
The server handles the full OAuth flow and returns a JWT — the frontend
just needs to initiate the redirect and handle the token on return.

## Current State

- Login page exists in `app/src/features/auth/`
- Uses email/password form → `POST /api/auth/login` → stores JWT
- Auth store in Zustand manages the session

## Scope

### 1. Login page — social buttons

`app/src/features/auth/` (find the login component)

- Add "Continue with Google" and "Continue with GitHub" buttons below
  the existing email/password form
- Visual separator: "— or —" between form and social buttons
- Google button: white background, Google logo, "Continue with Google"
- GitHub button: dark background, GitHub logo, "Continue with GitHub"
- Each button links to `${API_BASE_URL}/api/auth/oauth/google` (or
  `/github`) — plain redirect, not an API call
- Buttons only render when the server reports those providers as
  available (check `GET /api/auth/providers` or similar — coordinate
  with TASK-166)

### 2. Callback handling

After OAuth, the server redirects back to the app with a JWT (e.g.
`/auth/callback?token=xxx` or sets an httpOnly cookie). The frontend:

- Reads the token from the URL or cookie
- Stores it in the auth Zustand store (same as password login)
- Redirects to `/dashboard`
- Clears the token from the URL

### 3. Account settings

`app/src/features/settings/` or `app/src/features/auth/`

- Show linked OAuth accounts (Google, GitHub) in user settings
- Allow linking additional providers to an existing account
- Allow unlinking (only if password login is set up as fallback)

## Key Files

- `app/src/features/auth/` — login page component
- `app/src/features/auth/` or `app/src/store/` — auth store
- `app/src/features/settings/` — account settings

## Design

- Follow the existing dark theme (#141414 base, #FF6700 accent)
- Google brand guidelines: use their official button style
- GitHub: dark button with Octocat or GitHub mark
- Mobile-responsive: buttons stack vertically on small screens

## Test Strategy

- [ ] Google button visible on login page, redirects to server OAuth
- [ ] GitHub button visible on login page, redirects to server OAuth
- [ ] After OAuth callback, user lands on dashboard with valid session
- [ ] Buttons hidden when provider not configured (no broken links)
- [ ] `npx tsc --noEmit` in `app/` → 0 errors
