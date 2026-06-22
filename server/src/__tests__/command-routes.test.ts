/**
 * @file command-routes.test.ts
 * @description Integration tests for natural language command interpretation routes
 * @feature command
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Use vi.hoisted so mock objects are available before vi.mock hoisting
const { mockCommandInterpreter, mockCommandRepository } = vi.hoisted(() => ({
  mockCommandInterpreter: {
    interpretCommand: vi.fn(),
  },
  mockCommandRepository: {
    findByRobotId: vi.fn(),
    findAll: vi.fn(),
    findById: vi.fn(),
    updateStatus: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('../services/CommandInterpreter.js', () => ({
  commandInterpreter: mockCommandInterpreter,
}));

vi.mock('../repositories/index.js', () => ({
  commandRepository: mockCommandRepository,
}));

vi.mock('../middleware/auth.middleware.js', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-123', email: 'test@example.com', name: 'Test', role: 'admin' };
    next();
  },
  AuthenticatedRequest: {},
}));

import { commandRoutes } from '../routes/command.routes.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/command', authMiddleware as any, commandRoutes);
  return app;
}

const INTERPRETATION = {
  id: 'cmd-001',
  originalText: 'move to warehouse',
  commandType: 'navigation',
  parameters: { destination: 'warehouse' },
  confidence: 0.95,
  safetyClassification: 'safe',
  warnings: [],
  suggestedAlternatives: [],
  timestamp: '2026-06-22T00:00:00.000Z',
};

const HISTORY_ENTRY = {
  id: 'cmd-001',
  robotId: 'robot-1',
  originalText: 'move to warehouse',
  commandType: 'navigation',
  parameters: { destination: 'warehouse' },
  confidence: 0.95,
  safetyClassification: 'safe',
  warnings: [],
  suggestedAlternatives: [],
  status: 'interpreted',
  createdAt: '2026-06-22T00:00:00.000Z',
  executedAt: null,
};

describe('Command Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  // --------------------------------------------------------------------------
  // POST /api/command/interpret
  // --------------------------------------------------------------------------

  describe('POST /api/command/interpret', () => {
    it('interprets a command successfully', async () => {
      mockCommandInterpreter.interpretCommand.mockResolvedValue(INTERPRETATION);

      const response = await request(app)
        .post('/api/command/interpret')
        .send({ text: 'move to warehouse', robotId: 'robot-1', context: { foo: 'bar' } });

      expect(response.status).toBe(200);
      expect(response.body.id).toBe('cmd-001');
      expect(response.body.commandType).toBe('navigation');
      expect(mockCommandInterpreter.interpretCommand).toHaveBeenCalledWith({
        text: 'move to warehouse',
        robotId: 'robot-1',
        context: { foo: 'bar' },
      });
    });

    it('returns 400 when text is missing', async () => {
      const response = await request(app)
        .post('/api/command/interpret')
        .send({ robotId: 'robot-1' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Missing required field: text (string)');
      expect(mockCommandInterpreter.interpretCommand).not.toHaveBeenCalled();
    });

    it('returns 400 when text is not a string', async () => {
      const response = await request(app)
        .post('/api/command/interpret')
        .send({ text: 42, robotId: 'robot-1' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Missing required field: text (string)');
    });

    it('returns 400 when robotId is missing', async () => {
      const response = await request(app)
        .post('/api/command/interpret')
        .send({ text: 'move to warehouse' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Missing required field: robotId (string)');
      expect(mockCommandInterpreter.interpretCommand).not.toHaveBeenCalled();
    });

    it('returns 500 on interpreter error', async () => {
      mockCommandInterpreter.interpretCommand.mockRejectedValue(new Error('LLM down'));

      const response = await request(app)
        .post('/api/command/interpret')
        .send({ text: 'move to warehouse', robotId: 'robot-1' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to interpret command');
      expect(response.body.message).toBe('LLM down');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/command/history
  // --------------------------------------------------------------------------

  describe('GET /api/command/history', () => {
    it('returns all command history with default pagination', async () => {
      mockCommandRepository.findAll.mockResolvedValue({
        entries: [HISTORY_ENTRY],
        pagination: { page: 1, pageSize: 50, total: 1 },
      });

      const response = await request(app).get('/api/command/history');

      expect(response.status).toBe(200);
      expect(response.body.entries).toHaveLength(1);
      expect(response.body.entries[0].id).toBe('cmd-001');
      expect(response.body.entries[0].robotName).toBe('robot-1');
      expect(response.body.entries[0].interpretation.commandType).toBe('navigation');
      expect(response.body.pagination.total).toBe(1);
      expect(mockCommandRepository.findAll).toHaveBeenCalledWith({ page: 1, pageSize: 50 });
    });

    it('filters by robotId and parses pagination query params', async () => {
      mockCommandRepository.findByRobotId.mockResolvedValue({
        entries: [HISTORY_ENTRY],
        pagination: { page: 2, pageSize: 10, total: 1 },
      });

      const response = await request(app)
        .get('/api/command/history')
        .query({ robotId: 'robot-1', page: '2', pageSize: '10' });

      expect(response.status).toBe(200);
      expect(mockCommandRepository.findByRobotId).toHaveBeenCalledWith('robot-1', {
        page: 2,
        pageSize: 10,
      });
      expect(mockCommandRepository.findAll).not.toHaveBeenCalled();
    });

    it('returns 500 on repository error', async () => {
      mockCommandRepository.findAll.mockRejectedValue(new Error('DB error'));

      const response = await request(app).get('/api/command/history');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to fetch command history');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/command/:id
  // --------------------------------------------------------------------------

  describe('GET /api/command/:id', () => {
    it('returns a single interpretation by id', async () => {
      mockCommandRepository.findById.mockResolvedValue(INTERPRETATION);

      const response = await request(app).get('/api/command/cmd-001');

      expect(response.status).toBe(200);
      expect(response.body.id).toBe('cmd-001');
      expect(mockCommandRepository.findById).toHaveBeenCalledWith('cmd-001');
    });

    it('returns 404 when not found', async () => {
      mockCommandRepository.findById.mockResolvedValue(null);

      const response = await request(app).get('/api/command/missing');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Command interpretation not found');
    });

    it('returns 500 on repository error', async () => {
      mockCommandRepository.findById.mockRejectedValue(new Error('DB error'));

      const response = await request(app).get('/api/command/cmd-001');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to fetch command interpretation');
    });
  });

  // --------------------------------------------------------------------------
  // PATCH /api/command/:id/status
  // --------------------------------------------------------------------------

  describe('PATCH /api/command/:id/status', () => {
    it('updates status successfully', async () => {
      const updated = { ...INTERPRETATION, status: 'confirmed' };
      mockCommandRepository.updateStatus.mockResolvedValue(updated);

      const response = await request(app)
        .patch('/api/command/cmd-001/status')
        .send({ status: 'confirmed', executedCommandId: 'exec-1' });

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('confirmed');
      expect(mockCommandRepository.updateStatus).toHaveBeenCalledWith(
        'cmd-001',
        'confirmed',
        'exec-1'
      );
    });

    it('returns 400 when status is missing', async () => {
      const response = await request(app).patch('/api/command/cmd-001/status').send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Missing required field: status (string)');
      expect(mockCommandRepository.updateStatus).not.toHaveBeenCalled();
    });

    it('returns 400 for an invalid status value', async () => {
      const response = await request(app)
        .patch('/api/command/cmd-001/status')
        .send({ status: 'bogus' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid status. Must be one of:');
      expect(mockCommandRepository.updateStatus).not.toHaveBeenCalled();
    });

    it('returns 404 when interpretation not found', async () => {
      mockCommandRepository.updateStatus.mockResolvedValue(null);

      const response = await request(app)
        .patch('/api/command/missing/status')
        .send({ status: 'executed' });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Command interpretation not found');
    });

    it('returns 500 on repository error', async () => {
      mockCommandRepository.updateStatus.mockRejectedValue(new Error('DB error'));

      const response = await request(app)
        .patch('/api/command/cmd-001/status')
        .send({ status: 'executed' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to update command status');
    });
  });

  // --------------------------------------------------------------------------
  // DELETE /api/command/:id
  // --------------------------------------------------------------------------

  describe('DELETE /api/command/:id', () => {
    it('deletes an interpretation successfully', async () => {
      mockCommandRepository.delete.mockResolvedValue(true);

      const response = await request(app).delete('/api/command/cmd-001');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockCommandRepository.delete).toHaveBeenCalledWith('cmd-001');
    });

    it('returns 404 when not found', async () => {
      mockCommandRepository.delete.mockResolvedValue(false);

      const response = await request(app).delete('/api/command/missing');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Command interpretation not found');
    });

    it('returns 500 on repository error', async () => {
      mockCommandRepository.delete.mockRejectedValue(new Error('DB error'));

      const response = await request(app).delete('/api/command/cmd-001');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to delete command interpretation');
    });
  });
});
