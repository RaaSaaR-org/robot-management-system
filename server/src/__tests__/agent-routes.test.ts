/**
 * @file agent-routes.test.ts
 * @description Integration tests for agent registration/management routes
 * @feature a2a
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Use vi.hoisted so mock objects are available before vi.mock hoisting
const { mockConversationManager, mockAgentCardResolver } = vi.hoisted(() => ({
  mockConversationManager: {
    registerAgent: vi.fn(),
    listAgentsAsync: vi.fn(),
    unregisterAgent: vi.fn(),
    getAgentAsync: vi.fn(),
  },
  mockAgentCardResolver: {
    fetchAgentCard: vi.fn(),
  },
}));

vi.mock('../services/ConversationManager.js', () => ({
  conversationManager: mockConversationManager,
}));

vi.mock('../services/A2AClient.js', () => ({
  agentCardResolver: mockAgentCardResolver,
}));

vi.mock('../middleware/auth.middleware.js', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-123', email: 'test@example.com', name: 'Test', role: 'admin' };
    next();
  },
  AuthenticatedRequest: {},
}));

import { agentRoutes } from '../routes/agent.routes.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/a2a/agent', authMiddleware as any, agentRoutes);
  return app;
}

const MOCK_AGENT_CARD = {
  name: 'Weather Agent',
  description: 'Provides weather data',
  url: 'http://localhost:9999',
  version: '1.0.0',
};

describe('Agent Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  // --------------------------------------------------------------------------
  // POST /api/a2a/agent/register
  // --------------------------------------------------------------------------

  describe('POST /api/a2a/agent/register', () => {
    it('registers an external agent successfully', async () => {
      mockAgentCardResolver.fetchAgentCard.mockResolvedValue(MOCK_AGENT_CARD);
      mockConversationManager.registerAgent.mockResolvedValue(undefined);

      const response = await request(app)
        .post('/api/a2a/agent/register')
        .send({ agentUrl: 'http://localhost:9999' });

      expect(response.status).toBe(200);
      expect(response.body.agentCard).toEqual(MOCK_AGENT_CARD);
      expect(mockAgentCardResolver.fetchAgentCard).toHaveBeenCalledWith('http://localhost:9999');
      expect(mockConversationManager.registerAgent).toHaveBeenCalledWith(MOCK_AGENT_CARD);
    });

    it('returns 400 when agentUrl is missing', async () => {
      const response = await request(app).post('/api/a2a/agent/register').send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('agentUrl is required');
      expect(mockAgentCardResolver.fetchAgentCard).not.toHaveBeenCalled();
    });

    it('returns 500 with the error message when fetching the card fails', async () => {
      mockAgentCardResolver.fetchAgentCard.mockRejectedValue(new Error('unreachable host'));

      const response = await request(app)
        .post('/api/a2a/agent/register')
        .send({ agentUrl: 'http://localhost:9999' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('unreachable host');
    });

    it('returns 500 with default message for non-Error rejections', async () => {
      mockAgentCardResolver.fetchAgentCard.mockRejectedValue('boom');

      const response = await request(app)
        .post('/api/a2a/agent/register')
        .send({ agentUrl: 'http://localhost:9999' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to register agent');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/a2a/agent/list
  // --------------------------------------------------------------------------

  describe('POST /api/a2a/agent/list', () => {
    it('lists all registered agents', async () => {
      const agents = [MOCK_AGENT_CARD, { ...MOCK_AGENT_CARD, name: 'Other Agent' }];
      mockConversationManager.listAgentsAsync.mockResolvedValue(agents);

      const response = await request(app).post('/api/a2a/agent/list');

      expect(response.status).toBe(200);
      expect(response.body.agents).toEqual(agents);
      expect(mockConversationManager.listAgentsAsync).toHaveBeenCalledTimes(1);
    });

    it('returns 500 on service error', async () => {
      mockConversationManager.listAgentsAsync.mockRejectedValue(new Error('DB error'));

      const response = await request(app).post('/api/a2a/agent/list');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to list agents');
    });
  });

  // --------------------------------------------------------------------------
  // DELETE /api/a2a/agent/:name
  // --------------------------------------------------------------------------

  describe('DELETE /api/a2a/agent/:name', () => {
    it('unregisters an agent successfully', async () => {
      mockConversationManager.unregisterAgent.mockResolvedValue(true);

      const response = await request(app).delete('/api/a2a/agent/Weather%20Agent');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockConversationManager.unregisterAgent).toHaveBeenCalledWith('Weather Agent');
    });

    it('returns 404 when the agent does not exist', async () => {
      mockConversationManager.unregisterAgent.mockResolvedValue(false);

      const response = await request(app).delete('/api/a2a/agent/Unknown');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Agent not found');
    });

    it('returns 500 on service error', async () => {
      mockConversationManager.unregisterAgent.mockRejectedValue(new Error('DB error'));

      const response = await request(app).delete('/api/a2a/agent/Weather');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to unregister agent');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/a2a/agent/:name
  // --------------------------------------------------------------------------

  describe('GET /api/a2a/agent/:name', () => {
    it('returns a specific registered agent', async () => {
      mockConversationManager.getAgentAsync.mockResolvedValue(MOCK_AGENT_CARD);

      const response = await request(app).get('/api/a2a/agent/Weather%20Agent');

      expect(response.status).toBe(200);
      expect(response.body.agent).toEqual(MOCK_AGENT_CARD);
      expect(mockConversationManager.getAgentAsync).toHaveBeenCalledWith('Weather Agent');
    });

    it('returns 404 when the agent does not exist', async () => {
      mockConversationManager.getAgentAsync.mockResolvedValue(null);

      const response = await request(app).get('/api/a2a/agent/Unknown');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Agent not found');
    });

    it('returns 500 on service error', async () => {
      mockConversationManager.getAgentAsync.mockRejectedValue(new Error('DB error'));

      const response = await request(app).get('/api/a2a/agent/Weather');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get agent');
    });
  });
});
