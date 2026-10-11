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

  it('passes a taken name through as 409', async () => {
    svc.createRobotConfiguration.mockRejectedValue(new svc.DatasetExpectationError('taken', 409, 'ROBOT_TYPE_EXISTS'));
    const res = await request(createApp()).post('/api/datasets/robot-types')
      .send({ name: 'Unitree_G1', actionDim: 43, proprioceptionDim: 43 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ROBOT_TYPE_EXISTS');
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
    expect(svc.auditDatasetAction).toHaveBeenCalledWith('d1', 'dataset.revalidate', null, expect.any(Object));
  });
});
