---
id: TASK-161
aliases:
- TASK-161
title: 'Multi-tenancy: per-tenant branding (logo, colours, settings editor)'
slug: multi-tenancy-per-tenant-branding-logo-colours-settings-editor
status: done
priority: 3
owner: ''
projects: []
customers: []
tags:
- extended
sprint: ''
depends_on:
- TASK-160
due_date: ''
created: 2026-04-12
updated: 2026-04-12
---


# Multi-tenancy: per-tenant branding (logo, colours, settings editor)

## Description

The `Tenant` model already has `logoUrl`, `plan`, and a generic `settings` JSON field (`server/prisma/schema.prisma`), but nothing reads them. Customer demos lose some impact because every tenant looks identical — Acme Robotics shows the EmAI logo, not its own. This task wires branding through so a tenant can have its own logo + accent colour, and adds a minimal settings editor so the operator doesn't need raw SQL to change them.

## Current State

- `Tenant.logoUrl: String?` — nullable, unused
- `Tenant.plan: String?` — nullable, unused (used for a chip on the org card but nothing else)
- `Tenant.settings: String @default("{}")` — JSON blob, unused
- `GET /api/tenants/current` already returns all of these fields; they reach the frontend via `useOrganizationsStore.current`
- `OrganizationCard` at `app/src/features/organizations/components/OrganizationCard.tsx` has a hardcoded building icon placeholder

## Scope

### Server

- **New endpoint** `PATCH /api/tenants/:id` (super-admin — depends on TASK-160's role) that updates name, logoUrl, plan, and settings (JSON).
- **Validation** — logoUrl must be a valid URL (or reject), plan must be one of a small enum if we want to enforce it, settings JSON-validated against a schema (start tiny: `{ brandColor?: string, compactMode?: boolean }`)
- **Storage** — logos can be stored as external URLs (operator uploads to their own CDN) for v1 to avoid the upload/storage-quota mess. A future version could use the existing RustFS bucket at `server/src/storage/`.
- **Service** — extend `TenantService` with `update(id, input)`

### Frontend — display

- **TopBar** — `TenantBadge` renders the tenant logo (fallback to building icon) and uses the tenant's `brandColor` for the pill background/border
- **Sidebar** (optional — scope risk) — top-of-sidebar EmAI logo swaps for the tenant's logo when impersonating or viewing as a tenant user
- **Organization card** — show the logo + plan chip in the card header

### Frontend — edit

- **New modal** `EditOrganizationModal.tsx` — tabs: Basics / Branding / Settings
  - **Basics** — name (rename), plan
  - **Branding** — logoUrl input with live preview, brand colour picker (hex input with swatches)
  - **Settings** — JSON editor (Monaco-lite) with schema validation, or a simple form with known keys
- Wire up from the Organization card's existing "Delete" area — add an "Edit" button next to it
- Show a toast on save

### Types + store

- `Organization.settings` type: parse the JSON server-side and return a typed object so the frontend doesn't re-parse everywhere; e.g. `settings: { brandColor?: string; compactMode?: boolean }`
- `useOrganizationsStore.update(id, input)` mirrors `create`/`remove`

## Key Files to Modify / Create

**Server:**
- `server/src/services/TenantService.ts` — new `update()` method
- `server/src/routes/tenants.routes.ts` — new PATCH endpoint, super-admin gated
- `server/src/types/` — add a `TenantSettings` zod/typebox schema if the codebase uses one

**Frontend:**
- `app/src/features/organizations/components/EditOrganizationModal.tsx` (new)
- `app/src/features/organizations/components/OrganizationCard.tsx` — logo rendering + Edit button
- `app/src/features/organizations/types/organizations.types.ts` — typed settings
- `app/src/features/organizations/api/organizationsApi.ts` — `update` method
- `app/src/features/organizations/store/organizationsStore.ts` — `update` action
- `app/src/components/layout/TenantBadge.tsx` — logo + brand colour

**Docs:**
- `docs/multi-tenancy.md` — new §Branding section with the settings JSON schema + update §7 limitations

## Test Strategy

- Unit: `TenantService.update` rejects invalid logoUrl, invalid JSON settings, invalid brand colour
- Integration: PATCH endpoint requires super-admin role (403 without), updates round-trip through GET
- Playwright: operator clicks Edit on Acme, uploads a logo URL and picks `#FF6700`, saves, verifies TopBar badge shows the logo + tinted background
- Security: PATCH on `DEFAULT` tenant requires super-admin (tenants shouldn't self-brand the system tenant)

## Dependencies

- TASK-155 (merged) — foundation
- TASK-160 — super-admin role gates the PATCH endpoint; tenant switcher makes branding visually obvious (otherwise you only see your own tenant's brand)

## Notes

- **Scope discipline**: start with logo + brand colour. Don't build a full theme editor. The `settings` JSON schema should be minimal (2-3 fields) for v1 — expand later if real customers ask.
- **Demo value vs. engineering cost** — this is priority 3 (nice-to-have) because the core isolation story doesn't need branding. Skip if runway is tight. But once we onboard a real second customer, branding is the single highest-impact UX polish for that customer's first login.
- Logo as external URL is the pragmatic v1 — operator can point to their own S3 bucket or any CDN. Actual upload UI is a separate follow-up if we want to own the asset pipeline.
