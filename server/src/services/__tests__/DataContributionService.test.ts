/**
 * @file DataContributionService.test.ts
 * @description Unit tests for DataContributionService — contribution lifecycle, credit
 *   scoring, redemption guards, impact aggregation, leaderboard ranking.
 * @feature datasets
 */

import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'crypto';

import { DataContributionService } from '../DataContributionService.js';
import {
  DEFAULT_CREDIT_MULTIPLIERS,
  getTierForCredits,
} from '../../types/contribution.types.js';
import type {
  DataContribution,
  ContributionMetadata,
  InitiateContributionRequest,
} from '../../types/contribution.types.js';

// The service is an in-memory singleton; use a unique userId per test to keep
// state isolated across cases (the same Map persists across instances).
let uid = 0;
function nextUser(): string {
  uid += 1;
  return `user-${uid}-${Math.random().toString(36).slice(2)}`;
}

const metadata: ContributionMetadata = {
  robotType: 'so101',
  taskCategories: ['pick-place'],
  collectionMethod: 'teleoperation',
  description: 'test contribution',
};

const initRequest: InitiateContributionRequest = {
  licenseType: 'non_exclusive',
  metadata,
};

describe('DataContributionService', () => {
  let service: DataContributionService;

  beforeEach(() => {
    service = DataContributionService.getInstance();
  });

  // --------------------------------------------------------------------------
  // Contribution lifecycle
  // --------------------------------------------------------------------------

  describe('contribution lifecycle', () => {
    it('initiates a contribution in draft status', () => {
      const userId = nextUser();
      const c = service.initiateContribution(userId, initRequest);

      expect(c.id).toBeTruthy();
      expect(c.userId).toBe(userId);
      expect(c.status).toBe('draft');
      expect(c.trajectoryCount).toBe(0);
      expect(c.licenseType).toBe('non_exclusive');
      expect(service.getContribution(c.id)).toEqual(c);
    });

    it('emits contribution:initiated event', () => {
      const userId = nextUser();
      let captured: { contributionId?: string; userId?: string } | undefined;
      service.once('contribution:initiated', (e) => {
        captured = e;
      });

      const c = service.initiateContribution(userId, initRequest);

      expect(captured?.contributionId).toBe(c.id);
      expect(captured?.userId).toBe(userId);
    });

    it('uploads data and transitions draft -> uploaded', () => {
      const userId = nextUser();
      const c = service.initiateContribution(userId, initRequest);

      const updated = service.uploadContributionData(c.id, { trajectoryCount: 42 });

      expect(updated.status).toBe('uploaded');
      expect(updated.trajectoryCount).toBe(42);
    });

    it('rejects upload for unknown contribution', () => {
      expect(() =>
        service.uploadContributionData('does-not-exist', { trajectoryCount: 5 })
      ).toThrow('Contribution not found');
    });

    it('rejects upload when not in draft status', () => {
      const userId = nextUser();
      const c = service.initiateContribution(userId, initRequest);
      service.uploadContributionData(c.id, { trajectoryCount: 10 });

      expect(() =>
        service.uploadContributionData(c.id, { trajectoryCount: 20 })
      ).toThrow(/Cannot upload data in status: uploaded/);
    });

    it('submits for review only from uploaded status', () => {
      const userId = nextUser();
      const c = service.initiateContribution(userId, initRequest);

      // draft -> submitForReview should fail
      expect(() => service.submitForReview(c.id)).toThrow(
        /Cannot submit for review in status: draft/
      );

      service.uploadContributionData(c.id, { trajectoryCount: 10 });
      const submitted = service.submitForReview(c.id);
      expect(submitted.status).toBe('validating');
    });

    it('throws submitting for review on unknown contribution', () => {
      expect(() => service.submitForReview('nope')).toThrow('Contribution not found');
    });
  });

  // --------------------------------------------------------------------------
  // Review
  // --------------------------------------------------------------------------

  describe('reviewContribution', () => {
    // Build a contribution forced into 'reviewing' status directly via the
    // public lifecycle is timer-based; instead push it there by mutating the
    // returned object reference (the service stores it by reference).
    function makeReviewable(userId: string, trajectoryCount: number): DataContribution {
      const c = service.initiateContribution(userId, initRequest);
      service.uploadContributionData(c.id, { trajectoryCount });
      const submitted = service.submitForReview(c.id);
      // submitForReview leaves status 'validating'; advance to 'reviewing'
      submitted.status = 'reviewing';
      submitted.qualityScore = 80;
      return submitted;
    }

    it('rejects review when not in reviewing status', () => {
      const userId = nextUser();
      const c = service.initiateContribution(userId, initRequest);

      expect(() =>
        service.reviewContribution(c.id, 'admin', { decision: 'accept' })
      ).toThrow(/Cannot review in status: draft/);
    });

    it('throws review on unknown contribution', () => {
      expect(() =>
        service.reviewContribution('nope', 'admin', { decision: 'accept' })
      ).toThrow('Contribution not found');
    });

    it('accepts a contribution, assigns dataset and awards credits', () => {
      const userId = nextUser();
      const c = makeReviewable(userId, 100);

      const reviewed = service.reviewContribution(c.id, 'admin-1', {
        decision: 'accept',
      });

      expect(reviewed.status).toBe('accepted');
      expect(reviewed.datasetId).toBe(`dataset_${c.id}`);
      expect(reviewed.reviewedBy).toBe('admin-1');
      expect(reviewed.creditsAwarded).toBeGreaterThan(0);
    });

    it('applies qualityOverride before computing credits', () => {
      const userId = nextUser();
      const c = makeReviewable(userId, 100);
      c.qualityScore = 80;

      const reviewed = service.reviewContribution(c.id, 'admin', {
        decision: 'accept',
        qualityOverride: 100,
      });

      expect(reviewed.qualityScore).toBe(100);
    });

    it('rejects a contribution with default reason', () => {
      const userId = nextUser();
      const c = makeReviewable(userId, 50);

      const reviewed = service.reviewContribution(c.id, 'admin', {
        decision: 'reject',
      });

      expect(reviewed.status).toBe('rejected');
      expect(reviewed.rejectionReason).toBe('Did not meet quality standards');
      expect(reviewed.datasetId).toBeUndefined();
    });

    it('rejects a contribution with a custom reason', () => {
      const userId = nextUser();
      const c = makeReviewable(userId, 50);

      const reviewed = service.reviewContribution(c.id, 'admin', {
        decision: 'reject',
        rejectionReason: 'duplicate data',
      });

      expect(reviewed.rejectionReason).toBe('duplicate data');
    });
  });

  // --------------------------------------------------------------------------
  // Revocation
  // --------------------------------------------------------------------------

  describe('revokeContribution', () => {
    it('revokes a contribution and records reason', () => {
      const userId = nextUser();
      const c = service.initiateContribution(userId, initRequest);

      const revoked = service.revokeContribution(c.id, 'consent withdrawn');

      expect(revoked.status).toBe('revoked');
      expect(revoked.revocationReason).toBe('consent withdrawn');
      expect(revoked.revokedAt).toBeInstanceOf(Date);
    });

    it('is idempotent when already revoked', () => {
      const userId = nextUser();
      const c = service.initiateContribution(userId, initRequest);
      const first = service.revokeContribution(c.id, 'reason1');
      const firstRevokedAt = first.revokedAt;

      const second = service.revokeContribution(c.id, 'reason2');

      // returns existing unchanged; reason not overwritten
      expect(second.revocationReason).toBe('reason1');
      expect(second.revokedAt).toBe(firstRevokedAt);
    });

    it('throws on unknown contribution', () => {
      expect(() => service.revokeContribution('nope', 'x')).toThrow(
        'Contribution not found'
      );
    });
  });

  // --------------------------------------------------------------------------
  // Credit calculation
  // --------------------------------------------------------------------------

  describe('calculateCredits', () => {
    const m = DEFAULT_CREDIT_MULTIPLIERS;

    function buildContribution(
      userId: string,
      overrides: Partial<DataContribution>
    ): DataContribution {
      return {
        id: crypto.randomUUID(),
        userId,
        status: 'reviewing',
        trajectoryCount: 0,
        licenseType: 'non_exclusive',
        consentGrantedAt: new Date(),
        metadata,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
      };
    }

    it('computes base credits + first-contribution bonus when no prior accepted', () => {
      const userId = nextUser();
      const c = buildContribution(userId, { trajectoryCount: 10 });

      // 10 * 10 = 100 base, no quality, + firstContributionBonus(100) = 200
      const credits = service.calculateCredits(c);
      expect(credits).toBe(
        10 * m.baseCreditsPerTrajectory + m.firstContributionBonus
      );
    });

    it('applies the quality bonus multiplicatively', () => {
      const userId = nextUser();
      const c = buildContribution(userId, {
        trajectoryCount: 10,
        qualityScore: 50,
      });

      // base 100 * (1 + 50*0.02=1) = 200, + first bonus 100 = 300
      const expected = Math.floor(
        10 * m.baseCreditsPerTrajectory * (1 + 50 * m.qualityMultiplier) +
          m.firstContributionBonus
      );
      expect(service.calculateCredits(c)).toBe(expected);
    });

    it('applies the large-dataset multiplier above threshold', () => {
      const userId = nextUser();
      const c = buildContribution(userId, {
        trajectoryCount: m.largeDatasetThreshold,
      });

      const expected = Math.floor(
        m.largeDatasetThreshold *
          m.baseCreditsPerTrajectory *
          m.largeDatasetMultiplier +
          m.firstContributionBonus
      );
      expect(service.calculateCredits(c)).toBe(expected);
    });

    it('omits the first-contribution bonus when user already has an accepted contribution', () => {
      const userId = nextUser();

      // Create + accept one contribution so the user has prior accepted history.
      const first = service.initiateContribution(userId, initRequest);
      service.uploadContributionData(first.id, { trajectoryCount: 5 });
      const submitted = service.submitForReview(first.id);
      submitted.status = 'reviewing';
      submitted.qualityScore = 80;
      service.reviewContribution(first.id, 'admin', { decision: 'accept' });

      // Now calc for a second contribution: no first-contribution bonus.
      const second = buildContribution(userId, { trajectoryCount: 10 });
      expect(service.calculateCredits(second)).toBe(
        10 * m.baseCreditsPerTrajectory
      );
    });

    it('returns a floored integer', () => {
      const userId = nextUser();
      const c = buildContribution(userId, {
        trajectoryCount: 3,
        qualityScore: 33,
      });
      const credits = service.calculateCredits(c);
      expect(Number.isInteger(credits)).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Credit balance & history
  // --------------------------------------------------------------------------

  describe('credit balance & history', () => {
    it('reports zeros for a user with no credits', () => {
      const userId = nextUser();
      const balance = service.getCreditBalance(userId);
      expect(balance).toMatchObject({
        userId,
        totalEarned: 0,
        totalRedeemed: 0,
        available: 0,
        pending: 0,
      });
    });

    it('accumulates earned credits from bonus awards', () => {
      const userId = nextUser();
      service.awardBonusCredits(userId, 300, 'bonus', 'promo');
      service.awardBonusCredits(userId, 200, 'referral');

      const balance = service.getCreditBalance(userId);
      expect(balance.totalEarned).toBe(500);
      expect(balance.available).toBe(500);
    });

    it('counts pending credits from contributions still under review', () => {
      const userId = nextUser();
      const c = service.initiateContribution(userId, initRequest);
      service.uploadContributionData(c.id, { trajectoryCount: 10 });
      service.submitForReview(c.id); // -> validating, counts as pending

      const balance = service.getCreditBalance(userId);
      expect(balance.pending).toBeGreaterThan(0);
    });

    it('returns credit history newest-first and honors limit', () => {
      const userId = nextUser();
      service.awardBonusCredits(userId, 100, 'bonus');
      service.awardBonusCredits(userId, 200, 'bonus');
      service.awardBonusCredits(userId, 300, 'bonus');

      const all = service.getCreditHistory(userId);
      expect(all.length).toBe(3);

      const limited = service.getCreditHistory(userId, { limit: 2 });
      expect(limited.length).toBe(2);

      // sorted by awardedAt desc — verify ordering is non-increasing
      for (let i = 1; i < all.length; i++) {
        expect(all[i - 1].awardedAt.getTime()).toBeGreaterThanOrEqual(
          all[i].awardedAt.getTime()
        );
      }
    });
  });

  // --------------------------------------------------------------------------
  // Rewards & redemption
  // --------------------------------------------------------------------------

  describe('rewards & redemption', () => {
    it('exposes default available rewards', () => {
      const rewards = service.getRewards();
      const ids = rewards.map((r) => r.id);
      expect(ids).toContain('service-credit-100');
      expect(ids).toContain('priority-training');
      expect(rewards.every((r) => r.available)).toBe(true);
    });

    it('getReward returns a known reward', () => {
      const reward = service.getReward('service-credit-100');
      expect(reward?.creditCost).toBe(10000);
    });

    it('throws redeeming an unknown reward', () => {
      const userId = nextUser();
      expect(() => service.redeemCredits(userId, 'no-such-reward')).toThrow(
        'Reward not found'
      );
    });

    it('throws when the user lacks sufficient credits', () => {
      const userId = nextUser();
      service.awardBonusCredits(userId, 100, 'bonus');
      // feature-beta-access costs 2500
      expect(() => service.redeemCredits(userId, 'feature-beta-access')).toThrow(
        /Insufficient credits/
      );
    });

    it('deducts credits and creates a pending redemption on success', () => {
      const userId = nextUser();
      service.awardBonusCredits(userId, 5000, 'bonus');

      const redemption = service.redeemCredits(userId, 'feature-beta-access');

      expect(redemption.status).toBe('pending');
      expect(redemption.creditCost).toBe(2500);

      const balance = service.getCreditBalance(userId);
      expect(balance.totalRedeemed).toBe(2500);
      expect(balance.available).toBe(2500);

      const history = service.getRedemptionHistory(userId);
      expect(history).toHaveLength(1);
      expect(history[0].id).toBe(redemption.id);
    });

    it('enforces per-user redemption limits', () => {
      const userId = nextUser();
      // priority-training: cost 5000, limitPerUser 1
      service.awardBonusCredits(userId, 20000, 'bonus');

      service.redeemCredits(userId, 'priority-training');
      expect(() => service.redeemCredits(userId, 'priority-training')).toThrow(
        /reached the limit/
      );
    });
  });

  // --------------------------------------------------------------------------
  // Impact tracking
  // --------------------------------------------------------------------------

  describe('impact tracking', () => {
    it('records impact and aggregates a summary', () => {
      const contributionId = crypto.randomUUID();

      service.recordImpact(contributionId, 'model-v1', 100, 0.8, [
        { metric: 'success_rate', before: 0.5, after: 0.7, attributionPercent: 0 },
      ]);
      service.recordImpact(contributionId, 'model-v2', 50, 0.6, [
        { metric: 'success_rate', before: 0.7, after: 0.9, attributionPercent: 0 },
      ]);

      const summary = service.getImpactSummary(contributionId);

      expect(summary.totalModelsUsedIn).toBe(2);
      expect(summary.totalTrajectoriesUsed).toBe(150);
      expect(summary.averageImpactScore).toBeCloseTo(0.7, 5);

      // improvements averaged across the two records for the same metric
      const sr = summary.improvements.find((i) => i.metric === 'success_rate');
      expect(sr).toBeDefined();
      expect(sr?.before).toBeCloseTo(0.6, 5); // (0.5 + 0.7) / 2
      expect(sr?.after).toBeCloseTo(0.8, 5); // (0.7 + 0.9) / 2
      expect(summary.lastUsedAt).toBeInstanceOf(Date);
    });

    it('returns an empty summary when there is no recorded impact', () => {
      const summary = service.getImpactSummary(crypto.randomUUID());
      expect(summary.totalModelsUsedIn).toBe(0);
      expect(summary.totalTrajectoriesUsed).toBe(0);
      expect(summary.averageImpactScore).toBe(0);
      expect(summary.improvements).toEqual([]);
      expect(summary.lastUsedAt).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // Contributor stats & leaderboard
  // --------------------------------------------------------------------------

  describe('contributor stats & leaderboard', () => {
    function acceptContribution(
      userId: string,
      trajectoryCount: number,
      quality: number
    ): DataContribution {
      const c = service.initiateContribution(userId, initRequest);
      service.uploadContributionData(c.id, { trajectoryCount });
      const submitted = service.submitForReview(c.id);
      submitted.status = 'reviewing';
      submitted.qualityScore = quality;
      return service.reviewContribution(c.id, 'admin', { decision: 'accept' });
    }

    it('returns undefined stats for a user with no contributions', () => {
      expect(service.getContributorStats(nextUser())).toBeUndefined();
    });

    it('computes acceptance rate and average quality', () => {
      const userId = nextUser();
      acceptContribution(userId, 10, 80);

      // a rejected one
      const rej = service.initiateContribution(userId, initRequest);
      service.uploadContributionData(rej.id, { trajectoryCount: 5 });
      const sub = service.submitForReview(rej.id);
      sub.status = 'reviewing';
      sub.qualityScore = 40;
      service.reviewContribution(rej.id, 'admin', { decision: 'reject' });

      const stats = service.getContributorStats(userId);
      expect(stats).toBeDefined();
      expect(stats?.totalContributions).toBe(1); // only accepted counted
      expect(stats?.acceptanceRate).toBeCloseTo(0.5, 5); // 1 of 2
      expect(stats?.averageQuality).toBe(80);
      expect(stats?.tier).toBe(getTierForCredits(stats!.totalCredits));
    });

    it('ranks leaderboard entries by total credits descending', () => {
      const orgId = `org-${Math.random().toString(36).slice(2)}`;
      const richUser = nextUser();
      const poorUser = nextUser();

      // Override the request to share an organization for filtering.
      const reqWithOrg: InitiateContributionRequest = {
        ...initRequest,
        organizationId: orgId,
      };

      const big = service.initiateContribution(richUser, reqWithOrg);
      service.uploadContributionData(big.id, { trajectoryCount: 500 });
      const bigSub = service.submitForReview(big.id);
      bigSub.status = 'reviewing';
      bigSub.qualityScore = 90;
      service.reviewContribution(big.id, 'admin', { decision: 'accept' });

      const small = service.initiateContribution(poorUser, reqWithOrg);
      service.uploadContributionData(small.id, { trajectoryCount: 1 });
      const smallSub = service.submitForReview(small.id);
      smallSub.status = 'reviewing';
      smallSub.qualityScore = 60;
      service.reviewContribution(small.id, 'admin', { decision: 'accept' });

      const board = service.getLeaderboard({ organizationId: orgId });

      expect(board).toHaveLength(2);
      expect(board[0].userId).toBe(richUser);
      expect(board[0].rank).toBe(1);
      expect(board[1].userId).toBe(poorUser);
      expect(board[1].rank).toBe(2);
      expect(board[0].totalCredits).toBeGreaterThanOrEqual(board[1].totalCredits);
    });

    it('honors the leaderboard limit', () => {
      const orgId = `org-${Math.random().toString(36).slice(2)}`;
      const reqWithOrg: InitiateContributionRequest = {
        ...initRequest,
        organizationId: orgId,
      };
      for (let i = 0; i < 3; i++) {
        const u = nextUser();
        const c = service.initiateContribution(u, reqWithOrg);
        service.uploadContributionData(c.id, { trajectoryCount: 10 * (i + 1) });
        const sub = service.submitForReview(c.id);
        sub.status = 'reviewing';
        sub.qualityScore = 70;
        service.reviewContribution(c.id, 'admin', { decision: 'accept' });
      }

      const board = service.getLeaderboard({ organizationId: orgId, limit: 2 });
      expect(board).toHaveLength(2);
    });
  });
});
