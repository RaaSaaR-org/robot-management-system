/**
 * @file task-routes.test.ts
 * @description Integration tests for A2A task management routes
 * @feature a2a-tasks
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Use vi.hoisted so mock objects are available before vi.mock hoisting
const { mockConversationManager } = vi.hoisted(() => ({
  mockConversationManager: {
    listTasks: vi.fn(),
    getTask: vi.fn(),
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

import { taskRoutes } from '../routes/task.routes.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/a2a/task', authMiddleware as any, taskRoutes);
  return app;
}

const MOCK_TASK = {
  id: 'task-001',
  contextId: 'ctx-001',
  status: { state: 'completed' },
  history: [],
};

describe('Task Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  // --------------------------------------------------------------------------
  // POST /api/a2a/task/list
  // --------------------------------------------------------------------------

  describe('POST /api/a2a/task/list', () => {
    it('returns the list of tasks', async () => {
      mockConversationManager.listTasks.mockResolvedValue([MOCK_TASK]);

      const response = await request(app).post('/api/a2a/task/list');

      expect(response.status).toBe(200);
      expect(response.body.tasks).toHaveLength(1);
      expect(response.body.tasks[0].id).toBe('task-001');
      expect(mockConversationManager.listTasks).toHaveBeenCalledTimes(1);
    });

    it('returns 500 on service error', async () => {
      mockConversationManager.listTasks.mockRejectedValue(new Error('DB error'));

      const response = await request(app).post('/api/a2a/task/list');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to list tasks');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/a2a/task/:id
  // --------------------------------------------------------------------------

  describe('GET /api/a2a/task/:id', () => {
    it('returns the requested task', async () => {
      mockConversationManager.getTask.mockResolvedValue(MOCK_TASK);

      const response = await request(app).get('/api/a2a/task/task-001');

      expect(response.status).toBe(200);
      expect(response.body.task.id).toBe('task-001');
      expect(mockConversationManager.getTask).toHaveBeenCalledWith('task-001');
    });

    it('returns 404 when the task does not exist', async () => {
      mockConversationManager.getTask.mockResolvedValue(undefined);

      const response = await request(app).get('/api/a2a/task/missing');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Task not found');
      expect(mockConversationManager.getTask).toHaveBeenCalledWith('missing');
    });

    it('returns 500 on service error', async () => {
      mockConversationManager.getTask.mockRejectedValue(new Error('DB error'));

      const response = await request(app).get('/api/a2a/task/task-001');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get task');
    });
  });
});
