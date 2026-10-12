---
id: "TASK-383"
aliases: []
title: "GDPR admin routes and the retention policy are scoped to the right people"
slug: "gdpr-admin-routes-and-the-retention-policy-are-scoped-to-the-right-people"
status: "review"
priority: 1
owner: "huhn511"
projects: []
customers: []
tags: ["core", "compliance"]
sprint: ""
parent: ""
depends_on: []
spe: 3
effort: "medium"
due_date: ""
created: "2026-10-13"
updated: "2026-10-13"
---

# GDPR admin routes and the retention policy are scoped to the right people

## Description

Two auth-tenancy holes found on the auth-on multi-tenant stack. Any tenant member
could list and act on every tenant's GDPR data-subject requests through
`/api/gdpr/admin/*`, and any tenant member could change the platform-wide
compliance-log retention policy and start a cleanup that deletes every tenant's
audit logs. GDPR admin work belongs to the owner of the data subject's tenant (or
a super-admin); the retention policy is platform-level and belongs to a super-admin.

## Details

**Current state**

- `server/src/app.ts` mounts `/api/gdpr` and `/api/compliance/retention` with only
  `authMiddleware` + `writeRoleGuard`, so a `member` reaches every write.
- `server/src/routes/gdpr.routes.ts` — `GET /admin/requests` calls
  `gdprRequestService.getAllRequests` with no tenant filter; the by-id handlers
  (`acknowledge`, `start-processing`, `complete`, `reject`, `execute-erasure`) load
  the request by id alone; metrics, SLA report, overdue, nearing-deadline,
  consent metrics and restrictions aggregate over every tenant; `adminId` is
  taken from the request body.
- `GDPRRequest`, `UserConsent` and `DataRestriction` have no `tenantId`, but each
  has a `user` relation, and `User.tenantId` is the tenant.
- `server/src/routes/retention.routes.ts` — `PUT /:eventType`, `DELETE /:eventType`
  and `POST /cleanup` have no role check. `RetentionPolicy` and `ComplianceLog`
  have no `tenantId`; `RetentionCleanupJob.runCleanup()` works across the table.

### Server

- Every `/api/gdpr/admin/*` route is behind `ownerOnly` (owner or super-admin).
- An owner's admin view is confined to users of their own tenant
  (`user: { tenantId }` on every list/aggregate query; a null tenant in
  single-tenant mode matches users with a null tenant). A super-admin stays
  platform-wide.
- A by-id admin call (request or restriction) on a record whose data subject is
  in another tenant answers `404` exactly like a missing id, and changes nothing.
- `adminId` recorded on status changes is the authenticated caller's id; the
  body's `adminId` is ignored.
- Retention `PUT /:eventType`, `DELETE /:eventType` and `POST /cleanup` are
  `superAdminOnly`. The GET routes are unchanged.

**Key files**

- `server/src/routes/gdpr.routes.ts`
- `server/src/routes/retention.routes.ts`
- `server/src/services/GDPRRequestService.ts`, `ConsentService.ts`, `DataRestrictionService.ts`
- `server/src/services/gdprTenantScope.ts` (new)
- Tests: `server/src/__tests__/gdpr-routes.test.ts`, `retention-routes.test.ts`,
  `gdpr-retention-role-routing.test.ts` (new), `gdpr-admin-tenant-scope.integration.test.ts` (new)

## Acceptance Criteria

- [x] A `member` or `viewer` gets 403 on every `/api/gdpr/admin/*` route; `owner` and `super-admin` reach them.
- [x] An owner of tenant B listing `/api/gdpr/admin/requests` sees only requests of tenant B users; metrics, SLA report, overdue, nearing-deadline, consent metrics, restriction stats and restrictions are confined the same way.
- [x] An owner of tenant B acknowledging, starting, completing, rejecting or erasing a tenant A request gets 404 and the service is never called; the same for lifting a tenant A restriction.
- [x] A super-admin still lists and acts on every tenant's requests.
- [x] The recorded `adminId` is the caller's id, not a body field.
- [x] A `member` or `owner` gets 403 on retention `PUT`, `DELETE` and `POST /cleanup`; a super-admin reaches them; GETs are unchanged.
- [x] No schema change; server typecheck and vitest pass.

## Test Strategy

- Unit (`gdpr-routes.test.ts`, `retention-routes.test.ts`): role guard per route, scope passed to the services, 404 across tenants, `adminId` from the caller.
- Real routing (`gdpr-retention-role-routing.test.ts`): `createApp()` with `AUTH_DISABLED=false` and signed tokens per role.
- Real database (`gdpr-admin-tenant-scope.integration.test.ts`): temp SQLite with two tenants, checks the relation filters on list, count and groupBy queries.

## Notes

- Out of scope: a regulatory minimum for `retentionDays` and a per-tenant retention policy; with the write routes super-admin only, no tenant can change another tenant's retention.
