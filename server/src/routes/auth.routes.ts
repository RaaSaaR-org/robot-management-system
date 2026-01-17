/**
 * @file auth.routes.ts
 * @description Authentication REST API endpoints
 */

import { Router, type Request, type Response } from 'express';
import { authService } from '../services/AuthService.js';
import {
  authMiddleware,
  type AuthenticatedRequest,
} from '../middleware/auth.middleware.js';

export const authRoutes = Router();

/**
 * POST /register - Register a new user
 */
authRoutes.post('/register', async (req: Request, res: Response) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({
        error: 'Validation error',
        message: 'Email, password, and name are required',
      });
    }

    const result = await authService.register(email, password, name);

    res.status(201).json(result);
  } catch (error) {
    console.error('Registration error:', error);
    const message = error instanceof Error ? error.message : 'Registration failed';

    if (message.includes('already registered')) {
      return res.status(409).json({ error: 'Conflict', message });
    }

    if (message.includes('Invalid') || message.includes('must be')) {
      return res.status(400).json({ error: 'Validation error', message });
    }

    res.status(500).json({ error: 'Internal error', message: 'Registration failed' });
  }
});

/**
 * POST /login - Login with email and password
 */
authRoutes.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        error: 'Validation error',
        message: 'Email and password are required',
      });
    }

    const result = await authService.login(email, password);

    res.json(result);
  } catch (error) {
    console.error('Login error:', error);
    const message = error instanceof Error ? error.message : 'Login failed';

    if (message.includes('Invalid') || message.includes('deactivated')) {
      return res.status(401).json({ error: 'Unauthorized', message });
    }

    res.status(500).json({ error: 'Internal error', message: 'Login failed' });
  }
});

/**
 * POST /logout - Logout and invalidate refresh token
 */
authRoutes.post(
  '/logout',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { refreshToken } = req.body;

      if (!req.user) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Not authenticated',
        });
      }

      await authService.logout(req.user.id, refreshToken);

      res.json({ message: 'Logged out successfully' });
    } catch (error) {
      console.error('Logout error:', error);
      res.status(500).json({ error: 'Internal error', message: 'Logout failed' });
    }
  }
);

/**
 * POST /refresh - Refresh access token
 */
authRoutes.post('/refresh', async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        error: 'Validation error',
        message: 'Refresh token is required',
      });
    }

    const result = await authService.refreshTokens(refreshToken);

    res.json(result);
  } catch (error) {
    console.error('Token refresh error:', error);
    const message = error instanceof Error ? error.message : 'Token refresh failed';

    if (message.includes('Invalid') || message.includes('expired')) {
      return res.status(401).json({ error: 'Unauthorized', message });
    }

    if (message.includes('deactivated')) {
      return res.status(403).json({ error: 'Forbidden', message });
    }

    res.status(500).json({ error: 'Internal error', message: 'Token refresh failed' });
  }
});

/**
 * GET /me - Get current user
 */
authRoutes.get(
  '/me',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Not authenticated',
        });
      }

      // When auth is disabled, return mock user directly (no DB lookup)
      if (process.env.AUTH_DISABLED === 'true') {
        return res.json({
          id: req.user.id,
          email: req.user.email,
          name: req.user.name,
          role: req.user.role,
          isActive: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }

      const user = await authService.getCurrentUser(req.user.id);

      res.json(user);
    } catch (error) {
      console.error('Get current user error:', error);
      const message = error instanceof Error ? error.message : 'Failed to get user';

      if (message.includes('not found')) {
        return res.status(404).json({ error: 'Not found', message });
      }

      res.status(500).json({ error: 'Internal error', message: 'Failed to get user' });
    }
  }
);

/**
 * POST /forgot-password - Request password reset
 */
authRoutes.post('/forgot-password', async (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        error: 'Validation error',
        message: 'Email is required',
      });
    }

    const result = await authService.forgotPassword(email);

    res.json(result);
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({
      error: 'Internal error',
      message: 'Failed to process password reset request',
    });
  }
});

/**
 * POST /reset-password - Reset password with token
 */
authRoutes.post('/reset-password', async (req: Request, res: Response) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({
        error: 'Validation error',
        message: 'Token and password are required',
      });
    }

    await authService.resetPassword(token, password);

    res.json({ message: 'Password reset successfully' });
  } catch (error) {
    console.error('Reset password error:', error);
    const message = error instanceof Error ? error.message : 'Password reset failed';

    if (message.includes('Invalid') || message.includes('expired')) {
      return res.status(400).json({ error: 'Bad request', message });
    }

    if (message.includes('must be')) {
      return res.status(400).json({ error: 'Validation error', message });
    }

    res.status(500).json({ error: 'Internal error', message: 'Password reset failed' });
  }
});

/**
 * POST /change-password - Change password (authenticated)
 */
authRoutes.post(
  '/change-password',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { currentPassword, newPassword } = req.body;

      if (!req.user) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Not authenticated',
        });
      }

      if (!currentPassword || !newPassword) {
        return res.status(400).json({
          error: 'Validation error',
          message: 'Current password and new password are required',
        });
      }

      await authService.changePassword(req.user.id, currentPassword, newPassword);

      res.json({ message: 'Password changed successfully' });
    } catch (error) {
      console.error('Change password error:', error);
      const message = error instanceof Error ? error.message : 'Password change failed';

      if (message.includes('incorrect')) {
        return res.status(401).json({ error: 'Unauthorized', message });
      }

      if (message.includes('must be')) {
        return res.status(400).json({ error: 'Validation error', message });
      }

      res.status(500).json({ error: 'Internal error', message: 'Password change failed' });
    }
  }
);
