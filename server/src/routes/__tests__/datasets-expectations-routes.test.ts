/**
 * @file datasets-expectations-routes.test.ts
 * @description Status mapping for the TASK-353 routes: changing a dataset's
 *              robot type, defining a robot configuration, and refusing a
 *              revalidation while an import is still writing the files.
 * @feature datasets
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const svc = vi.hoisted(() => {
  class DatasetExpectationError extends Error {
    constructor(message: string, public readonly status: number, public readonly code: string) {
      super(message);
    }
  }
  return {
    DatasetExpectationError,
    get: vi.fn(),
    reassociateRobotType: vi.fn(),
    createRobotConfiguration: vi.fn(),
    deleteRobotConfiguration: vi.fn(),
    renameRobotConfiguration: vi.fn(),
    requestValidation: vi.fn(),
    auditDatasetAction: vi.fn(),
  };
});

vi.mock('../../services/DatasetService.js', () => ({
  DatasetExpectationError: svc.DatasetExpectationError,
  datasetService: {
    get: svc.get,
    reassociateRobotType: svc.reassociateRobotType,
    createRobotConfiguration: svc.createRobotConfiguration,
    deleteRobotConfiguration: svc.deleteRobotConfiguration,
    renameRobotConfiguration: svc.renameRobotConfiguration,
    requestValidation: svc.requestValidation,
    auditDatasetAction: svc.auditDatasetAction,
    on: vi.fn(),
    off: vi.fn(),
  },
  datasetStorageRoot: () => '/tmp',
}));

import { datasetRoutes } from '../datasets.routes.js';

function createApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/api/datasets', datasetRoutes);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PUT /api/datasets/:id/robot-type', () => {
  it('answers the change and the revalidation it started', async () => {
    svc.reassociateRobotType.mockResolvedValue({ dataset: { id: 'd1' }, change: { toRobotTypeId: 'rt-43' }, revalidation: 'started' });
    const res = await request(createApp()).put('/api/datasets/d1/robot-type').send({ robotTypeId: 'rt-43', reason: 'fix' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ revalidation: 'started', progressUrl: '/api/datasets/d1/progress' });
    expect(svc.reassociateRobotType).toHaveBeenCalledWith('d1', 'rt-43', expect.objectContaining({ reason: 'fix' }));
  });

  it('is a 409 with a code while the dataset is busy', async () => {
    svc.reassociateRobotType.mockRejectedValue(new svc.DatasetExpectationError('busy', 409, 'VALIDATION_IN_FLIGHT'));
    const res = await request(createApp()).put('/api/datasets/d1/robot-type').send({ robotTypeId: 'rt-43' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('VALIDATION_IN_FLIGHT');
  });

  it('is a 400 without a robotTypeId', async () => {
    const res = await request(createApp()).put('/api/datasets/d1/robot-type').send({});
    expect(res.status).toBe(400);
    expect(svc.reassociateRobotType).not.toHaveBeenCalled();
  });
});

describe('POST /api/datasets/robot-types', () => {
  it('creates a configuration with 201', async () => {
    svc.createRobotConfiguration.mockResolvedValue({ id: 'rt-43', name: 'G1 43', actionDim: 43, proprioceptionDim: 43 });
    const res = await request(createApp()).post('/api/datasets/robot-types')
      .send({ name: 'G1 43', actionDim: 43, proprioceptionDim: 43 });
    expect(res.status).toBe(201);
    expect(res.body.robotType.id).toBe('rt-43');
  });

  it('refuses a member: robot types are shared configuration, owner-only', async () => {
    const app = express();
    app.use(express.json());
    // A service identity is never under the dev auth bypass, so the role check runs.
    app.use((req, _res, next) => {
      (req as unknown as { user: unknown }).user = { id: 'u1', role: 'member', authType: 'service' };
      next();
    });
    app.use('/api/datasets', datasetRoutes);
    const res = await request(app).post('/api/datasets/robot-types')
      .send({ name: 'G1 43', actionDim: 43, proprioceptionDim: 43 });
    expect(res.status).toBe(403);
    expect(svc.createRobotConfiguration).not.toHaveBeenCalled();
  });

  it('passes a taken name through as 409', async () => {
    svc.createRobotConfiguration.mockRejectedValue(new svc.DatasetExpectationError('taken', 409, 'ROBOT_TYPE_EXISTS'));
    const res = await request(createApp()).post('/api/datasets/robot-types')
      .send({ name: 'Unitree_G1', actionDim: 43, proprioceptionDim: 43 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ROBOT_TYPE_EXISTS');
  });
});

describe('DELETE /api/datasets/robot-types/:id (TASK-485)', () => {
  it('answers the deleted type', async () => {
    svc.deleteRobotConfiguration.mockResolvedValue({ id: 'rt-stale', name: 'Unitree_G1' });
    const res = await request(createApp()).delete('/api/datasets/robot-types/rt-stale');
    expect(res.status).toBe(200);
    expect(res.body.robotType.name).toBe('Unitree_G1');
    expect(svc.deleteRobotConfiguration).toHaveBeenCalledWith('rt-stale', null);
  });

  it('refuses a member: only an owner removes shared configuration', async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as unknown as { user: unknown }).user = { id: 'u1', role: 'member', authType: 'service' };
      next();
    });
    app.use('/api/datasets', datasetRoutes);
    const res = await request(app).delete('/api/datasets/robot-types/rt-stale');
    expect(res.status).toBe(403);
    expect(svc.deleteRobotConfiguration).not.toHaveBeenCalled();
  });

  it('passes a type in use through as 409 with what references it', async () => {
    const error = Object.assign(
      new svc.DatasetExpectationError('still in use by 1 dataset ("apples")', 409, 'ROBOT_TYPE_IN_USE'),
      { references: { datasets: [{ id: 'd1', name: 'apples' }], embodiments: [], skills: [] } },
    );
    svc.deleteRobotConfiguration.mockRejectedValue(error);
    const res = await request(createApp()).delete('/api/datasets/robot-types/rt-stale');
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      code: 'ROBOT_TYPE_IN_USE',
      error: 'still in use by 1 dataset ("apples")',
      references: { datasets: [{ id: 'd1', name: 'apples' }] },
    });
  });

  it('passes a standard type and an unknown id through with their own status', async () => {
    svc.deleteRobotConfiguration.mockRejectedValueOnce(new svc.DatasetExpectationError('standard', 409, 'ROBOT_TYPE_STANDARD'));
    expect((await request(createApp()).delete('/api/datasets/robot-types/rt-std')).body.code).toBe('ROBOT_TYPE_STANDARD');
    svc.deleteRobotConfiguration.mockRejectedValueOnce(new svc.DatasetExpectationError('gone', 404, 'ROBOT_TYPE_NOT_FOUND'));
    expect((await request(createApp()).delete('/api/datasets/robot-types/nope')).status).toBe(404);
  });
});

describe('PATCH /api/datasets/robot-types/:id (TASK-493)', () => {
  it('answers the renamed type', async () => {
    svc.renameRobotConfiguration.mockResolvedValue({ id: 'rt-31', name: 'Unitree G1 upper body + Dex3-1 hands' });
    const res = await request(createApp()).patch('/api/datasets/robot-types/rt-31')
      .send({ name: 'Unitree G1 upper body + Dex3-1 hands' });
    expect(res.status).toBe(200);
    expect(res.body.robotType.name).toBe('Unitree G1 upper body + Dex3-1 hands');
    expect(svc.renameRobotConfiguration).toHaveBeenCalledWith('rt-31', 'Unitree G1 upper body + Dex3-1 hands', null);
  });

  it('refuses a member: only an owner renames shared configuration', async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as unknown as { user: unknown }).user = { id: 'u1', role: 'member', authType: 'service' };
      next();
    });
    app.use('/api/datasets', datasetRoutes);
    const res = await request(app).patch('/api/datasets/robot-types/rt-31').send({ name: 'G1' });
    expect(res.status).toBe(403);
    expect(svc.renameRobotConfiguration).not.toHaveBeenCalled();
  });

  it('passes a taken name, a standard type and an unknown id through with their own status', async () => {
    svc.renameRobotConfiguration.mockRejectedValueOnce(new svc.DatasetExpectationError('taken', 409, 'ROBOT_TYPE_EXISTS'));
    const taken = await request(createApp()).patch('/api/datasets/robot-types/rt-31').send({ name: 'SO-101 Follower' });
    expect(taken.status).toBe(409);
    expect(taken.body).toEqual({ error: 'taken', code: 'ROBOT_TYPE_EXISTS' });
    svc.renameRobotConfiguration.mockRejectedValueOnce(new svc.DatasetExpectationError('standard', 409, 'ROBOT_TYPE_STANDARD'));
    expect((await request(createApp()).patch('/api/datasets/robot-types/rt-std').send({ name: 'x' })).body.code).toBe('ROBOT_TYPE_STANDARD');
    svc.renameRobotConfiguration.mockRejectedValueOnce(new svc.DatasetExpectationError('gone', 404, 'ROBOT_TYPE_NOT_FOUND'));
    expect((await request(createApp()).patch('/api/datasets/robot-types/nope').send({ name: 'x' })).status).toBe(404);
  });
});

describe('POST /api/datasets/:id/validate', () => {
  it('refuses with 409 while an import is running, without starting a pass', async () => {
    svc.get.mockResolvedValue({ id: 'd1', status: 'importing', storagePath: 'x/' });
    const res = await request(createApp()).post('/api/datasets/d1/validate');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('DATASET_BUSY');
    expect(svc.requestValidation).not.toHaveBeenCalled();
  });

  it('revalidates stored files and audits it', async () => {
    svc.get.mockResolvedValue({ id: 'd1', status: 'failed', storagePath: 'x/', robotTypeId: 'rt-43' });
    svc.requestValidation.mockResolvedValue('started');
    const res = await request(createApp()).post('/api/datasets/d1/validate');
    expect(res.status).toBe(202);
    // The actor travels with the request so the service can audit the pass it accepts.
    expect(svc.requestValidation).toHaveBeenCalledWith('d1', 'x/', { actorId: null });
  });
});
