---
id: TASK-156
aliases:
- TASK-156
title: 'Refactor Data Contributions to Skill & Data Marketplace'
slug: skill-data-marketplace
status: deferred
priority: 2
owner: ''
projects: []
customers: []
sprint: ''
tags:
- core
depends_on:
- TASK-157
due_date: ''
created: '2026-04-10'
---

## Description

**Prerequisite:** TASK-157 (UI Prototype) is done — the marketplace pages, components, mock data, and routes are in place at `/marketplace`. This task adds the real backend (Prisma models, API endpoints, RustFS integration) and replaces mock data with live data.

Refactor the existing Data Contributions page (`/contributions`) into a **Skill & Data Marketplace** where users and companies can buy and sell robot skills (LoRA adapters) and datasets (LeRobot v3 recordings). Buyers download artifacts and run them on their own hardware — sovereignty is a key selling point.

## What Already Exists (from TASK-157 — UI Prototype)

The UI prototype is complete with mock data. All pages, components, types, and routes are in place. This task replaces mock data with real backend APIs.

### Marketplace Pages (already built, mock data)
- `app/src/features/contributions/pages/MarketplacePage.tsx` — browse page with hero, sovereignty tagline, credit balance, type tabs (All/Skills/Datasets), search bar, robot type + base model filter dropdowns, featured/trending sections, listing grid
- `app/src/features/contributions/pages/MarketplaceDetailPage.tsx` — detail view with seller info + tier badge, full description, skill preview placeholder / dataset stats, tags, tech specs table, reviews, license tier selector with purchase flow, download modal trigger, sovereignty note
- `app/src/features/contributions/pages/MyMarketplacePage.tsx` — tabbed: My Purchases (list with download buttons) + My Listings (seller table: title, type, status, downloads, revenue)

### Marketplace Components (already built)
- `app/src/features/contributions/components/MarketplaceListingCard.tsx` — browse grid card (type badge, title, description, robot/model tags, success rate or episode count, star rating, download count, seller with tier badge, price footer)
- `app/src/features/contributions/components/MarketplaceLicenseTierSelector.tsx` — 4-tier license picker (Research, Per Robot, Per Fleet, Enterprise) with credit price, affordability check ("Need X more credits"), selected state
- `app/src/features/contributions/components/MarketplaceStarRating.tsx` — reusable 1-5 star display with optional number
- `app/src/features/contributions/components/MarketplaceDownloadModal.tsx` — modal with file info (filename, size, format, SHA256 checksum + copy button), robot type + base model, "After Download" deployment steps (skill: place adapter → configure VLA server → robot loads; dataset: extract → reference in training config → fine-tune), "Your Infrastructure, Your Data" sovereignty banner, animated progress bar, completion state

### Marketplace Types (already defined)
- `app/src/features/contributions/types/marketplace.types.ts` — `MarketplaceItemType` (skill|dataset), `MarketplaceLicenseTier` (research|per_robot|per_fleet|enterprise), `RobotHardwareType` (SO-101|Unitree H1|Generic), `BaseModelType` (SmolVLA|Pi0.5|OpenVLA|None), `MarketplaceSeller`, `LicenseTierPrice`, `MarketplaceReview`, `MarketplaceListing`, `MarketplacePurchase`, `MyMarketplaceListing`, `MarketplaceFilters`, `LICENSE_TIER_LABELS`, `ITEM_TYPE_LABELS`

### Mock Data (to be replaced with API calls)
- `app/src/features/contributions/mockMarketplaceData.ts` — 10 listings (6 skills + 4 datasets), 6 seller profiles, 2-3 reviews per listing, 4 license tiers per listing, 3 mock purchases, 2 mock seller listings, credit balance

### Routes & Wiring (already configured)
- `app/src/App.tsx` — routes `/marketplace`, `/marketplace/mine`, `/marketplace/:id` (with ProtectedAppRoute)
- `app/src/routes/lazyPages.ts` — `LazyMarketplacePage`, `LazyMarketplaceDetailPage`, `LazyMyMarketplacePage`
- `app/src/components/layout/Sidebar.tsx` — "Marketplace" entry (was "Contributions") with shopping bag icon under Training & Models
- `app/src/features/contributions/pages/index.ts` — exports MarketplacePage, MarketplaceDetailPage, MyMarketplacePage
- `app/src/features/contributions/components/index.ts` — exports all 4 marketplace components
- `app/src/features/contributions/index.ts` — exports marketplace types + pages

### Existing Contributions Infrastructure (still in place)
- **Frontend**: `app/src/features/contributions/` — 15 original components, 3 original pages (`/contributions`, `/contributions/new`, `/contributions/:id`), Zustand store, hooks, API client — all still functional
- **Backend**: `server/src/routes/contribution.routes.ts` — 19+ endpoints (dual in-memory + Prisma), credit economy with 5-tier system (bronze→diamond)
- **DB models**: `DataContribution`, `ContributionCredit` in `server/prisma/schema.prisma`
- **Storage**: RustFS buckets for datasets (`training-datasets`) and models (`production-models`)
- **Training pipeline**: Dataset → TrainingJob → LoRA adapter (.safetensors) → Deployment
- **Reusable components**: `CreditBalance`, `TierBadge`, `Leaderboard`, `CreditsDashboard` — already imported by marketplace pages

## Marketplace Concept

### What's sold

| Item | Artifact | Format | Typical Size |
|------|----------|--------|-------------|
| **Dataset** | LeRobot v3 recording package | Video + joint states + actions (parquet/mp4) | 1-50 GB |
| **Skill** | LoRA adapter weights | `.safetensors` file + metadata (base model, robot type, task description) | 50-200 MB |

### Licensing model

| License tier | Scope | Target |
|-------------|-------|--------|
| **Research** | Non-commercial use only | Universities, hobbyists |
| **Per-Robot** | 1 robot instance | Small customers, prototyping |
| **Per-Fleet** | Unlimited robots in one org | Companies with robot fleets |
| **Enterprise** | Unlimited + redistribution rights | System integrators, OEMs |

### Sovereignty selling point

- Buyers download the actual artifact file — no cloud dependency, no phone-home
- Skills run on buyer's own hardware (VLA server loads LoRA adapters from local disk)
- No platform lock-in for inference — the marketplace is for discovery & purchase, not runtime
- "Buy once, run forever, on your own iron"

### Credit economy (keep & extend existing)

- **Sellers** earn credits when their datasets/skills are purchased
- **Buyers** spend credits to acquire items
- Existing tier system (bronze→diamond) becomes seller reputation
- Existing leaderboard becomes marketplace reputation
- Later: add EUR/USD payment gateway on top of credits

## Implementation Plan

### Phase 1: Schema & Backend (DONE: UI exists, needs real data)

**New/updated Prisma models:**
- `MarketplaceListing` — id, sellerId, type (skill|dataset), title, description, thumbnailUrl, robotType, baseModel, taskCategory, downloads, rating, status (draft|published|suspended)
- `ListingVersion` — id, listingId, version, artifactUri (RustFS path), fileSize, changelog
- `ListingLicense` — id, listingId, tier (research|per_robot|per_fleet|enterprise), priceCredits
- `ListingPurchase` — id, buyerId, listingId, licenseId, versionId, creditsPaid, purchasedAt, downloadCount
- `ListingReview` — id, buyerId, listingId, rating (1-5), comment
- Refactor `DataContribution` → map to `MarketplaceListing` (type=dataset)
- Refactor `ContributionCredit` → keep as `MarketplaceCredit` (add purchase/sale transaction types)

**New API endpoints (`/api/marketplace/`):**
- `GET /api/marketplace/listings` — browse/search with filters (type, robot, category, price range)
- `GET /api/marketplace/listings/:id` — listing detail
- `POST /api/marketplace/listings` — publish new listing (skill or dataset)
- `PUT /api/marketplace/listings/:id` — update listing
- `POST /api/marketplace/listings/:id/versions` — upload new version
- `GET /api/marketplace/listings/:id/download` — presigned download URL (requires valid purchase)
- `POST /api/marketplace/listings/:id/purchase` — buy with credits + license selection
- `POST /api/marketplace/listings/:id/reviews` — leave review
- `GET /api/marketplace/my/listings` — seller's own listings
- `GET /api/marketplace/my/purchases` — buyer's purchased items
- Keep existing credit/leaderboard endpoints, adapt to marketplace context

### Phase 3: Publish Flow

**For Skills (LoRA adapters):**
- After a training job completes → offer "Publish to Marketplace" action
- Auto-fill metadata from training job (base model, dataset, robot type, metrics)
- Seller adds: title, description, license tiers + pricing, task category
- Artifact: `.safetensors` file from `production-models` bucket

**For Datasets:**
- Refactor contribution wizard → "Publish Dataset" flow
- Seller uploads LeRobot v3 package or links existing dataset from `training-datasets` bucket
- Seller adds: title, description, license tiers + pricing, episode/frame counts, robot type

### Phase 4: Download & License Management

- Purchase generates a license key/record tied to buyer + license tier
- Download endpoint returns presigned RustFS URL (time-limited)
- Buyer's "My Purchases" page shows: purchased items, license details, download links, version updates
- Seller dashboard: sales stats, revenue (credits earned), download counts per listing

## Key Files to Create/Modify

### Server (new)
- `server/prisma/schema.prisma` — add MarketplaceListing, ListingVersion, ListingLicense, ListingPurchase, ListingReview models
- `server/src/routes/marketplace.routes.ts` — all `/api/marketplace/*` endpoints
- `server/src/services/MarketplaceService.ts` — listing CRUD, purchase logic, download URL generation, credit transactions
- `server/src/repositories/MarketplaceRepository.ts` — Prisma data access for marketplace models

### Frontend (modify existing prototype)
- `app/src/features/contributions/mockMarketplaceData.ts` → **delete** (replace with API calls)
- `app/src/features/contributions/api/` — add `marketplaceApi.ts` with real API client
- `app/src/features/contributions/store/` — add `marketplaceStore.ts` (Zustand) or extend existing store
- `app/src/features/contributions/hooks/` — add `marketplace.ts` hooks (useMarketplace, useMarketplaceListing, etc.)
- `app/src/features/contributions/pages/MarketplacePage.tsx` — replace `MOCK_LISTINGS` imports with store/hooks
- `app/src/features/contributions/pages/MarketplaceDetailPage.tsx` — replace mock data with API calls
- `app/src/features/contributions/pages/MyMarketplacePage.tsx` — replace mock data with API calls
- `app/src/features/contributions/components/MarketplaceDownloadModal.tsx` — wire real presigned download URL
- `app/src/features/training/` — add "Publish to Marketplace" action after training completes

### Optional (later)
- Rename feature folder `contributions/` → `marketplace/` (cosmetic, low priority)
- Remove old `/contributions` routes once marketplace is fully functional

## Test Strategy

- **Unit tests**: marketplace service (publish, purchase, download, license validation)
- **Integration tests**: full flow — publish dataset → buy with credits → download artifact → verify file
- **E2E**: browse marketplace → filter by robot type → purchase skill → check "My Purchases"
- **License enforcement**: verify download blocked without valid purchase, per-robot license limits respected
- **Migration**: existing contributions data migrates cleanly to marketplace listings
