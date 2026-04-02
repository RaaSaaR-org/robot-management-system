---
id: TASK-126
title: Replace episodes modal with dedicated detail page
status: done
priority: 2
tags:
- core
created: 2026-04-02
updated: 2026-04-02
---



## Description

Replace the `EpisodeViewerModal` on the Datasets page with a proper route-based detail page at `/datasets/:datasetId/episodes`. Instead of opening a modal when clicking "View Episodes", navigate to a full detail page — consistent with how other features work (e.g. robot detail at `/robots/:id`).

## Details

### Frontend

**Current flow:**
- `DatasetsPage.tsx` has state `episodeViewerDataset` that controls an `EpisodeViewerModal`
- Clicking "View Episodes" in the floating action buttons sets this state and opens the modal
- The modal (`EpisodeViewerModal.tsx`) loads episodes, shows dual video, joint state chart

**New flow:**
- Clicking "View Episodes" should `navigate('/datasets/${datasetId}/episodes')` instead of opening a modal
- Create a new page component `DatasetEpisodesPage.tsx` that gets `datasetId` from URL params
- The page reuses ALL the existing logic from `EpisodeViewerModal.tsx` — same API calls, same video players, same joint chart, same episode sidebar
- Add a "Back" button (like the robot detail page) that navigates back to `/datasets`

**Files to modify:**

1. **`app/src/features/training/pages/DatasetEpisodesPage.tsx`** (NEW)
   - Create a full page component based on `EpisodeViewerModal.tsx`
   - Use `useParams()` to get `datasetId` from URL
   - Fetch dataset name via the datasets API or store
   - Layout: same as modal but as a page — episode sidebar on left, video + chart on right
   - Include a back button/breadcrumb: `← Back to Datasets`
   - Keep all existing functionality: episode selection, dual video playback, speed controls, flagging, joint state chart

2. **`app/src/features/training/pages/DatasetsPage.tsx`** (MODIFY)
   - Remove `episodeViewerDataset` state
   - Remove `EpisodeViewerModal` import and JSX
   - Change "View Episodes" button to use `navigate(`/datasets/${selectedDataset.id}/episodes`)`
   - Import `useNavigate` from react-router-dom

3. **`app/src/App.tsx`** (MODIFY — around line 310)
   - Add route: `<Route path="/datasets/:datasetId/episodes" element={<ProtectedAppRoute><LazyDatasetEpisodesPage /></ProtectedAppRoute>} />`
   - Place it BEFORE the `/datasets` route so it matches first

4. **`app/src/routes/lazyPages.ts`** (MODIFY)
   - Add lazy import: `export const LazyDatasetEpisodesPage = lazy(() => import('@/features/training').then((m) => ({ default: m.DatasetEpisodesPage })));`

5. **`app/src/features/training/index.ts`** (MODIFY)
   - Export the new `DatasetEpisodesPage` component

**Do NOT delete `EpisodeViewerModal.tsx`** — just stop using it from DatasetsPage. It can be removed in a future cleanup.

## Test Strategy

1. Navigate to `/datasets` — should show dataset list as before
2. Select a dataset, click "View Episodes" — should navigate to `/datasets/<id>/episodes`
3. Episodes page should show episode list, video players, joint chart
4. Back button should return to `/datasets`
5. Direct URL access to `/datasets/<id>/episodes` should work
6. Mobile layout should be responsive (episode dropdown instead of sidebar)
