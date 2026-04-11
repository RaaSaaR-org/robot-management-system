---
id: TASK-147
aliases:
- TASK-147
title: 'Simplify sidebar navigation: 22 items → 11'
slug: simplify-sidebar-navigation
status: done
priority: 2
owner: ''
projects: []
customers: []
sprint: ''
tags:
- extended
depends_on: []
due_date: ''
created: 2026-04-07
updated: 2026-04-11
---





## Description

The sidebar has 6 categories with 22 nav items — too much cognitive load. Simplify to ~11 items by merging overlapping pages and collapsing rarely-used sections into tabs. No functionality removed, just better organization.

## Current State

```
MAIN (2):              Dashboard, Orchestrator
ROBOT MANAGEMENT (2):  Robots, Fleet
OPERATIONS (3):        Alerts, Incidents, Processes
TRAINING & MODELS (10): Train a Skill, Data Collection, Datasets, Training,
                        Models, Simulation, Evaluation, Deployments, Skills, Contributions
COMPLIANCE (5):        Audit Log, AI Explainability, Oversight, Approvals, Data Privacy
SYSTEM (3):            Updates, Docs, Settings
```

Key file: `app/src/components/layout/Sidebar.tsx` (lines 56-355)

## Changes (in priority order)

### 1. Merge Robots + Fleet → single "Fleet" page

**Why:** "Robots" = list of robots, "Fleet" = map of robots + zones. Two views of the same data.

**How:**
- Combine into `/fleet` with tabs or toggle: **List | Map | Zones**
- `/robots` redirects to `/fleet` (keep `/robots/:id` detail route)
- Remove "Robots" nav item, rename "Fleet" section to just have one item

**Files:**
- `app/src/components/layout/Sidebar.tsx` — remove Robots nav item, update Fleet
- `app/src/features/fleet/pages/FleetPage.tsx` — add tabbed layout with RobotList integration
- `app/src/features/robots/pages/RobotsPage.tsx` — extract list into reusable component if not already
- `app/src/App.tsx` — add redirect from `/robots` to `/fleet`

### 2. Collapse Compliance → single page with tabs

**Why:** 5 items that most users rarely visit. All are compliance-related and belong together.

**How:**
- `/compliance` becomes a tabbed page: **Audit Log | Explainability | Oversight | Approvals | Data Privacy**
- Remove 4 sub-items from sidebar, keep one "Compliance" entry
- Deep links still work: `/compliance?tab=explainability`, etc.

**Files:**
- `app/src/components/layout/Sidebar.tsx` — remove 4 compliance sub-items
- `app/src/features/compliance/pages/CompliancePage.tsx` — add tab navigation hosting all 5 views
- `app/src/App.tsx` — redirect old routes to `/compliance?tab=...`

### 3. Merge Alerts + Incidents

**Why:** Both deal with "something went wrong." Alerts are automated, incidents are human-reported — but they're the same workflow for operators.

**How:**
- `/alerts` page gets an "Incidents" tab or toggle
- Remove "Incidents" from nav
- `/incidents` redirects to `/alerts?tab=incidents`

**Files:**
- `app/src/components/layout/Sidebar.tsx` — remove Incidents nav item
- `app/src/features/alerts/pages/AlertsPage.tsx` — add incidents tab
- `app/src/App.tsx` — add redirect

### 4. Fold Training sub-items (covered partially by TASK-142, TASK-143)

**Why:** 10 items is nearly half the entire nav. Many are steps in a pipeline that the "Train a Skill" page already aggregates.

**How:**
- Keep in nav: Pipeline, Data Collection, Datasets, Training, Deployments (5 items)
- Models → tab inside Training (see also TASK-142)
- Simulation → tab inside Training or step in Pipeline
- Evaluation → tab inside Training or step in Pipeline
- Skills → tab inside Deployments (see also TASK-143)
- Contributions → tab inside Datasets or Data Collection

**Files:**
- `app/src/components/layout/Sidebar.tsx` — remove 5 nav items
- Various page files to add tab navigation

### 5. Merge Orchestrator into Dashboard

**Why:** Dashboard already has a CommandBar and fleet overview. Orchestrator is a chat interface for sending commands. Embedding it as a slide-out panel makes Dashboard the single "home base."

**How:**
- Add orchestrator chat as a slide-out drawer or bottom panel on Dashboard
- Remove "Orchestrator" from nav
- `/orchestrator` redirects to `/dashboard`

**Files:**
- `app/src/components/layout/Sidebar.tsx` — remove Orchestrator nav item
- `app/src/features/dashboard/pages/DashboardPage.tsx` — integrate chat drawer
- `app/src/App.tsx` — add redirect

## Target Navigation

```
MAIN
  Dashboard              (with orchestrator chat drawer)
  Fleet                  (robots list + map + zones)

OPERATIONS
  Alerts                 (alerts + incidents)
  Processes

TRAINING
  Pipeline               (Train a Skill hub)
  Data Collection
  Datasets               (+ contributions)
  Training               (jobs + models + evaluation)
  Deployments            (+ skills)

COMPLIANCE               (single tabbed page)

SYSTEM
  Updates
  Settings
```

## Test Strategy

- Verify all old routes redirect correctly (no 404s)
- All existing functionality accessible from new locations
- Sidebar renders correctly in collapsed and expanded states
- Mobile nav works with new structure
- Run Playwright tests to check no broken links
