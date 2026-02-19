---
id: TASK-036
aliases:
- TASK-036
title: Fleet Map Enhancements (Dashboard)
slug: fleet-map-enhancements-dashboard
status: backlog
priority: 3
owner: ''
projects: []
customers: []
tags:
- core
sprint: ''
depends_on:
- "[[TASK-009]]"
due_date: ''
created: 2026-02-19
updated: 2026-02-19
---


# Fleet Map Enhancements (Dashboard)

## Description
Improve the fleet map and dashboard with real floor plan support, marker clustering for large fleets, and integrate the CommandBar into the dashboard layout.

## Details
**Gaps identified from TASK-009 review — the current implementation uses a custom SVG map renderer.**

### Current State
- `app/src/features/fleet/components/FleetMap.tsx` renders an SVG-based coordinate grid with robot markers
- `app/src/features/dashboard/pages/DashboardPage.tsx` assembles FleetStats + FleetMap + AlertBanner but no CommandBar
- No Leaflet.js integration, no floor plan image support, no marker clustering

### Frontend (`app/src/features/fleet/`)
- **Floor plan rendering**: Either integrate Leaflet.js (`react-leaflet`) with CRS.Simple for indoor maps, or enhance the existing SVG renderer to support background floor plan images (SVG/PNG). Decision: evaluate which approach fits better with the existing ZoneEditor/ZoneOverlay SVG components
- **Marker clustering**: Implement marker grouping when robots are close together. For SVG approach, build a simple spatial clustering utility. For Leaflet, use `leaflet.markercluster`
- **Floor plan assets**: Support uploading/configuring floor plan images per floor in zone management
- **Dashboard CommandBar**: Add `CommandBar` from `app/src/features/command/components/CommandBar.tsx` into `DashboardPage.tsx`

**Key Files:**
- Modify: `app/src/features/fleet/components/FleetMap.tsx`
- Modify: `app/src/features/dashboard/pages/DashboardPage.tsx` — add CommandBar import and render
- Potentially add: `app/src/features/fleet/utils/markerClustering.ts`
- Optional: `app/package.json` — add `react-leaflet` + `leaflet` if taking the Leaflet approach

## Test Strategy
Test floor plan image rendering at different zoom levels. Test marker clustering groups nearby robots and expands on zoom. Test CommandBar appears on dashboard and can send commands. Test floor plan switching between floors.

## Notes
%% mc-links: [[TASK-009]] %%
