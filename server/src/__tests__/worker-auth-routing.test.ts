/**
 * @file worker-auth-routing.test.ts
 * @description Real application routing for shared-token training/twin workers.
 * @feature vla
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../app.js';
import { trainingOrchestrator } from '../services/TrainingOrchestrator.js';
import { digitalTwinService } from '../services/DigitalTwinService.js';

const app = createApp();
const workerToken = 'test-worker-routing-secret';
const endpoints = ['/api/training/workers/claim', '/api/twin/workers/claim'];
let humanToken: string;

beforeAll(() => {
  humanToken = jwt.sign(
    { userId: 'routing-user', email: 'routing@example.com', name: 'Routing User', role: 'member' },
    process.env.JWT_SECRET!,
    { expiresIn: '1h' },
  );
});
beforeEach(() => {
  vi.stubEnv('AUTH_DISABLED', 'false');
  vi.stubEnv('WORKER_API_TOKEN', workerToken);
  vi.spyOn(trainingOrchestrator, 'claimNextPendingJob').mockResolvedValue(null);
  vi.spyOn(digitalTwinService, 'claimNextPendingJob').mockResolvedValue(null);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe.each(endpoints)('%s through createApp', (endpoint) => {
  it('accepts the configured worker credential and reaches the real claim handler', async () => {
    const result = await request(app).post(endpoint)
      .set('Authorization', `Bearer ${workerToken}`).send({ workerId: 'demo-worker' });
    expect(result.status).toBe(204);
    if (endpoint.includes('/training/')) {
      expect(trainingOrchestrator.claimNextPendingJob).toHaveBeenCalledWith('demo-worker', undefined, ['supervised'], []);
    } else {
      expect(digitalTwinService.claimNextPendingJob).toHaveBeenCalledWith('demo-worker');
    }
  });

  it('rejects absent and incorrect credentials before dispatching', async () => {
    expect((await request(app).post(endpoint).send({ workerId: 'demo-worker' })).status).toBe(401);
    expect((await request(app).post(endpoint).set('Authorization', 'Bearer incorrect').send({ workerId: 'demo-worker' })).status).toBe(403);
    expect(trainingOrchestrator.claimNextPendingJob).not.toHaveBeenCalled();
    expect(digitalTwinService.claimNextPendingJob).not.toHaveBeenCalled();
  });

  it('requires regular authentication when no shared token is configured', async () => {
    vi.stubEnv('WORKER_API_TOKEN', '');
    expect((await request(app).post(endpoint).send({ workerId: 'demo-worker' })).status).toBe(401);
    expect((await request(app).post(endpoint).set('Authorization', `Bearer ${humanToken}`).send({ workerId: 'demo-worker' })).status).toBe(204);
  });

  it('retains the explicit development auth bypass', async () => {
    vi.stubEnv('AUTH_DISABLED', 'true');
    expect((await request(app).post(endpoint).send({ workerId: 'demo-worker' })).status).toBe(204);
  });
});

it('does not grant worker credentials access to ordinary management endpoints', async () => {
  for (const endpoint of ['/api/training/jobs', '/api/training/workers', '/api/robots']) {
    const result = await request(app).get(endpoint).set('Authorization', `Bearer ${workerToken}`);
    expect(result.status).toBe(401);
  }
});

it('keeps the worker monitoring page accessible with normal user authentication', async () => {
  vi.spyOn(trainingOrchestrator, 'listWorkers').mockResolvedValue({ workers: [], queuedJobs: 0, runningJobs: 0 });
  const result = await request(app).get('/api/training/workers').set('Authorization', `Bearer ${humanToken}`);
  expect(result.status).toBe(200);
  expect(trainingOrchestrator.listWorkers).toHaveBeenCalledOnce();
});

it.each(['heartbeat', 'progress', 'complete', 'failed', 'checkpoint'])(
  'dispatches the documented training worker /%s callback', async (callback) => {
    const result = await request(app).post(`/api/training/workers/${callback}`)
      .set('Authorization', `Bearer ${workerToken}`).send({});
    expect(result.status).toBe(400);
    expect(result.body.error).toBe('jobId is required');
  },
);
