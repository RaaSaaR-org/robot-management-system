---
id: TASK-157
aliases:
- TASK-157
title: 'Skill & Data Marketplace — UI Prototype'
slug: marketplace-ui-prototype
status: done
priority: 2
owner: ''
projects: []
customers: []
sprint: ''
tags:
- core
depends_on: []
due_date: ''
created: '2026-04-10'
---

## Description

Presentable UI prototype of the Skill & Data Marketplace to demonstrate the concept and potential. Frontend-only with mock data, no backend changes.

## What Was Built

### Pages (3 new)
- **MarketplacePage** (`/marketplace`) — browse page with hero, sovereignty tagline, credit balance, type tabs (All/Skills/Datasets), search, robot type + base model filters, featured & trending sections, full listing grid
- **MarketplaceDetailPage** (`/marketplace/:id`) — detail view with seller info, description, skill preview / dataset stats, tags, tech specs table, reviews, license tier selector with purchase flow, sovereignty note
- **MyMarketplacePage** (`/marketplace/mine`) — My Purchases tab (3 mock purchases with download buttons) + My Listings tab (seller table with revenue stats)

### Components (4 new)
- `MarketplaceListingCard` — browse grid card with type badge, tags, star rating, downloads, seller tier, price
- `MarketplaceLicenseTierSelector` — 4-tier license picker (Research, Per Robot, Per Fleet, Enterprise) with affordability check
- `MarketplaceStarRating` — reusable 1-5 star display
- `MarketplaceDownloadModal` — download modal with file info (filename, size, format, checksum), deployment steps, sovereignty banner, animated progress bar, completion state

### Mock Data
- 10 listings (6 skills + 4 datasets) across SO-101, Unitree H1, Generic
- 6 seller profiles with tier badges (bronze→diamond)
- 2-3 reviews per listing with German/English mix
- 4 license tiers per listing with realistic credit pricing
- 3 mock purchases, 2 mock seller listings

### Wiring
- Routes: `/marketplace`, `/marketplace/mine`, `/marketplace/:id`
- Sidebar: "Contributions" renamed to "Marketplace" with shopping bag icon
- "My Marketplace" button in hero section
- Lazy loading via `lazyPages.ts`
- All existing contribution pages/routes preserved (no breaking changes)

## Key Files

### New
- `app/src/features/contributions/types/marketplace.types.ts`
- `app/src/features/contributions/mockMarketplaceData.ts`
- `app/src/features/contributions/components/MarketplaceListingCard.tsx`
- `app/src/features/contributions/components/MarketplaceLicenseTierSelector.tsx`
- `app/src/features/contributions/components/MarketplaceStarRating.tsx`
- `app/src/features/contributions/components/MarketplaceDownloadModal.tsx`
- `app/src/features/contributions/pages/MarketplacePage.tsx`
- `app/src/features/contributions/pages/MarketplaceDetailPage.tsx`
- `app/src/features/contributions/pages/MyMarketplacePage.tsx`

### Modified
- `app/src/App.tsx` — 3 new routes
- `app/src/routes/lazyPages.ts` — 3 new lazy loaders
- `app/src/components/layout/Sidebar.tsx` — Contributions → Marketplace
- `app/src/features/contributions/pages/index.ts` — 3 new exports
- `app/src/features/contributions/components/index.ts` — 4 new exports
- `app/src/features/contributions/index.ts` — marketplace types + pages exports

## Test Results

All pages tested via Playwright MCP:
- Browse page renders with all 10 listings, filters work (type tabs, search, dropdowns)
- Detail page shows correct info for skills (success rate, adapter size) and datasets (episodes, frames, size)
- License selector highlights selection, shows unaffordable tiers with "Need X more credits"
- Purchase flow: select tier → purchase → "Purchase Complete!" state
- Download modal: file info, deployment steps, sovereignty note, animated progress, completion
- My Marketplace: purchases list + seller listings table
- Navigation: sidebar link, "My Marketplace" button, back buttons, listing links all work
