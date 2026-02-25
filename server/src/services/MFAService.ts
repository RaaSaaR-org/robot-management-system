/**
 * @file MFAService.ts
 * @description Multi-Factor Authentication service — TOTP, recovery codes, lockout, password policy
 * @feature auth
 * @regulatory NIS2 Art. 21(2)(j), CRA Annex I
 */

import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { generateSecret as otpGenerateSecret, generateURI, verifySync } from 'otplib';
import { prisma } from '../database/index.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

const EPOCH_TOLERANCE = 30; // Allow ±30s tolerance (equivalent to ±1 time step)
const RECOVERY_CODE_COUNT = 8;
const RECOVERY_CODE_LENGTH = 10;
const BCRYPT_ROUNDS = 10;
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 30;
const ISSUER = 'RoboMindOS';

// ============================================================================
// TYPES
// ============================================================================

export interface TOTPSetupResult {
  secret: string;
  otpauthUrl: string;
}

export interface PasswordComplexityResult {
  valid: boolean;
  errors: string[];
}

// ============================================================================
// MFA SERVICE
// ============================================================================

export class MFAService {
  // --------------------------------------------------------------------------
  // TOTP
  // --------------------------------------------------------------------------

  /**
   * Generate a new TOTP secret and otpauth URL for QR code generation.
   */
  generateTOTPSecret(userEmail: string): TOTPSetupResult {
    const secret = otpGenerateSecret();
    const otpauthUrl = generateURI({ issuer: ISSUER, label: userEmail, secret });
    return { secret, otpauthUrl };
  }

  /**
   * Verify a TOTP code against a secret. Allows ±1 time window.
   */
  verifyTOTP(secret: string, code: string): boolean {
    const result = verifySync({ secret, token: code, epochTolerance: EPOCH_TOLERANCE });
    return result.valid;
  }

  /**
   * Enable TOTP for a user: store the credential and enable MFA flag.
   */
  async enableTOTP(userId: string, secret: string, name?: string): Promise<void> {
    await prisma.$transaction([
      prisma.mFACredential.create({
        data: {
          userId,
          type: 'totp',
          secret,
          name: name ?? 'Authenticator App',
        },
      }),
      prisma.user.update({
        where: { id: userId },
        data: { mfaEnabled: true },
      }),
    ]);
  }

  /**
   * Disable TOTP for a user: remove credentials and disable MFA flag.
   */
  async disableTOTP(userId: string): Promise<void> {
    await prisma.$transaction([
      prisma.mFACredential.deleteMany({
        where: { userId, type: 'totp' },
      }),
      prisma.user.update({
        where: { id: userId },
        data: { mfaEnabled: false, recoveryCodes: null },
      }),
    ]);
  }

  /**
   * Get the TOTP credential for a user.
   */
  async getTOTPCredential(userId: string) {
    return prisma.mFACredential.findFirst({
      where: { userId, type: 'totp' },
    });
  }

  /**
   * Validate a TOTP code for a user (used during login).
   * Updates lastUsedAt on success.
   */
  async validateTOTP(userId: string, code: string): Promise<boolean> {
    const credential = await this.getTOTPCredential(userId);
    if (!credential) return false;

    const isValid = this.verifyTOTP(credential.secret, code);
    if (isValid) {
      await prisma.mFACredential.update({
        where: { id: credential.id },
        data: { lastUsedAt: new Date() },
      });
    }
    return isValid;
  }

  /**
   * Get the MFA status for a user.
   */
  async getMFAStatus(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { mfaEnabled: true, recoveryCodes: true },
    });

    const totpCredential = await this.getTOTPCredential(userId);

    return {
      mfaEnabled: user?.mfaEnabled ?? false,
      totpConfigured: !!totpCredential,
      hasRecoveryCodes: !!user?.recoveryCodes,
    };
  }

  // --------------------------------------------------------------------------
  // RECOVERY CODES
  // --------------------------------------------------------------------------

  /**
   * Generate a set of plaintext recovery codes.
   */
  generateRecoveryCodes(): string[] {
    const codes: string[] = [];
    for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
      codes.push(
        crypto
          .randomBytes(Math.ceil(RECOVERY_CODE_LENGTH / 2))
          .toString('hex')
          .slice(0, RECOVERY_CODE_LENGTH)
          .toUpperCase()
      );
    }
    return codes;
  }

  /**
   * Hash recovery codes with bcrypt for storage.
   */
  async hashRecoveryCodes(codes: string[]): Promise<string[]> {
    const hashed: string[] = [];
    for (const code of codes) {
      hashed.push(await bcrypt.hash(code, BCRYPT_ROUNDS));
    }
    return hashed;
  }

  /**
   * Store hashed recovery codes for a user (JSON-encoded array in User.recoveryCodes).
   */
  async storeRecoveryCodes(userId: string, hashedCodes: string[]): Promise<void> {
    await prisma.user.update({
      where: { id: userId },
      data: { recoveryCodes: JSON.stringify(hashedCodes) },
    });
  }

  /**
   * Verify a recovery code. If valid, invalidate it (one-time use).
   * Returns true on success.
   */
  async verifyRecoveryCode(userId: string, code: string): Promise<boolean> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { recoveryCodes: true },
    });

    if (!user?.recoveryCodes) return false;

    const hashedCodes: string[] = JSON.parse(user.recoveryCodes);
    let matchIndex = -1;

    for (let i = 0; i < hashedCodes.length; i++) {
      const isMatch = await bcrypt.compare(code.toUpperCase(), hashedCodes[i]);
      if (isMatch) {
        matchIndex = i;
        break;
      }
    }

    if (matchIndex === -1) return false;

    // Remove the used code
    hashedCodes.splice(matchIndex, 1);
    await prisma.user.update({
      where: { id: userId },
      data: { recoveryCodes: JSON.stringify(hashedCodes) },
    });

    return true;
  }

  // --------------------------------------------------------------------------
  // ACCOUNT LOCKOUT
  // --------------------------------------------------------------------------

  /**
   * Record a failed login attempt. Locks the account after MAX_LOGIN_ATTEMPTS.
   */
  async recordFailedAttempt(userId: string): Promise<{ locked: boolean; attempts: number }> {
    const user = await prisma.user.update({
      where: { id: userId },
      data: { loginAttempts: { increment: 1 } },
      select: { loginAttempts: true },
    });

    if (user.loginAttempts >= MAX_LOGIN_ATTEMPTS) {
      await this.lockAccount(userId, LOCKOUT_MINUTES);
      return { locked: true, attempts: user.loginAttempts };
    }

    return { locked: false, attempts: user.loginAttempts };
  }

  /**
   * Lock a user account for a specified number of minutes.
   */
  async lockAccount(userId: string, minutes: number = LOCKOUT_MINUTES): Promise<void> {
    const lockedUntil = new Date(Date.now() + minutes * 60 * 1000);
    await prisma.user.update({
      where: { id: userId },
      data: { lockedUntil },
    });
  }

  /**
   * Check if a user account is currently locked.
   */
  async isLocked(userId: string): Promise<boolean> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { lockedUntil: true },
    });

    if (!user?.lockedUntil) return false;

    if (user.lockedUntil > new Date()) {
      return true;
    }

    // Lock expired — clear it
    await prisma.user.update({
      where: { id: userId },
      data: { lockedUntil: null, loginAttempts: 0 },
    });
    return false;
  }

  /**
   * Reset login attempts after a successful login.
   */
  async resetLoginAttempts(userId: string): Promise<void> {
    await prisma.user.update({
      where: { id: userId },
      data: { loginAttempts: 0, lockedUntil: null },
    });
  }

  // --------------------------------------------------------------------------
  // PASSWORD COMPLEXITY
  // --------------------------------------------------------------------------

  /**
   * Check password complexity against NIS2 requirements.
   * Minimum: 12 chars, 1 uppercase, 1 digit, 1 special character.
   */
  checkPasswordComplexity(password: string): PasswordComplexityResult {
    const errors: string[] = [];

    if (password.length < 12) {
      errors.push('Password must be at least 12 characters long');
    }
    if (!/[A-Z]/.test(password)) {
      errors.push('Password must contain at least one uppercase letter');
    }
    if (!/[a-z]/.test(password)) {
      errors.push('Password must contain at least one lowercase letter');
    }
    if (!/\d/.test(password)) {
      errors.push('Password must contain at least one digit');
    }
    if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/.test(password)) {
      errors.push('Password must contain at least one special character');
    }

    return { valid: errors.length === 0, errors };
  }
}

export const mfaService = new MFAService();
