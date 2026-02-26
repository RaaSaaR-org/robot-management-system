/**
 * @file settings-routes.test.ts
 * @description Integration tests for user settings routes
 * @feature user-settings
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Use vi.hoisted so mock objects are available before vi.mock hoisting
const { mockSettingsService } = vi.hoisted(() => ({
  mockSettingsService: {
    getSettings: vi.fn(),
    updateSettings: vi.fn(),
    resetSettings: vi.fn(),
  },
}));

vi.mock('../services/SettingsService.js', () => ({
  settingsService: mockSettingsService,
}));

vi.mock('../middleware/auth.middleware.js', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-123', email: 'test@example.com', name: 'Test', role: 'admin' };
    next();
  },
  AuthenticatedRequest: {},
}));

import { settingsRoutes } from '../routes/settings.routes.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/settings', authMiddleware as any, settingsRoutes);
  return app;
}

const DEFAULT_SETTINGS = {
  id: 'settings-001',
  userId: 'user-123',
  theme: 'system',
  language: 'en',
  compactMode: false,
  emailNotifications: true,
  alertsEnabled: true,
  maintenanceReminders: true,
  weeklyDigest: false,
  defaultDashboardView: 'fleet',
  refreshIntervalSec: 30,
  createdAt: '2026-02-26T00:00:00.000Z',
  updatedAt: '2026-02-26T00:00:00.000Z',
};

describe('Settings Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  // --------------------------------------------------------------------------
  // GET /api/settings
  // --------------------------------------------------------------------------

  describe('GET /api/settings', () => {
    it('returns user settings (creates defaults if missing)', async () => {
      mockSettingsService.getSettings.mockResolvedValue(DEFAULT_SETTINGS);

      const response = await request(app).get('/api/settings');

      expect(response.status).toBe(200);
      expect(response.body.theme).toBe('system');
      expect(response.body.language).toBe('en');
      expect(response.body.refreshIntervalSec).toBe(30);
      expect(mockSettingsService.getSettings).toHaveBeenCalledWith('user-123');
    });

    it('returns 500 on service error', async () => {
      mockSettingsService.getSettings.mockRejectedValue(new Error('DB error'));

      const response = await request(app).get('/api/settings');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get settings');
    });
  });

  // --------------------------------------------------------------------------
  // PUT /api/settings
  // --------------------------------------------------------------------------

  describe('PUT /api/settings', () => {
    it('updates settings successfully', async () => {
      const updated = { ...DEFAULT_SETTINGS, theme: 'dark', compactMode: true };
      mockSettingsService.updateSettings.mockResolvedValue(updated);

      const response = await request(app)
        .put('/api/settings')
        .send({ theme: 'dark', compactMode: true });

      expect(response.status).toBe(200);
      expect(response.body.theme).toBe('dark');
      expect(response.body.compactMode).toBe(true);
      expect(mockSettingsService.updateSettings).toHaveBeenCalledWith('user-123', {
        theme: 'dark',
        compactMode: true,
      });
    });

    it('returns 400 for invalid theme value', async () => {
      mockSettingsService.updateSettings.mockRejectedValue(
        new Error('Invalid theme. Must be one of: light, dark, system')
      );

      const response = await request(app)
        .put('/api/settings')
        .send({ theme: 'neon' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid theme');
    });

    it('returns 400 for invalid language value', async () => {
      mockSettingsService.updateSettings.mockRejectedValue(
        new Error('Invalid language. Must be one of: en, de, fr, es, ja')
      );

      const response = await request(app)
        .put('/api/settings')
        .send({ language: 'klingon' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid language');
    });

    it('returns 400 for invalid dashboard view', async () => {
      mockSettingsService.updateSettings.mockRejectedValue(
        new Error('Invalid dashboard view. Must be one of: fleet, robots, training')
      );

      const response = await request(app)
        .put('/api/settings')
        .send({ defaultDashboardView: 'nonexistent' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid dashboard view');
    });

    it('returns 400 for invalid refreshIntervalSec', async () => {
      mockSettingsService.updateSettings.mockRejectedValue(
        new Error('refreshIntervalSec must be between 5 and 300')
      );

      const response = await request(app)
        .put('/api/settings')
        .send({ refreshIntervalSec: 1 });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('refreshIntervalSec');
    });

    it('returns 500 on unexpected service error', async () => {
      mockSettingsService.updateSettings.mockRejectedValue(new Error('DB connection lost'));

      const response = await request(app)
        .put('/api/settings')
        .send({ theme: 'dark' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to update settings');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/settings/reset
  // --------------------------------------------------------------------------

  describe('POST /api/settings/reset', () => {
    it('resets settings to defaults', async () => {
      mockSettingsService.resetSettings.mockResolvedValue(DEFAULT_SETTINGS);

      const response = await request(app).post('/api/settings/reset');

      expect(response.status).toBe(200);
      expect(response.body.theme).toBe('system');
      expect(response.body.weeklyDigest).toBe(false);
      expect(mockSettingsService.resetSettings).toHaveBeenCalledWith('user-123');
    });

    it('returns 500 on service error', async () => {
      mockSettingsService.resetSettings.mockRejectedValue(new Error('DB error'));

      const response = await request(app).post('/api/settings/reset');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to reset settings');
    });
  });
});
