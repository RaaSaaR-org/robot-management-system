/**
 * @file auth-middleware.test.ts
 * @description Tests for the auth middleware
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// We test the middleware behavior by checking the ENV-based bypass
// and the token extraction logic directly

describe('Auth Middleware', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('with AUTH_DISABLED=true', () => {
    it('allows requests without token and injects mock user', async () => {
      process.env.AUTH_DISABLED = 'true';

      // Dynamically import to pick up env changes
      const { authMiddleware } = await import('../middleware/auth.middleware.js');

      const app = express();
      app.use(express.json());
      app.get('/test', authMiddleware, (req: any, res) => {
        res.json({ user: req.user });
      });

      const res = await request(app).get('/test');

      expect(res.status).toBe(200);
      expect(res.body.user).toBeDefined();
      expect(res.body.user.email).toBe('dev@neodem.local');
      expect(res.body.user.role).toBe('super-admin');
    });
  });

  describe('with AUTH_DISABLED=false', () => {
    it('returns 401 when no token is provided', async () => {
      process.env.AUTH_DISABLED = 'false';

      const { authMiddleware } = await import('../middleware/auth.middleware.js');

      const app = express();
      app.use(express.json());
      app.get('/test', authMiddleware, (_req, res) => {
        res.json({ ok: true });
      });

      const res = await request(app).get('/test');

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Unauthorized');
    });

    it('returns 401 when invalid token is provided', async () => {
      process.env.AUTH_DISABLED = 'false';

      const { authMiddleware } = await import('../middleware/auth.middleware.js');

      const app = express();
      app.use(express.json());
      app.get('/test', authMiddleware, (_req, res) => {
        res.json({ ok: true });
      });

      const res = await request(app)
        .get('/test')
        .set('Authorization', 'Bearer invalid-token-here');

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Unauthorized');
    });
  });

  describe('roleMiddleware', () => {
    it('allows request in dev mode (AUTH_DISABLED=true)', async () => {
      process.env.AUTH_DISABLED = 'true';

      const { authMiddleware, roleMiddleware } = await import('../middleware/auth.middleware.js');

      const app = express();
      app.use(express.json());
      app.get('/admin', authMiddleware, roleMiddleware('owner'), (_req, res) => {
        res.json({ ok: true });
      });

      const res = await request(app).get('/admin');
      expect(res.status).toBe(200);
    });
  });

  describe('optionalAuthMiddleware', () => {
    it('allows requests without token in dev mode', async () => {
      process.env.AUTH_DISABLED = 'true';

      const { optionalAuthMiddleware } = await import('../middleware/auth.middleware.js');

      const app = express();
      app.use(express.json());
      app.get('/test', optionalAuthMiddleware, (req: any, res) => {
        res.json({ user: req.user ?? null });
      });

      const res = await request(app).get('/test');
      expect(res.status).toBe(200);
      expect(res.body.user).toBeDefined();
    });

    it('allows requests without token when auth enabled', async () => {
      process.env.AUTH_DISABLED = 'false';

      const { optionalAuthMiddleware } = await import('../middleware/auth.middleware.js');

      const app = express();
      app.use(express.json());
      app.get('/test', optionalAuthMiddleware, (req: any, res) => {
        res.json({ user: req.user ?? null });
      });

      const res = await request(app).get('/test');
      expect(res.status).toBe(200);
      expect(res.body.user).toBeNull();
    });
  });
});
