/**
 * @file signInRequired.test.ts
 * @description TASK-483: the public feature snapshot says whether a browser has
 *              to sign in, and the shared user of a sign-in-free server carries
 *              a presentable name outside development.
 * @feature config
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { getFeatureFlags, signInRequired } from '../features.js';
import { anonymousUserName } from '../anonymousUser.js';
import { configRoutes } from '../../routes/config.routes.js';
import { authMiddleware, type AuthenticatedRequest } from '../../middleware/auth.middleware.js';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  delete process.env.AUTH_DISABLED;
  delete process.env.ANONYMOUS_USER_NAME;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('signInRequired', () => {
  it.each([
    [undefined, true],
    ['false', true],
    ['1', true], // only the literal "true" turns sign-in off, as in authMiddleware
    ['true', false],
  ])('AUTH_DISABLED=%s → %s', (value, expected) => {
    if (value !== undefined) process.env.AUTH_DISABLED = value;
    expect(signInRequired()).toBe(expected);
    expect(getFeatureFlags().signInRequired).toBe(expected);
  });

  it('is served by the public /api/config/features, booleans only', async () => {
    process.env.AUTH_DISABLED = 'true';
    process.env.ANONYMOUS_USER_NAME = 'Booth visitor';
    const app = express();
    app.use('/api/config', configRoutes);

    const response = await request(app).get('/api/config/features');

    expect(response.status).toBe(200);
    expect(response.body.signInRequired).toBe(false);
    for (const value of Object.values(response.body)) expect(typeof value).toBe('boolean');
  });
});

describe('anonymousUserName', () => {
  it('is "Dev User" in development and "Demo user" in a production build', () => {
    expect(anonymousUserName({ NODE_ENV: 'development' })).toBe('Dev User');
    expect(anonymousUserName({})).toBe('Dev User');
    expect(anonymousUserName({ NODE_ENV: 'production' })).toBe('Demo user');
  });

  it('takes ANONYMOUS_USER_NAME over either default, trimmed and capped', () => {
    expect(anonymousUserName({ NODE_ENV: 'production', ANONYMOUS_USER_NAME: '  Booth visitor ' })).toBe('Booth visitor');
    expect(anonymousUserName({ NODE_ENV: 'production', ANONYMOUS_USER_NAME: '   ' })).toBe('Demo user');
    expect(anonymousUserName({ ANONYMOUS_USER_NAME: 'x'.repeat(200) })).toHaveLength(60);
  });

  it('names the user authMiddleware injects when sign-in is off', async () => {
    process.env.AUTH_DISABLED = 'true';
    process.env.NODE_ENV = 'production';
    const req = { headers: {} } as AuthenticatedRequest;
    await authMiddleware(req, {} as never, () => undefined);
    expect(req.user).toMatchObject({ id: 'dev-user-id', name: 'Demo user', role: 'super-admin' });

    process.env.ANONYMOUS_USER_NAME = 'Booth visitor';
    const again = { headers: {} } as AuthenticatedRequest;
    await authMiddleware(again, {} as never, () => undefined);
    expect(again.user?.name).toBe('Booth visitor');
  });
});
