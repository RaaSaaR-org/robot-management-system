/**
 * @file conversation-routes.test.ts
 * @description Integration tests for conversation management routes
 * @feature a2a
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Use vi.hoisted so mock objects are available before vi.mock hoisting
const { mockConversationManager } = vi.hoisted(() => ({
  mockConversationManager: {
    createConversation: vi.fn(),
    listConversations: vi.fn(),
    getConversation: vi.fn(),
    deleteConversation: vi.fn(),
  },
}));

vi.mock('../services/ConversationManager.js', () => ({
  conversationManager: mockConversationManager,
}));

vi.mock('../middleware/auth.middleware.js', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-123', email: 'test@example.com', name: 'Test', role: 'admin' };
    next();
  },
  AuthenticatedRequest: {},
}));

import { conversationRoutes } from '../routes/conversation.routes.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/a2a/conversation', authMiddleware as any, conversationRoutes);
  return app;
}

const BASE = '/api/a2a/conversation';

const SAMPLE_CONVERSATION = {
  id: 'conv-001',
  robotId: 'robot-001',
  name: 'Test Conversation',
  createdAt: '2026-02-26T00:00:00.000Z',
  updatedAt: '2026-02-26T00:00:00.000Z',
};

describe('Conversation Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  // --------------------------------------------------------------------------
  // POST /create
  // --------------------------------------------------------------------------

  describe('POST /create', () => {
    it('creates a conversation successfully', async () => {
      mockConversationManager.createConversation.mockResolvedValue(SAMPLE_CONVERSATION);

      const response = await request(app)
        .post(`${BASE}/create`)
        .send({ robotId: 'robot-001', name: 'Test Conversation' });

      expect(response.status).toBe(200);
      expect(response.body.conversation.id).toBe('conv-001');
      expect(response.body.conversation.name).toBe('Test Conversation');
      expect(mockConversationManager.createConversation).toHaveBeenCalledWith(
        'robot-001',
        'Test Conversation'
      );
    });

    it('returns 500 on service error', async () => {
      mockConversationManager.createConversation.mockRejectedValue(new Error('DB error'));

      const response = await request(app)
        .post(`${BASE}/create`)
        .send({ robotId: 'robot-001', name: 'Test Conversation' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to create conversation');
    });
  });

  // --------------------------------------------------------------------------
  // POST /list
  // --------------------------------------------------------------------------

  describe('POST /list', () => {
    it('lists conversations successfully', async () => {
      mockConversationManager.listConversations.mockResolvedValue([SAMPLE_CONVERSATION]);

      const response = await request(app).post(`${BASE}/list`);

      expect(response.status).toBe(200);
      expect(response.body.conversations).toHaveLength(1);
      expect(response.body.conversations[0].id).toBe('conv-001');
      expect(mockConversationManager.listConversations).toHaveBeenCalledTimes(1);
    });

    it('returns 500 on service error', async () => {
      mockConversationManager.listConversations.mockRejectedValue(new Error('DB error'));

      const response = await request(app).post(`${BASE}/list`);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to list conversations');
    });
  });

  // --------------------------------------------------------------------------
  // GET /:id
  // --------------------------------------------------------------------------

  describe('GET /:id', () => {
    it('returns a specific conversation', async () => {
      mockConversationManager.getConversation.mockResolvedValue(SAMPLE_CONVERSATION);

      const response = await request(app).get(`${BASE}/conv-001`);

      expect(response.status).toBe(200);
      expect(response.body.conversation.id).toBe('conv-001');
      expect(mockConversationManager.getConversation).toHaveBeenCalledWith('conv-001');
    });

    it('returns 404 when conversation not found', async () => {
      mockConversationManager.getConversation.mockResolvedValue(null);

      const response = await request(app).get(`${BASE}/missing`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Conversation not found');
    });

    it('returns 500 on service error', async () => {
      mockConversationManager.getConversation.mockRejectedValue(new Error('DB error'));

      const response = await request(app).get(`${BASE}/conv-001`);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get conversation');
    });
  });

  // --------------------------------------------------------------------------
  // DELETE /:id
  // --------------------------------------------------------------------------

  describe('DELETE /:id', () => {
    it('deletes a conversation successfully', async () => {
      mockConversationManager.deleteConversation.mockResolvedValue(true);

      const response = await request(app).delete(`${BASE}/conv-001`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockConversationManager.deleteConversation).toHaveBeenCalledWith('conv-001');
    });

    it('returns 404 when conversation not found', async () => {
      mockConversationManager.deleteConversation.mockResolvedValue(false);

      const response = await request(app).delete(`${BASE}/missing`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Conversation not found');
    });

    it('returns 500 on service error', async () => {
      mockConversationManager.deleteConversation.mockRejectedValue(new Error('DB error'));

      const response = await request(app).delete(`${BASE}/conv-001`);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to delete conversation');
    });
  });
});
