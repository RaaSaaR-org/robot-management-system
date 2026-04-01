---
id: TASK-118
aliases:
- TASK-118
title: 'UX: Dataset cards missing status badge for non-ready datasets'
slug: ux-dataset-cards-missing-status-badge-for-non-ready-datasets
status: done
priority: 2
owner: ''
projects: []
customers: []
tags:
- ux
sprint: ''
depends_on: []
due_date: ''
created: 2026-04-01
updated: 2026-04-01
---




# UX: Dataset cards missing status badge for non-ready datasets

## Description

On `/datasets`, 12 of 20 dataset cards are missing their status badge and Quality Score progress bar entirely. Only the 8 datasets with `status: 'ready'` render the full card layout. The remaining 12 cards have no Badge element or Quality Score section in the DOM at all — they show name, description, stats, and footer only.

### Current State

- **File:** `app/src/features/training/components/DatasetCard.tsx`
- The `DatasetCard` component renders `<Badge className={statusColors[dataset.status]}>{statusLabels[dataset.status]}</Badge>` — but for 12 cards the Badge and Quality Score sections are completely absent from the rendered DOM
- Likely cause: datasets returned from the API have a status value not in `statusLabels` / `statusColors` maps, or the status field is missing/null, causing React to render nothing

### Expected Behavior

Every dataset card should show a visible status badge regardless of its status value. Unknown or missing statuses should show a neutral badge (e.g., "Imported", "Unknown", or "Processing").

## Acceptance Criteria
- [ ] All dataset cards show a status badge (even if status is not `ready`)
- [ ] Cards with unknown/missing status show a neutral fallback badge
- [ ] Quality Score section gracefully handles null/undefined (already does — just verify)

## Test Strategy
1. Open `/datasets` and verify all 20 cards show a status badge
2. Check cards that previously had no badge now show appropriate status
3. Mobile (390x844): verify badges don't overflow on narrow cards

## Notes
- Reported by Ava (UX Review 2026-04-01)
- Screenshot: `/tmp/ava-screenshot-datasets-desktop-full.png`
