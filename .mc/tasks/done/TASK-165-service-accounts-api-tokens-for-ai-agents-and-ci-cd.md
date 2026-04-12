---
id: TASK-165
aliases:
- TASK-165
title: Service accounts + API tokens for AI agents and CI/CD
slug: service-accounts-api-tokens-for-ai-agents-and-ci-cd
status: backlog
priority: 2
owner: ''
projects: []
customers: []
tags:
- core
- auth
sprint: ''
depends_on: []
due_date: ''
created: 2026-04-12
updated: 2026-04-12
---


# Service accounts + API tokens for AI agents and CI/CD

## Description

Owners need a way to mint long-lived, revocable, audit-able credentials
for non-human callers (AI agents like Kira, CI/CD pipelines, partner
integrations, embedded systems). Today the only way for a robot to talk
to the API is to bypass auth (`AUTH_DISABLED=true`) or to share a
human user's JWT — both broken: no per-agent attribution, no rotation,
no scoped revocation.

This task adds a **GitLab-style "bot user" service-account model**: a
service account is just a `User` row with `kind='service'`, no
password, that owns one or more `ApiToken` rows. Tokens authenticate
via a `Bearer ndsa_*` header. The whole thing reuses the existing
tenant isolation (Prisma extension), role middleware, and audit log
pipes from TASK-155/162/163 — no new authz concepts, just one new
column on `User` and one new table.

Out of scope for this task (deliberate, see "Follow-ups"): per-token
fine-grained scopes, OIDC federation for CI/CD, per-token IP allowlist,
GitHub secret-scanning registration. Phase 1 ships the 80% case:
long-lived tokens with expiry, rotation, and revocation. The harder
patterns are Phase 2/3 follow-up tasks.

## Current State

### What exists today

- **`User` model** (`server/prisma/schema.prisma:303-341`):
  `id, email, name, passwordHash, role: String, tenantId, isActive,
  forcePasswordChange, lastPasswordChange, lastLoginAt, mfaSecret,
  mfaEnabled, ...`. Roles after TASK-162 are
  `'super-admin' | 'owner' | 'member' | 'viewer'`.
- **Auth middleware** (`server/src/middleware/auth.middleware.ts`):
  reads `Authorization: Bearer <jwt>`, verifies via
  `authService.verifyAccessToken`, hydrates `req.user` with
  `{id, email, name, role, tenantId}`. Helpers `superAdminOnly`,
  `ownerOnly`, `memberOrAbove`, `viewerOrAbove`.
- **Tenant isolation** (`server/src/database/client.ts:80-180` +
  `server/src/middleware/tenantContext.ts`): Prisma `$extends` reads
  `req.user.tenantId` from an AsyncLocalStorage and auto-adds a
  `where: { tenantId }` clause to every query on tenant-scoped models.
  This means **anything that runs in the same `withTenantContext` will
  be auto-scoped — service accounts inherit isolation for free** as
  long as they get a `tenantId` on their `User` row.
- **`TeamService`** (`server/src/services/TeamService.ts`): owner-only
  user CRUD with `add`, `changeRole`, `deactivate`, `reactivate`,
  `assertNotLastOwner`. `ASSIGNABLE_ROLES = ['owner','member','viewer']`
  — `super-admin` is intentionally not assignable. Audit-logs every
  mutation via `complianceLogService`.
- **Team page** (`app/src/features/team/pages/TeamPage.tsx`,
  `server/src/routes/team.routes.ts`): list/add/change-role/deactivate
  members. `CredentialsHandoffModal.tsx` is the "show password once"
  pattern from TASK-163 — directly reusable for tokens.
- **Compliance audit log** (`server/src/services/ComplianceLogService.ts`):
  takes an `operatorId` and `result` per event. TeamService writes
  events with `actorId` = the human owner who performed the action.

### What's missing

- No way for a non-human caller to authenticate at all (every route
  requires either a valid JWT or `AUTH_DISABLED=true`).
- No `User.kind` column to distinguish humans from bots.
- No `ApiToken` table.
- No service-account UI on the Team page.
- Audit log records `operatorId` but has no way to express "this was a
  bot, not a human" or "this was specifically the
  github-actions-deploy token, not the kira-agent token".

## Details

### Schema (one column + one table)

```prisma
// server/prisma/schema.prisma
model User {
  // ... existing fields ...

  /// 'human' (default) or 'service'. Service accounts have null
  /// passwordHash, no MFA, no forcePasswordChange. They authenticate
  /// only via ApiToken rows (TASK-165).
  kind        String     @default("human")

  /// For service accounts, the human owner who created this account.
  /// Null for human users (they create themselves via team-add or
  /// signup). Used for audit and the Team page UI.
  createdById String?
  createdBy   User?      @relation("CreatedServiceAccounts", fields: [createdById], references: [id], onDelete: SetNull)
  servicedBy  User[]     @relation("CreatedServiceAccounts")

  apiTokens   ApiToken[]
}

model ApiToken {
  id           String    @id @default(cuid())

  userId       String
  user         User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  /// Human label, e.g. "github-actions deploy" or "kira agent prod".
  /// Required, unique per (userId).
  name         String

  /// First 12 chars of the token (e.g. "ndsa_aBc4Xz9"). Used for the
  /// auth-middleware index lookup AND for the truncated display in the
  /// Team page so owners can recognize a leaked token.
  prefix       String

  /// SHA-256 hash of the full token. Constant-time-compared on auth.
  /// The full plaintext is shown exactly once to the owner on creation
  /// and never persisted.
  hash         String

  /// Expiry. Default `now() + 90 days`, max 1 year, no "never". A null
  /// value here is reserved for future bring-your-own-PKI flows and
  /// rejected by the create endpoint today.
  expiresAt    DateTime?

  /// Best-effort fire-and-forget stamp from the auth middleware. Not
  /// used for authz, only for the Team page "last used" column and
  /// stale-token cleanup heuristics.
  lastUsedAt   DateTime?

  /// When set, the token is rejected by the auth middleware regardless
  /// of expiry. Soft-delete so audit log references stay valid.
  revokedAt    DateTime?

  createdAt    DateTime  @default(now())

  /// Human user who minted this token. Required for audit
  /// ("who issued this credential?"). Cascade-null on user delete so
  /// orphaned tokens don't keep referencing a missing user.
  createdById  String
  createdBy    User      @relation("CreatedTokens", fields: [createdById], references: [id], onDelete: NoAction)

  @@unique([userId, name])
  @@index([prefix])
  @@index([userId])
}
```

Migration is additive only — `User.kind` defaults to `'human'`, no
backfill needed.

### Token format

```
ndsa_<43-char-base64url>     // 47 chars total
```

- `ndsa_` = "neodem service account" — recognizable in pastes/grep,
  registerable with GitHub secret scanning later (Phase 2 follow-up).
- 32 random bytes via `crypto.randomBytes(32)`, base64url-encoded
  (43 chars, no padding). **Never use `Math.random()`** — it's not a
  CSPRNG and the token is the only credential the bot has.
- Stored as `sha256(token)` hex; constant-time-compared on lookup via
  `crypto.timingSafeEqual`.

### Auth middleware extension

`server/src/middleware/auth.middleware.ts` — add ONE new branch
before the existing JWT path:

```typescript
async function authenticateRequest(req): Promise<AuthUser | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);

  // Service-account token path (TASK-165)
  if (token.startsWith('ndsa_')) {
    const prefix = token.slice(0, 12);
    const expectedHash = sha256(token);
    const candidates = await prisma.apiToken.findMany({
      where: { prefix, revokedAt: null },
      include: { user: true },
    });
    for (const t of candidates) {
      if (
        t.user.isActive &&
        t.user.kind === 'service' &&
        timingSafeEqualHex(t.hash, expectedHash) &&
        (!t.expiresAt || t.expiresAt > new Date())
      ) {
        // Best-effort lastUsedAt stamp — never blocks the request
        prisma.apiToken
          .update({ where: { id: t.id }, data: { lastUsedAt: new Date() } })
          .catch((err) => logger.warn({ err, tokenId: t.id }, 'lastUsedAt stamp failed'));
        return {
          id: t.user.id,
          email: t.user.email,
          name: t.user.name,
          role: t.user.role as UserRole,
          tenantId: t.user.tenantId,
          authType: 'service',  // NEW
          tokenId: t.id,        // NEW
        };
      }
    }
    return null;
  }

  // Existing JWT path — unchanged
  return verifyJwt(token);
}
```

`AuthUser` gains two optional fields:

```typescript
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  tenantId: string | null;
  authType?: 'human' | 'service';   // NEW — defaults 'human' for JWT path
  tokenId?: string;                  // NEW — only set for service path
}
```

**Critical**: from this point on, **everything else works unchanged**.
`roleMiddleware('member')` works. `withTenantContext` reads
`req.user.tenantId` and works. The Prisma isolation extension scopes
the same way. The only delta is `req.user.authType === 'service'` for
places that want to flag it (audit log, future per-token rate limits).

### Role constraint

Service accounts max out at `member`. Reason: an `owner` can create
service accounts → if a service account could be `owner` it could
mint more `owner` accounts recursively → privilege escalation chain.
Keep the bounds explicit:

```typescript
// server/src/services/ServiceAccountService.ts
const ASSIGNABLE_SERVICE_ROLES = ['member', 'viewer'] as const;
export type AssignableServiceRole = (typeof ASSIGNABLE_SERVICE_ROLES)[number];
```

### Server

Files to create:

1. **`server/src/services/ServiceAccountService.ts`** (~300 LOC):
   - `createServiceAccount({tenantId, name, role, actorId})` → creates
     a `User` row with `kind='service'`, `passwordHash=null`,
     `forcePasswordChange=false`, `email=<slug>@service.<tenant>.local`
     (synthetic, never actually used for delivery), `createdById=actorId`.
   - `listServiceAccounts(tenantId)` → returns service-account users
     with their token counts.
   - `deleteServiceAccount(id)` → soft-delete via `isActive=false`
     (cascades to all tokens via the auth middleware's `t.user.isActive`
     check). Audit-log.
   - `createToken({serviceAccountId, name, expiresAt, actorId})` →
     generates token via `crypto.randomBytes(32)`, computes
     `prefix + hash`, persists, returns the **plaintext** exactly once.
     Default expiry = `now() + 90d`, hard cap at 1y. Audit-log.
   - `listTokens(serviceAccountId)` → tokens with `prefix`, `name`,
     `lastUsedAt`, `expiresAt`, `revokedAt`. Never returns plaintext.
   - `revokeToken(id, actorId)` → sets `revokedAt = now()`. Audit-log.
   - `rotateToken(id, actorId)` → creates a new token AND sets the old
     one's `expiresAt = now() + 24h` so consumers have a window to
     update. Returns the new plaintext.
   - All mutations require the actor to be `owner` or `super-admin` of
     the same tenant (enforced at the route layer via `ownerOnly`).

2. **`server/src/routes/service-accounts.routes.ts`** (~150 LOC) —
   mounted at `/api/team/service-accounts`:
   - `GET   /api/team/service-accounts` — list (ownerOnly)
   - `POST  /api/team/service-accounts` — create (ownerOnly)
   - `DELETE /api/team/service-accounts/:id` — soft-delete (ownerOnly)
   - `GET   /api/team/service-accounts/:id/tokens` — list tokens (ownerOnly)
   - `POST  /api/team/service-accounts/:id/tokens` — mint a token (ownerOnly)
   - `POST  /api/team/service-accounts/:id/tokens/:tokenId/rotate` — rotate (ownerOnly)
   - `DELETE /api/team/service-accounts/:id/tokens/:tokenId` — revoke (ownerOnly)
   - Mounted in `server/src/app.ts` next to the existing
     `team.routes.ts` registration.

3. **`server/src/middleware/auth.middleware.ts`** — extend the
   auth-resolution branch as described above. ~40 LOC delta.

4. **`server/src/utils/tokens.ts`** (new, ~30 LOC):
   - `generateToken()` → returns `{plaintext, prefix, hash}`
   - `hashToken(plaintext)` → returns hex sha256
   - `timingSafeEqualHex(a, b)` → wraps `crypto.timingSafeEqual` with
     length-equalisation so a length mismatch doesn't early-return
   - **Uses `crypto.randomBytes`, never `Math.random`.**

5. **`server/src/services/ComplianceLogService.ts`** — extend the
   audit event payload with two optional fields:
   - `actorType?: 'human' | 'service'`
   - `tokenId?: string`
   Set by the auth middleware on `req.user`; consumed by the
   `auditLog()` helper in TeamService and the new ServiceAccountService.

### Frontend

Files to create:

1. **`app/src/features/team/api/serviceAccountsApi.ts`** (~80 LOC) —
   typed wrappers for the 7 routes above.

2. **`app/src/features/team/types/serviceAccount.types.ts`** (~30 LOC) —
   `ServiceAccount`, `ApiTokenSummary`, `CreateServiceAccountInput`,
   `CreateTokenInput`, `RotateTokenResponse`.

3. **`app/src/features/team/store/serviceAccountsStore.ts`** (~80 LOC) —
   Zustand store for the list + currently-selected SA's tokens.

4. **`app/src/features/team/pages/TeamPage.tsx`** — extend with a
   sibling section "Service Accounts" below the existing "Team Members"
   section. Hide the section entirely from `member`/`viewer` callers.

5. **`app/src/features/team/components/ServiceAccountRow.tsx`** (new,
   ~120 LOC) — name, role badge, "created by" attribution, last-used
   summary across tokens, [Manage tokens] [Delete] actions.

6. **`app/src/features/team/components/CreateServiceAccountModal.tsx`**
   (new, ~150 LOC) — form: name, role (member|viewer), Create button.

7. **`app/src/features/team/components/ServiceAccountTokensModal.tsx`**
   (new, ~250 LOC) — opens from the [Manage tokens] action, lists
   existing tokens with [Rotate] [Revoke] per row, and a "Create new
   token" form (name + expiry picker, default 90d). When a token is
   created or rotated, opens `CredentialsHandoffModal` (existing,
   from TASK-163, no changes) with the plaintext token.

8. **`app/src/features/team/components/CredentialsHandoffModal.tsx`** —
   already exists. Reuse unchanged. Pass the token as the `credential`
   prop.

### Test strategy

#### Server

1. **Unit (`server/src/services/__tests__/ServiceAccountService.test.ts`)**:
   - `createServiceAccount` writes a `User` with `kind='service'`,
     `passwordHash=null`, `tenantId` set, returns the row.
   - Trying to set `role='owner'` or `'super-admin'` throws
     `InvalidRoleError`.
   - `createToken` returns a plaintext token of the right format
     (`ndsa_` prefix, 47 chars total), the hash matches sha256, the
     prefix matches the first 12 chars.
   - `createToken` defaults `expiresAt` to `now + 90d`, caps at 1y.
   - `revokeToken` sets `revokedAt`, doesn't delete the row (so audit
     references stay valid).
   - `rotateToken` creates a new row AND sets the old row's
     `expiresAt = now + 24h`.
   - Audit log writes happen for create/delete/token-mint/rotate/revoke
     and never block the primary mutation when audit fails.

2. **Auth middleware test
   (`server/src/__tests__/auth-middleware.test.ts`)**: existing file,
   add cases:
   - `Bearer ndsa_<valid token>` → returns the user with
     `authType='service'`, `tokenId` set.
   - `Bearer ndsa_<expired>` → returns null.
   - `Bearer ndsa_<revoked>` → returns null.
   - `Bearer ndsa_<token whose user is inactive>` → returns null.
   - `Bearer ndsa_<token whose user kind='human'>` → returns null
     (defense in depth — should never happen but proves the check is
     there).
   - Constant-time comparison verified by mutating one byte of the
     hash and confirming rejection.

3. **Integration
   (`server/src/__tests__/service-accounts.integration.test.ts`,
   new file)**:
   - Create an owner via `TeamService`, log in, mint a service account,
     mint a token under it, hit `GET /api/robots` with the
     `Bearer ndsa_...` header → 200, with the JWT for the same owner →
     200, with no header → 401.
   - Tenant isolation: create two tenants, mint a service account in
     each, verify a token from tenant A only sees tenant A's robots.
   - Last-used stamp: hit `GET /api/robots` with the token, verify
     `lastUsedAt` updates within 1s.
   - Rotate: rotate a token, verify the old token still works for ~24h
     (or until its `expiresAt`) and the new one works immediately.
   - Revoke: revoke a token, verify the next request with that token
     returns 401.

#### Frontend

4. **`app/src/features/team/pages/__tests__/TeamPage.service-accounts.test.tsx`**
   (new):
   - Service-accounts section is hidden for `member`/`viewer` users.
   - Visible for `owner`/`super-admin`.
   - Create flow: click "Create service account" → fill form → submit →
     see new row.
   - Token flow: click "Manage tokens" → click "Create new token" →
     `CredentialsHandoffModal` opens with a `ndsa_*` token.
   - Revoke flow: click revoke → confirm → row updates with revoked
     state.

#### Manual

5. **`./scripts/test-all.sh`** stays clean (typecheck + e2e).
6. Manual smoke against the local stack:
   - Mint a service account with role `member`, create a token, copy
     it from the modal.
   - `curl -H "Authorization: Bearer ndsa_..." http://localhost:3001/api/robots`
     → returns the same robots a member would see.
   - `curl -H "Authorization: Bearer ndsa_..." http://localhost:3001/api/team`
     → 403 (members can't list team).
   - Revoke the token via the UI; re-curl → 401.

### Key files

#### Modify
- `server/prisma/schema.prisma` — add `User.kind`, `User.createdById`, new `ApiToken` model
- `server/src/middleware/auth.middleware.ts` — extend `authenticateRequest` with the `Bearer ndsa_*` branch + add `authType`/`tokenId` to `AuthUser`
- `server/src/services/ComplianceLogService.ts` — accept optional `actorType`/`tokenId` on audit events
- `server/src/services/TeamService.ts` — pipe `req.user.authType` and `req.user.tokenId` into the existing `auditLog()` helper
- `server/src/app.ts` — register `service-accounts.routes.ts`
- `app/src/features/team/pages/TeamPage.tsx` — sibling section
- `app/src/features/team/index.ts` — re-exports

#### Create
- `server/src/services/ServiceAccountService.ts`
- `server/src/routes/service-accounts.routes.ts`
- `server/src/utils/tokens.ts` (token generation, hashing, constant-time compare)
- `server/prisma/migrations/<timestamp>_service-accounts/migration.sql` (additive)
- `server/src/services/__tests__/ServiceAccountService.test.ts`
- `server/src/__tests__/service-accounts.integration.test.ts`
- `app/src/features/team/api/serviceAccountsApi.ts`
- `app/src/features/team/types/serviceAccount.types.ts`
- `app/src/features/team/store/serviceAccountsStore.ts`
- `app/src/features/team/components/ServiceAccountRow.tsx`
- `app/src/features/team/components/CreateServiceAccountModal.tsx`
- `app/src/features/team/components/ServiceAccountTokensModal.tsx`
- `app/src/features/team/pages/__tests__/TeamPage.service-accounts.test.tsx`

#### Reuse unchanged
- `app/src/features/team/components/CredentialsHandoffModal.tsx` — same modal that handles the human first-login password
- `server/src/services/ComplianceLogService.ts` — already takes `operatorId`; just gain two new optional fields
- `server/src/middleware/tenantContext.ts` — auto-scopes by `req.user.tenantId`, works unchanged for service paths
- `server/src/database/client.ts` Prisma `$extends` isolation — works unchanged

#### Do NOT touch
- `server/src/services/AuthService.ts` — JWT issuance is unrelated to opaque service tokens
- `server/src/repositories/UserRepository.ts` — `User.kind` is read directly via `prisma.user`, no repo changes needed (the repo only matters for the JWT auth path)
- The legacy `authMiddleware` consumers — they all read `req.user.role` and `req.user.tenantId`, both populated identically for service-account requests

## Acceptance Criteria

- [ ] Owners can mint a service account from the Team page with role `member` or `viewer` (never `owner`/`super-admin`)
- [ ] Owners can mint, list, rotate, and revoke API tokens under a service account; plaintext is shown exactly once via `CredentialsHandoffModal`
- [ ] Default token expiry is 90 days; max is 365 days; "no expiry" is rejected by the create endpoint
- [ ] `Bearer ndsa_...` requests are accepted by every existing route the service account's role allows, and rejected by routes it doesn't (`roleMiddleware` works unchanged)
- [ ] Tenant isolation holds: a token from tenant A cannot read or write tenant B data (Prisma extension auto-scopes)
- [ ] Token `lastUsedAt` updates on each successful auth; `revokedAt` is honored immediately
- [ ] Token rotation gives the old token a 24h grace window
- [ ] Audit log records every service-account create/delete and token mint/rotate/revoke, including the human `actorId` and (for token-use events) the `tokenId` and `actorType: 'service'`
- [ ] Tokens are generated via `crypto.randomBytes(32)`, hashed with sha256, compared with `crypto.timingSafeEqual` — **no `Math.random()`**
- [ ] Member/viewer users get 403 when they try to hit any `/api/team/service-accounts/*` route
- [ ] TypeScript: 0 errors in app + server
- [ ] `./scripts/test-all.sh --skip-pw` passes (typecheck + training e2e)
- [ ] New unit + integration tests pass

## Notes

This is **Phase 1 only** — long-lived tokens, single-role inheritance,
no scopes. Phase 2 / 3 are deliberate follow-up tasks:

- **Phase 2 (hardening)**: per-token scopes (`robots:read`,
  `datasets:write`, etc.), per-token IP allowlist, GitHub
  secret-scanning registration for the `ndsa_` prefix, per-token
  `express-rate-limit`. Worth a separate task once Phase 1 has been
  exercised in production.
- **Phase 3 (OIDC federation)**: trust-policy table per tenant, JWT
  exchange endpoint, GitHub Actions sample workflow. Removes the need
  for long-lived tokens for any OIDC-capable CI provider. Worth a
  separate task — this is the "right" answer for CI/CD but doesn't
  block the AI-agent use case.

### Implementation notes

- The synthetic email for service-account `User` rows
  (`<slug>@service.<tenant>.invalid`) uses the `.invalid` TLD reserved
  by RFC 2606 so it can never accidentally route to a real mailbox.

### Why not these alternatives

- **Separate `ServiceAccount` model instead of reusing `User`**:
  doubles the auth surface area — two tenant isolation paths, two role
  checks, two audit codepaths. The GitLab "bot user" pattern is the
  right abstraction.
- **Tenant-level API keys (Stripe-style)**: loses per-agent
  attribution. "Which agent updated this robot?" → "the tenant key".
  Bad fit for fleet management; great fit for billing. Wrong tradeoff.
- **JWT-only service tokens**: can't be revoked without a blacklist
  check on every request — at which point you might as well use
  opaque tokens with `lastUsedAt` and skip the JWT crypto.
- **No expiry on tokens**: NIST SP 800-63B and every recent breach
  review say expire credentials. 90d default with 1y max, no "never"
  option.
