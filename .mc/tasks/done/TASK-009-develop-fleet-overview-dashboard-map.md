---
id: TASK-009
aliases:
- TASK-009
title: Develop Fleet Overview Dashboard & Map
slug: develop-fleet-overview-dashboard-map
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
- "[[TASK-003]]"
- "[[TASK-006]]"
due_date: ''
created: 2026-02-19
updated: 2026-02-19
---



# Develop Fleet Overview Dashboard & Map

## Description
Create a high-level fleet monitoring dashboard and an interactive map to visualize robot positions and aggregate statuses.

## Details
Implement the following modules/features as defined in Phase 6:
- **fleet/hooks**: Develop `useFleetStatus()` hook, dependent on `robots/hooks` and `alerts/hooks`, to aggregate fleet-wide data.
- **UI Components**: Create `FleetStats` for displaying KPI cards (robot counts by status, alert count, utilization metrics) using `shared/ui` primitives.
- **FleetMap**: Implement an interactive 2D map using `Leaflet.js` to render floor plans and plot robot markers. Support zoom/pan and cluster markers for large fleets.
- **ZoneOverlay**: Develop a component to display operational zones or exclusion areas on the `FleetMap`.
- **FleetDashboard page**: Assemble `FleetStats`, `FleetMap`, `CommandBar` (from Task 7), and `AlertBanner` (from Task 6) into a comprehensive dashboard view.

## Test Strategy
Unit test `fleet/hooks` for correct data aggregation. Use React Testing Library for `FleetStats` components. For `FleetMap` and `ZoneOverlay`, perform integration tests to verify correct rendering of floor plans, accurate plotting of robot positions, marker clustering, and interactive features (zoom/pan). Ensure `FleetDashboard` correctly displays aggregated data and integrates other components.
%% mc-links: [[TASK-001]] [[TASK-003]] [[TASK-006]] %%
