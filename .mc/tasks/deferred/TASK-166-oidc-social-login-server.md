---
id: TASK-166
aliases:
- TASK-166
title: 'OIDC social login: server-side Google + GitHub OAuth flows'
slug: oidc-social-login-server
status: todo
priority: 3
owner: ''
projects: []
customers: []
sprint: ''
tags:
- core
- auth
- deferred
depends_on:
- TASK-153
due_date: ''
created: '2026-04-12'
---

## Description

Add "Login with Google" and "Login with GitHub" to the NeoDEM server as
OIDC/OAuth 2.0 social login providers. No dedicated IdP (Keycloak etc.) —
the server validates tokens directly from Google/GitHub and maps them to
NeoDEM users. The existing JWT session flow stays unchanged; OIDC replaces
the username/password step for users who choose social login.

**Why:** Cloud deployment will have real customers logging in. Google
Workspace covers corporate users, GitHub covers developers. Both are
standard OIDC flows with zero infra on our side.

## Current Auth State

- JWT auth in `server/src/middleware/` with RBAC
- Disabled in dev via `AUTH_DISABLED=true`
- Registration + login routes in `server/src/routes/auth.routes.ts`
- Multi-tenancy shipped (TASK-158) — users belong to Organizations
- Auth hardening planned in TASK-153

## Scope

### 1. OAuth route handlers

`server/src/routes/oauth.routes.ts` (new)

- `GET /api/auth/oauth/google` — redirect to Google OAuth consent screen
- `GET /api/auth/oauth/google/callback` — handle Google callback, validate
  ID token, create-or-link NeoDEM user, issue JWT session
- `GET /api/auth/oauth/github` — redirect to GitHub OAuth
- `GET /api/auth/oauth/github/callback` — handle callback, exchange code
  for access token, fetch user profile, create-or-link user, issue JWT

### 2. User linking

- First login: create a new User + link to an `OAuthAccount` record
  (provider, providerUserId, email)
- Returning login: find existing user by `OAuthAccount`, issue JWT
- Email match: if a user with the same email already exists (registered
  via password), link the OAuth account to that user (don't create a
  duplicate)
- Organization assignment: new OAuth users get a default org or join via
  invite link (reuse existing invite flow if present)

### 3. Prisma schema

`server/prisma/schema.prisma`

```prisma
model OAuthAccount {
  id              String   @id @default(cuid())
  provider        String   // "google" | "github"
  providerUserId  String
  email           String
  userId          String
  user            User     @relation(fields: [userId], references: [id])
  createdAt       DateTime @default(now())

  @@unique([provider, providerUserId])
}
```

### 4. Configuration

Environment variables (in `server/.env`):

```
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
OAUTH_REDIRECT_BASE_URL=https://app.emai.cloud  # or http://localhost:1420 for dev
```

OAuth is **disabled** when client IDs are not set — no impact on existing
dev workflow.

### 5. Libraries

- `google-auth-library` or just raw OIDC token validation (Google's
  `.well-known/openid-configuration` + `jwks_uri`)
- GitHub: plain `fetch` to their OAuth endpoints (no library needed)
- Avoid heavy frameworks like Passport.js — keep it minimal

## Key Files

- `server/src/routes/oauth.routes.ts` — new OAuth routes
- `server/src/routes/auth.routes.ts` — existing auth (unchanged, but
  register it alongside OAuth)
- `server/src/middleware/` — JWT middleware (unchanged)
- `server/prisma/schema.prisma` — add OAuthAccount model

## Test Strategy

- [ ] Google OAuth flow: redirect → consent → callback → JWT issued
- [ ] GitHub OAuth flow: redirect → authorize → callback → JWT issued
- [ ] Returning user: same provider login → same NeoDEM user
- [ ] Email linking: OAuth email matches existing password user → linked
- [ ] Missing env vars: OAuth routes return 404 (not 500)
- [ ] `AUTH_DISABLED=true` still bypasses everything in dev

## Non-goals

- Microsoft/Azure AD — add later if a customer needs it (same pattern)
- SAML — overkill for our scale
- Keycloak or any self-hosted IdP — unnecessary infra
