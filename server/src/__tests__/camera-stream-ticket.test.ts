/**
 * @file camera-stream-ticket.test.ts
 * @description What a camera stream ticket can and cannot open (TASK-214).
 * @feature robots
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

/**
 * These run with AUTH_DISABLED=false — the whole point is what happens when
 * auth is ON, and the shipped dev default (`true`) waves everything through.
 * The middleware reads that env at call time, but `authService` captures
 * JWT_SECRET at import, so every test re-imports after setting the env, the way
 * `auth-middleware.test.ts` does.
 */
const SECRET = 'test-secret-for-camera-tickets';

const CLAIMS = {
  robotId: 'robot-001',
  cameraName: 'head_camera',
  userId: 'user-7',
  tenantId: 'tenant-a',
  role: 'operator',
};

async function load() {
  const { cameraStreamTicket, authMiddleware } = await import('../middleware/auth.middleware.js');
  const { signCameraTicket } = await import('../security/cameraTicket.js');
  return { cameraStreamTicket, authMiddleware, signCameraTicket };
}

/**
 * The real mount shape from `app.ts`: the ticket middleware, then auth, then the
 * routes — plus a second router on the same prefix WITHOUT the ticket
 * middleware, which is what `voiceRoutes` and `agentModeRoutes` are.
 */
function mountApp(
  cameraStreamTicket: express.RequestHandler,
  authMiddleware: express.RequestHandler
) {
  const app = express();
  const ticketed = express.Router();
  ticketed.get('/:id/camera/:name', (req, res) => {
    res.json({ ok: true, user: (req as express.Request & { user?: unknown }).user });
  });
  ticketed.post('/:id/camera/:name', (_req, res) => res.json({ ok: true, mutated: true }));

  const unticketed = express.Router();
  unticketed.get('/:id/voice/events', (_req, res) => res.json({ ok: true, voice: true }));

  app.use('/api/robots', cameraStreamTicket, authMiddleware, ticketed);
  app.use('/api/robots', authMiddleware, unticketed);
  return app;
}

describe('the camera stream ticket, with auth ON', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env.AUTH_DISABLED = 'false';
    process.env.JWT_SECRET = SECRET;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('opens the camera it names', async () => {
    const { cameraStreamTicket, authMiddleware, signCameraTicket } = await load();
    const app = mountApp(cameraStreamTicket, authMiddleware);

    const res = await request(app)
      .get('/api/robots/robot-001/camera/head_camera')
      .query({ ticket: signCameraTicket(CLAIMS) });

    expect(res.status).toBe(200);
    // The stream carries the identity of whoever asked for the ticket — not a
    // fabricated superuser. Downstream tenant isolation depends on it.
    expect(res.body.user).toMatchObject({ id: 'user-7', tenantId: 'tenant-a', role: 'operator' });
  });

  it('does not open another robot camera', async () => {
    const { cameraStreamTicket, authMiddleware, signCameraTicket } = await load();
    const app = mountApp(cameraStreamTicket, authMiddleware);

    const res = await request(app)
      .get('/api/robots/robot-002/camera/head_camera')
      .query({ ticket: signCameraTicket(CLAIMS) });

    expect(res.status).toBe(401);
  });

  it('does not open another camera on the same robot', async () => {
    const { cameraStreamTicket, authMiddleware, signCameraTicket } = await load();
    const app = mountApp(cameraStreamTicket, authMiddleware);

    const res = await request(app)
      .get('/api/robots/robot-001/camera/wrist')
      .query({ ticket: signCameraTicket(CLAIMS) });

    expect(res.status).toBe(401);
  });

  it('is refused once it has expired', async () => {
    const { cameraStreamTicket, authMiddleware, signCameraTicket } = await load();
    const app = mountApp(cameraStreamTicket, authMiddleware);
    const ticket = signCameraTicket(CLAIMS, -1_000);

    const res = await request(app)
      .get('/api/robots/robot-001/camera/head_camera')
      .query({ ticket });

    expect(res.status).toBe(401);
  });

  it('is refused on a non-GET, even on the camera path', async () => {
    const { cameraStreamTicket, authMiddleware, signCameraTicket } = await load();
    const app = mountApp(cameraStreamTicket, authMiddleware);

    const res = await request(app)
      .post('/api/robots/robot-001/camera/head_camera')
      .query({ ticket: signCameraTicket(CLAIMS) });

    expect(res.status).toBe(401);
  });

  it('is inert on every other route sharing the /api/robots prefix', async () => {
    // The narrowness property. `voiceRoutes` and `agentModeRoutes` mount on the
    // same prefix without this middleware, and a ticket must buy nothing there.
    // The task recorded this as verified by hand; nothing held it down.
    const { cameraStreamTicket, authMiddleware, signCameraTicket } = await load();
    const app = mountApp(cameraStreamTicket, authMiddleware);
    const ticket = signCameraTicket(CLAIMS);

    const voice = await request(app).get('/api/robots/robot-001/voice/events').query({ ticket });
    expect(voice.status).toBe(401);

    // ...including when the ticket is smuggled through an encoded slash, which
    // would make the path LOOK like the camera path to a laxer matcher.
    const smuggled = await request(app)
      .get('/api/robots/robot-001/camera%2f..%2f..%2fvoice%2fevents')
      .query({ ticket });
    expect(smuggled.status).not.toBe(200);
  });

  it('never overrides a real Authorization header', async () => {
    // A ticket must not be able to downgrade a request that already presented a
    // credential — the ticketed identity is weaker than a bearer one.
    const { cameraStreamTicket, authMiddleware, signCameraTicket } = await load();
    const app = mountApp(cameraStreamTicket, authMiddleware);

    const res = await request(app)
      .get('/api/robots/robot-001/camera/head_camera')
      .set('Authorization', 'Bearer not-a-real-token')
      .query({ ticket: signCameraTicket(CLAIMS) });

    // The header is what gets validated, and it is junk.
    expect(res.status).toBe(401);
  });

  it('refuses a ticket forged with the wrong secret', async () => {
    const { signCameraTicket } = await load();
    const ticket = signCameraTicket(CLAIMS);

    vi.resetModules();
    process.env.JWT_SECRET = 'a-different-secret-entirely';
    const { cameraStreamTicket, authMiddleware } = await import('../middleware/auth.middleware.js');
    const app = mountApp(cameraStreamTicket, authMiddleware);

    const res = await request(app)
      .get('/api/robots/robot-001/camera/head_camera')
      .query({ ticket });

    expect(res.status).toBe(401);
  });

  it('no longer accepts ?access_token=', async () => {
    // The credential this replaced. A URL-borne access token must stop working,
    // or the change bought nothing.
    const { cameraStreamTicket, authMiddleware } = await load();
    const { authService } = await import('../services/AuthService.js');
    const jwt = (await import('jsonwebtoken')).default;
    const app = mountApp(cameraStreamTicket, authMiddleware);
    // A genuinely valid token, minted the way the login route mints one — the
    // test is worthless if the credential it presents is junk.
    const realToken = jwt.sign(
      { userId: 'user-7', email: 'op@neodem.local', name: 'Op', role: 'operator', tenantId: 'tenant-a' },
      SECRET,
      { expiresIn: '15m' }
    );
    expect(authService.verifyAccessToken(realToken)).not.toBeNull();

    const res = await request(app)
      .get('/api/robots/robot-001/camera/head_camera')
      .query({ access_token: realToken });

    expect(res.status).toBe(401);
  });
});
