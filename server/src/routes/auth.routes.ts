/**
 * @file auth.routes.ts
 * @description Authentication REST API endpoints
 */

import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import { authService } from '../services/AuthService.js';
import { mfaService } from '../services/MFAService.js';
import {
  authMiddleware,
  type AuthenticatedRequest,
} from '../middleware/auth.middleware.js';
import { MULTI_TENANCY_ENABLED } from '../config/features.js';

export const authRoutes = Router();

// ============================================================================
// MFA RATE LIMITERS
// ============================================================================

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

const mfaSetupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many MFA setup attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

const mfaValidateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many MFA validation attempts' },
  standardHeaders: true,
  legacyHeaders: false,
});

const mfaRecoveryLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { error: 'Too many recovery code attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

const mfaDisableLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many MFA disable attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * POST /register - Register a new user
 */
authRoutes.post('/register', async (req: Request, res: Response) => {
  try {
    // TASK-162: anonymous self-service signup is disabled when multi-tenancy
    // is on — new users must be added via the Team page (TASK-163) so they
    // inherit a tenantId. Single-tenant deployments keep the legacy flow.
    if (MULTI_TENANCY_ENABLED) {
      return res.status(403).json({
        error: 'Forbidden',
        message:
          'Signup is invite-only. Ask your organization owner to add you.',
      });
    }

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
 * Integrates account lockout and MFA challenge flow.
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

    // Pre-check: is account locked?
    const { userRepository } = await import('../repositories/index.js');
    const existingUser = await userRepository.findByEmail(email);
    if (existingUser) {
      const locked = await mfaService.isLocked(existingUser.id);
      if (locked) {
        return res.status(423).json({
          error: 'Account locked',
          message: 'Account is temporarily locked due to too many failed login attempts. Try again later.',
        });
      }
    }

    let result;
    try {
      result = await authService.login(email, password);
    } catch (loginError) {
      // Record failed attempt if user exists
      if (existingUser) {
        const { locked } = await mfaService.recordFailedAttempt(existingUser.id);
        if (locked) {
          return res.status(423).json({
            error: 'Account locked',
            message: 'Account is temporarily locked due to too many failed login attempts. Try again later.',
          });
        }
      }
      throw loginError;
    }

    // Reset login attempts on successful password verification
    if (existingUser) {
      await mfaService.resetLoginAttempts(existingUser.id);
    }

    // Check if MFA is required
    const mfaStatus = await mfaService.getMFAStatus(result.user.id);
    if (mfaStatus.mfaEnabled && mfaStatus.totpConfigured) {
      // Return scope-limited MFA-pending token (NOT the full access token)
      const mfaPendingToken = jwt.sign(
        { userId: result.user.id, scope: 'mfa-pending' },
        JWT_SECRET,
        { expiresIn: '5m' }
      );
      return res.json({
        mfaRequired: true,
        mfaToken: mfaPendingToken,
        userId: result.user.id,
      });
    }

    res.json(result);
  } catch (error) {
    console.error('Login error:', error);
    const rawMessage = error instanceof Error ? error.message : 'Login failed';

    // TASK-164: never leak whether the email is registered or why the
    // login failed — return a single generic message for any 4xx cause.
    // Internal-only states (unreachable DB, crashed process) still surface
    // as 500 so ops can see them.
    if (
      rawMessage.includes('Invalid') ||
      rawMessage.includes('deactivated') ||
      rawMessage.includes('not found')
    ) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Incorrect email or password.',
      });
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
          tenantId: req.user.tenantId ?? undefined,
          isActive: true,
          // TASK-164: MOCK_USER never has the force-password-change gate
          // — dev sessions must not get trapped on /set-password.
          forcePasswordChange: false,
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

// ============================================================================
// MFA ENDPOINTS (TASK-022)
// ============================================================================

/**
 * POST /mfa/totp/setup - Generate TOTP secret for setup
 */
authRoutes.post(
  '/mfa/totp/setup',
  mfaSetupLimiter,
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Unauthorized', message: 'Not authenticated' });
      }

      // Check if already configured
      const existing = await mfaService.getTOTPCredential(req.user.id);
      if (existing) {
        return res.status(409).json({
          error: 'Conflict',
          message: 'TOTP is already configured. Disable it first to reconfigure.',
        });
      }

      const setup = mfaService.generateTOTPSecret(req.user.email);

      res.json({
        secret: setup.secret,
        otpauthUrl: setup.otpauthUrl,
      });
    } catch (error) {
      console.error('MFA TOTP setup error:', error);
      res.status(500).json({ error: 'Internal error', message: 'Failed to generate TOTP secret' });
    }
  }
);

/**
 * POST /mfa/totp/verify - Verify TOTP code and enable MFA
 * Called during setup to confirm the user has correctly configured their authenticator.
 */
authRoutes.post(
  '/mfa/totp/verify',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Unauthorized', message: 'Not authenticated' });
      }

      const { secret, code } = req.body;

      if (!secret || !code) {
        return res.status(400).json({
          error: 'Validation error',
          message: 'Secret and code are required',
        });
      }

      // Verify the code against the provided secret
      const isValid = mfaService.verifyTOTP(secret, code);
      if (!isValid) {
        return res.status(400).json({
          error: 'Validation error',
          message: 'Invalid TOTP code. Please try again.',
        });
      }

      // Enable TOTP
      await mfaService.enableTOTP(req.user.id, secret);

      // Generate recovery codes
      const recoveryCodes = mfaService.generateRecoveryCodes();
      const hashedCodes = await mfaService.hashRecoveryCodes(recoveryCodes);
      await mfaService.storeRecoveryCodes(req.user.id, hashedCodes);

      res.json({
        message: 'TOTP enabled successfully',
        recoveryCodes, // Show only once!
      });
    } catch (error) {
      console.error('MFA TOTP verify error:', error);
      res.status(500).json({ error: 'Internal error', message: 'Failed to enable TOTP' });
    }
  }
);

/**
 * POST /mfa/totp/validate - Validate TOTP code during login
 */
authRoutes.post('/mfa/totp/validate', mfaValidateLimiter, async (req: Request, res: Response) => {
  try {
    const { userId, code, mfaToken } = req.body;

    if (!userId || !code || !mfaToken) {
      return res.status(400).json({
        error: 'Validation error',
        message: 'userId, code, and mfaToken are required',
      });
    }

    // Verify the mfa-pending scoped token
    let decoded: { userId: string; scope?: string };
    try {
      decoded = jwt.verify(mfaToken, JWT_SECRET) as { userId: string; scope?: string };
    } catch {
      return res.status(401).json({ error: 'Unauthorized', message: 'Invalid or expired MFA token' });
    }
    if (decoded.scope !== 'mfa-pending' || decoded.userId !== userId) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Invalid MFA token' });
    }

    // Validate the TOTP code
    const isValid = await mfaService.validateTOTP(userId, code);
    if (!isValid) {
      await mfaService.recordFailedAttempt(userId);
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid TOTP code',
      });
    }

    // Reset login attempts after successful MFA
    await mfaService.resetLoginAttempts(userId);

    // Get user and generate full auth response
    const user = await authService.getCurrentUser(userId);
    const { userRepository } = await import('../repositories/index.js');
    const fullUser = await userRepository.findById(userId);

    if (!fullUser) {
      return res.status(404).json({ error: 'Not found', message: 'User not found' });
    }

    // Generate fresh tokens (MFA-verified session)
    const accessToken = authService.generateAccessToken(fullUser);
    const { refreshTokenRepository } = await import('../repositories/index.js');
    const crypto = await import('crypto');
    const refreshToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    await refreshTokenRepository.create(userId, refreshToken, expiresAt);

    res.json({
      user: fullUser,
      accessToken,
      refreshToken,
      expiresIn: 15 * 60 * 1000, // 15 minutes
    });
  } catch (error) {
    console.error('MFA TOTP validate error:', error);
    res.status(500).json({ error: 'Internal error', message: 'Failed to validate TOTP code' });
  }
});

/**
 * POST /mfa/recovery-codes - Generate new recovery codes (replaces existing)
 */
authRoutes.post(
  '/mfa/recovery-codes',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Unauthorized', message: 'Not authenticated' });
      }

      const status = await mfaService.getMFAStatus(req.user.id);
      if (!status.mfaEnabled) {
        return res.status(400).json({
          error: 'Bad request',
          message: 'MFA must be enabled before generating recovery codes',
        });
      }

      const recoveryCodes = mfaService.generateRecoveryCodes();
      const hashedCodes = await mfaService.hashRecoveryCodes(recoveryCodes);
      await mfaService.storeRecoveryCodes(req.user.id, hashedCodes);

      res.json({ recoveryCodes });
    } catch (error) {
      console.error('MFA recovery codes error:', error);
      res.status(500).json({ error: 'Internal error', message: 'Failed to generate recovery codes' });
    }
  }
);

/**
 * POST /mfa/recovery/use - Use a recovery code for login
 */
authRoutes.post('/mfa/recovery/use', mfaRecoveryLimiter, async (req: Request, res: Response) => {
  try {
    const { userId, code, mfaToken } = req.body;

    if (!userId || !code || !mfaToken) {
      return res.status(400).json({
        error: 'Validation error',
        message: 'userId, code, and mfaToken are required',
      });
    }

    // Verify the mfa-pending scoped token
    let decoded: { userId: string; scope?: string };
    try {
      decoded = jwt.verify(mfaToken, JWT_SECRET) as { userId: string; scope?: string };
    } catch {
      return res.status(401).json({ error: 'Unauthorized', message: 'Invalid or expired MFA token' });
    }
    if (decoded.scope !== 'mfa-pending' || decoded.userId !== userId) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Invalid MFA token' });
    }

    const isValid = await mfaService.verifyRecoveryCode(userId, code);
    if (!isValid) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid recovery code',
      });
    }

    // Reset login attempts
    await mfaService.resetLoginAttempts(userId);

    // Generate full auth response
    const { userRepository, refreshTokenRepository } = await import('../repositories/index.js');
    const fullUser = await userRepository.findById(userId);

    if (!fullUser) {
      return res.status(404).json({ error: 'Not found', message: 'User not found' });
    }

    const accessToken = authService.generateAccessToken(fullUser);
    const crypto = await import('crypto');
    const refreshToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await refreshTokenRepository.create(userId, refreshToken, expiresAt);

    res.json({
      user: fullUser,
      accessToken,
      refreshToken,
      expiresIn: 15 * 60 * 1000,
    });
  } catch (error) {
    console.error('MFA recovery use error:', error);
    res.status(500).json({ error: 'Internal error', message: 'Failed to use recovery code' });
  }
});

/**
 * DELETE /mfa/totp - Disable TOTP MFA
 */
authRoutes.delete(
  '/mfa/totp',
  mfaDisableLimiter,
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Unauthorized', message: 'Not authenticated' });
      }

      await mfaService.disableTOTP(req.user.id);

      res.json({ message: 'TOTP disabled successfully' });
    } catch (error) {
      console.error('MFA TOTP disable error:', error);
      res.status(500).json({ error: 'Internal error', message: 'Failed to disable TOTP' });
    }
  }
);

/**
 * GET /mfa/status - Get MFA status for current user
 */
authRoutes.get(
  '/mfa/status',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Unauthorized', message: 'Not authenticated' });
      }

      const status = await mfaService.getMFAStatus(req.user.id);

      res.json(status);
    } catch (error) {
      console.error('MFA status error:', error);
      res.status(500).json({ error: 'Internal error', message: 'Failed to get MFA status' });
    }
  }
);
