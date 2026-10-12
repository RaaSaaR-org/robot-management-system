/**
 * @file authRateLimit.test.ts
 * @description The strict auth limiter counts credential attempts only; session
 *   upkeep under /api/auth is never answered 429 by it (TASK-362).
 * @feature auth
 */

import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createAuthLimiter, isCredentialAuthRequest } from '../authRateLimit.js';

function appWithLimiter(max = 5) {
  const app = express();
  const auth = express.Router();
  for (const path of ['/login', '/register', '/forgot-password', '/reset-password', '/change-password', '/refresh', '/logout']) {
    auth.post(path, (_req, res) => res.json({ ok: true }));
  }
  auth.get('/me', (_req, res) => res.json({ ok: true }));
  auth.get('/mfa/status', (_req, res) => res.json({ ok: true }));
  app.use('/api/auth', createAuthLimiter({ max }), auth);
  return app;
}

describe('createAuthLimiter', () => {
  it('429s the sixth login within a window', async () => {
    const app = appWithLimiter();
    for (let i = 0; i < 5; i++) {
      await request(app).post('/api/auth/login').expect(200);
    }
    await request(app).post('/api/auth/login').expect(429);
  });

  it('counts every credential endpoint against the same budget', async () => {
    const app = appWithLimiter(2);
    await request(app).post('/api/auth/register').expect(200);
    await request(app).post('/api/auth/forgot-password').expect(200);
    await request(app).post('/api/auth/reset-password').expect(429);
  });

  it('never limits /me, /refresh, /logout or /mfa/status', async () => {
    const app = appWithLimiter(1);
    for (let i = 0; i < 20; i++) {
      await request(app).get('/api/auth/me').expect(200);
      await request(app).post('/api/auth/refresh').expect(200);
      await request(app).post('/api/auth/logout').expect(200);
      await request(app).get('/api/auth/mfa/status').expect(200);
    }
    // ...and that traffic did not consume the credential budget.
    await request(app).post('/api/auth/login').expect(200);
  });

  it('is off when disabled', async () => {
    const app = express();
    app.use('/api/auth', createAuthLimiter({ max: 1, disabled: true }), (_req, res) => res.json({}));
    await request(app).post('/api/auth/login').expect(200);
    await request(app).post('/api/auth/login').expect(200);
  });
});

describe('isCredentialAuthRequest', () => {
  it('matches credential paths, with or without a trailing slash', () => {
    expect(isCredentialAuthRequest('/login')).toBe(true);
    expect(isCredentialAuthRequest('/login/')).toBe(true);
    expect(isCredentialAuthRequest('/me')).toBe(false);
    expect(isCredentialAuthRequest('/refresh')).toBe(false);
    expect(isCredentialAuthRequest('/')).toBe(false);
  });
});
