# Multi-Tenancy Guide

Row-level multi-tenancy lets one NeoDEM deployment serve multiple customer organizations
from a single database. Each organization sees only its own robots, datasets, and training
jobs — while sharing the same server, UI, and infrastructure.

The feature is **optional** and off by default. Single-tenant deployments are identical to
"pre-multi-tenancy" NeoDEM with zero overhead.

---

## TL;DR

```bash
# server/.env
MULTI_TENANCY_ENABLED=true
```

Restart the server → `[MULTI_TENANCY] enabled (row-level isolation active)` in the startup
log → an **Admin › Organizations** entry appears in the sidebar → the TopBar shows the
current tenant name. That's it. Click **Create organization** or **Load sample (Acme
Robotics)** to try it.

---

## Contents

1. [When to enable it](#1-when-to-enable-it)
2. [Architecture](#2-architecture)
3. [Configuration](#3-configuration)
4. [Using the Organizations UI](#4-using-the-organizations-ui)
5. [Developer guide: scoped models](#5-developer-guide-scoped-models)
6. [Escape hatch: `runAsPlatform`](#6-escape-hatch-runasplatform)
7. [Current limitations](#7-current-limitations)
8. [Troubleshooting](#8-troubleshooting)
9. [Reference: files + endpoints](#9-reference-files--endpoints)

---

## 1. When to enable it

Enable multi-tenancy when **any** of these are true:

- You want to run live customer demos of the "SaaS shape" (one server, many isolated
  customers).
- You plan to onboard a second customer onto the same deployment.
- You're building customer-facing features that must respect data boundaries.

Keep it **off** when:

- You're running a single-customer pilot (the default for most local dev).
- You want fastest possible query paths with zero middleware overhead.
- You haven't yet validated that all the entities you care about are in the tenant-scoped
  allowlist (see [§7](#7-current-limitations)).

Either mode is production-safe; the toggle is reversible and the schema is identical.
Data created while the flag was on continues to work with the flag off — the Prisma
extension just stops filtering.

---

## 2. Architecture

### The four pieces

```
┌──────────────────────────────────────────────────────────────────┐
│  MULTI_TENANCY_ENABLED=true                                       │
│                                                                    │
│   request ─┐                                                       │
│            ▼                                                       │
│   authMiddleware  ──────┐                                          │
│     sets req.user       │ reads req.user.tenantId                  │
│                         ▼                                          │
│                  tenantStore.run({ tenantId }, next)              │
│                         │ AsyncLocalStorage                       │
│                         ▼                                          │
│   service / repository → prisma.robot.findMany({ where: {...} })  │
│                         │                                          │
│                         ▼                                          │
│   Prisma $extends tenant-isolation                                 │
│     • getTenantId() from ALS                                       │
│     • injects where.tenantId / data.tenantId                       │
│       (only for models in TENANT_SCOPED_MODELS)                    │
│                         │                                          │
│                         ▼                                          │
│                     database                                       │
└──────────────────────────────────────────────────────────────────┘
```

- **Feature flag** (`server/src/config/features.ts`) — `MULTI_TENANCY_ENABLED`. When
  `false`, every piece below short-circuits into a passthrough.
- **Tenant context** (`server/src/middleware/tenantContext.ts`) — a Node
  `AsyncLocalStorage` carrying the current request's `tenantId`. Set by `authMiddleware`
  from the JWT claim (or `MOCK_USER.tenantId` in `AUTH_DISABLED=true` mode).
- **Prisma client extension** (`server/src/database/client.ts`) — auto-injects
  `where.tenantId` on reads, `data.tenantId` on writes, and an ownership check on
  `update`/`delete` for any model in the `TENANT_SCOPED_MODELS` allowlist.
- **Seeder** (`server/src/database/seedTenant.ts`) — on boot, upserts a `DEFAULT` tenant
  and backfills any still-null `tenantId` columns. Idempotent.

### Why an allowlist, not "all models"

NeoDEM has 85 Prisma models. Adding `tenantId` columns + FKs + indexes to all of them in
one shot is a large blast-radius migration. Instead, multi-tenancy rolls out in **waves**:

- **Wave 1** (shipped): `User`, `Robot`, `Dataset`, `TrainingJob`.
- **Wave 2+** (future): `Fleet`, `Zone`, `Alert`, `Incident`, `ProcessDefinition`,
  `ProcessInstance`, `RobotTask`, `Command`, `ModelVersion`, `Deployment`,
  `ApprovalRequest`, `Conversation`, `Event`, `SimulationJob`, `SyntheticJob`, `Message`.

The allowlist is the single source of truth for "which models are tenant-scoped". Adding
a model to it without also adding the FK column is a runtime error — that's intentional,
it catches mistakes at startup.

### Why `AsyncLocalStorage`

`tenantId` has to reach every Prisma call inside a request. Threading it through 20
repositories and 57 services would touch thousands of lines. ALS lets the extension pull
the value at query time from ambient context, so **zero repository code had to change**
when Wave 1 shipped.

---

## 3. Configuration

### Enable the feature

```bash
# server/.env
MULTI_TENANCY_ENABLED=true
```

Then restart the server. You should see:

```
[MULTI_TENANCY] enabled (row-level isolation active)
[MULTI_TENANCY] DEFAULT tenant ready (nothing to backfill)
```

On a fresh DB (or the first time you flip the flag on), the seeder logs how many rows
it stamped with the DEFAULT tenant:

```
[MULTI_TENANCY] backfilled 11 row(s) to DEFAULT tenant
```

### Disable it

Set `MULTI_TENANCY_ENABLED=false` (or unset it) and restart. Startup log reads
`[MULTI_TENANCY] disabled (single-tenant mode)`, the Organizations UI disappears from the
sidebar, the TopBar badge hides, and all queries run without tenant filtering. Existing
`tenantId` columns are ignored — data created under either mode continues to work.

### Dev mode (`AUTH_DISABLED=true`)

The dev mock user (`server/src/middleware/auth.middleware.ts`) carries `tenantId:
'default'`, so the full UI flow (badge, list, create, delete) works end-to-end without
real auth.

### Environment matrix

| Flag state                | `AUTH_DISABLED` | Badge | Sidebar entry | Extension active |
|---------------------------|-----------------|-------|---------------|------------------|
| `false` (default)          | either           | ❌     | ❌             | ❌ (passthrough)  |
| `true`                     | `true` (dev)     | ✅     | ✅             | ✅ (scopes as DEFAULT)|
| `true`                     | `false` (prod)   | ✅     | ✅             | ✅ (scopes as JWT claim)|

---

## 4. Using the Organizations UI

### Finding it

When multi-tenancy is enabled, a new **Admin** group appears at the bottom of the
sidebar with a single **Organizations** entry. The top bar shows a compact pill (e.g.
`🏢 Default Tenant`) indicating which organization you're currently operating as.

### Creating an organization

Two paths:

1. **Custom**: click **Create organization** at the top of the page. Fill in the
   organization name (e.g. "Contoso Logistics") — the URL slug auto-fills (`contoso-logistics`)
   but is editable. Click **Create organization** in the modal.
2. **Sample (one click)**: when there are no customer tenants yet, the empty state
   offers a **Load sample (Acme Robotics)** button that prefills the form and submits
   it for you. Designed for live demos.

Slug rules: lowercase letters, digits, and hyphens only, max 64 chars, must be unique.
Validation errors surface the **server's** message directly (e.g. `Slug "acme" is already
in use` or `slug must be lowercase alphanumerics + hyphens`).

### Stat tiles = isolation story

Each organization card shows four tiles: **Users / Robots / Datasets / Jobs**. A brand
new tenant shows `0 / 0 / 0 / 0` while the `DEFAULT` tenant shows whatever existed before
you enabled multi-tenancy — that's the whole isolation story in one screenshot.

### Deleting an organization

- The `DEFAULT` tenant cannot be deleted (system-protected).
- A tenant that still has users/robots/datasets/jobs cannot be deleted (server returns
  409 with the counts); migrate or delete those rows first.
- Non-empty customer tenants show a two-step confirm-then-delete button inline on the
  card.

---

## 5. Login — your email finds your tenant

NeoDEM uses **email-based tenant routing**. A user signs in with email + password on a
single login page — no tenant picker, no workspace URL. Behind the scenes:

1. The `User` model has a globally unique `email` field.
2. `POST /api/auth/login` looks up the user by email, verifies the password, and reads
   `user.tenantId` off the row.
3. The JWT is signed with that `tenantId` and every subsequent query through the Prisma
   isolation extension scopes to the correct tenant.

Error messages on the login page are intentionally generic (`Incorrect email or
password.`) so we don't leak whether an email is registered or which tenant it belongs
to. The "Create one" signup link is hidden while `MULTI_TENANCY_ENABLED=true` — new
users are added by their organization owner via the Team page.

For `@emai.dev` team members who need to access multiple tenants, the super-admin +
impersonation flow (TASK-160) is the supported path, not a tenant picker at login.

### First login (new teammate)

When an owner adds a teammate via the Team page (TASK-163), the new user is created
with `forcePasswordChange = true`. On their first login:

1. `AuthService.login` returns the access + refresh tokens as normal plus a
   `mustChangePassword: true` flag on the response.
2. The `/me` endpoint also exposes `forcePasswordChange` so a page refresh during the
   "required" state still works.
3. The frontend authStore hydrates a `mustChangePassword` flag from both sources.
4. `ProtectedAppRoute` sees the flag and redirects every protected route to
   `/set-password` until the user completes the change.
5. `ChangePasswordForm` calls `POST /api/auth/change-password`, the server clears
   `forcePasswordChange` inside `UserRepository.updatePassword`, and the store mirrors
   the reset. Navigation resumes normally.

**MOCK_USER under `AUTH_DISABLED=true`** is returned with `forcePasswordChange: false`
by the `/me` route so dev sessions never get trapped on `/set-password`.

---

## 6. Developer guide: scoped models

### Adding a model to the allowlist (follow-up waves)

```prisma
// 1. schema.prisma — add the nullable FK + composite index
model Alert {
  // ... existing fields
  tenantId String?
  tenant   Tenant? @relation(fields: [tenantId], references: [id])

  @@index([tenantId, createdAt])
}

model Tenant {
  // ... existing
  alerts Alert[]   // ← add back-reference
}
```

```ts
// 2. server/src/database/client.ts — add to the allowlist
const TENANT_SCOPED_MODELS = new Set<string>([
  'User',
  'Robot',
  'Dataset',
  'TrainingJob',
  'Alert',   // ← new
]);
```

```sql
-- 3. Write a migration that adds the column + FK + index
ALTER TABLE "Alert" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "Alert_tenantId_createdAt_idx" ON "Alert"("tenantId", "createdAt");
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
```

```ts
// 4. server/src/database/seedTenant.ts — extend the backfill loop
await prisma.alert.updateMany({
  where: { tenantId: null },
  data: { tenantId: DEFAULT_TENANT_ID },
});
```

Restart the server; the seeder logs the backfill count and the Prisma extension
immediately starts scoping the new model.

### What the extension does per operation

For any call on an allowlisted model, while `getTenantId()` is non-undefined:

| Operation                                | Behaviour                                      |
|------------------------------------------|------------------------------------------------|
| `findMany`, `findFirst[OrThrow]`, `count`, `aggregate`, `groupBy` | Spread `where`, append `where.tenantId = <current>` |
| `findUnique[OrThrow]`                    | Run, then **post-filter** (Prisma rejects non-unique filters on `findUnique`). Mismatch → `null` or `TenantNotFound` |
| `create`                                 | Spread `data`, append `data.tenantId = <current>` |
| `createMany`                             | Same, per row                                  |
| `upsert`                                 | Scope `where.tenantId` AND stamp `create.tenantId` |
| `update`, `delete`                        | `findUnique` to verify ownership, throw on mismatch, then let the mutation through |
| `updateMany`, `deleteMany`                | Spread `where`, append `where.tenantId = <current>` |

Outside a request scope (background workers, seeds, cron jobs), `getTenantId()` returns
`undefined` and the extension is a passthrough.

---

## 7. Escape hatch: `runAsPlatform`

Sometimes you need to query across tenants on purpose — typically operator-level code
like the Organizations UI counting robots per tenant. If you just called
`prisma.robot.count({ where: { tenantId: 'acme' } })` from inside a request scope,
the extension would **override** your explicit filter with the caller's tenantId.

Use `runAsPlatform` to escape the ALS scope for the duration of a callback:

```ts
import { runAsPlatform } from '../middleware/tenantContext.js';

async function countsFor(tenantId: string) {
  return runAsPlatform(async () => {
    // Extension is a passthrough inside this block — explicit
    // `where.tenantId` filters are respected.
    return {
      robots: await prisma.robot.count({ where: { tenantId } }),
      datasets: await prisma.dataset.count({ where: { tenantId } }),
    };
  });
}
```

Under the hood it runs the callback inside `tenantStore.run({ tenantId: PLATFORM_TENANT })`
and `getTenantId()` treats the sentinel as "no tenant".

> ⚠️ **Use sparingly.** `runAsPlatform` is a privilege escalation. Never call it from a
> handler that a regular tenant user can reach without additional authorisation.
> `TenantService.countsFor()` is the canonical example — it's only invoked by the
> `/api/tenants` list endpoint, which itself is operator-facing.

---

## 8. Current limitations

- **Only 4 models are tenant-scoped** (Wave 1): `User`, `Robot`, `Dataset`, `TrainingJob`.
  Alerts, incidents, processes, deployments, etc. still ignore `tenantId`. If a card's
  stat tile shows a count for a not-yet-scoped model, that number reflects the whole
  database — don't trust it as isolation evidence until the model lands in the allowlist.
- **No tenant switcher.** The current user is pinned to one tenant for the session. A
  super-admin impersonation flow is a future wave, not in scope today.
- **No edit flow.** You can create and delete tenants but not rename or re-brand them.
- **Single-tenant user model.** A given `User` row belongs to exactly one tenant. No
  "user in multiple tenants" support.
- **Signup is invite-only when `MULTI_TENANCY_ENABLED=true`** (TASK-162). Anonymous
  `POST /api/auth/register` returns 403 — new users must be added by their organization
  owner via the Team page (TASK-163). Single-tenant deployments keep the legacy public
  signup flow.
- **`GET /api/tenants` / `POST /api/tenants` / `DELETE /api/tenants/:id` are super-admin
  only** (TASK-162). `GET /api/tenants/current` stays reachable for any authenticated
  user so the TopBar badge can render.

### Role model (TASK-162)

The unified `UserRole` union replaces the legacy `admin | operator | viewer` triple:

| Role | `tenantId` | Can do |
|---|---|---|
| `super-admin` | `null` | Everything, including list/create/delete tenants and impersonate (TASK-160) |
| `owner` | non-null | Full control of their own tenant: team management, settings, all data |
| `member` | non-null | Operate robots, run training, manage datasets — everything except team/billing |
| `viewer` | non-null | Read-only access to dashboards, metrics, and robot state |

Legacy values are migrated by `20260412000000_task_162_unified_role_model`:
`admin → owner`, `operator → member`, `viewer → viewer`.

---

## 9. Troubleshooting

### "The page loads but all stat tiles show the same counts"

You probably forgot to wrap `countsFor` in [`runAsPlatform`](#6-escape-hatch-runasplatform).
Inside a request scope, the extension overrides explicit `where.tenantId` filters with
the caller's tenantId, so every card ends up showing the *current user's* counts.

### "Create organization fails with a generic error"

The API client's error extraction reads both `data.message` and `data.error` shapes, so
as long as the server returns 4xx/5xx with `{error: "..."}` or `{message: "..."}`, the
modal shows the real text. If you're still seeing "Failed to create organization":

1. Open the browser devtools Network tab, look at the failing `/api/tenants` POST.
2. Check the response JSON shape — if the server returned a non-standard shape, update
   `createApiError()` in `app/src/api/client.ts` to read the new field.

### "Seeder runs on every boot"

Check the logs — `backfilled N row(s)` only appears when there were rows with `tenantId
IS NULL`. Normal state is `DEFAULT tenant ready (nothing to backfill)`. If you're seeing
non-zero counts on every boot, something else is creating tenant-null rows (probably a
worker or seed that bypasses the extension) — fix that pipeline to include `tenantId` or
wrap it in `runAsPlatform`.

### "I deleted `tenantId` from a model in schema.prisma but the extension still expects it"

The allowlist in `client.ts` is the source of truth. Remove the model from
`TENANT_SCOPED_MODELS` when you remove the column, or the extension will start rejecting
queries on that model at runtime.

### "Cross-tenant data is visible in the list of alerts/incidents/..."

Those models aren't in the Wave 1 allowlist. See [§7](#7-current-limitations) — they'll
be added in follow-up waves.

---

## 10. Reference: files + endpoints

### Server

| File                                                  | Role                                           |
|--------------------------------------------------------|-----------------------------------------------|
| `server/src/config/features.ts`                        | `MULTI_TENANCY_ENABLED` flag + `DEFAULT_TENANT_ID` |
| `server/src/middleware/tenantContext.ts`               | `tenantStore` (ALS), `getTenantId`, `runAsPlatform`, `PLATFORM_TENANT` |
| `server/src/middleware/auth.middleware.ts`             | Injects tenantId from JWT / `MOCK_USER`, wraps `next()` in `tenantStore.run` |
| `server/src/database/client.ts`                        | Prisma `$extends` tenant-isolation extension + `TENANT_SCOPED_MODELS` allowlist |
| `server/src/database/seedTenant.ts`                    | Idempotent DEFAULT-tenant seeder + backfill |
| `server/src/services/TenantService.ts`                 | CRUD + counts aggregation (uses `runAsPlatform`) |
| `server/src/routes/tenants.routes.ts`                  | `/api/tenants` REST endpoints                |
| `server/src/routes/config.routes.ts`                   | `/api/config/features` (public)              |
| `server/prisma/migrations/20260411232000_task_155_multi_tenancy_wave_1/` | Initial schema + FKs     |

### Endpoints

| Method | Path                         | Auth        | Purpose                                      |
|--------|-----------------------------|-------------|---------------------------------------------|
| `GET`  | `/api/config/features`       | public      | `{multiTenancyEnabled, natsEnabled, rustfsEnabled}` |
| `GET`  | `/api/tenants`               | authed      | List all tenants (platform view)             |
| `GET`  | `/api/tenants/current`        | authed      | The caller's own tenant                      |
| `POST` | `/api/tenants`               | authed      | Create — body: `{name, slug?, logoUrl?, plan?}` |
| `DELETE` | `/api/tenants/:id`          | authed      | Delete (rejects `DEFAULT` + non-empty)       |

### Frontend

| File                                                   | Role                                        |
|---------------------------------------------------------|--------------------------------------------|
| `app/src/features/organizations/`                       | Full feature module (types, api, store, components, page) |
| `app/src/components/layout/TenantBadge.tsx`             | TopBar tenant pill                          |
| `app/src/components/layout/Sidebar.tsx`                 | `NavCategory.requiresFeature` gating        |
| `app/src/shared/hooks/useFeatures.ts`                   | Fetches `/api/config/features` once + caches |

### Environment variables

| Name                                                    | Default | Purpose                                    |
|----------------------------------------------------------|---------|-------------------------------------------|
| `MULTI_TENANCY_ENABLED`                                 | `false` | Master flag — gates everything above      |
| `AUTH_DISABLED`                                         | `false` | Dev mode: injects `MOCK_USER` with `tenantId: 'default'` |

---

## See also

- `docs/architecture.md` — overall system layout
- `docs/nats-rustfs.md` — prior example of the optional-infrastructure pattern multi-tenancy mirrors
- TASK-155 in `.mc/tasks/` — the original task + wave breakdown
