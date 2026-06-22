/**
 * @file process-routes.test.ts
 * @description Integration tests for process, process-instance and robot-task routes
 * @feature processes
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Use vi.hoisted so mock objects are available before vi.mock hoisting
const {
  mockProcessManager,
  mockTaskDistributor,
  mockRobotTaskRepository,
  mockProcessRepository,
  mockValidateCron,
} = vi.hoisted(() => ({
  mockProcessManager: {
    listDefinitions: vi.fn(),
    getDefinition: vi.fn(),
    createDefinition: vi.fn(),
    updateDefinition: vi.fn(),
    publishDefinition: vi.fn(),
    archiveDefinition: vi.fn(),
    startProcess: vi.fn(),
    listInstances: vi.fn(),
    getInstance: vi.fn(),
    pauseProcess: vi.fn(),
    resumeProcess: vi.fn(),
    cancelProcess: vi.fn(),
    retryProcess: vi.fn(),
  },
  mockTaskDistributor: {
    getTask: vi.fn(),
    createTask: vi.fn(),
    updateTaskStatus: vi.fn(),
    cancelTask: vi.fn(),
    getQueueStats: vi.fn(),
  },
  mockRobotTaskRepository: {
    findAll: vi.fn(),
  },
  mockProcessRepository: {
    updateSchedule: vi.fn(),
  },
  mockValidateCron: vi.fn(),
}));

vi.mock('../services/ProcessManager.js', () => ({
  processManager: mockProcessManager,
}));

vi.mock('../services/TaskDistributor.js', () => ({
  taskDistributor: mockTaskDistributor,
}));

vi.mock('../repositories/RobotTaskRepository.js', () => ({
  robotTaskRepository: mockRobotTaskRepository,
}));

vi.mock('../repositories/ProcessRepository.js', () => ({
  processRepository: mockProcessRepository,
}));

vi.mock('../services/ProcessSchedulerService.js', () => ({
  ProcessSchedulerService: {
    validateCron: mockValidateCron,
  },
}));

vi.mock('../middleware/auth.middleware.js', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-123', email: 'test@example.com', name: 'Test', role: 'admin' };
    next();
  },
  AuthenticatedRequest: {},
}));

import { processRoutes } from '../routes/process.routes.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/processes', authMiddleware as any, processRoutes);
  return app;
}

const SAMPLE_PROCESS = {
  id: 'proc-001',
  name: 'Inspection Routine',
  status: 'draft',
  stepTemplates: [{ id: 'step-1', actionType: 'navigate', instruction: 'Go' }],
};

const SAMPLE_INSTANCE = {
  id: 'inst-001',
  processDefinitionId: 'proc-001',
  status: 'running',
};

const SAMPLE_TASK = {
  id: 'task-001',
  actionType: 'navigate',
  instruction: 'Go to zone A',
  status: 'pending',
};

describe('Process Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  // --------------------------------------------------------------------------
  // GET /api/processes
  // --------------------------------------------------------------------------

  describe('GET /api/processes', () => {
    it('lists process definitions with filters and pagination', async () => {
      mockProcessManager.listDefinitions.mockResolvedValue({ items: [SAMPLE_PROCESS], total: 1 });

      const response = await request(app)
        .get('/api/processes')
        .query({ status: 'published', search: 'insp', tags: 'a,b', page: '2', limit: '5', sortBy: 'name', sortOrder: 'asc' });

      expect(response.status).toBe(200);
      expect(response.body.total).toBe(1);
      expect(response.body.items[0].id).toBe('proc-001');
      expect(mockProcessManager.listDefinitions).toHaveBeenCalledWith(
        { status: 'published', search: 'insp', tags: ['a', 'b'] },
        { page: 2, limit: 5, sortBy: 'name', sortOrder: 'asc' }
      );
    });

    it('uses default pagination when not provided', async () => {
      mockProcessManager.listDefinitions.mockResolvedValue({ items: [], total: 0 });

      const response = await request(app).get('/api/processes');

      expect(response.status).toBe(200);
      expect(mockProcessManager.listDefinitions).toHaveBeenCalledWith(
        { status: undefined, search: undefined, tags: undefined },
        { page: 1, limit: 20, sortBy: undefined, sortOrder: undefined }
      );
    });

    it('returns 500 on service error', async () => {
      mockProcessManager.listDefinitions.mockRejectedValue(new Error('DB error'));

      const response = await request(app).get('/api/processes');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to list processes');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/processes/:id
  // --------------------------------------------------------------------------

  describe('GET /api/processes/:id', () => {
    it('returns a process definition', async () => {
      mockProcessManager.getDefinition.mockResolvedValue(SAMPLE_PROCESS);

      const response = await request(app).get('/api/processes/proc-001');

      expect(response.status).toBe(200);
      expect(response.body.id).toBe('proc-001');
      expect(mockProcessManager.getDefinition).toHaveBeenCalledWith('proc-001');
    });

    it('returns 404 when not found', async () => {
      mockProcessManager.getDefinition.mockResolvedValue(null);

      const response = await request(app).get('/api/processes/missing');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Process not found');
    });

    it('returns 500 on service error', async () => {
      mockProcessManager.getDefinition.mockRejectedValue(new Error('boom'));

      const response = await request(app).get('/api/processes/proc-001');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get process');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/processes
  // --------------------------------------------------------------------------

  describe('POST /api/processes', () => {
    it('creates a process definition', async () => {
      mockProcessManager.createDefinition.mockResolvedValue(SAMPLE_PROCESS);
      const body = { name: 'Inspection Routine', stepTemplates: [{ id: 'step-1' }] };

      const response = await request(app).post('/api/processes').send(body);

      expect(response.status).toBe(201);
      expect(response.body.id).toBe('proc-001');
      expect(mockProcessManager.createDefinition).toHaveBeenCalledWith(body, 'system');
    });

    it('returns 400 when name is missing', async () => {
      const response = await request(app)
        .post('/api/processes')
        .send({ stepTemplates: [{ id: 'step-1' }] });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('name and stepTemplates are required');
      expect(mockProcessManager.createDefinition).not.toHaveBeenCalled();
    });

    it('returns 400 when stepTemplates is empty', async () => {
      const response = await request(app)
        .post('/api/processes')
        .send({ name: 'X', stepTemplates: [] });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('name and stepTemplates are required');
    });

    it('returns 500 on service error', async () => {
      mockProcessManager.createDefinition.mockRejectedValue(new Error('boom'));

      const response = await request(app)
        .post('/api/processes')
        .send({ name: 'X', stepTemplates: [{ id: 's' }] });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to create process');
    });
  });

  // --------------------------------------------------------------------------
  // PUT /api/processes/:id
  // --------------------------------------------------------------------------

  describe('PUT /api/processes/:id', () => {
    it('updates a process definition', async () => {
      const updated = { ...SAMPLE_PROCESS, name: 'Updated' };
      mockProcessManager.updateDefinition.mockResolvedValue(updated);

      const response = await request(app).put('/api/processes/proc-001').send({ name: 'Updated' });

      expect(response.status).toBe(200);
      expect(response.body.name).toBe('Updated');
      expect(mockProcessManager.updateDefinition).toHaveBeenCalledWith('proc-001', { name: 'Updated' });
    });

    it('returns 404 when not found', async () => {
      mockProcessManager.updateDefinition.mockResolvedValue(null);

      const response = await request(app).put('/api/processes/missing').send({ name: 'X' });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Process not found');
    });

    it('returns 500 on service error', async () => {
      mockProcessManager.updateDefinition.mockRejectedValue(new Error('boom'));

      const response = await request(app).put('/api/processes/proc-001').send({ name: 'X' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to update process');
    });
  });

  // --------------------------------------------------------------------------
  // PUT /api/processes/:id/schedule
  // --------------------------------------------------------------------------

  describe('PUT /api/processes/:id/schedule', () => {
    it('updates schedule fields', async () => {
      mockValidateCron.mockReturnValue({ valid: true, nextRun: '2026-07-01T00:00:00.000Z' });
      const updated = { ...SAMPLE_PROCESS, cronExpression: '0 0 * * *' };
      mockProcessRepository.updateSchedule.mockResolvedValue(updated);

      const response = await request(app)
        .put('/api/processes/proc-001/schedule')
        .send({ triggerType: 'schedule', cronExpression: '0 0 * * *', enabled: true });

      expect(response.status).toBe(200);
      expect(response.body.cronExpression).toBe('0 0 * * *');
      expect(mockValidateCron).toHaveBeenCalledWith('0 0 * * *');
      expect(mockProcessRepository.updateSchedule).toHaveBeenCalledWith(
        'proc-001',
        'schedule',
        '0 0 * * *',
        true,
        null
      );
    });

    it('passes undefined nextRunAt reset when cronExpression is not provided', async () => {
      mockProcessRepository.updateSchedule.mockResolvedValue(SAMPLE_PROCESS);

      const response = await request(app)
        .put('/api/processes/proc-001/schedule')
        .send({ enabled: false });

      expect(response.status).toBe(200);
      expect(mockValidateCron).not.toHaveBeenCalled();
      expect(mockProcessRepository.updateSchedule).toHaveBeenCalledWith(
        'proc-001',
        undefined,
        undefined,
        false,
        undefined
      );
    });

    it('resets cronExpression to null when passed null', async () => {
      mockProcessRepository.updateSchedule.mockResolvedValue(SAMPLE_PROCESS);

      const response = await request(app)
        .put('/api/processes/proc-001/schedule')
        .send({ cronExpression: null });

      expect(response.status).toBe(200);
      // cronExpression null is falsy so no validation runs
      expect(mockValidateCron).not.toHaveBeenCalled();
      expect(mockProcessRepository.updateSchedule).toHaveBeenCalledWith(
        'proc-001',
        undefined,
        null,
        undefined,
        null
      );
    });

    it('returns 400 for invalid cron expression', async () => {
      mockValidateCron.mockReturnValue({ valid: false, error: 'bad syntax' });

      const response = await request(app)
        .put('/api/processes/proc-001/schedule')
        .send({ cronExpression: 'not-a-cron' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid cron expression: bad syntax');
      expect(mockProcessRepository.updateSchedule).not.toHaveBeenCalled();
    });

    it('returns 404 when process not found', async () => {
      mockProcessRepository.updateSchedule.mockResolvedValue(null);

      const response = await request(app)
        .put('/api/processes/missing/schedule')
        .send({ enabled: true });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Process not found');
    });

    it('returns 500 on repository error', async () => {
      mockProcessRepository.updateSchedule.mockRejectedValue(new Error('boom'));

      const response = await request(app)
        .put('/api/processes/proc-001/schedule')
        .send({ enabled: true });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to update process schedule');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/processes/cron/validate
  // --------------------------------------------------------------------------

  describe('POST /api/processes/cron/validate', () => {
    it('returns 200 for a valid cron expression', async () => {
      mockValidateCron.mockReturnValue({ valid: true, nextRun: '2026-07-01T00:00:00.000Z' });

      const response = await request(app)
        .post('/api/processes/cron/validate')
        .send({ cronExpression: '0 0 * * *' });

      expect(response.status).toBe(200);
      expect(response.body.valid).toBe(true);
      expect(response.body.nextRun).toBe('2026-07-01T00:00:00.000Z');
      expect(mockValidateCron).toHaveBeenCalledWith('0 0 * * *');
    });

    it('returns 400 for an invalid cron expression', async () => {
      mockValidateCron.mockReturnValue({ valid: false, error: 'bad' });

      const response = await request(app)
        .post('/api/processes/cron/validate')
        .send({ cronExpression: 'xyz' });

      expect(response.status).toBe(400);
      expect(response.body.valid).toBe(false);
      expect(response.body.error).toBe('bad');
    });

    it('returns 400 when cronExpression is missing', async () => {
      const response = await request(app).post('/api/processes/cron/validate').send({});

      expect(response.status).toBe(400);
      expect(response.body.valid).toBe(false);
      expect(response.body.error).toBe('cronExpression is required');
      expect(mockValidateCron).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/processes/:id/publish
  // --------------------------------------------------------------------------

  describe('POST /api/processes/:id/publish', () => {
    it('publishes a process definition', async () => {
      mockProcessManager.publishDefinition.mockResolvedValue({ ...SAMPLE_PROCESS, status: 'published' });

      const response = await request(app).post('/api/processes/proc-001/publish');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('published');
      expect(mockProcessManager.publishDefinition).toHaveBeenCalledWith('proc-001');
    });

    it('returns 404 when not found', async () => {
      mockProcessManager.publishDefinition.mockResolvedValue(null);

      const response = await request(app).post('/api/processes/missing/publish');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Process not found');
    });

    it('returns 500 on service error', async () => {
      mockProcessManager.publishDefinition.mockRejectedValue(new Error('boom'));

      const response = await request(app).post('/api/processes/proc-001/publish');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to publish process');
    });
  });

  // --------------------------------------------------------------------------
  // DELETE /api/processes/:id
  // --------------------------------------------------------------------------

  describe('DELETE /api/processes/:id', () => {
    it('archives a process definition', async () => {
      mockProcessManager.archiveDefinition.mockResolvedValue(true);

      const response = await request(app).delete('/api/processes/proc-001');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockProcessManager.archiveDefinition).toHaveBeenCalledWith('proc-001');
    });

    it('returns 404 when not found', async () => {
      mockProcessManager.archiveDefinition.mockResolvedValue(false);

      const response = await request(app).delete('/api/processes/missing');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Process not found');
    });

    it('returns 500 on service error', async () => {
      mockProcessManager.archiveDefinition.mockRejectedValue(new Error('boom'));

      const response = await request(app).delete('/api/processes/proc-001');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to archive process');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/processes/:id/start
  // --------------------------------------------------------------------------

  describe('POST /api/processes/:id/start', () => {
    it('starts a process instance', async () => {
      mockProcessManager.startProcess.mockResolvedValue(SAMPLE_INSTANCE);
      const body = { priority: 'high' };

      const response = await request(app).post('/api/processes/proc-001/start').send(body);

      expect(response.status).toBe(201);
      expect(response.body.id).toBe('inst-001');
      expect(mockProcessManager.startProcess).toHaveBeenCalledWith('proc-001', body, 'system');
    });

    it('returns 400 when start fails (no instance)', async () => {
      mockProcessManager.startProcess.mockResolvedValue(null);

      const response = await request(app).post('/api/processes/proc-001/start').send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Failed to start process. Definition may not exist or not be ready.');
    });

    it('returns 500 on service error', async () => {
      mockProcessManager.startProcess.mockRejectedValue(new Error('boom'));

      const response = await request(app).post('/api/processes/proc-001/start').send({});

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to start process');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/processes/instances/list
  // --------------------------------------------------------------------------

  describe('GET /api/processes/instances/list', () => {
    it('lists process instances with filters', async () => {
      mockProcessManager.listInstances.mockResolvedValue({ items: [SAMPLE_INSTANCE], total: 1 });

      const response = await request(app)
        .get('/api/processes/instances/list')
        .query({ status: 'running', priority: 'high', processDefinitionId: 'proc-001', robotId: 'r1', createdBy: 'u1', page: '3', limit: '10' });

      expect(response.status).toBe(200);
      expect(response.body.total).toBe(1);
      expect(mockProcessManager.listInstances).toHaveBeenCalledWith(
        { status: 'running', priority: 'high', processDefinitionId: 'proc-001', robotId: 'r1', createdBy: 'u1' },
        { page: 3, limit: 10, sortBy: undefined, sortOrder: undefined }
      );
    });

    it('returns 500 on service error', async () => {
      mockProcessManager.listInstances.mockRejectedValue(new Error('boom'));

      const response = await request(app).get('/api/processes/instances/list');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to list process instances');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/processes/instances/:id
  // --------------------------------------------------------------------------

  describe('GET /api/processes/instances/:id', () => {
    it('returns a process instance', async () => {
      mockProcessManager.getInstance.mockResolvedValue(SAMPLE_INSTANCE);

      const response = await request(app).get('/api/processes/instances/inst-001');

      expect(response.status).toBe(200);
      expect(response.body.id).toBe('inst-001');
      expect(mockProcessManager.getInstance).toHaveBeenCalledWith('inst-001');
    });

    it('returns 404 when not found', async () => {
      mockProcessManager.getInstance.mockResolvedValue(null);

      const response = await request(app).get('/api/processes/instances/missing');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Process instance not found');
    });

    it('returns 500 on service error', async () => {
      mockProcessManager.getInstance.mockRejectedValue(new Error('boom'));

      const response = await request(app).get('/api/processes/instances/inst-001');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get process instance');
    });
  });

  // --------------------------------------------------------------------------
  // PUT /api/processes/instances/:id/pause
  // --------------------------------------------------------------------------

  describe('PUT /api/processes/instances/:id/pause', () => {
    it('pauses a process instance', async () => {
      mockProcessManager.pauseProcess.mockResolvedValue({ ...SAMPLE_INSTANCE, status: 'paused' });

      const response = await request(app).put('/api/processes/instances/inst-001/pause');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('paused');
      expect(mockProcessManager.pauseProcess).toHaveBeenCalledWith('inst-001');
    });

    it('returns 400 when cannot pause', async () => {
      mockProcessManager.pauseProcess.mockResolvedValue(null);

      const response = await request(app).put('/api/processes/instances/inst-001/pause');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Cannot pause process. It may not be running.');
    });

    it('returns 500 on service error', async () => {
      mockProcessManager.pauseProcess.mockRejectedValue(new Error('boom'));

      const response = await request(app).put('/api/processes/instances/inst-001/pause');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to pause process');
    });
  });

  // --------------------------------------------------------------------------
  // PUT /api/processes/instances/:id/resume
  // --------------------------------------------------------------------------

  describe('PUT /api/processes/instances/:id/resume', () => {
    it('resumes a process instance', async () => {
      mockProcessManager.resumeProcess.mockResolvedValue({ ...SAMPLE_INSTANCE, status: 'running' });

      const response = await request(app).put('/api/processes/instances/inst-001/resume');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('running');
      expect(mockProcessManager.resumeProcess).toHaveBeenCalledWith('inst-001');
    });

    it('returns 400 when cannot resume', async () => {
      mockProcessManager.resumeProcess.mockResolvedValue(null);

      const response = await request(app).put('/api/processes/instances/inst-001/resume');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Cannot resume process. It may not be paused.');
    });

    it('returns 500 on service error', async () => {
      mockProcessManager.resumeProcess.mockRejectedValue(new Error('boom'));

      const response = await request(app).put('/api/processes/instances/inst-001/resume');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to resume process');
    });
  });

  // --------------------------------------------------------------------------
  // PUT /api/processes/instances/:id/cancel
  // --------------------------------------------------------------------------

  describe('PUT /api/processes/instances/:id/cancel', () => {
    it('cancels a process instance', async () => {
      mockProcessManager.cancelProcess.mockResolvedValue({ ...SAMPLE_INSTANCE, status: 'cancelled' });

      const response = await request(app).put('/api/processes/instances/inst-001/cancel');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('cancelled');
      expect(mockProcessManager.cancelProcess).toHaveBeenCalledWith('inst-001');
    });

    it('returns 400 when cannot cancel', async () => {
      mockProcessManager.cancelProcess.mockResolvedValue(null);

      const response = await request(app).put('/api/processes/instances/inst-001/cancel');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Cannot cancel process. It may already be completed.');
    });

    it('returns 500 on service error', async () => {
      mockProcessManager.cancelProcess.mockRejectedValue(new Error('boom'));

      const response = await request(app).put('/api/processes/instances/inst-001/cancel');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to cancel process');
    });
  });

  // --------------------------------------------------------------------------
  // PUT /api/processes/instances/:id/retry
  // --------------------------------------------------------------------------

  describe('PUT /api/processes/instances/:id/retry', () => {
    it('retries a process instance', async () => {
      mockProcessManager.retryProcess.mockResolvedValue({ ...SAMPLE_INSTANCE, status: 'running' });

      const response = await request(app).put('/api/processes/instances/inst-001/retry');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('running');
      expect(mockProcessManager.retryProcess).toHaveBeenCalledWith('inst-001');
    });

    it('returns 400 when cannot retry', async () => {
      mockProcessManager.retryProcess.mockResolvedValue(null);

      const response = await request(app).put('/api/processes/instances/inst-001/retry');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Cannot retry process. It must be in failed or cancelled state.');
    });

    it('returns 500 on service error', async () => {
      mockProcessManager.retryProcess.mockRejectedValue(new Error('boom'));

      const response = await request(app).put('/api/processes/instances/inst-001/retry');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to retry process');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/processes/tasks/list
  // --------------------------------------------------------------------------

  describe('GET /api/processes/tasks/list', () => {
    it('lists robot tasks with filters', async () => {
      mockRobotTaskRepository.findAll.mockResolvedValue({ items: [SAMPLE_TASK], total: 1 });

      const response = await request(app)
        .get('/api/processes/tasks/list')
        .query({ status: 'pending', priority: 'high', robotId: 'r1', processInstanceId: 'inst-001', source: 'manual', page: '2', limit: '50' });

      expect(response.status).toBe(200);
      expect(response.body.total).toBe(1);
      expect(mockRobotTaskRepository.findAll).toHaveBeenCalledWith(
        { status: 'pending', priority: 'high', robotId: 'r1', processInstanceId: 'inst-001', source: 'manual' },
        { page: 2, limit: 50, sortBy: undefined, sortOrder: undefined }
      );
    });

    it('returns 500 on repository error', async () => {
      mockRobotTaskRepository.findAll.mockRejectedValue(new Error('boom'));

      const response = await request(app).get('/api/processes/tasks/list');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to list tasks');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/processes/tasks/:id
  // --------------------------------------------------------------------------

  describe('GET /api/processes/tasks/:id', () => {
    it('returns a robot task', async () => {
      mockTaskDistributor.getTask.mockResolvedValue(SAMPLE_TASK);

      const response = await request(app).get('/api/processes/tasks/task-001');

      expect(response.status).toBe(200);
      expect(response.body.id).toBe('task-001');
      expect(mockTaskDistributor.getTask).toHaveBeenCalledWith('task-001');
    });

    it('returns 404 when not found', async () => {
      mockTaskDistributor.getTask.mockResolvedValue(null);

      const response = await request(app).get('/api/processes/tasks/missing');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Task not found');
    });

    it('returns 500 on service error', async () => {
      mockTaskDistributor.getTask.mockRejectedValue(new Error('boom'));

      const response = await request(app).get('/api/processes/tasks/task-001');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get task');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/processes/tasks
  // --------------------------------------------------------------------------

  describe('POST /api/processes/tasks', () => {
    it('creates a robot task', async () => {
      mockTaskDistributor.createTask.mockResolvedValue(SAMPLE_TASK);
      const body = { actionType: 'navigate', instruction: 'Go to zone A' };

      const response = await request(app).post('/api/processes/tasks').send(body);

      expect(response.status).toBe(201);
      expect(response.body.id).toBe('task-001');
      expect(mockTaskDistributor.createTask).toHaveBeenCalledWith(body, 'manual');
    });

    it('returns 400 when actionType is missing', async () => {
      const response = await request(app)
        .post('/api/processes/tasks')
        .send({ instruction: 'Go' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('actionType and instruction are required');
      expect(mockTaskDistributor.createTask).not.toHaveBeenCalled();
    });

    it('returns 400 when instruction is missing', async () => {
      const response = await request(app)
        .post('/api/processes/tasks')
        .send({ actionType: 'navigate' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('actionType and instruction are required');
    });

    it('returns 500 on service error', async () => {
      mockTaskDistributor.createTask.mockRejectedValue(new Error('boom'));

      const response = await request(app)
        .post('/api/processes/tasks')
        .send({ actionType: 'navigate', instruction: 'Go' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to create task');
    });
  });

  // --------------------------------------------------------------------------
  // PUT /api/processes/tasks/:id/status
  // --------------------------------------------------------------------------

  describe('PUT /api/processes/tasks/:id/status', () => {
    it('updates task status', async () => {
      mockTaskDistributor.updateTaskStatus.mockResolvedValue({ ...SAMPLE_TASK, status: 'completed' });

      const response = await request(app)
        .put('/api/processes/tasks/task-001/status')
        .send({ status: 'completed', result: { ok: true }, a2aTaskId: 'a1', a2aContextId: 'c1' });

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('completed');
      expect(mockTaskDistributor.updateTaskStatus).toHaveBeenCalledWith('task-001', 'completed', {
        a2aTaskId: 'a1',
        a2aContextId: 'c1',
        result: { ok: true },
        error: undefined,
      });
    });

    it('returns 400 for invalid status', async () => {
      const response = await request(app)
        .put('/api/processes/tasks/task-001/status')
        .send({ status: 'bogus' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Valid status (executing, completed, failed) is required');
      expect(mockTaskDistributor.updateTaskStatus).not.toHaveBeenCalled();
    });

    it('returns 400 when status is missing', async () => {
      const response = await request(app)
        .put('/api/processes/tasks/task-001/status')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Valid status (executing, completed, failed) is required');
    });

    it('returns 404 when task not found', async () => {
      mockTaskDistributor.updateTaskStatus.mockResolvedValue(null);

      const response = await request(app)
        .put('/api/processes/tasks/missing/status')
        .send({ status: 'executing' });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Task not found');
    });

    it('returns 500 on service error', async () => {
      mockTaskDistributor.updateTaskStatus.mockRejectedValue(new Error('boom'));

      const response = await request(app)
        .put('/api/processes/tasks/task-001/status')
        .send({ status: 'failed' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to update task status');
    });
  });

  // --------------------------------------------------------------------------
  // PUT /api/processes/tasks/:id/cancel
  // --------------------------------------------------------------------------

  describe('PUT /api/processes/tasks/:id/cancel', () => {
    it('cancels a task', async () => {
      mockTaskDistributor.cancelTask.mockResolvedValue({ ...SAMPLE_TASK, status: 'cancelled' });

      const response = await request(app)
        .put('/api/processes/tasks/task-001/cancel')
        .send({ reason: 'no longer needed' });

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('cancelled');
      expect(mockTaskDistributor.cancelTask).toHaveBeenCalledWith('task-001', 'no longer needed');
    });

    it('returns 400 when cannot cancel', async () => {
      mockTaskDistributor.cancelTask.mockResolvedValue(null);

      const response = await request(app)
        .put('/api/processes/tasks/task-001/cancel')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Cannot cancel task. It may already be completed.');
    });

    it('returns 500 on service error', async () => {
      mockTaskDistributor.cancelTask.mockRejectedValue(new Error('boom'));

      const response = await request(app)
        .put('/api/processes/tasks/task-001/cancel')
        .send({});

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to cancel task');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/processes/tasks/queue/stats
  // --------------------------------------------------------------------------

  describe('GET /api/processes/tasks/queue/stats', () => {
    it('returns queue statistics', async () => {
      const stats = { pending: 3, executing: 1, completed: 10 };
      mockTaskDistributor.getQueueStats.mockResolvedValue(stats);

      const response = await request(app).get('/api/processes/tasks/queue/stats');

      expect(response.status).toBe(200);
      expect(response.body.pending).toBe(3);
      expect(mockTaskDistributor.getQueueStats).toHaveBeenCalled();
    });

    it('returns 500 on service error', async () => {
      mockTaskDistributor.getQueueStats.mockRejectedValue(new Error('boom'));

      const response = await request(app).get('/api/processes/tasks/queue/stats');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get queue stats');
    });
  });
});
