/**
 * @file message-routes.test.ts
 * @description Integration tests for A2A message routes
 * @feature a2a
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Use vi.hoisted so mock objects are available before vi.mock hoisting
const { mockConversationManager } = vi.hoisted(() => ({
  mockConversationManager: {
    processMessage: vi.fn(),
    processOrchestratedMessage: vi.fn(),
    getMessages: vi.fn(),
    getPendingMessages: vi.fn(),
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

import { messageRoutes } from '../routes/message.routes.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/a2a/message', authMiddleware as any, messageRoutes);
  return app;
}

describe('Message Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  // --------------------------------------------------------------------------
  // POST /api/a2a/message/send
  // --------------------------------------------------------------------------

  describe('POST /api/a2a/message/send', () => {
    it('sends a message successfully', async () => {
      mockConversationManager.processMessage.mockResolvedValue({
        messageId: 'msg-1',
        task: { id: 'task-1' },
      });

      const response = await request(app)
        .post('/api/a2a/message/send')
        .send({ conversationId: 'conv-1', message: 'hello', targetAgentUrl: 'http://agent' });

      expect(response.status).toBe(200);
      expect(response.body.messageId).toBe('msg-1');
      expect(response.body.contextId).toBe('conv-1');
      expect(response.body.taskId).toBe('task-1');
      expect(mockConversationManager.processMessage).toHaveBeenCalledWith(
        'conv-1',
        'hello',
        'http://agent'
      );
    });

    it('returns taskId undefined when no task is returned', async () => {
      mockConversationManager.processMessage.mockResolvedValue({ messageId: 'msg-2' });

      const response = await request(app)
        .post('/api/a2a/message/send')
        .send({ conversationId: 'conv-1', message: 'hello' });

      expect(response.status).toBe(200);
      expect(response.body.messageId).toBe('msg-2');
      expect(response.body.taskId).toBeUndefined();
    });

    it('returns 400 when conversationId is missing', async () => {
      const response = await request(app)
        .post('/api/a2a/message/send')
        .send({ message: 'hello' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('conversationId is required');
      expect(mockConversationManager.processMessage).not.toHaveBeenCalled();
    });

    it('returns 400 when message is missing', async () => {
      const response = await request(app)
        .post('/api/a2a/message/send')
        .send({ conversationId: 'conv-1' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('message is required');
      expect(mockConversationManager.processMessage).not.toHaveBeenCalled();
    });

    it('returns 500 with error message on service error', async () => {
      mockConversationManager.processMessage.mockRejectedValue(new Error('boom'));

      const response = await request(app)
        .post('/api/a2a/message/send')
        .send({ conversationId: 'conv-1', message: 'hello' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('boom');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/a2a/message/orchestrate
  // --------------------------------------------------------------------------

  describe('POST /api/a2a/message/orchestrate', () => {
    it('orchestrates a message successfully', async () => {
      mockConversationManager.processOrchestratedMessage.mockResolvedValue({
        messageId: 'msg-3',
        task: { id: 'task-3' },
      });

      const response = await request(app)
        .post('/api/a2a/message/orchestrate')
        .send({ conversationId: 'conv-2', message: 'route me' });

      expect(response.status).toBe(200);
      expect(response.body.messageId).toBe('msg-3');
      expect(response.body.contextId).toBe('conv-2');
      expect(response.body.taskId).toBe('task-3');
      expect(mockConversationManager.processOrchestratedMessage).toHaveBeenCalledWith(
        'conv-2',
        'route me'
      );
    });

    it('returns 400 when conversationId is missing', async () => {
      const response = await request(app)
        .post('/api/a2a/message/orchestrate')
        .send({ message: 'route me' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('conversationId is required');
      expect(mockConversationManager.processOrchestratedMessage).not.toHaveBeenCalled();
    });

    it('returns 400 when message is missing', async () => {
      const response = await request(app)
        .post('/api/a2a/message/orchestrate')
        .send({ conversationId: 'conv-2' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('message is required');
      expect(mockConversationManager.processOrchestratedMessage).not.toHaveBeenCalled();
    });

    it('returns 500 with error message on service error', async () => {
      mockConversationManager.processOrchestratedMessage.mockRejectedValue(
        new Error('orchestrate failed')
      );

      const response = await request(app)
        .post('/api/a2a/message/orchestrate')
        .send({ conversationId: 'conv-2', message: 'route me' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('orchestrate failed');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/a2a/message/list
  // --------------------------------------------------------------------------

  describe('POST /api/a2a/message/list', () => {
    it('lists messages for a conversation', async () => {
      const messages = [{ id: 'm1' }, { id: 'm2' }];
      mockConversationManager.getMessages.mockResolvedValue(messages);

      const response = await request(app)
        .post('/api/a2a/message/list')
        .send({ conversationId: 'conv-3' });

      expect(response.status).toBe(200);
      expect(response.body.messages).toEqual(messages);
      expect(mockConversationManager.getMessages).toHaveBeenCalledWith('conv-3');
    });

    it('returns 400 when conversationId is missing', async () => {
      const response = await request(app).post('/api/a2a/message/list').send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('conversationId is required');
      expect(mockConversationManager.getMessages).not.toHaveBeenCalled();
    });

    it('returns 500 on service error', async () => {
      mockConversationManager.getMessages.mockRejectedValue(new Error('db error'));

      const response = await request(app)
        .post('/api/a2a/message/list')
        .send({ conversationId: 'conv-3' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to list messages');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/a2a/message/pending
  // --------------------------------------------------------------------------

  describe('POST /api/a2a/message/pending', () => {
    it('returns pending message statuses', async () => {
      const pending = [{ id: 'p1', status: 'pending' }];
      mockConversationManager.getPendingMessages.mockReturnValue(pending);

      const response = await request(app).post('/api/a2a/message/pending').send({});

      expect(response.status).toBe(200);
      expect(response.body.pending).toEqual(pending);
      expect(mockConversationManager.getPendingMessages).toHaveBeenCalled();
    });

    it('returns 500 on service error', async () => {
      mockConversationManager.getPendingMessages.mockImplementation(() => {
        throw new Error('pending failed');
      });

      const response = await request(app).post('/api/a2a/message/pending').send({});

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get pending messages');
    });
  });
});
