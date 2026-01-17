/**
 * @file contributions.routes.ts
 * @description REST API endpoints for customer data contributions
 * @feature datasets
 */

import { Router, Request, Response } from 'express';
import { dataContributionService } from '../services/DataContributionService.js';
import type {
  InitiateContributionRequest,
  UploadContributionDataRequest,
  ReviewContributionRequest,
  RedeemCreditsRequest,
  ContributionStatus,
  ContributionLicenseType,
} from '../types/contribution.types.js';

export const contributionsRoutes = Router();

// ============================================================================
// CONTRIBUTION MANAGEMENT
// ============================================================================

/**
 * POST /api/contributions
 * Initiate a new contribution
 */
contributionsRoutes.post('/', async (req: Request, res: Response) => {
  try {
    const body = req.body as InitiateContributionRequest;

    // Get user ID from auth (mock for now)
    const userId = (req as any).user?.id || 'anonymous-user';

    // Validate required fields
    if (!body.licenseType) {
      return res.status(400).json({ error: 'licenseType is required' });
    }

    const validLicenses: ContributionLicenseType[] = [
      'exclusive',
      'non_exclusive',
      'limited',
      'research_only',
    ];
    if (!validLicenses.includes(body.licenseType)) {
      return res.status(400).json({
        error: `Invalid licenseType. Must be one of: ${validLicenses.join(', ')}`,
      });
    }

    if (!body.metadata) {
      return res.status(400).json({ error: 'metadata is required' });
    }

    if (!body.metadata.robotType) {
      return res.status(400).json({ error: 'metadata.robotType is required' });
    }

    if (!body.metadata.taskCategories || body.metadata.taskCategories.length === 0) {
      return res.status(400).json({
        error: 'metadata.taskCategories must be a non-empty array',
      });
    }

    if (!body.metadata.collectionMethod) {
      return res.status(400).json({
        error: 'metadata.collectionMethod is required',
      });
    }

    if (!body.metadata.description) {
      return res.status(400).json({
        error: 'metadata.description is required',
      });
    }

    const contribution = dataContributionService.initiateContribution(userId, body);

    res.status(201).json(contribution);
  } catch (error) {
    console.error('[ContributionsRoutes] Error initiating contribution:', error);
    res.status(500).json({ error: 'Failed to initiate contribution' });
  }
});

/**
 * POST /api/contributions/:id/upload
 * Upload contribution data
 */
contributionsRoutes.post('/:id/upload', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const body = req.body as UploadContributionDataRequest;

    if (!body.trajectoryCount || body.trajectoryCount < 1) {
      return res.status(400).json({
        error: 'trajectoryCount must be a positive integer',
      });
    }

    const contribution = dataContributionService.uploadContributionData(id, body);

    // Calculate estimated credits
    const estimatedCredits = dataContributionService.calculateCredits(contribution);

    res.json({
      contribution,
      estimatedCredits,
      message: 'Data uploaded successfully. Submit for review when ready.',
    });
  } catch (error) {
    console.error('[ContributionsRoutes] Error uploading data:', error);
    const message =
      error instanceof Error ? error.message : 'Failed to upload data';
    res.status(400).json({ error: message });
  }
});

/**
 * POST /api/contributions/:id/submit
 * Submit contribution for review
 */
contributionsRoutes.post('/:id/submit', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const contribution = dataContributionService.submitForReview(id);

    res.json({
      contribution,
      message: 'Contribution submitted for review. You will be notified of the result.',
    });
  } catch (error) {
    console.error('[ContributionsRoutes] Error submitting for review:', error);
    const message =
      error instanceof Error ? error.message : 'Failed to submit for review';
    res.status(400).json({ error: message });
  }
});

/**
 * GET /api/contributions
 * List contributions (user's own or all for admin)
 */
contributionsRoutes.get('/', async (req: Request, res: Response) => {
  try {
    const query = req.query as Record<string, string | undefined>;
    const userId = (req as any).user?.id || query.userId;

    const { contributions, total } = dataContributionService.listContributions({
      userId,
      status: query.status as ContributionStatus | undefined,
      licenseType: query.licenseType as ContributionLicenseType | undefined,
      limit: query.limit ? parseInt(query.limit, 10) : 50,
      offset: query.offset ? parseInt(query.offset, 10) : 0,
    });

    res.json({
      contributions,
      total,
      limit: query.limit ? parseInt(query.limit, 10) : 50,
      offset: query.offset ? parseInt(query.offset, 10) : 0,
    });
  } catch (error) {
    console.error('[ContributionsRoutes] Error listing contributions:', error);
    res.status(500).json({ error: 'Failed to list contributions' });
  }
});

/**
 * GET /api/contributions/:id
 * Get a specific contribution
 */
contributionsRoutes.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const contribution = dataContributionService.getContribution(id);
    if (!contribution) {
      return res.status(404).json({ error: 'Contribution not found' });
    }

    res.json(contribution);
  } catch (error) {
    console.error('[ContributionsRoutes] Error getting contribution:', error);
    res.status(500).json({ error: 'Failed to get contribution' });
  }
});

/**
 * POST /api/contributions/:id/review
 * Review a contribution (admin only)
 */
contributionsRoutes.post('/:id/review', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const body = req.body as ReviewContributionRequest;
    const reviewerId = (req as any).user?.id || 'admin';

    if (!body.decision) {
      return res.status(400).json({ error: 'decision is required' });
    }

    if (body.decision !== 'accept' && body.decision !== 'reject') {
      return res.status(400).json({
        error: 'decision must be "accept" or "reject"',
      });
    }

    if (body.decision === 'reject' && !body.rejectionReason) {
      return res.status(400).json({
        error: 'rejectionReason is required when rejecting',
      });
    }

    const contribution = dataContributionService.reviewContribution(
      id,
      reviewerId,
      body
    );

    res.json({
      contribution,
      message:
        contribution.status === 'accepted'
          ? `Contribution accepted. ${contribution.creditsAwarded} credits awarded.`
          : `Contribution rejected: ${contribution.rejectionReason}`,
    });
  } catch (error) {
    console.error('[ContributionsRoutes] Error reviewing contribution:', error);
    const message =
      error instanceof Error ? error.message : 'Failed to review contribution';
    res.status(400).json({ error: message });
  }
});

/**
 * POST /api/contributions/:id/revoke
 * Revoke a contribution (consent withdrawal)
 */
contributionsRoutes.post('/:id/revoke', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { reason } = req.body as { reason?: string };

    const contribution = dataContributionService.revokeContribution(
      id,
      reason || 'User requested revocation'
    );

    res.json({
      contribution,
      message:
        'Contribution revoked. Your data will be excluded from future training.',
    });
  } catch (error) {
    console.error('[ContributionsRoutes] Error revoking contribution:', error);
    const message =
      error instanceof Error ? error.message : 'Failed to revoke contribution';
    res.status(400).json({ error: message });
  }
});

// ============================================================================
// IMPACT
// ============================================================================

/**
 * GET /api/contributions/:id/impact
 * Get impact report for a contribution
 */
contributionsRoutes.get('/:id/impact', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const contribution = dataContributionService.getContribution(id);
    if (!contribution) {
      return res.status(404).json({ error: 'Contribution not found' });
    }

    const impact = dataContributionService.getImpactSummary(id);

    res.json({
      contributionId: id,
      impact,
      message:
        impact.totalModelsUsedIn > 0
          ? `Your data has been used in ${impact.totalModelsUsedIn} model(s)`
          : 'Your data has not yet been used in any models',
    });
  } catch (error) {
    console.error('[ContributionsRoutes] Error getting impact:', error);
    res.status(500).json({ error: 'Failed to get impact report' });
  }
});

// ============================================================================
// CREDITS
// ============================================================================

/**
 * GET /api/contributions/credits
 * Get credit balance
 */
contributionsRoutes.get('/credits', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id || 'anonymous-user';

    const balance = dataContributionService.getCreditBalance(userId);

    res.json(balance);
  } catch (error) {
    console.error('[ContributionsRoutes] Error getting credits:', error);
    res.status(500).json({ error: 'Failed to get credit balance' });
  }
});

/**
 * GET /api/contributions/credits/history
 * Get credit history
 */
contributionsRoutes.get('/credits/history', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id || 'anonymous-user';
    const query = req.query as Record<string, string | undefined>;

    const history = dataContributionService.getCreditHistory(userId, {
      limit: query.limit ? parseInt(query.limit, 10) : 50,
      offset: query.offset ? parseInt(query.offset, 10) : 0,
    });

    res.json({
      history,
      count: history.length,
    });
  } catch (error) {
    console.error('[ContributionsRoutes] Error getting credit history:', error);
    res.status(500).json({ error: 'Failed to get credit history' });
  }
});

/**
 * POST /api/contributions/credits/redeem
 * Redeem credits for a reward
 */
contributionsRoutes.post('/credits/redeem', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id || 'anonymous-user';
    const body = req.body as RedeemCreditsRequest;

    if (!body.rewardId) {
      return res.status(400).json({ error: 'rewardId is required' });
    }

    const redemption = dataContributionService.redeemCredits(userId, body.rewardId);

    const reward = dataContributionService.getReward(body.rewardId);

    res.json({
      redemption,
      reward,
      message: `Successfully redeemed ${reward?.name}`,
    });
  } catch (error) {
    console.error('[ContributionsRoutes] Error redeeming credits:', error);
    const message =
      error instanceof Error ? error.message : 'Failed to redeem credits';
    res.status(400).json({ error: message });
  }
});

// ============================================================================
// REWARDS
// ============================================================================

/**
 * GET /api/contributions/rewards
 * Get available rewards
 */
contributionsRoutes.get('/rewards', async (_req: Request, res: Response) => {
  try {
    const rewards = dataContributionService.getRewards();

    res.json({
      rewards,
      count: rewards.length,
    });
  } catch (error) {
    console.error('[ContributionsRoutes] Error getting rewards:', error);
    res.status(500).json({ error: 'Failed to get rewards' });
  }
});

/**
 * GET /api/contributions/redemptions
 * Get redemption history
 */
contributionsRoutes.get('/redemptions', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id || 'anonymous-user';

    const redemptions = dataContributionService.getRedemptionHistory(userId);

    res.json({
      redemptions,
      count: redemptions.length,
    });
  } catch (error) {
    console.error('[ContributionsRoutes] Error getting redemptions:', error);
    res.status(500).json({ error: 'Failed to get redemption history' });
  }
});

// ============================================================================
// LEADERBOARD
// ============================================================================

/**
 * GET /api/contributions/leaderboard
 * Get contributor leaderboard
 */
contributionsRoutes.get('/leaderboard', async (req: Request, res: Response) => {
  try {
    const query = req.query as Record<string, string | undefined>;

    const leaderboard = dataContributionService.getLeaderboard({
      limit: query.limit ? parseInt(query.limit, 10) : 100,
      organizationId: query.organizationId,
    });

    res.json({
      leaderboard,
      count: leaderboard.length,
    });
  } catch (error) {
    console.error('[ContributionsRoutes] Error getting leaderboard:', error);
    res.status(500).json({ error: 'Failed to get leaderboard' });
  }
});

/**
 * GET /api/contributions/stats
 * Get contributor stats for current user
 */
contributionsRoutes.get('/stats', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id || 'anonymous-user';

    const stats = dataContributionService.getContributorStats(userId);

    if (!stats) {
      return res.json({
        message: 'No contributions yet',
        stats: null,
      });
    }

    res.json(stats);
  } catch (error) {
    console.error('[ContributionsRoutes] Error getting stats:', error);
    res.status(500).json({ error: 'Failed to get contributor stats' });
  }
});
