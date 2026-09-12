/**
 * @file agent-endpoints-auth.test.ts
 * @description The four prefixes a robot agent talks to refuse an
 *              unauthenticated request when auth is ON (TASK-292).
 * @feature core
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

/**
 * These run with AUTH_DISABLED=false, like `camera-stream-ticket.test.ts`: the
 * suite's global default is `true`, which waves every one of these through, and
 * that default is exactly why four agent clients shipped with no credential at
 * all. The middleware reads the env at call time, but `authService` captures
 * JWT_SECRET at import, so every test re-imports after setting the env.
 */
const SECRET = 'test-secret-for-agent-endpoints';

/** The prefixes `app.ts` mounts behind `authMiddleware`, and the agent calls. */
const PREFIXES = ['/api/zones', '/api/updates', '/api/processes', '/api/robots'] as const;

/** The real middleware in front of stub routers — the mount shape from `app.ts`. */
async function mountApp() {
  const { authMiddleware } = await import('../middleware/auth.middleware.js');
  const app = express();
  for (const prefix of PREFIXES) {
    const router = express.Router();
    router.get('/', (_req, res) => {
      res.json({ ok: true, prefix });
    });
    // The one write a robot makes on its own, unprompted: TaskQueue's status
    // report (`PUT /api/processes/tasks/:id/status`).
    router.put('/tasks/:id/status', (_req, res) => {
      res.json({ ok: true, mutated: true });
    });
    app.use(prefix, authMiddleware, router);
  }
  return app;
}

function mintToken(jwt: typeof import('jsonwebtoken')): string {
  return jwt.sign(
    { userId: 'svc-1', email: 'agent@neodem.local', name: 'Agent', role: 'operator', tenantId: 'tenant-a' },
    SECRET,
    { expiresIn: '15m' }
  );
}

describe('the agent-facing endpoints, with auth ON', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env.AUTH_DISABLED = 'false';
    process.env.JWT_SECRET = SECRET;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it.each(PREFIXES)('refuses %s with no Authorization header', async (prefix) => {
    const app = await mountApp();

    const res = await request(app).get(prefix);

    expect(res.status).toBe(401);
  });

  it('refuses the task status report the robot PUTs after every task', async () => {
    const app = await mountApp();

    const res = await request(app)
      .put('/api/processes/tasks/task-1/status')
      .send({ status: 'executing' });

    expect(res.status).toBe(401);
  });

  it('lets the same requests through once they carry a bearer token', async () => {
    // Without this the 401s above would still pass if the mount were broken.
    const app = await mountApp();
    const jwt = (await import('jsonwebtoken')).default;
    const token = mintToken(jwt);

    for (const prefix of PREFIXES) {
      const res = await request(app).get(prefix).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
    }
  });
});
