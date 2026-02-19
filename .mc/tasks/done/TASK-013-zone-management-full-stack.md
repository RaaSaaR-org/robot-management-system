---
id: TASK-013
aliases:
- TASK-013
title: Zone Management (Full Stack)
slug: zone-management-full-stack
status: done
priority: 3
owner: ''
projects: []
customers: []
tags:
- core
sprint: ''
depends_on:
- "[[TASK-001]]"
- "[[TASK-009]]"
due_date: ''
created: 2026-02-19
updated: 2026-02-19
---



# Zone Management (Full Stack)

## Description
Implement zone management for fleet operations with zone editor, validation, and robot zone awareness.

## Details
**Full-Stack Feature spanning Frontend + Server + Robot**

### Frontend (`app/src/features/fleet/`)
- **Zone Editor**: Add zone drawing/editing mode to `FleetMap.tsx`
- **Zone CRUD UI**: Create `ZoneEditor`, `ZoneConfigPanel`, `ZoneFormModal` components
- **Zone Display**: Enhance `ZoneOverlay` to show zones with different colors by type
- **fleet/api**: Create `fleetApi.ts` with zone CRUD endpoints
- **fleet/store**: Create `zoneStore.ts` with Zustand for zone state
- **fleet/hooks**: Create `useZones()`, `useZoneManagement()` hooks

### Server (`server/src/`)
- **Zone routes**: `GET /api/zones`, `POST /api/zones`, `PUT /api/zones/:id`, `DELETE /api/zones/:id`
- **ZoneService**: Zone validation, overlap detection, coordinate handling
- **Database**: Zone model with type (operational, exclusion, charging, staging), coordinates (polygon), color

### Robot Client (`robot-agent/src/`)
- **Zone awareness**: Update `tools/navigation.ts` to check zones before navigation
- **Exclusion zones**: Prevent navigation into exclusion zones
- **Current zone reporting**: Update `robot/state.ts` to report current zone (already has `zone` field)
- **Zone events**: Emit events when entering/exiting zones

**Key Files:**
- Frontend: `app/src/features/fleet/components/FleetMap.tsx`, `app/src/features/fleet/types/fleet.types.ts`
- Server: Create `server/src/routes/zone.routes.ts`, `server/src/services/ZoneService.ts`
- Robot: `robot-agent/src/tools/navigation.ts`, `robot-agent/src/robot/state.ts`

## Test Strategy
Frontend: Test zone CRUD operations, test zone editor drawing, test zone display on map. Server: Test coordinate validation, test zone type enforcement, test overlap detection. Robot: Test zone-aware navigation, test exclusion zone blocking.
%% mc-links: [[TASK-001]] [[TASK-009]] %%
