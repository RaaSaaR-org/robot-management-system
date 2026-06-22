/**
 * @file contributions-routes.test.ts
 * @description Integration tests for customer data contribution routes
 * @feature contributions
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Use vi.hoisted so mock objects are available before vi.mock hoisting
const { mockDataContributionService, mockContributionService } = vi.hoisted(() => ({
  mockDataContributionService: {
    initiateContribution: vi.fn(),
    uploadContributionData: vi.fn(),
    calculateCredits: vi.fn(),
    submitForReview: vi.fn(),
    listContributions: vi.fn(),
    reviewContribution: vi.fn(),
    revokeContribution: vi.fn(),
    getCreditBalance: vi.fn(),
    getCreditHistory: vi.fn(),
    redeemCredits: vi.fn(),
    getReward: vi.fn(),
    getRewards: vi.fn(),
    getRedemptionHistory: vi.fn(),
    getLeaderboard: vi.fn(),
    getContributorStats: vi.fn(),
    getContribution: vi.fn(),
    getImpactSummary: vi.fn(),
  },
  mockContributionService: {
    submitContribution: vi.fn(),
    getContributions: vi.fn(),
    getUserCredits: vi.fn(),
    getLeaderboard: vi.fn(),
    getImpactStats: vi.fn(),
    approveContribution: vi.fn(),
    getContribution: vi.fn(),
  },
}));

vi.mock('../services/DataContributionService.js', () => ({
  dataContributionService: mockDataContributionService,
}));

vi.mock('../services/ContributionService.js', () => ({
  contributionService: mockContributionService,
}));

vi.mock('../middleware/auth.middleware.js', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-123', email: 'test@example.com', name: 'Test', role: 'admin' };
    next();
  },
  ownerOnly: (_req: any, _res: any, next: any) => next(),
  AuthenticatedRequest: {},
}));

import { contributionsRoutes } from '../routes/contributions.routes.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/contributions', authMiddleware as any, contributionsRoutes);
  return app;
}

const VALID_INITIATE_BODY = {
  licenseType: 'non_exclusive',
  metadata: {
    robotType: 'so101',
    taskCategories: ['manipulation'],
    collectionMethod: 'teleoperation',
    description: 'Pick and place dataset',
  },
};

describe('Contributions Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  // --------------------------------------------------------------------------
  // POST /api/contributions
  // --------------------------------------------------------------------------

  describe('POST /api/contributions', () => {
    it('initiates a contribution (201)', async () => {
      const contribution = { id: 'contrib-1', status: 'draft' };
      mockDataContributionService.initiateContribution.mockReturnValue(contribution);

      const response = await request(app).post('/api/contributions').send(VALID_INITIATE_BODY);

      expect(response.status).toBe(201);
      expect(response.body.id).toBe('contrib-1');
      expect(mockDataContributionService.initiateContribution).toHaveBeenCalledWith(
        'user-123',
        VALID_INITIATE_BODY
      );
    });

    it('returns 400 when licenseType is missing', async () => {
      const { licenseType, ...rest } = VALID_INITIATE_BODY;
      const response = await request(app).post('/api/contributions').send(rest);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('licenseType is required');
    });

    it('returns 400 for invalid licenseType', async () => {
      const response = await request(app)
        .post('/api/contributions')
        .send({ ...VALID_INITIATE_BODY, licenseType: 'bogus' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid licenseType');
    });

    it('returns 400 when metadata is missing', async () => {
      const response = await request(app)
        .post('/api/contributions')
        .send({ licenseType: 'limited' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('metadata is required');
    });

    it('returns 400 when metadata.robotType is missing', async () => {
      const response = await request(app)
        .post('/api/contributions')
        .send({ licenseType: 'limited', metadata: { taskCategories: ['x'] } });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('metadata.robotType is required');
    });

    it('returns 400 when taskCategories is empty', async () => {
      const response = await request(app)
        .post('/api/contributions')
        .send({
          licenseType: 'limited',
          metadata: { robotType: 'so101', taskCategories: [] },
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('taskCategories');
    });

    it('returns 400 when collectionMethod is missing', async () => {
      const response = await request(app)
        .post('/api/contributions')
        .send({
          licenseType: 'limited',
          metadata: { robotType: 'so101', taskCategories: ['x'] },
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('metadata.collectionMethod is required');
    });

    it('returns 400 when description is missing', async () => {
      const response = await request(app)
        .post('/api/contributions')
        .send({
          licenseType: 'limited',
          metadata: {
            robotType: 'so101',
            taskCategories: ['x'],
            collectionMethod: 'teleoperation',
          },
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('metadata.description is required');
    });

    it('returns 500 on service error', async () => {
      mockDataContributionService.initiateContribution.mockImplementation(() => {
        throw new Error('boom');
      });

      const response = await request(app).post('/api/contributions').send(VALID_INITIATE_BODY);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to initiate contribution');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/contributions/:id/upload
  // --------------------------------------------------------------------------

  describe('POST /api/contributions/:id/upload', () => {
    it('uploads data and returns estimated credits', async () => {
      const contribution = { id: 'c1', status: 'data_uploaded' };
      mockDataContributionService.uploadContributionData.mockReturnValue(contribution);
      mockDataContributionService.calculateCredits.mockReturnValue(42);

      const response = await request(app)
        .post('/api/contributions/c1/upload')
        .send({ trajectoryCount: 10 });

      expect(response.status).toBe(200);
      expect(response.body.estimatedCredits).toBe(42);
      expect(response.body.contribution.id).toBe('c1');
      expect(mockDataContributionService.uploadContributionData).toHaveBeenCalledWith('c1', {
        trajectoryCount: 10,
      });
    });

    it('returns 400 when trajectoryCount is invalid', async () => {
      const response = await request(app)
        .post('/api/contributions/c1/upload')
        .send({ trajectoryCount: 0 });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('trajectoryCount');
    });

    it('returns 400 with service error message', async () => {
      mockDataContributionService.uploadContributionData.mockImplementation(() => {
        throw new Error('not found');
      });

      const response = await request(app)
        .post('/api/contributions/c1/upload')
        .send({ trajectoryCount: 5 });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('not found');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/contributions/:id/submit
  // --------------------------------------------------------------------------

  describe('POST /api/contributions/:id/submit', () => {
    it('submits for review', async () => {
      mockDataContributionService.submitForReview.mockReturnValue({ id: 'c1', status: 'submitted' });

      const response = await request(app).post('/api/contributions/c1/submit');

      expect(response.status).toBe(200);
      expect(response.body.contribution.status).toBe('submitted');
      expect(mockDataContributionService.submitForReview).toHaveBeenCalledWith('c1');
    });

    it('returns 400 on service error', async () => {
      mockDataContributionService.submitForReview.mockImplementation(() => {
        throw new Error('invalid state');
      });

      const response = await request(app).post('/api/contributions/c1/submit');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('invalid state');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/contributions
  // --------------------------------------------------------------------------

  describe('GET /api/contributions', () => {
    it('lists contributions', async () => {
      mockDataContributionService.listContributions.mockReturnValue({
        contributions: [{ id: 'c1' }],
        total: 1,
      });

      const response = await request(app).get('/api/contributions?limit=10&offset=5');

      expect(response.status).toBe(200);
      expect(response.body.total).toBe(1);
      expect(response.body.limit).toBe(10);
      expect(response.body.offset).toBe(5);
      expect(mockDataContributionService.listContributions).toHaveBeenCalledWith({
        userId: 'user-123',
        status: undefined,
        licenseType: undefined,
        limit: 10,
        offset: 5,
      });
    });

    it('returns 500 on service error', async () => {
      mockDataContributionService.listContributions.mockImplementation(() => {
        throw new Error('db');
      });

      const response = await request(app).get('/api/contributions');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to list contributions');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/contributions/:id/review
  // --------------------------------------------------------------------------

  describe('POST /api/contributions/:id/review', () => {
    it('accepts a contribution', async () => {
      mockDataContributionService.reviewContribution.mockReturnValue({
        status: 'accepted',
        creditsAwarded: 100,
      });

      const response = await request(app)
        .post('/api/contributions/c1/review')
        .send({ decision: 'accept' });

      expect(response.status).toBe(200);
      expect(response.body.message).toContain('100 credits awarded');
      expect(mockDataContributionService.reviewContribution).toHaveBeenCalledWith(
        'c1',
        'user-123',
        { decision: 'accept' }
      );
    });

    it('rejects a contribution', async () => {
      mockDataContributionService.reviewContribution.mockReturnValue({
        status: 'rejected',
        rejectionReason: 'low quality',
      });

      const response = await request(app)
        .post('/api/contributions/c1/review')
        .send({ decision: 'reject', rejectionReason: 'low quality' });

      expect(response.status).toBe(200);
      expect(response.body.message).toContain('low quality');
    });

    it('returns 400 when decision is missing', async () => {
      const response = await request(app).post('/api/contributions/c1/review').send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('decision is required');
    });

    it('returns 400 for invalid decision', async () => {
      const response = await request(app)
        .post('/api/contributions/c1/review')
        .send({ decision: 'maybe' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('accept');
    });

    it('returns 400 when rejecting without reason', async () => {
      const response = await request(app)
        .post('/api/contributions/c1/review')
        .send({ decision: 'reject' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('rejectionReason is required when rejecting');
    });

    it('returns 400 on service error', async () => {
      mockDataContributionService.reviewContribution.mockImplementation(() => {
        throw new Error('cannot review');
      });

      const response = await request(app)
        .post('/api/contributions/c1/review')
        .send({ decision: 'accept' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('cannot review');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/contributions/:id/revoke
  // --------------------------------------------------------------------------

  describe('POST /api/contributions/:id/revoke', () => {
    it('revokes a contribution with a reason', async () => {
      mockDataContributionService.revokeContribution.mockReturnValue({ id: 'c1', status: 'revoked' });

      const response = await request(app)
        .post('/api/contributions/c1/revoke')
        .send({ reason: 'changed mind' });

      expect(response.status).toBe(200);
      expect(response.body.contribution.status).toBe('revoked');
      expect(mockDataContributionService.revokeContribution).toHaveBeenCalledWith(
        'c1',
        'changed mind'
      );
    });

    it('defaults the reason when omitted', async () => {
      mockDataContributionService.revokeContribution.mockReturnValue({ id: 'c1' });

      const response = await request(app).post('/api/contributions/c1/revoke').send({});

      expect(response.status).toBe(200);
      expect(mockDataContributionService.revokeContribution).toHaveBeenCalledWith(
        'c1',
        'User requested revocation'
      );
    });

    it('returns 400 on service error', async () => {
      mockDataContributionService.revokeContribution.mockImplementation(() => {
        throw new Error('cannot revoke');
      });

      const response = await request(app).post('/api/contributions/c1/revoke').send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('cannot revoke');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/contributions/credits
  // --------------------------------------------------------------------------

  describe('GET /api/contributions/credits', () => {
    it('returns credit balance', async () => {
      mockDataContributionService.getCreditBalance.mockReturnValue({ balance: 250 });

      const response = await request(app).get('/api/contributions/credits');

      expect(response.status).toBe(200);
      expect(response.body.balance).toBe(250);
      expect(mockDataContributionService.getCreditBalance).toHaveBeenCalledWith('user-123');
    });

    it('returns 500 on service error', async () => {
      mockDataContributionService.getCreditBalance.mockImplementation(() => {
        throw new Error('db');
      });

      const response = await request(app).get('/api/contributions/credits');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get credit balance');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/contributions/credits/history
  // --------------------------------------------------------------------------

  describe('GET /api/contributions/credits/history', () => {
    it('returns credit history', async () => {
      mockDataContributionService.getCreditHistory.mockReturnValue([{ id: 'tx1' }, { id: 'tx2' }]);

      const response = await request(app).get('/api/contributions/credits/history');

      expect(response.status).toBe(200);
      expect(response.body.count).toBe(2);
      expect(mockDataContributionService.getCreditHistory).toHaveBeenCalledWith('user-123', {
        limit: 50,
        offset: 0,
      });
    });

    it('returns 500 on service error', async () => {
      mockDataContributionService.getCreditHistory.mockImplementation(() => {
        throw new Error('db');
      });

      const response = await request(app).get('/api/contributions/credits/history');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get credit history');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/contributions/credits/redeem
  // --------------------------------------------------------------------------

  describe('POST /api/contributions/credits/redeem', () => {
    it('redeems credits', async () => {
      mockDataContributionService.redeemCredits.mockReturnValue({ id: 'redemption-1' });
      mockDataContributionService.getReward.mockReturnValue({ name: 'T-Shirt' });

      const response = await request(app)
        .post('/api/contributions/credits/redeem')
        .send({ rewardId: 'reward-1' });

      expect(response.status).toBe(200);
      expect(response.body.message).toContain('T-Shirt');
      expect(mockDataContributionService.redeemCredits).toHaveBeenCalledWith('user-123', 'reward-1');
    });

    it('returns 400 when rewardId is missing', async () => {
      const response = await request(app).post('/api/contributions/credits/redeem').send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('rewardId is required');
    });

    it('returns 400 on service error', async () => {
      mockDataContributionService.redeemCredits.mockImplementation(() => {
        throw new Error('insufficient credits');
      });

      const response = await request(app)
        .post('/api/contributions/credits/redeem')
        .send({ rewardId: 'reward-1' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('insufficient credits');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/contributions/rewards
  // --------------------------------------------------------------------------

  describe('GET /api/contributions/rewards', () => {
    it('returns rewards', async () => {
      mockDataContributionService.getRewards.mockReturnValue([{ id: 'r1' }]);

      const response = await request(app).get('/api/contributions/rewards');

      expect(response.status).toBe(200);
      expect(response.body.count).toBe(1);
    });

    it('returns 500 on service error', async () => {
      mockDataContributionService.getRewards.mockImplementation(() => {
        throw new Error('db');
      });

      const response = await request(app).get('/api/contributions/rewards');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get rewards');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/contributions/redemptions
  // --------------------------------------------------------------------------

  describe('GET /api/contributions/redemptions', () => {
    it('returns redemption history', async () => {
      mockDataContributionService.getRedemptionHistory.mockReturnValue([{ id: 'rd1' }]);

      const response = await request(app).get('/api/contributions/redemptions');

      expect(response.status).toBe(200);
      expect(response.body.count).toBe(1);
      expect(mockDataContributionService.getRedemptionHistory).toHaveBeenCalledWith('user-123');
    });

    it('returns 500 on service error', async () => {
      mockDataContributionService.getRedemptionHistory.mockImplementation(() => {
        throw new Error('db');
      });

      const response = await request(app).get('/api/contributions/redemptions');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get redemption history');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/contributions/leaderboard
  // --------------------------------------------------------------------------

  describe('GET /api/contributions/leaderboard', () => {
    it('returns the leaderboard', async () => {
      mockDataContributionService.getLeaderboard.mockReturnValue([{ userId: 'u1' }]);

      const response = await request(app).get('/api/contributions/leaderboard?organizationId=org-1');

      expect(response.status).toBe(200);
      expect(response.body.count).toBe(1);
      expect(mockDataContributionService.getLeaderboard).toHaveBeenCalledWith({
        limit: 100,
        organizationId: 'org-1',
      });
    });

    it('returns 500 on service error', async () => {
      mockDataContributionService.getLeaderboard.mockImplementation(() => {
        throw new Error('db');
      });

      const response = await request(app).get('/api/contributions/leaderboard');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get leaderboard');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/contributions/stats
  // --------------------------------------------------------------------------

  describe('GET /api/contributions/stats', () => {
    it('returns contributor stats', async () => {
      mockDataContributionService.getContributorStats.mockReturnValue({ totalContributions: 5 });

      const response = await request(app).get('/api/contributions/stats');

      expect(response.status).toBe(200);
      expect(response.body.totalContributions).toBe(5);
      expect(mockDataContributionService.getContributorStats).toHaveBeenCalledWith('user-123');
    });

    it('returns a "no contributions" message when stats are null', async () => {
      mockDataContributionService.getContributorStats.mockReturnValue(null);

      const response = await request(app).get('/api/contributions/stats');

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('No contributions yet');
      expect(response.body.stats).toBeNull();
    });

    it('returns 500 on service error', async () => {
      mockDataContributionService.getContributorStats.mockImplementation(() => {
        throw new Error('db');
      });

      const response = await request(app).get('/api/contributions/stats');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get contributor stats');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/contributions/db
  // --------------------------------------------------------------------------

  describe('POST /api/contributions/db', () => {
    it('submits a contribution (201)', async () => {
      mockContributionService.submitContribution.mockResolvedValue({
        id: 'db-1',
        sizeBytes: BigInt(1024),
      });

      const response = await request(app)
        .post('/api/contributions/db')
        .send({ robotId: 'robot-1', episodeCount: 3, frameCount: 100, sizeBytes: 1024 });

      expect(response.status).toBe(201);
      expect(response.body.id).toBe('db-1');
      expect(response.body.sizeBytes).toBe('1024');
      expect(mockContributionService.submitContribution).toHaveBeenCalledWith({
        userId: 'user-123',
        robotId: 'robot-1',
        episodeCount: 3,
        frameCount: 100,
        sizeBytes: BigInt(1024),
        metadata: undefined,
      });
    });

    it('returns 400 when robotId is missing', async () => {
      const response = await request(app)
        .post('/api/contributions/db')
        .send({ episodeCount: 1, frameCount: 1 });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('robotId is required');
    });

    it('returns 400 when episodeCount is invalid', async () => {
      const response = await request(app)
        .post('/api/contributions/db')
        .send({ robotId: 'r1', episodeCount: -1, frameCount: 1 });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('episodeCount');
    });

    it('returns 400 when frameCount is invalid', async () => {
      const response = await request(app)
        .post('/api/contributions/db')
        .send({ robotId: 'r1', episodeCount: 1, frameCount: -1 });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('frameCount');
    });

    it('returns 500 on service error', async () => {
      mockContributionService.submitContribution.mockRejectedValue(new Error('db'));

      const response = await request(app)
        .post('/api/contributions/db')
        .send({ robotId: 'r1', episodeCount: 1, frameCount: 1 });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to submit contribution');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/contributions/db
  // --------------------------------------------------------------------------

  describe('GET /api/contributions/db', () => {
    it('lists contributions', async () => {
      mockContributionService.getContributions.mockResolvedValue({
        contributions: [{ id: 'db-1', sizeBytes: BigInt(2048) }],
        total: 1,
      });

      const response = await request(app).get('/api/contributions/db');

      expect(response.status).toBe(200);
      expect(response.body.total).toBe(1);
      expect(response.body.contributions[0].sizeBytes).toBe('2048');
      expect(mockContributionService.getContributions).toHaveBeenCalledWith({
        userId: 'user-123',
        status: undefined,
        limit: 50,
        offset: 0,
      });
    });

    it('returns 500 on service error', async () => {
      mockContributionService.getContributions.mockRejectedValue(new Error('db'));

      const response = await request(app).get('/api/contributions/db');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to list contributions');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/contributions/credits/balance
  // --------------------------------------------------------------------------

  describe('GET /api/contributions/credits/balance', () => {
    it('returns the credit balance', async () => {
      mockContributionService.getUserCredits.mockResolvedValue(500);

      const response = await request(app).get('/api/contributions/credits/balance');

      expect(response.status).toBe(200);
      expect(response.body.userId).toBe('user-123');
      expect(response.body.totalCredits).toBe(500);
    });

    it('returns 500 on service error', async () => {
      mockContributionService.getUserCredits.mockRejectedValue(new Error('db'));

      const response = await request(app).get('/api/contributions/credits/balance');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get credit balance');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/contributions/db/leaderboard
  // --------------------------------------------------------------------------

  describe('GET /api/contributions/db/leaderboard', () => {
    it('returns the leaderboard', async () => {
      mockContributionService.getLeaderboard.mockResolvedValue([{ userId: 'u1' }, { userId: 'u2' }]);

      const response = await request(app).get('/api/contributions/db/leaderboard?limit=5');

      expect(response.status).toBe(200);
      expect(response.body.count).toBe(2);
      expect(mockContributionService.getLeaderboard).toHaveBeenCalledWith(5);
    });

    it('returns 500 on service error', async () => {
      mockContributionService.getLeaderboard.mockRejectedValue(new Error('db'));

      const response = await request(app).get('/api/contributions/db/leaderboard');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get leaderboard');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/contributions/db/impact
  // --------------------------------------------------------------------------

  describe('GET /api/contributions/db/impact', () => {
    it('returns impact stats', async () => {
      mockContributionService.getImpactStats.mockResolvedValue({
        totalContributions: 3,
        totalSizeBytes: BigInt(4096),
      });

      const response = await request(app).get('/api/contributions/db/impact');

      expect(response.status).toBe(200);
      expect(response.body.totalContributions).toBe(3);
      expect(response.body.totalSizeBytes).toBe('4096');
      expect(mockContributionService.getImpactStats).toHaveBeenCalledWith('user-123');
    });

    it('returns 500 on service error', async () => {
      mockContributionService.getImpactStats.mockRejectedValue(new Error('db'));

      const response = await request(app).get('/api/contributions/db/impact');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get impact stats');
    });
  });

  // --------------------------------------------------------------------------
  // PUT /api/contributions/db/:id/approve
  // --------------------------------------------------------------------------

  describe('PUT /api/contributions/db/:id/approve', () => {
    it('approves a contribution', async () => {
      mockContributionService.approveContribution.mockResolvedValue({
        id: 'db-1',
        sizeBytes: BigInt(8192),
        creditAwarded: 75,
      });

      const response = await request(app).put('/api/contributions/db/db-1/approve');

      expect(response.status).toBe(200);
      expect(response.body.sizeBytes).toBe('8192');
      expect(response.body.message).toContain('75 credits awarded');
      expect(mockContributionService.approveContribution).toHaveBeenCalledWith('db-1');
    });

    it('returns 400 on service error', async () => {
      mockContributionService.approveContribution.mockRejectedValue(new Error('already approved'));

      const response = await request(app).put('/api/contributions/db/db-1/approve');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('already approved');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/contributions/db/:id
  // --------------------------------------------------------------------------

  describe('GET /api/contributions/db/:id', () => {
    it('returns a single contribution', async () => {
      mockContributionService.getContribution.mockResolvedValue({
        id: 'db-1',
        sizeBytes: BigInt(16384),
      });

      const response = await request(app).get('/api/contributions/db/db-1');

      expect(response.status).toBe(200);
      expect(response.body.sizeBytes).toBe('16384');
      expect(mockContributionService.getContribution).toHaveBeenCalledWith('db-1');
    });

    it('returns 404 when not found', async () => {
      mockContributionService.getContribution.mockResolvedValue(null);

      const response = await request(app).get('/api/contributions/db/missing');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Contribution not found');
    });

    it('returns 500 on service error', async () => {
      mockContributionService.getContribution.mockRejectedValue(new Error('db'));

      const response = await request(app).get('/api/contributions/db/db-1');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get contribution');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/contributions/:id/impact
  // --------------------------------------------------------------------------

  describe('GET /api/contributions/:id/impact', () => {
    it('returns an impact report', async () => {
      mockDataContributionService.getContribution.mockReturnValue({ id: 'c1' });
      mockDataContributionService.getImpactSummary.mockReturnValue({ totalModelsUsedIn: 2 });

      const response = await request(app).get('/api/contributions/c1/impact');

      expect(response.status).toBe(200);
      expect(response.body.contributionId).toBe('c1');
      expect(response.body.message).toContain('2 model(s)');
      expect(mockDataContributionService.getImpactSummary).toHaveBeenCalledWith('c1');
    });

    it('returns a "not yet used" message when no models', async () => {
      mockDataContributionService.getContribution.mockReturnValue({ id: 'c1' });
      mockDataContributionService.getImpactSummary.mockReturnValue({ totalModelsUsedIn: 0 });

      const response = await request(app).get('/api/contributions/c1/impact');

      expect(response.status).toBe(200);
      expect(response.body.message).toContain('not yet been used');
    });

    it('returns 404 when contribution not found', async () => {
      mockDataContributionService.getContribution.mockReturnValue(null);

      const response = await request(app).get('/api/contributions/missing/impact');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Contribution not found');
    });

    it('returns 500 on service error', async () => {
      mockDataContributionService.getContribution.mockImplementation(() => {
        throw new Error('db');
      });

      const response = await request(app).get('/api/contributions/c1/impact');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get impact report');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/contributions/:id
  // --------------------------------------------------------------------------

  describe('GET /api/contributions/:id', () => {
    it('returns a specific contribution', async () => {
      mockDataContributionService.getContribution.mockReturnValue({ id: 'c1', status: 'draft' });

      const response = await request(app).get('/api/contributions/c1');

      expect(response.status).toBe(200);
      expect(response.body.id).toBe('c1');
      expect(mockDataContributionService.getContribution).toHaveBeenCalledWith('c1');
    });

    it('returns 404 when not found', async () => {
      mockDataContributionService.getContribution.mockReturnValue(null);

      const response = await request(app).get('/api/contributions/missing');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Contribution not found');
    });

    it('returns 500 on service error', async () => {
      mockDataContributionService.getContribution.mockImplementation(() => {
        throw new Error('db');
      });

      const response = await request(app).get('/api/contributions/c1');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get contribution');
    });
  });
});
