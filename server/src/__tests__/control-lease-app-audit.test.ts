/**
 * @file control-lease-app-audit.test.ts
 * @description Through the real `createApp()` mount order, a viewer refused a
 *              control-lease write is audited (TASK-317). The first
 *              `/api/robots` mount's `writeRoleGuard` answers that 403, so the
 *              denial audit has to sit ahead of it, not ahead of the lease router.
 * @feature robots
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../app.js';
import { complianceLogService } from '../services/ComplianceLogService.js';

const app = createApp();

function token(role: string): string {
  return jwt.sign(
    { userId: 'lease-viewer', email: 'viewer@example.com', name: 'Viewer', role },
    process.env.JWT_SECRET!,
    { expiresIn: '1h' },
  );
}

beforeEach(() => {
  vi.stubEnv('AUTH_DISABLED', 'false');
  vi.stubEnv('CONTROL_LEASES_ENABLED', 'true');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe.each(['/api/robots/robot-1/control-lease', '/api/robots/robot-1/control-lease/release'])(
  'POST %s as a viewer',
  (path) => {
    it('is 403 and writes exactly one control_lease denial', async () => {
      const logAccess = vi.spyOn(complianceLogService, 'logAccess').mockResolvedValue(undefined as never);
      const res = await request(app)
        .post(path)
        .set('Authorization', `Bearer ${token('viewer')}`)
        .send({ leaseId: 'x', generation: 1 });
      expect(res.status).toBe(403);
      await vi.waitFor(() => expect(logAccess).toHaveBeenCalledTimes(1));
      const entry = logAccess.mock.calls[0][0] as { robotId: string; payload: { resourceType: string; action: string } };
      expect(entry.robotId).toBe('robot-1');
      expect(entry.payload.resourceType).toBe('control_lease');
      expect(entry.payload.action).toBe('deny');
    });
  },
);
