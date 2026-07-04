/**
 * @file marketplace.routes.ts
 * @description REST API endpoints for the Skill & Data Marketplace (TASK-156).
 *              Mounted at /api/marketplace behind authMiddleware.
 * @feature marketplace
 */

import { Router, Request, Response } from 'express';
import { createReadStream } from 'fs';
import { marketplaceService } from '../services/MarketplaceService.js';
import type { AuthenticatedRequest } from '../middleware/auth.middleware.js';
import {
  MARKETPLACE_LICENSE_TIERS,
  type BaseModelType,
  type CreateListingInput,
  type CreateReviewInput,
  type MarketplaceLicenseTier,
  type MarketplaceListingType,
  type RobotHardwareType,
} from '../types/marketplace.types.js';

export const marketplaceRoutes = Router();

const VALID_TYPES: MarketplaceListingType[] = ['skill', 'dataset'];
const VALID_ROBOT_TYPES: RobotHardwareType[] = ['SO-101', 'Unitree H1', 'Generic'];
const VALID_BASE_MODELS: BaseModelType[] = ['SmolVLA', 'Pi0.5', 'OpenVLA', 'None'];

// Upper bounds on user-supplied content (express.json allows 10 MB bodies;
// without these any authenticated user could persist ~10 MB per listing).
const MAX_TITLE_LENGTH = 200;
const MAX_SHORT_DESCRIPTION_LENGTH = 500;
const MAX_FULL_DESCRIPTION_LENGTH = 20000;
const MAX_REVIEW_BODY_LENGTH = 5000;
const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 40;
const MAX_FEATURES = 10;
const MAX_FEATURE_LENGTH = 120;
const MAX_TEXT_FIELD_LENGTH = 100;

function getUserId(req: Request): string {
  return (req as AuthenticatedRequest).user?.id || 'anonymous-user';
}

function getUserName(req: Request): string {
  return (req as AuthenticatedRequest).user?.name || 'Anonymous';
}

/** undefined passes; otherwise must be a finite number within [min, max]. */
function isInvalidOptionalNumber(
  value: unknown,
  { integer = false, min = 0, max = Number.MAX_SAFE_INTEGER } = {}
): boolean {
  if (value === undefined) return false;
  if (typeof value !== 'number' || !Number.isFinite(value)) return true;
  if (integer && !Number.isInteger(value)) return true;
  return value < min || value > max;
}

/** undefined passes; otherwise must be a string within maxLength. */
function isInvalidOptionalString(value: unknown, maxLength: number): boolean {
  if (value === undefined) return false;
  return typeof value !== 'string' || value.length > maxLength;
}

// ============================================================================
// STATIC ROUTES (declared before /listings/:id parameter routes)
// ============================================================================

/**
 * GET /api/marketplace/listings
 * Browse published listings with optional filters.
 */
marketplaceRoutes.get('/listings', async (req: Request, res: Response) => {
  try {
    const query = req.query as Record<string, string | undefined>;

    if (query.type && !VALID_TYPES.includes(query.type as MarketplaceListingType)) {
      return res.status(400).json({
        error: `Invalid type. Must be one of: ${VALID_TYPES.join(', ')}`,
      });
    }

    const result = await marketplaceService.listListings({
      type: query.type as MarketplaceListingType | undefined,
      robotType: query.robotType,
      baseModel: query.baseModel,
      search: query.search,
      featured: query.featured === 'true' || undefined,
      trending: query.trending === 'true' || undefined,
    });

    res.json(result);
  } catch (error) {
    console.error('[MarketplaceRoutes] Error listing listings:', error);
    res.status(500).json({ error: 'Failed to list marketplace listings' });
  }
});

/**
 * POST /api/marketplace/listings
 * Create a new listing (published immediately — MVP, no review queue).
 */
marketplaceRoutes.post('/listings', async (req: Request, res: Response) => {
  try {
    const body = req.body as CreateListingInput;

    if (!body.type || !VALID_TYPES.includes(body.type)) {
      return res.status(400).json({
        error: `type must be one of: ${VALID_TYPES.join(', ')}`,
      });
    }
    if (!body.title || typeof body.title !== 'string' || !body.title.trim()) {
      return res.status(400).json({ error: 'title is required' });
    }
    if (body.title.length > MAX_TITLE_LENGTH) {
      return res.status(400).json({ error: `title must be at most ${MAX_TITLE_LENGTH} characters` });
    }
    if (
      !body.shortDescription ||
      typeof body.shortDescription !== 'string' ||
      !body.shortDescription.trim()
    ) {
      return res.status(400).json({ error: 'shortDescription is required' });
    }
    if (body.shortDescription.length > MAX_SHORT_DESCRIPTION_LENGTH) {
      return res.status(400).json({
        error: `shortDescription must be at most ${MAX_SHORT_DESCRIPTION_LENGTH} characters`,
      });
    }
    if (
      !body.fullDescription ||
      typeof body.fullDescription !== 'string' ||
      !body.fullDescription.trim()
    ) {
      return res.status(400).json({ error: 'fullDescription is required' });
    }
    if (body.fullDescription.length > MAX_FULL_DESCRIPTION_LENGTH) {
      return res.status(400).json({
        error: `fullDescription must be at most ${MAX_FULL_DESCRIPTION_LENGTH} characters`,
      });
    }
    if (!body.robotType || !VALID_ROBOT_TYPES.includes(body.robotType)) {
      return res.status(400).json({
        error: `robotType must be one of: ${VALID_ROBOT_TYPES.join(', ')}`,
      });
    }
    if (!body.baseModel || !VALID_BASE_MODELS.includes(body.baseModel)) {
      return res.status(400).json({
        error: `baseModel must be one of: ${VALID_BASE_MODELS.join(', ')}`,
      });
    }
    if (body.tags !== undefined) {
      if (!Array.isArray(body.tags) || body.tags.some((t) => typeof t !== 'string')) {
        return res.status(400).json({ error: 'tags must be an array of strings' });
      }
      if (body.tags.length > MAX_TAGS || body.tags.some((t) => t.length > MAX_TAG_LENGTH)) {
        return res.status(400).json({
          error: `tags: at most ${MAX_TAGS} tags of ${MAX_TAG_LENGTH} characters each`,
        });
      }
    }
    if (isInvalidOptionalNumber(body.successRate, { min: 0, max: 100 })) {
      return res.status(400).json({ error: 'successRate must be a number between 0 and 100' });
    }
    if (isInvalidOptionalNumber(body.adapterSizeMB, { min: 0, max: 1_000_000 })) {
      return res.status(400).json({ error: 'adapterSizeMB must be a non-negative number' });
    }
    if (isInvalidOptionalNumber(body.episodeCount, { integer: true, min: 0 })) {
      return res.status(400).json({ error: 'episodeCount must be a non-negative integer' });
    }
    if (isInvalidOptionalNumber(body.frameCount, { integer: true, min: 0 })) {
      return res.status(400).json({ error: 'frameCount must be a non-negative integer' });
    }
    if (isInvalidOptionalNumber(body.datasetSizeGB, { min: 0, max: 1_000_000 })) {
      return res.status(400).json({ error: 'datasetSizeGB must be a non-negative number' });
    }
    if (isInvalidOptionalString(body.taskCategory, MAX_TEXT_FIELD_LENGTH)) {
      return res.status(400).json({
        error: `taskCategory must be a string of at most ${MAX_TEXT_FIELD_LENGTH} characters`,
      });
    }
    if (isInvalidOptionalString(body.collectionMethod, MAX_TEXT_FIELD_LENGTH)) {
      return res.status(400).json({
        error: `collectionMethod must be a string of at most ${MAX_TEXT_FIELD_LENGTH} characters`,
      });
    }
    if (!Array.isArray(body.priceTiers) || body.priceTiers.length === 0) {
      return res.status(400).json({ error: 'priceTiers must be a non-empty array' });
    }
    const seenTiers = new Set<string>();
    for (const tier of body.priceTiers) {
      if (!tier || !MARKETPLACE_LICENSE_TIERS.includes(tier.tier)) {
        return res.status(400).json({
          error: `priceTiers[].tier must be one of: ${MARKETPLACE_LICENSE_TIERS.join(', ')}`,
        });
      }
      if (seenTiers.has(tier.tier)) {
        return res.status(400).json({ error: `Duplicate price tier: ${tier.tier}` });
      }
      seenTiers.add(tier.tier);
      if (
        typeof tier.priceCredits !== 'number' ||
        !Number.isInteger(tier.priceCredits) ||
        tier.priceCredits <= 0
      ) {
        return res.status(400).json({ error: 'priceTiers[].priceCredits must be a positive integer' });
      }
      if (
        tier.features !== undefined &&
        (!Array.isArray(tier.features) ||
          tier.features.length > MAX_FEATURES ||
          tier.features.some((f) => typeof f !== 'string' || f.length > MAX_FEATURE_LENGTH))
      ) {
        return res.status(400).json({
          error: `priceTiers[].features: at most ${MAX_FEATURES} strings of ${MAX_FEATURE_LENGTH} characters each`,
        });
      }
      if (isInvalidOptionalString(tier.description, MAX_SHORT_DESCRIPTION_LENGTH)) {
        return res.status(400).json({
          error: `priceTiers[].description must be a string of at most ${MAX_SHORT_DESCRIPTION_LENGTH} characters`,
        });
      }
    }

    const listing = await marketplaceService.createListing(getUserId(req), getUserName(req), body);

    res.status(201).json({ listing });
  } catch (error) {
    console.error('[MarketplaceRoutes] Error creating listing:', error);
    res.status(500).json({ error: 'Failed to create listing' });
  }
});

/**
 * GET /api/marketplace/my/purchases
 * Current user's purchases, newest first.
 */
marketplaceRoutes.get('/my/purchases', async (req: Request, res: Response) => {
  try {
    const result = await marketplaceService.getMyPurchases(getUserId(req));
    res.json(result);
  } catch (error) {
    console.error('[MarketplaceRoutes] Error getting purchases:', error);
    res.status(500).json({ error: 'Failed to get purchases' });
  }
});

/**
 * GET /api/marketplace/my/listings
 * Current user's own listings (any status) with revenue/download stats.
 */
marketplaceRoutes.get('/my/listings', async (req: Request, res: Response) => {
  try {
    const result = await marketplaceService.getMyListings(getUserId(req));
    res.json(result);
  } catch (error) {
    console.error('[MarketplaceRoutes] Error getting my listings:', error);
    res.status(500).json({ error: 'Failed to get my listings' });
  }
});

/**
 * GET /api/marketplace/credits/balance
 * Current user's credit balance.
 */
marketplaceRoutes.get('/credits/balance', async (req: Request, res: Response) => {
  try {
    const balance = await marketplaceService.getCreditBalance(getUserId(req));
    res.json({ balance });
  } catch (error) {
    console.error('[MarketplaceRoutes] Error getting credit balance:', error);
    res.status(500).json({ error: 'Failed to get credit balance' });
  }
});

// ============================================================================
// LISTING PARAMETER ROUTES
// ============================================================================

/**
 * GET /api/marketplace/listings/:id
 * Listing detail with reviews (newest first).
 */
marketplaceRoutes.get('/listings/:id', async (req: Request, res: Response) => {
  try {
    const listing = await marketplaceService.getListing(req.params.id);
    if (!listing) {
      return res.status(404).json({ error: 'Listing not found' });
    }
    res.json({ listing });
  } catch (error) {
    console.error('[MarketplaceRoutes] Error getting listing:', error);
    res.status(500).json({ error: 'Failed to get listing' });
  }
});

/**
 * POST /api/marketplace/listings/:id/purchase
 * Purchase a license tier for a listing (atomic credit debit/credit).
 */
marketplaceRoutes.post('/listings/:id/purchase', async (req: Request, res: Response) => {
  try {
    const { tier } = req.body as { tier?: MarketplaceLicenseTier };
    if (!tier || !MARKETPLACE_LICENSE_TIERS.includes(tier)) {
      return res.status(400).json({
        error: `tier must be one of: ${MARKETPLACE_LICENSE_TIERS.join(', ')}`,
      });
    }

    const result = await marketplaceService.purchaseListing(getUserId(req), req.params.id, tier);
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error, ...result.extras });
    }

    res.status(201).json({ purchase: result.purchase, balance: result.balance });
  } catch (error) {
    console.error('[MarketplaceRoutes] Error purchasing listing:', error);
    res.status(500).json({ error: 'Failed to purchase listing' });
  }
});

/**
 * GET /api/marketplace/listings/:id/download
 * Download metadata (presigned URL when RustFS is up, else url: null).
 * Increments download counters.
 */
marketplaceRoutes.get('/listings/:id/download', async (req: Request, res: Response) => {
  try {
    const result = await marketplaceService.getDownloadInfo(getUserId(req), req.params.id);
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error, ...result.extras });
    }
    res.json(result.info);
  } catch (error) {
    console.error('[MarketplaceRoutes] Error getting download info:', error);
    res.status(500).json({ error: 'Failed to get download info' });
  }
});

/**
 * GET /api/marketplace/listings/:id/download/file
 * Stream the artifact from the local-disk fallback.
 */
marketplaceRoutes.get('/listings/:id/download/file', async (req: Request, res: Response) => {
  try {
    const result = await marketplaceService.resolveDownloadFile(getUserId(req), req.params.id);
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error, ...result.extras });
    }

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${result.fileName}"`);
    res.setHeader('Content-Length', String(result.sizeBytes));

    const stream = createReadStream(result.absolutePath);
    stream.on('error', (error) => {
      console.error('[MarketplaceRoutes] Error streaming artifact:', error);
      if (!res.headersSent) {
        res.removeHeader('Content-Type');
        res.removeHeader('Content-Disposition');
        res.removeHeader('Content-Length');
        res.status(500).json({ error: 'Failed to stream artifact' });
      } else {
        res.destroy();
      }
    });
    stream.pipe(res);
  } catch (error) {
    console.error('[MarketplaceRoutes] Error downloading artifact:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to download artifact' });
    }
  }
});

/**
 * POST /api/marketplace/listings/:id/reviews
 * Review a purchased listing (one review per buyer per listing).
 */
marketplaceRoutes.post('/listings/:id/reviews', async (req: Request, res: Response) => {
  try {
    const body = req.body as CreateReviewInput;

    if (
      typeof body.rating !== 'number' ||
      !Number.isInteger(body.rating) ||
      body.rating < 1 ||
      body.rating > 5
    ) {
      return res.status(400).json({ error: 'rating must be an integer between 1 and 5' });
    }
    if (!body.body || typeof body.body !== 'string' || !body.body.trim()) {
      return res.status(400).json({ error: 'body must be a non-empty string' });
    }
    if (body.body.length > MAX_REVIEW_BODY_LENGTH) {
      return res.status(400).json({
        error: `body must be at most ${MAX_REVIEW_BODY_LENGTH} characters`,
      });
    }
    if (body.robotType !== undefined && !VALID_ROBOT_TYPES.includes(body.robotType)) {
      return res.status(400).json({
        error: `robotType must be one of: ${VALID_ROBOT_TYPES.join(', ')}`,
      });
    }

    const result = await marketplaceService.createReview(
      getUserId(req),
      getUserName(req),
      req.params.id,
      body
    );
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error, ...result.extras });
    }

    res.status(201).json({
      review: result.review,
      rating: result.rating,
      reviewCount: result.reviewCount,
    });
  } catch (error) {
    console.error('[MarketplaceRoutes] Error creating review:', error);
    res.status(500).json({ error: 'Failed to create review' });
  }
});
