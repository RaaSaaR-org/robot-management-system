---
id: TASK-134
aliases:
- TASK-134
title: Unified training pipeline UX
slug: unified-training-pipeline-ux
status: done
priority: 2
owner: ''
projects: []
customers: []
tags:
- core
sprint: ''
depends_on: []
due_date: ''
created: 2026-04-05
updated: 2026-04-05
---

# Unified training pipeline UX

## Description

The training workflow is spread across 5 disconnected feature pages (data collection → datasets → training → evaluation → deployment). First-time users have to know the whole flow already — there's no overview, no next-step guidance, no entry point. Add a unified `/pipeline` page + connective tissue across the existing feature pages.

## Details

### New page: `/pipeline` — "Train a Skill"

- 5 stage cards in a responsive grid, each showing: step number, title, description, current status badge, live stats line, relative last-activity timestamp, and a next-step CTA button.
- Data aggregated in parallel from existing APIs: `datacollectionApi.listSessions`, `trainingApi.listDatasets/listTrainingJobs`, `simulationApi.listJobs`, `deploymentApi.listDeployments`. Polls every 10 seconds.
- Empty state (no records in any stage) shows a `FirstRunWizard` with 3 onboarding paths: record your own demos, use an existing dataset, or test a pretrained model.
- Reached via sidebar "Train a Skill" link (first item in AI & ML) or a dashboard Quick Actions button.

### Shared UI components (in `app/src/shared/components/ui/`)

- `Tooltip` + `InfoIcon` — already landed in TASK-133, reused here
- `NextStepBanner` — horizontal CTA banner with icon + title + description + button linking to the next pipeline stage
- `PipelineBreadcrumb` — small "Step N/5 · [stage] · Pipeline overview" pill linking back to `/pipeline`

### Cross-page connective tissue

- `PipelineBreadcrumb` added to page headers: Data Collection, Datasets, Training, Simulation, Deployments
- `NextStepBanner` at the bottom of Simulation Results: "Deploy model" when success rate ≥ 50%, "Back to pipeline" + improvement hints otherwise
- Dashboard Quick Actions: "Train a Skill" button (turquoise) linking to `/pipeline`
- Datasets empty state: replaced "No datasets found" with a richer explainer pointing at the 3 sources (upload / HuggingFace / export session)

### Files added

- `app/src/features/pipeline/pages/PipelinePage.tsx`
- `app/src/features/pipeline/components/StageCard.tsx`
- `app/src/features/pipeline/components/FirstRunWizard.tsx`
- `app/src/features/pipeline/index.ts`
- `app/src/shared/components/ui/NextStepBanner.tsx`
- `app/src/shared/components/ui/PipelineBreadcrumb.tsx`

### Files modified

- `app/src/routes/lazyPages.ts` — `LazyPipelinePage` export
- `app/src/App.tsx` — `/pipeline` route
- `app/src/components/layout/Sidebar.tsx` — "Train a Skill" nav item
- `app/src/shared/components/ui/index.ts` — barrel re-exports
- `app/src/features/dashboard/pages/DashboardPage.tsx` — Quick Actions button
- `app/src/features/simulation/pages/SimulationPage.tsx` — PipelineBreadcrumb + NextStepBanner
- `app/src/features/datacollection/pages/DataCollectionPage.tsx` — PipelineBreadcrumb
- `app/src/features/training/pages/DatasetsPage.tsx` — PipelineBreadcrumb
- `app/src/features/training/pages/TrainingPage.tsx` — PipelineBreadcrumb
- `app/src/features/deployment/pages/DeploymentsPage.tsx` — PipelineBreadcrumb
- `app/src/features/training/components/DatasetList.tsx` — richer empty state

## Test Strategy

1. `npx tsc --noEmit` in `app/` clean
2. Navigate to `/pipeline` — 5 stage cards render, statuses reflect real data
3. Empty install: navigate to `/pipeline` with all APIs empty → `FirstRunWizard` card shown with 3 onboarding paths
4. Each stage CTA navigates correctly (Collect → /data-collection, Dataset → /datasets, Train → /training, Evaluate → /simulation, Deploy → /deployments)
5. Each feature page shows `PipelineBreadcrumb` pill in header (on ≥sm screens)
6. Simulation Results tab with ≥50% success: NextStepBanner suggests Deploy. With <50%: suggests going back to pipeline.
7. Dashboard shows "Train a Skill" button in Quick Actions → navigates to /pipeline
8. Datasets page with zero datasets: rich explainer with 3 data-source options
9. Pipeline page auto-refreshes every 10s (DOM updates when a new sim job is submitted in parallel)
