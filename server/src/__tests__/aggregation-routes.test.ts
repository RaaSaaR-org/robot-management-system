/**
 * @file aggregation-routes.test.ts
 * @description Integration tests for secure aggregation (federated) routes
 * @feature fleetlearning
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Use vi.hoisted so mock objects are available before vi.mock hoisting
const { mockSecureAggregator } = vi.hoisted(() => ({
  mockSecureAggregator: {
    collectUpdate: vi.fn(),
    getAggregationStatus: vi.fn(),
    getResult: vi.fn(),
    aggregate: vi.fn(),
  },
}));

vi.mock('../services/SecureAggregator.js', () => ({
  secureAggregator: mockSecureAggregator,
}));

vi.mock('../middleware/auth.middleware.js', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-123', email: 'test@example.com', name: 'Test', role: 'admin' };
    next();
  },
  AuthenticatedRequest: {},
}));

import { aggregationRoutes } from '../routes/aggregation.routes.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/federated', authMiddleware as any, aggregationRoutes);
  return app;
}

describe('Aggregation Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  // --------------------------------------------------------------------------
  // POST /api/federated/rounds/:roundId/submit
  // --------------------------------------------------------------------------

  describe('POST /api/federated/rounds/:roundId/submit', () => {
    const validBody = {
      robotId: 'robot-001',
      maskedGradients: [[1, 2], [3, 4]],
      participantCount: 3,
    };

    it('submits a masked update successfully (201)', async () => {
      mockSecureAggregator.collectUpdate.mockReturnValue(undefined);

      const response = await request(app)
        .post('/api/federated/rounds/round-1/submit')
        .send(validBody);

      expect(response.status).toBe(201);
      expect(response.body.message).toBe('Masked update submitted successfully');
      expect(response.body.roundId).toBe('round-1');
      expect(response.body.robotId).toBe('robot-001');
      expect(mockSecureAggregator.collectUpdate).toHaveBeenCalledWith(
        'round-1',
        'robot-001',
        {
          robotId: 'robot-001',
          roundId: 'round-1',
          maskedGradients: [[1, 2], [3, 4]],
          participantCount: 3,
        }
      );
    });

    it('returns 400 when robotId is missing', async () => {
      const response = await request(app)
        .post('/api/federated/rounds/round-1/submit')
        .send({ maskedGradients: [[1]], participantCount: 1 });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('robotId is required and must be a string');
      expect(mockSecureAggregator.collectUpdate).not.toHaveBeenCalled();
    });

    it('returns 400 when robotId is not a string', async () => {
      const response = await request(app)
        .post('/api/federated/rounds/round-1/submit')
        .send({ robotId: 123, maskedGradients: [[1]], participantCount: 1 });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('robotId is required and must be a string');
    });

    it('returns 400 when maskedGradients is not an array', async () => {
      const response = await request(app)
        .post('/api/federated/rounds/round-1/submit')
        .send({ robotId: 'robot-001', maskedGradients: 'nope', participantCount: 1 });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('maskedGradients is required and must be an array');
    });

    it('returns 400 when participantCount is not a positive number', async () => {
      const response = await request(app)
        .post('/api/federated/rounds/round-1/submit')
        .send({ robotId: 'robot-001', maskedGradients: [[1]], participantCount: 0 });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe(
        'participantCount is required and must be a positive number'
      );
    });

    it('returns 409 when the robot already submitted (conflict)', async () => {
      mockSecureAggregator.collectUpdate.mockImplementation(() => {
        throw new Error('Robot robot-001 has already submitted for this round');
      });

      const response = await request(app)
        .post('/api/federated/rounds/round-1/submit')
        .send(validBody);

      expect(response.status).toBe(409);
      expect(response.body.error).toContain('already');
    });

    it('returns 500 on unexpected service error', async () => {
      mockSecureAggregator.collectUpdate.mockImplementation(() => {
        throw new Error('boom');
      });

      const response = await request(app)
        .post('/api/federated/rounds/round-1/submit')
        .send(validBody);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to submit update: boom');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/federated/rounds/:roundId/aggregation
  // --------------------------------------------------------------------------

  describe('GET /api/federated/rounds/:roundId/aggregation', () => {
    it('returns aggregation status with result', async () => {
      const status = {
        roundId: 'round-1',
        receivedCount: 2,
        participants: ['robot-001', 'robot-002'],
        aggregated: true,
      };
      const result = {
        roundId: 'round-1',
        participantCount: 2,
        aggregatedGradients: [[4, 6]],
      };
      mockSecureAggregator.getAggregationStatus.mockReturnValue(status);
      mockSecureAggregator.getResult.mockReturnValue(result);

      const response = await request(app).get('/api/federated/rounds/round-1/aggregation');

      expect(response.status).toBe(200);
      expect(response.body.roundId).toBe('round-1');
      expect(response.body.receivedCount).toBe(2);
      expect(response.body.aggregated).toBe(true);
      expect(response.body.result).toEqual(result);
      expect(mockSecureAggregator.getAggregationStatus).toHaveBeenCalledWith('round-1');
      expect(mockSecureAggregator.getResult).toHaveBeenCalledWith('round-1');
    });

    it('omits result when none available', async () => {
      const status = {
        roundId: 'round-1',
        receivedCount: 1,
        participants: ['robot-001'],
        aggregated: false,
      };
      mockSecureAggregator.getAggregationStatus.mockReturnValue(status);
      mockSecureAggregator.getResult.mockReturnValue(null);

      const response = await request(app).get('/api/federated/rounds/round-1/aggregation');

      expect(response.status).toBe(200);
      expect(response.body.aggregated).toBe(false);
      expect(response.body.result).toBeUndefined();
    });

    it('returns 500 on service error', async () => {
      mockSecureAggregator.getAggregationStatus.mockImplementation(() => {
        throw new Error('status failure');
      });

      const response = await request(app).get('/api/federated/rounds/round-1/aggregation');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get aggregation status: status failure');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/federated/rounds/:roundId/aggregate
  // --------------------------------------------------------------------------

  describe('POST /api/federated/rounds/:roundId/aggregate', () => {
    it('triggers aggregation successfully', async () => {
      const result = {
        roundId: 'round-1',
        participantCount: 2,
        aggregatedGradients: [[4, 6]],
      };
      mockSecureAggregator.aggregate.mockReturnValue(result);

      const response = await request(app)
        .post('/api/federated/rounds/round-1/aggregate')
        .send({ expectedParticipants: 2 });

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Aggregation completed successfully');
      expect(response.body.result).toEqual(result);
      expect(mockSecureAggregator.aggregate).toHaveBeenCalledWith('round-1', 2);
    });

    it('returns 400 when expectedParticipants is missing/invalid', async () => {
      const response = await request(app)
        .post('/api/federated/rounds/round-1/aggregate')
        .send({ expectedParticipants: 0 });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe(
        'expectedParticipants is required and must be a positive number'
      );
      expect(mockSecureAggregator.aggregate).not.toHaveBeenCalled();
    });

    it('returns 400 when there are no updates to aggregate', async () => {
      mockSecureAggregator.aggregate.mockImplementation(() => {
        throw new Error('No updates collected for round round-1');
      });

      const response = await request(app)
        .post('/api/federated/rounds/round-1/aggregate')
        .send({ expectedParticipants: 2 });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('No updates');
    });

    it('returns 500 on unexpected aggregation error', async () => {
      mockSecureAggregator.aggregate.mockImplementation(() => {
        throw new Error('math exploded');
      });

      const response = await request(app)
        .post('/api/federated/rounds/round-1/aggregate')
        .send({ expectedParticipants: 2 });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to aggregate: math exploded');
    });
  });
});
