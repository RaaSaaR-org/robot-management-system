---
id: "TASK-384"
aliases: []
title: "Compliance logs and skills are kept per tenant"
slug: "compliance-logs-and-skills-are-kept-per-tenant"
status: "done"
priority: 2
owner: "huhn511"
projects: []
customers: []
tags: ["core", "multi-tenancy", "compliance"]
sprint: ""
parent: ""
depends_on: []
spe: 3
effort: "medium"
due_date: ""
created: "2026-10-13"
updated: "2026-10-13"
---

# Compliance logs and skills are kept per tenant

## Description

With `MULTI_TENANCY_ENABLED=true`, a viewer of tenant A can read tenant B's
compliance audit trail (user emails included), and a member of tenant B can
read, overwrite and delete tenant A's skills. `ComplianceLog`, `SkillDefinition`
and `SkillChain` carry no `tenantId`, so nothing scopes them. Record the owning
tenant on each row and scope every read and write by it.

## Details

**Current state**

- `ComplianceLog` (`server/prisma/schema.prisma`) has no `tenantId`.
  `server/src/routes/compliance-log.routes.ts` serves `/logs`, `/logs/:id`,
  `/logs/:id/access-history`, `/logs/session/:id`, `/logs/decision/:id`,
  `/metrics`, `/metrics/event-types`, `/verify`, `/export` and
  `/export/history` with no tenant filter (`ComplianceLogRepository`,
  `LogExportService`).
- The compliance log is one global hash chain: `ComplianceLogRepository.create`
  reads the chain head (highest `seq`) across all rows, and `verifyHashChain`
  walks every row. The hash input is `previousHash|timestamp|payloadHash|eventType`.
- `SkillDefinition` and `SkillChain` have no `tenantId`; `SkillDefinition` has a
  global `@@unique([name, version])`. `SkillLibraryService` looks rows up by id
  before every mutation, but nothing scopes the lookup.

### Server

- **Skills:** add nullable `tenantId` (+ FK, `ON DELETE SET NULL`, index) to
  `SkillDefinition` and `SkillChain`, and add both to `TENANT_SCOPED_MODELS`
  (`server/src/database/client.ts`). `SkillChainStep` is reached only through its
  chain. The `(name, version)` unique key becomes `(tenantId, name, version)`,
  as TASK-288 did for `Zone`, and `findByNameAndVersion` asks with `findFirst`.
  `SkillChainRepository.update` must not touch a chain's steps before its
  ownership is checked.
- **Compliance logs:** add nullable `tenantId` (+ FK, index). Do **not** add the
  model to `TENANT_SCOPED_MODELS`: the extension would scope the chain-head read
  and fork the global chain. Instead:
  - `create` stamps `tenantId` from an explicit input, else the request's tenant
    context, else the tenant of the robot (`robotId`) or of the operator
    (`operatorId`), else `null`. `tenantId` does not enter the hash, so rows
    written before this change still verify.
  - Every read (list, detail, session, decision, access history, metrics, export,
    export history) filters by the caller's tenant explicitly.
  - `verify` still walks the whole chain (integrity is a property of the chain),
    but a tenant caller only sees its own rows in `brokenLinks` and the counts.
  - Rows with `tenantId = null` (platform events such as tenant impersonation)
    are visible only to a super-admin who is not impersonating; such a request
    runs as platform on the compliance-log routes.
- **Backfill** (`server/src/database/seedTenant.ts`): skills and chains go to the
  DEFAULT tenant like every other wave. Compliance logs are stamped with their
  robot's tenant, then their operator's; what matches neither stays `null`.
- Migration under `server/prisma/migrations/` (PostgreSQL SQL; local SQLite uses
  `db push`).
- Ratchet: `ComplianceLog` goes into `EXCEPTIONS` in
  `server/src/database/__tests__/tenantAllowlist.test.ts`, with the reason.

### Docs

`docs/multi-tenancy.md`: the new scoped models, the explicitly filtered
`ComplianceLog` and why it is not in the allowlist, and the null-tenant rule.

## Acceptance Criteria

- [x] With multi-tenancy on, `GET /api/compliance/logs` (and detail, session,
      decision, access history, metrics, export, export history) returns only the
      caller's tenant's rows; another tenant's log id returns 404.
- [x] Null-tenant compliance rows are returned to a non-impersonating
      super-admin and to nobody else.
- [x] A compliance log written in a tenant's request scope, or for a robot of a
      tenant, carries that tenant's id; the hash chain still verifies across rows
      written before and after the column was added.
- [x] A skill or skill chain created in tenant A is not listed for tenant B, and
      tenant B's GET/PUT/DELETE on its id returns 404 and changes nothing.
- [x] Two tenants can each create a skill with the same name and version.
- [x] Existing skills/chains are backfilled to DEFAULT; existing compliance logs
      to their robot's or operator's tenant.
- [x] Server typecheck and the full server vitest suite pass.

## Test Strategy

Integration tests on a temp SQLite database with the real client and extension
(pattern: `server/src/database/__tests__/tenant-numbering.integration.test.ts`):
two tenants write compliance logs and skills, each reads only its own; a
cross-tenant update/delete of a skill is refused; the chain verifies with mixed
null/non-null rows; the backfill stamps logs from robots and operators.

## Notes

Found by the 2026-10 auth/tenancy audit ("Compliance logs are readable across
tenants", "Skill definitions are shared across tenants"). Legal holds, GDPR
erasure and retention cleanup also touch `ComplianceLog` and stay platform-wide
here.
