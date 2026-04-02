---
id: TASK-120
aliases:
- TASK-120
title: 'UX: Mobile Dashboard — Fleet E-Stop button missing'
slug: ux-mobile-dashboard-fleet-e-stop-button-missing
status: done
priority: 1
owner: ''
projects: []
customers: []
tags:
- ux
- safety
sprint: ''
depends_on: []
due_date: ''
created: 2026-04-02
updated: 2026-04-02
---




# UX: Mobile Dashboard — Fleet E-Stop button missing

## Description

On mobile viewport (390x844), the Fleet E-Stop button is completely missing from the Dashboard page. Only the "Refresh" button is shown. On desktop (1920x1080) the E-Stop button is prominently displayed in the header area.

This is a **safety-critical issue** — emergency stop must always be accessible regardless of device/viewport.

### Current state
- **Desktop**: Fleet E-Stop button (red, prominent) is displayed in the dashboard header next to Refresh
- **Mobile**: Only "Refresh" button is rendered; E-Stop is hidden/removed entirely
- **File**: `app/src/features/dashboard/pages/DashboardPage.tsx` (header actions area)

The E-Stop button likely uses a responsive `hidden` class (e.g. `hidden md:flex`) that removes it on small screens.

### Fix
Ensure the Fleet E-Stop button is always visible on all viewports. On mobile, consider:
- Keeping it in the header (possibly icon-only to save space)
- Or adding a sticky/floating E-Stop button at the bottom of the screen

## Acceptance Criteria
- [ ] Fleet E-Stop button is visible and clickable on mobile (390x844)
- [ ] Fleet E-Stop button still renders correctly on desktop (1920x1080)
- [ ] Button is prominent (red) and not hidden behind menus

## Test Strategy
1. Open `/dashboard` at 390x844 viewport
2. Verify Fleet E-Stop button is visible and clickable
3. Verify it still looks correct on desktop (1920x1080)

## Screenshots
- `/tmp/ux-review/22-dashboard-mobile.png` (E-Stop missing)
- `/tmp/ux-review/02-dashboard-desktop.png` (E-Stop visible)
