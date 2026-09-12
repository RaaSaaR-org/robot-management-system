/**
 * @file field-operations-role-routing.test.ts
 * @description Real application routing protects zone, tour and patrol writes from viewers.
 * @feature auth
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../app.js';
import { zoneService } from '../services/ZoneService.js';
import { tourService } from '../services/TourService.js';
import { patrolService } from '../services/PatrolService.js';
import { patrolPhotoStore } from '../services/PatrolPhotoStore.js';
import * as serviceAccounts from '../services/ServiceAccountService.js';

const app = createApp();
function token(role: string) {
  return jwt.sign(
    { userId: 'role-test-user', email: 'roles@example.com', name: 'Role Test', role },
    process.env.JWT_SECRET!,
    { expiresIn: '1h' },
  );
}

beforeEach(() => {
  vi.stubEnv('AUTH_DISABLED', 'false');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const writes = [
  { method: 'post', path: '/api/zones', spy: () => vi.spyOn(zoneService, 'createZone') },
  { method: 'put', path: '/api/zones/zone-1', spy: () => vi.spyOn(zoneService, 'updateZone') },
  { method: 'delete', path: '/api/zones/zone-1', spy: () => vi.spyOn(zoneService, 'deleteZone') },
  { method: 'delete', path: '/api/zones/floor/1', spy: () => vi.spyOn(zoneService, 'deleteZonesByFloor') },
  { method: 'post', path: '/api/tour/routes', spy: () => vi.spyOn(tourService, 'createRoute') },
  { method: 'put', path: '/api/tour/routes/route-1', spy: () => vi.spyOn(tourService, 'updateRoute') },
  { method: 'delete', path: '/api/tour/routes/route-1', spy: () => vi.spyOn(tourService, 'deleteRoute') },
  { method: 'post', path: '/api/tour/routes/route-1/start', spy: () => vi.spyOn(tourService, 'startRun') },
  { method: 'post', path: '/api/tour/routes/route-1/abort', spy: () => vi.spyOn(tourService, 'abortRun') },
  { method: 'post', path: '/api/patrol/routes', spy: () => vi.spyOn(patrolService, 'createRoute') },
  { method: 'put', path: '/api/patrol/routes/route-1', spy: () => vi.spyOn(patrolService, 'updateRoute') },
  { method: 'delete', path: '/api/patrol/routes/route-1', spy: () => vi.spyOn(patrolService, 'deleteRoute') },
  { method: 'post', path: '/api/patrol/routes/route-1/start', spy: () => vi.spyOn(patrolService, 'startRun') },
  { method: 'post', path: '/api/patrol/routes/route-1/abort', spy: () => vi.spyOn(patrolService, 'abortRun') },
  { method: 'post', path: '/api/patrol/runs/run-1/promote', spy: () => vi.spyOn(patrolService, 'promoteRun') },
  { method: 'post', path: '/api/patrol/findings/finding-1/acknowledge', spy: () => vi.spyOn(patrolService, 'acknowledgeFinding') },
  { method: 'post', path: '/api/patrol/findings/finding-1/normal', spy: () => vi.spyOn(patrolService, 'markFindingNormal') },
  { method: 'post', path: '/api/patrol/findings/finding-1/escalate', spy: () => vi.spyOn(patrolService, 'escalateFinding') },
  { method: 'post', path: '/api/robots/robot-1/agent-mode/patrol', spy: () => vi.spyOn(patrolService, 'startRun') },
  { method: 'post', path: '/api/robots/robot-1/agent-mode/patrol/abort', spy: () => vi.spyOn(patrolService, 'abortOnRobot') },
  { method: 'put', path: '/api/robots/robot-1/patrol-runs/run-1/photos/control.jpg', spy: () => vi.spyOn(patrolPhotoStore, 'put') },
] as const;

describe.each(writes)('$method $path', ({ method, path, spy }) => {
  it('rejects a viewer before any write or robot command', async () => {
    const operation = spy();
    const result = await request(app)[method](path)
      .set('Authorization', `Bearer ${token('viewer')}`).send({});
    expect(result.status).toBe(403);
    expect(result.body.message).toBe('Insufficient permissions');
    expect(operation).not.toHaveBeenCalled();
  });

  it.each(path.startsWith('/api/zones') ? ['owner', 'super-admin'] : ['member', 'owner', 'super-admin'])('allows %s to reach the operation', async (role) => {
    const operation = spy().mockResolvedValue({
      unreachable: false, result: { ok: true }, key: 'control.jpg', kind: 'control', size: 1,
    } as never);
    const result = await request(app)[method](path)
      .set('Authorization', `Bearer ${token(role)}`)
      .send({ routeId: 'route-1', imageB64: 'YQ==' });
    expect(result.status).toBeGreaterThanOrEqual(200);
    expect(result.status).toBeLessThan(300);
    expect(operation).toHaveBeenCalledOnce();
  });
});

it('accepts robot photo callbacks from an authenticated member service account', async () => {
  vi.spyOn(serviceAccounts, 'authenticateServiceToken').mockResolvedValue({
    userId: 'robot-service', email: 'robot@service.local', name: 'Robot service',
    role: 'member', tenantId: null, tokenId: 'token-1',
  });
  const upload = vi.spyOn(patrolPhotoStore, 'put').mockResolvedValue({
    key: 'control.jpg', kind: 'control', size: 1,
  } as never);
  const result = await request(app)
    .put('/api/robots/robot-1/patrol-runs/run-1/photos/control.jpg')
    .set('Authorization', 'Bearer ndsa_test-member-service-token')
    .send({ imageB64: 'YQ==' });
  expect(result.status).toBe(200);
  expect(upload).toHaveBeenCalledOnce();
});

it('rejects zone mutations by members', async () => {
  for (const { method, path, spy } of writes.filter(({ path }) => path.startsWith('/api/zones'))) {
    const operation = spy();
    const result = await request(app)[method](path)
      .set('Authorization', `Bearer ${token('member')}`).send({});
    expect(result.status).toBe(403);
    expect(operation).not.toHaveBeenCalled();
  }
});

it('lets viewers read zones, tour routes, patrol routes and validate a schedule', async () => {
  vi.spyOn(zoneService, 'getZones').mockResolvedValue({ zones: [], total: 0 } as never);
  vi.spyOn(tourService, 'listRoutes').mockResolvedValue([]);
  vi.spyOn(patrolService, 'listRoutes').mockResolvedValue([]);
  for (const path of ['/api/zones', '/api/tour/routes', '/api/patrol/routes']) {
    const result = await request(app).get(path).set('Authorization', `Bearer ${token('viewer')}`);
    expect(result.status).toBe(200);
  }
  const result = await request(app).post('/api/patrol/cron/validate')
    .set('Authorization', `Bearer ${token('viewer')}`).send({ cronExpression: '0 9 * * *' });
  expect(result.status).toBe(200);
  expect(result.body.valid).toBe(true);
});
