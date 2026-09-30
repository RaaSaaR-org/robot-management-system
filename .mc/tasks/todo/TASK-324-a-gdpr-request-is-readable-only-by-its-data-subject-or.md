---
id: "TASK-324"
aliases: []
title: "A GDPR request is readable only by its data subject or someone who may act for them"
slug: "a-gdpr-request-is-readable-only-by-its-data-subject-or"
status: "in-progress"
priority: 2
owner: "huhn511"
projects: []
customers: []
tags: [compliance]
sprint: ""
parent: ""
depends_on: []
spe: 2
effort: "low"
due_date: ""
created: "2026-09-30"
updated: "2026-09-30"
---

# A GDPR request is readable only by its data subject or someone who may act for them

## Description

`GET /api/gdpr/requests/:id` and `GET /api/gdpr/requests/:id/download` load a
GDPR request by id and return it without checking whose it is — any
authenticated user who knows (or guesses) an id reads another person's request,
its status history and, for a completed access/portability request, the full
personal-data export (IDOR). Found in the TASK-270 review (PR #334).

## Details

### Current state

- `server/src/routes/gdpr.routes.ts` — both handlers call
  `gdprRequestService.getRequest(id)` and answer with the row as-is.
- The same file already has `mayActFor(caller, targetId)` (TASK-270): a
  `super-admin` may act for anyone, an `owner` for users of their own tenant,
  everyone else for nobody but themselves.
- `GDPRRequest` rows carry `userId` (the data subject) but no `tenantId`.

### Audit of the other routes that take a request id

| Route | Gap? |
|-------|------|
| `GET /requests/:id` | **yes** — fixed here |
| `GET /requests/:id/download` | **yes** — fixed here |
| `DELETE /requests/:id` | no — `resolveDataSubject` gates `?userId`, and `GDPRRequestService.cancelRequest` refuses a request whose `userId` is not that subject; both not-found and not-yours answer the same `400 Failed to cancel request`, so nothing leaks |
| `GET /verify/:token` | no — the unguessable, expiring token is the capability |
| `/admin/requests/:id/*`, `/admin/restrictions/:id/lift` | not this gap — role-gated (member and above) by the write guard, deliberately acting on other people's requests. They are not tenant-scoped (the row has no `tenantId`); that is a separate question, see Notes |

### Server

- Add a helper in `gdpr.routes.ts` that loads a request and returns it only when
  the caller is its data subject (`request.userId === caller.id`) or
  `mayActFor(caller, request.userId)`; otherwise it answers
  `404 Request not found` itself — the same answer as a missing id.
- Use it in `GET /requests/:id` (before loading the status history) and
  `GET /requests/:id/download` (before the status/export checks, so a foreign
  request's status does not leak either).

### Key files

- `server/src/routes/gdpr.routes.ts`
- `server/src/__tests__/gdpr-routes.test.ts`
- `docs/api.md`

## Acceptance Criteria

- [ ] `GET /api/gdpr/requests/:id` returns `404 Request not found` for a request whose data subject is neither the caller nor someone the caller may act for, and does not load its status history
- [ ] `GET /api/gdpr/requests/:id/download` returns `404 Request not found` for such a request, whatever its status — no `400 not yet completed`, no export
- [ ] The data subject still reads their own request and download
- [ ] A `super-admin` reads any request; an `owner` reads a request of a user in their own tenant, and gets `404` for a user of another tenant or an unknown user
- [ ] Authorisation reuses `mayActFor` — no second definition of who may act for whom
- [ ] `docs/api.md` states the rule for the per-id reads
- [ ] Route tests cover each case above

## Test Strategy

`server/src/__tests__/gdpr-routes.test.ts` (supertest, mocked services, mocked
`prisma.user.findUnique` for the owner's tenant lookup): a member reading a
foreign request/download gets 404 and the history/export is never touched; the
subject gets 200; super-admin 200; owner same-tenant 200, other tenant 404.
Run `npm run typecheck` and `npx vitest run src/__tests__/gdpr-routes.test.ts`
in `server/`.

## Decisions (2026-09-30)

- **A foreign request answers 404, not 403.** A 403 would confirm that the id
  exists and belongs to someone else; 404 is indistinguishable from a missing
  id, so ids cannot be probed. It matches how `DELETE /requests/:id` already
  answers not-found and not-yours identically.
- **The per-id reads do not take `?userId`.** Whose request it is is read off
  the row, so the caller never needs to name the subject; `mayActFor` is asked
  about the row's `userId`.

## Notes

- Out of scope: `/api/gdpr/admin/*` lists and acts on requests across all
  tenants for any member-or-above caller, because `GDPRRequest` has no
  `tenantId`. Whether a tenant's members should see only their tenant's queue is
  a separate decision (and a schema change), not this IDOR.
