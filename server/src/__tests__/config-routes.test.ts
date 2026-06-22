/**
 * @file config-routes.test.ts
 * @description Integration tests for the public feature-flag config routes
 * @feature config
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Use vi.hoisted so mock fns are available before vi.mock hoisting
const { mockGetFeatureFlags } = vi.hoisted(() => ({
  mockGetFeatureFlags: vi.fn(),
}));

vi.mock('../config/features.js', () => ({
  getFeatureFlags: mockGetFeatureFlags,
}));

vi.mock('../middleware/auth.middleware.js', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-123', email: 'test@example.com', name: 'Test', role: 'admin' };
    next();
  },
  AuthenticatedRequest: {},
}));

import { configRoutes } from '../routes/config.routes.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

// config.routes is mounted at /api/config in src/app.ts. It is mounted WITHOUT
// auth in production (public, pre-login feature gating), but we wire the
// canonical pass-through authMiddleware here to mirror the template structure.
function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/config', authMiddleware as any, configRoutes);
  return app;
}

const DEFAULT_FLAGS = {
  multiTenancyEnabled: false,
  natsEnabled: false,
  rustfsEnabled: false,
};

describe('Config Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  // --------------------------------------------------------------------------
  // GET /api/config/features
  // --------------------------------------------------------------------------

  describe('GET /api/config/features', () => {
    it('returns the feature flag snapshot', async () => {
      mockGetFeatureFlags.mockReturnValue(DEFAULT_FLAGS);

      const response = await request(app).get('/api/config/features');

      expect(response.status).toBe(200);
      expect(response.body).toEqual(DEFAULT_FLAGS);
      expect(response.body.multiTenancyEnabled).toBe(false);
      expect(response.body.natsEnabled).toBe(false);
      expect(response.body.rustfsEnabled).toBe(false);
      expect(mockGetFeatureFlags).toHaveBeenCalledTimes(1);
    });

    it('reflects enabled flags when the subsystem flags are on', async () => {
      mockGetFeatureFlags.mockReturnValue({
        multiTenancyEnabled: true,
        natsEnabled: true,
        rustfsEnabled: true,
      });

      const response = await request(app).get('/api/config/features');

      expect(response.status).toBe(200);
      expect(response.body.multiTenancyEnabled).toBe(true);
      expect(response.body.natsEnabled).toBe(true);
      expect(response.body.rustfsEnabled).toBe(true);
      expect(mockGetFeatureFlags).toHaveBeenCalledTimes(1);
    });
  });
});
