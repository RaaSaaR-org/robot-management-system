/**
 * @file auth-register-gate.test.ts
 * @description TASK-369: with auth on, anonymous self-signup through
 *   POST /api/auth/register is closed unless ALLOW_SELF_REGISTRATION=true, and
 *   /api/config/features reports the same answer so the app can say so.
 * @feature auth
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const { mockAuthService } = vi.hoisted(() => ({
  mockAuthService: { register: vi.fn() },
}));

vi.mock('../../services/AuthService.js', () => ({ authService: mockAuthService }));
vi.mock('../../services/MFAService.js', () => ({ mfaService: {} }));
vi.mock('../../middleware/auth.middleware.js', () => ({
  authMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import { authRoutes } from '../auth.routes.js';
import { getFeatureFlags, selfRegistrationEnabled } from '../../config/features.js';

function authApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  return app;
}

const SIGNUP = { email: 'new@example.com', password: 'Passw0rdy', name: 'Ada' };

describe('POST /api/auth/register gate (TASK-369)', () => {
  beforeEach(() => {
    mockAuthService.register.mockReset();
    mockAuthService.register.mockResolvedValue({ user: { id: 'u1' } });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('refuses anonymous signup when auth is on and the operator did not opt in', async () => {
    vi.stubEnv('AUTH_DISABLED', 'false');
    vi.stubEnv('ALLOW_SELF_REGISTRATION', '');

    const res = await request(authApp()).post('/api/auth/register').send(SIGNUP);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('SELF_REGISTRATION_DISABLED');
    expect(res.body.message).toMatch(/administrator/);
    expect(mockAuthService.register).not.toHaveBeenCalled();
    expect(selfRegistrationEnabled()).toBe(false);
    expect(getFeatureFlags().selfRegistrationEnabled).toBe(false);
  });

  it('allows signup when ALLOW_SELF_REGISTRATION=true', async () => {
    vi.stubEnv('AUTH_DISABLED', 'false');
    vi.stubEnv('ALLOW_SELF_REGISTRATION', 'true');

    const res = await request(authApp()).post('/api/auth/register').send(SIGNUP);

    expect(res.status).toBe(201);
    expect(mockAuthService.register).toHaveBeenCalledWith(SIGNUP.email, SIGNUP.password, SIGNUP.name);
    expect(getFeatureFlags().selfRegistrationEnabled).toBe(true);
  });

  it('keeps signup open in dev mode (AUTH_DISABLED=true)', async () => {
    vi.stubEnv('AUTH_DISABLED', 'true');
    vi.stubEnv('ALLOW_SELF_REGISTRATION', '');

    const res = await request(authApp()).post('/api/auth/register').send(SIGNUP);

    expect(res.status).toBe(201);
    expect(selfRegistrationEnabled()).toBe(true);
  });
});

describe('POST /api/auth/register gate under multi-tenancy (TASK-369)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('stays closed even when ALLOW_SELF_REGISTRATION=true', async () => {
    // MULTI_TENANCY_ENABLED is read once at module load, so re-import fresh.
    vi.stubEnv('MULTI_TENANCY_ENABLED', 'true');
    vi.stubEnv('AUTH_DISABLED', 'false');
    vi.stubEnv('ALLOW_SELF_REGISTRATION', 'true');
    vi.resetModules();
    mockAuthService.register.mockReset();

    const features = await import('../../config/features.js');
    const { authRoutes: mtAuthRoutes } = await import('../auth.routes.js');
    const app = express();
    app.use(express.json());
    app.use('/api/auth', mtAuthRoutes);

    const res = await request(app).post('/api/auth/register').send(SIGNUP);

    expect(features.MULTI_TENANCY_ENABLED).toBe(true);
    expect(res.status).toBe(403);
    // The TASK-162 branch answers first, with its own invite-only wording.
    expect(res.body.message).toMatch(/invite-only/);
    expect(mockAuthService.register).not.toHaveBeenCalled();
    expect(features.selfRegistrationEnabled()).toBe(false);
    expect(features.getFeatureFlags().selfRegistrationEnabled).toBe(false);
  });
});
