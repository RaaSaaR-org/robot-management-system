/**
 * @file gdpr-retention-role-routing.test.ts
 * @description Real application routing keeps GDPR administration with owners
 * and the platform-wide retention policy with super-admins (TASK-383).
 * @feature auth
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../app.js';
import { gdprRequestService } from '../services/GDPRRequestService.js';
import { retentionPolicyService } from '../services/RetentionPolicyService.js';
import { retentionCleanupJob } from '../jobs/RetentionCleanupJob.js';

const app = createApp();
function token(role: string) {
  return jwt.sign(
    { userId: 'role-test-user', email: 'roles@example.com', name: 'Role Test', role, tenantId: 'tenant-a' },
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

describe('GET /api/gdpr/admin/metrics', () => {
  it.each(['viewer', 'member'])('refuses a %s', async (role) => {
    const metrics = vi.spyOn(gdprRequestService, 'getMetrics');
    const result = await request(app)
      .get('/api/gdpr/admin/metrics')
      .set('Authorization', `Bearer ${token(role)}`);
    expect(result.status).toBe(403);
    expect(metrics).not.toHaveBeenCalled();
  });

  it('confines an owner to their tenant', async () => {
    const metrics = vi.spyOn(gdprRequestService, 'getMetrics').mockResolvedValue({} as never);
    const result = await request(app)
      .get('/api/gdpr/admin/metrics')
      .set('Authorization', `Bearer ${token('owner')}`);
    expect(result.status).toBe(200);
    expect(metrics).toHaveBeenCalledWith({ tenantId: 'tenant-a' });
  });

  it('leaves a super-admin platform-wide', async () => {
    const metrics = vi.spyOn(gdprRequestService, 'getMetrics').mockResolvedValue({} as never);
    const result = await request(app)
      .get('/api/gdpr/admin/metrics')
      .set('Authorization', `Bearer ${token('super-admin')}`);
    expect(result.status).toBe(200);
    expect(metrics).toHaveBeenCalledWith(undefined);
  });
});

it('refuses a member a GDPR admin status change before any lookup', async () => {
  const lookup = vi.spyOn(gdprRequestService, 'getRequest');
  const result = await request(app)
    .post('/api/gdpr/admin/requests/req-1/reject')
    .set('Authorization', `Bearer ${token('member')}`)
    .send({ reason: 'x' });
  expect(result.status).toBe(403);
  expect(lookup).not.toHaveBeenCalled();
});

const retentionWrites = [
  { method: 'put', path: '/api/compliance/retention/access_audit', spy: () => vi.spyOn(retentionPolicyService, 'setPolicy') },
  { method: 'delete', path: '/api/compliance/retention/access_audit', spy: () => vi.spyOn(retentionPolicyService, 'deletePolicy') },
  { method: 'post', path: '/api/compliance/retention/cleanup', spy: () => vi.spyOn(retentionCleanupJob, 'runCleanup') },
] as const;

describe.each(retentionWrites)('$method $path', ({ method, path, spy }) => {
  it.each(['member', 'owner'])('refuses a tenant %s', async (role) => {
    const operation = spy();
    const result = await request(app)[method](path)
      .set('Authorization', `Bearer ${token(role)}`)
      .send({ retentionDays: 1 });
    expect(result.status).toBe(403);
    expect(result.body.message).toBe('Insufficient permissions');
    expect(operation).not.toHaveBeenCalled();
  });

  it('lets a super-admin through', async () => {
    const operation = spy().mockResolvedValue({ deleted: 0 } as never);
    vi.spyOn(retentionPolicyService, 'getPolicy').mockResolvedValue({} as never);
    const result = await request(app)[method](path)
      .set('Authorization', `Bearer ${token('super-admin')}`)
      .send({ retentionDays: 365 });
    expect(result.status).toBe(200);
    expect(operation).toHaveBeenCalledOnce();
  });
});
