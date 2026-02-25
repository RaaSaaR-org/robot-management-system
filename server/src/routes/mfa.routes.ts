/**
 * @file mfa.routes.ts
 * @description Multi-Factor Authentication REST API endpoints
 * @feature auth
 */

import { Router, type Response } from 'express';
import {
  authMiddleware,
  type AuthenticatedRequest,
} from '../middleware/auth.middleware.js';
import { rateLimiter } from '../middleware/rateLimiter.js';
import { mfaService } from '../services/MFAService.js';
import { accountLockoutService } from '../services/AccountLockoutService.js';

export const mfaRoutes = Router();

// Rate limit: max 10 attempts per 15 minutes on MFA verification endpoints
const mfaRateLimit = rateLimiter(10, 15 * 60 * 1000);

// ============================================================================
// TOTP SETUP
// ============================================================================

/**
 * POST /mfa/totp/setup - Generate TOTP secret for enrollment
 */
mfaRoutes.post(
  '/totp/setup',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Unauthorized', message: 'Not authenticated' });
      }

      const result = mfaService.generateTOTPSecret(req.user.email);

      res.json({
        secret: result.secret,
        otpauthUrl: result.otpauthUrl,
        qrCodeUrl: result.qrCodeUrl,
      });
    } catch (error) {
      console.error('TOTP setup error:', error);
      res.status(500).json({ error: 'Internal error', message: 'Failed to generate TOTP secret' });
    }
  }
);

/**
 * POST /mfa/totp/verify-setup - Verify first TOTP code and activate MFA
 */
mfaRoutes.post(
  '/totp/verify-setup',
  authMiddleware,
  mfaRateLimit,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Unauthorized', message: 'Not authenticated' });
      }

      const { secret, token, name } = req.body;

      if (!secret || !token) {
        return res.status(400).json({
          error: 'Validation error',
          message: 'Secret and token are required',
        });
      }

      const credential = await mfaService.setupTOTP(req.user.id, secret, token, name);

      // Auto-generate recovery codes on first MFA setup
      const recoveryCodes = await mfaService.generateRecoveryCodes(req.user.id);

      res.json({
        credential,
        recoveryCodes,
        message: 'TOTP enabled successfully. Save your recovery codes securely.',
      });
    } catch (error) {
      console.error('TOTP verify-setup error:', error);
      const message = error instanceof Error ? error.message : 'TOTP setup failed';

      if (message.includes('Invalid TOTP')) {
        return res.status(400).json({ error: 'Validation error', message });
      }

      res.status(500).json({ error: 'Internal error', message: 'TOTP setup failed' });
    }
  }
);

/**
 * POST /mfa/totp/verify - Verify TOTP code during login
 */
mfaRoutes.post(
  '/totp/verify',
  mfaRateLimit,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { userId, token } = req.body;

      if (!userId || !token) {
        return res.status(400).json({
          error: 'Validation error',
          message: 'User ID and token are required',
        });
      }

      // Check lockout
      const locked = await accountLockoutService.isLocked(userId);
      if (locked) {
        const lockInfo = await accountLockoutService.getLockInfo(userId);
        return res.status(423).json({
          error: 'Account locked',
          message: 'Too many failed attempts. Account is temporarily locked.',
          lockedUntil: lockInfo.lockedUntil,
        });
      }

      const isValid = await mfaService.verifyUserTOTP(userId, token);

      if (!isValid) {
        const result = await accountLockoutService.recordFailedAttempt(userId);
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Invalid TOTP code',
          remainingAttempts: result.remainingAttempts,
        });
      }

      // Reset lockout on success
      await accountLockoutService.resetLockout(userId);

      res.json({ verified: true });
    } catch (error) {
      console.error('TOTP verify error:', error);
      const message = error instanceof Error ? error.message : 'TOTP verification failed';

      if (message.includes('No active TOTP')) {
        return res.status(404).json({ error: 'Not found', message });
      }

      res.status(500).json({ error: 'Internal error', message: 'TOTP verification failed' });
    }
  }
);

// ============================================================================
// RECOVERY CODES
// ============================================================================

/**
 * GET /mfa/recovery-codes - Get recovery code count (not the actual codes)
 */
mfaRoutes.get(
  '/recovery-codes',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Unauthorized', message: 'Not authenticated' });
      }

      const info = await mfaService.getRecoveryCodes(req.user.id);

      res.json(info);
    } catch (error) {
      console.error('Recovery codes error:', error);
      res.status(500).json({ error: 'Internal error', message: 'Failed to get recovery codes' });
    }
  }
);

/**
 * POST /mfa/recovery-codes/generate - Generate new recovery codes
 */
mfaRoutes.post(
  '/recovery-codes/generate',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Unauthorized', message: 'Not authenticated' });
      }

      const codes = await mfaService.generateRecoveryCodes(req.user.id);

      res.json({
        codes,
        message: 'New recovery codes generated. Previous codes have been invalidated.',
      });
    } catch (error) {
      console.error('Generate recovery codes error:', error);
      res.status(500).json({ error: 'Internal error', message: 'Failed to generate recovery codes' });
    }
  }
);

/**
 * POST /mfa/recovery-codes/verify - Login with a recovery code
 */
mfaRoutes.post(
  '/recovery-codes/verify',
  mfaRateLimit,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { userId, code } = req.body;

      if (!userId || !code) {
        return res.status(400).json({
          error: 'Validation error',
          message: 'User ID and recovery code are required',
        });
      }

      // Check lockout
      const locked = await accountLockoutService.isLocked(userId);
      if (locked) {
        const lockInfo = await accountLockoutService.getLockInfo(userId);
        return res.status(423).json({
          error: 'Account locked',
          message: 'Too many failed attempts. Account is temporarily locked.',
          lockedUntil: lockInfo.lockedUntil,
        });
      }

      const isValid = await mfaService.verifyRecoveryCode(userId, code);

      if (!isValid) {
        const result = await accountLockoutService.recordFailedAttempt(userId);
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Invalid recovery code',
          remainingAttempts: result.remainingAttempts,
        });
      }

      // Reset lockout on success
      await accountLockoutService.resetLockout(userId);

      res.json({ verified: true });
    } catch (error) {
      console.error('Recovery code verify error:', error);
      res.status(500).json({ error: 'Internal error', message: 'Recovery code verification failed' });
    }
  }
);

// ============================================================================
// MFA STATUS & MANAGEMENT
// ============================================================================

/**
 * GET /mfa/status - Get MFA status for current user
 */
mfaRoutes.get(
  '/status',
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

/**
 * DELETE /mfa/:credentialId - Remove an MFA credential
 */
mfaRoutes.delete(
  '/:credentialId',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Unauthorized', message: 'Not authenticated' });
      }

      await mfaService.removeCredential(req.user.id, req.params.credentialId);

      res.json({ message: 'MFA credential removed' });
    } catch (error) {
      console.error('MFA delete error:', error);
      const message = error instanceof Error ? error.message : 'Failed to remove credential';

      if (message.includes('not found')) {
        return res.status(404).json({ error: 'Not found', message });
      }

      res.status(500).json({ error: 'Internal error', message: 'Failed to remove credential' });
    }
  }
);
