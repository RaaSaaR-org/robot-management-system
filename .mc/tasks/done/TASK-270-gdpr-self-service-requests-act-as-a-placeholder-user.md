---
id: "TASK-270"
aliases: []
title: "GDPR self-service requests act as a placeholder user"
slug: "gdpr-self-service-requests-act-as-a-placeholder-user"
status: "done"
priority: 2
owner: "huhn511"
projects: []
customers: []
tags: [compliance, server]
sprint: ""
parent: ""
depends_on: []
spe: 2
effort: "small"
due_date: ""
created: "2026-09-11"
updated: "2026-09-30"
---

# GDPR self-service requests act as a placeholder user

## Description

The Data Privacy tab under Compliance lets a person file GDPR requests and manage consents for themselves. The server does not know who "themselves" is. Every self-service route falls back to the literal user id `'current-user'` when the body or query carries no `userId`, and the app never sends one. So every privacy request and consent change is attributed to a user that does not exist: live, they return 500, and the list shows another user's requests. Found while browser-testing the redesigned compliance pages (TASK-267).

A second server defect turned up in the same pass. Creating an approval for an entity type that has no workflow configuration crashes instead of being rejected.

## Details

### Current state

- `server/src/routes/gdpr.routes.ts`. Every self-service handler reads `req.body.userId || 'current-user'` or `(req.query.userId as string) || 'current-user'`. That covers the access, rectification, erasure, restriction, portability, objection and ADM-review requests (lines ~62–239), listing a user's requests (~262), cancelling one (~299), and reading, updating and revoking consents (~366, ~380, ~429). The comment says "in production this comes from auth middleware", but it doesn't.
- `server/src/routes/approval.routes.ts` `POST /approvals` validates only that `entityType`, `entityId`, `requestedBy` and `requestReason` are present. An `entityType` with no workflow config, for example `ai_decision`, reaches the service and throws `Cannot read properties of undefined (reading 'type')`, which becomes a 500.

### Server

1. **GDPR routes.** Self-service routes take the user from the authenticated request (`req.user.id`; with `AUTH_DISABLED=true` that is the dev user). A `userId` in the body or query is honoured only for admin roles acting for someone else, and is rejected otherwise. The `'current-user'` fallback is removed.
2. **Approvals.** `POST /approvals` returns `400 { error: 'No approval workflow is configured for entity type <x>' }` when the type has no workflow config, before calling the service.
3. **Tests.** Add route tests next to the existing ones in `server/src/__tests__/`:
   - A self-service request is attributed to `req.user.id`.
   - A foreign `userId` from a non-admin is rejected.
   - The unconfigured approval type returns 400.

**Key files:** `server/src/routes/gdpr.routes.ts`, `server/src/routes/approval.routes.ts`, `server/src/__tests__/`.

## Acceptance Criteria

- [x] Filing a privacy request and changing a consent from Compliance → Data Privacy succeeds in live mode and shows up under the dev user.
- [x] No GDPR route contains `'current-user'`.
- [x] `POST /api/approvals` with an unconfigured entity type returns 400 with a clear message.

## Test Strategy

- `cd server && npm run typecheck && npx vitest run`.
- Live: file a request and toggle a consent on `/compliance?tab=gdpr`, and check that both are listed.

## Decisions (2026-09-30, implementation)

- **Who may act for someone else: `super-admin` and `owner`.** The task says "admin roles"; the unified role model (TASK-162) has no `admin`, so the controller-side roles are the two that administer an organisation. `member` processes requests under `/api/gdpr/admin/*` but does not originate one in another person's name — filing an erasure or revoking a consent for someone is a controller act, not an operator one.
- **An owner acts only for users of their own tenant (review, 2026-09-30).** `GDPRRequest` and `UserConsent` are not tenant-scoped, so a bare role check let an owner of one tenant read and revoke the consents of another tenant's user. The route now looks the named user up and requires `user.tenantId === caller.tenantId` (an owner with no tenant acts for no one else); an unknown user is refused the same way. `super-admin` stays unrestricted as the platform controller.
- **A foreign `userId` is refused with 403, never silently replaced by the caller's id.** Replacing it would file the request against the wrong person without telling the caller. A `userId` equal to the caller's own id is accepted for any role, so a client that sends it anyway keeps working. A non-string `userId` is a 400.
- **Approval entity types are checked with `hasOwnProperty` on `APPROVAL_TYPE_MAP`**, so a name like `toString` cannot pass as a configured type. The existing route tests posted `entityType: 'task'`, which is itself unconfigured; they now use `shift_change`.

## Verification (2026-09-30)

- `cd server && npm run typecheck` clean; `npx vitest run` 236/236 files pass.
- Live, against a copy of the dev DB with `AUTH_DISABLED=true`: `POST /api/gdpr/requests/access` → 201 with `userId: dev-user-id`, and `GET /api/gdpr/requests` lists it; `POST /api/gdpr/consents {type: marketing, granted: true}` → 200 for `dev-user-id`, and `GET /api/gdpr/consents` lists it; `POST /api/approvals {entityType: ai_decision, …}` → 400 `No approval workflow is configured for entity type ai_decision`.
