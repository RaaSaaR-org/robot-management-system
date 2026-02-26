/**
 * @file settings.routes.ts
 * @description REST API routes for user settings management
 * @feature user-settings
 */

import { Router, type Request, type Response } from 'express';
import type { AuthenticatedRequest } from '../middleware/auth.middleware.js';
import { settingsService } from '../services/SettingsService.js';

export const settingsRoutes = Router();

// ============================================================================
// GET /api/settings — Get current user settings
// ============================================================================

settingsRoutes.get('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthenticatedRequest).user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const settings = await settingsService.getSettings(userId);
    res.json(settings);
  } catch (error) {
    console.error('Error getting settings:', error);
    res.status(500).json({ error: 'Failed to get settings' });
  }
});

// ============================================================================
// PUT /api/settings — Update current user settings
// ============================================================================

settingsRoutes.put('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthenticatedRequest).user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const settings = await settingsService.updateSettings(userId, req.body);
    res.json(settings);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';

    if (message.startsWith('Invalid') || message.startsWith('refresh')) {
      return res.status(400).json({ error: message });
    }

    console.error('Error updating settings:', error);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// ============================================================================
// POST /api/settings/reset — Reset to defaults
// ============================================================================

settingsRoutes.post('/reset', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthenticatedRequest).user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const settings = await settingsService.resetSettings(userId);
    res.json(settings);
  } catch (error) {
    console.error('Error resetting settings:', error);
    res.status(500).json({ error: 'Failed to reset settings' });
  }
});
