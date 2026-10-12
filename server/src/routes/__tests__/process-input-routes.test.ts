/**
 * @file process-input-routes.test.ts
 * @description Process routes answer malformed step templates, unknown task
 *   actionTypes and garbage pagination with 400 (TASK-386).
 * @feature processes
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const { mockRepo, mockTaskRepo, mockDistributor } = vi.hoisted(() => ({
  mockRepo: {
    findAllDefinitions: vi.fn(),
    findAllInstances: vi.fn(),
    createDefinition: vi.fn(),
    findDefinitionById: vi.fn(),
    updateDefinition: vi.fn(),
  },
  mockTaskRepo: { findAll: vi.fn() },
  mockDistributor: { createTask: vi.fn() },
}));

vi.mock('../../repositories/ProcessRepository.js', () => ({ processRepository: mockRepo }));
vi.mock('../../repositories/RobotTaskRepository.js', () => ({ robotTaskRepository: mockTaskRepo }));
vi.mock('../../services/TaskDistributor.js', () => ({ taskDistributor: mockDistributor }));
vi.mock('../../services/SkillExecutionService.js', () => ({ skillExecutionService: {} }));
vi.mock('../../services/TwinPlaceGraphService.js', () => ({ twinPlaceGraphService: {} }));
vi.mock('../../services/ProcessSchedulerService.js', () => ({
  ProcessSchedulerService: { validateCron: () => ({ valid: true }) },
}));

import { processRoutes } from '../process.routes.js';

function app() {
  const a = express();
  a.use(express.json());
  a.use('/processes', processRoutes);
  return a;
}

const page = { data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } };

beforeEach(() => {
  vi.clearAllMocks();
  mockRepo.findAllDefinitions.mockResolvedValue(page);
  mockRepo.findAllInstances.mockResolvedValue(page);
  mockTaskRepo.findAll.mockResolvedValue(page);
});

describe('POST /processes', () => {
  it.each([
    [{ name: 'p', stepTemplates: 'x' }, 'stepTemplates must be an array'],
    [{ name: 'p', stepTemplates: [{ foo: 1 }] }, 'stepTemplates[0].name'],
    [
      { name: 'p', stepTemplates: [{ name: 's', actionType: 'wait', actionConfig: {} }, { name: 't', actionType: 'fly' }] },
      'stepTemplates[1].actionType',
    ],
    [{ name: 'p', stepTemplates: [{ name: 's', actionType: 'wait' }] }, 'stepTemplates[0].actionConfig'],
  ])('refuses %j with 400', async (body, message) => {
    const res = await request(app()).post('/processes').send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain(message);
    expect(mockRepo.createDefinition).not.toHaveBeenCalled();
  });

  it('creates a definition with well-formed steps', async () => {
    mockRepo.createDefinition.mockResolvedValue({ id: 'd1' });
    const res = await request(app())
      .post('/processes')
      .send({ name: 'p', stepTemplates: [{ name: 's', actionType: 'wait', actionConfig: {} }] });
    expect(res.status).toBe(201);
  });
});

describe('POST /processes/:id/publish', () => {
  it('refuses a stored definition with a malformed step', async () => {
    mockRepo.findDefinitionById.mockResolvedValue({ id: 'd1', stepTemplates: [{ foo: 1 }] });
    const res = await request(app()).post('/processes/d1/publish');
    expect(res.status).toBe(400);
    expect(mockRepo.updateDefinition).not.toHaveBeenCalled();
  });
});

describe('POST /processes/tasks', () => {
  it('refuses an unknown actionType', async () => {
    const res = await request(app())
      .post('/processes/tasks')
      .send({ actionType: 'bogus', instruction: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('actionType must be one of');
    expect(mockDistributor.createTask).not.toHaveBeenCalled();
  });
});

describe('list pagination', () => {
  it.each(['/processes', '/processes/instances/list', '/processes/tasks/list'])(
    '%s refuses page=abc, page=0 and limit=-1',
    async (path) => {
      for (const qs of ['page=abc', 'page=0', 'limit=-1']) {
        const res = await request(app()).get(`${path}?${qs}`);
        expect(res.status, `${path}?${qs}`).toBe(400);
      }
    }
  );

  it('passes valid pagination through', async () => {
    const res = await request(app()).get('/processes?page=2&limit=5');
    expect(res.status).toBe(200);
    expect(mockRepo.findAllDefinitions).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ page: 2, limit: 5 })
    );
  });
});
