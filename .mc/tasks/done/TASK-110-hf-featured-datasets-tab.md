---
id: TASK-110
aliases:
- TASK-110
title: HuggingFace Featured Datasets Tab
slug: hf-featured-datasets-tab
status: done
priority: 3
owner: Devin
projects: []
depends_on:
- TASK-108
tags:
- frontend
- training
- huggingface
updated: 2026-03-29
---


# TASK-110 — HuggingFace Featured Datasets Tab

## Goal

Add a "Featured" tab as the default tab in `HFDatasetBrowserModal` (built in TASK-108).
Shows a curated list of recommended datasets for NeoDEM — SO-101, G1/Dex3, classic benchmarks.
Users can import any with one click. No auto-download on startup — purely UI.

## Curated Dataset List

| Repo ID | Robot | Description |
|---------|-------|-------------|
| `lerobot/svla_so101_pickplace` | SO-101 | Pick & Place, 50 eps, LeRobot v2.1 |
| `unitreerobotics/g1_dex3_agilex_dual_arm_pick_place` | G1 + Dex3 | Tabletop dual-arm |
| `unitreerobotics/g1_dex3_bottle_cap` | G1 + Dex3 | Bottle cap manipulation |
| `unitreerobotics/g1_dex3_cup_stacking` | G1 + Dex3 | Cup stacking |
| `lerobot/aloha_static_coffee` | ALOHA | Classic coffee task |
| `lerobot/pusht` | PushT | Classic 2D benchmark |

## UI Changes

- **"Featured" tab is the first/default tab** when modal opens (before Search, before Direct Link)
- Dataset cards showing: repo ID, description, robot type badge, episode count (if available), tags
- "Import" button per card — same flow as search results (POST → WebSocket progress)
- Cards where dataset already exists in system: show "Already imported" badge, Import button disabled
- Grid layout: 2 columns desktop, 1 column mobile
- Metadata fetched lazily from HF API on modal open (or hardcoded as fallback)

## Implementation Notes

- Add `FeaturedDatasetsTab.tsx` component (or inline in HFDatasetBrowserModal)
- Curated list as a `const FEATURED_DATASETS` array in the component file
- Reuse existing `importFromHuggingFace()` API call from trainingApi.ts
- Check existing datasets against `repoId` field to detect "already imported"
- TypeScript strict — 0 errors mandatory

## Acceptance Criteria

- [ ] TypeScript: 0 errors (`npx tsc --noEmit` in app/)
- [ ] Featured tab is default when modal opens
- [ ] All 6 datasets listed with name + description + robot type
- [ ] Import button triggers same flow as search tab
- [ ] Already-imported datasets show "Imported" badge, button disabled
- [ ] Mobile responsive (390x844)
- [ ] Demo mode unaffected
