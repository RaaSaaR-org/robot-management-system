/**
 * @file MFAService.ts
 * @description Multi-Factor Authentication service — TOTP, recovery codes, WebAuthn stubs
 * @feature auth
 */

import crypto from 'crypto';
import {
  TOTP,
  generateSecret,
  generateURI,
  NobleCryptoPlugin,
  ScureBase32Plugin,
} from 'otplib';
import { prisma } from '../database/client.js';

// ============================================================================
// TYPES
// ============================================================================

export interface TOTPSetupResult {
  secret: string;
  otpauthUrl: string;
  qrCodeUrl: string;
}

export interface MFACredentialInfo {
  id: string;
  type: string;
  name: string;
  isActive: boolean;
  createdAt: Date;
  lastUsed: Date | null;
}

export interface MFAStatus {
  enabled: boolean;
  methods: MFACredentialInfo[];
  hasRecoveryCodes: boolean;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const TOTP_ISSUER = 'RoboMindOS';
const TOTP_EPOCH_TOLERANCE = 30; // ±30 seconds (one period each direction)
const RECOVERY_CODE_COUNT = 8;
const RECOVERY_CODE_LENGTH = 10;

// ============================================================================
// TOTP INSTANCE
// ============================================================================

const totpInstance = new TOTP({
  crypto: new NobleCryptoPlugin(),
  base32: new ScureBase32Plugin(),
});

// ============================================================================
// SERVICE
// ============================================================================

export class MFAService {
  /**
   * Generate a TOTP secret and otpauth URL for QR code enrollment.
   */
  generateTOTPSecret(userEmail: string): TOTPSetupResult {
    const secret = generateSecret();
    const otpauthUrl = generateURI({
      secret,
      issuer: TOTP_ISSUER,
      label: userEmail,
    });
    // Google Charts API for QR code (no native dependency needed on arm64)
    const qrCodeUrl = `https://chart.googleapis.com/chart?chs=200x200&cht=qr&chl=${encodeURIComponent(otpauthUrl)}`;

    return { secret, otpauthUrl, qrCodeUrl };
  }

  /**
   * Verify a TOTP token against a secret.
   */
  async verifyTOTP(secret: string, token: string): Promise<boolean> {
    const result = await totpInstance.verify(token, {
      secret,
      epochTolerance: TOTP_EPOCH_TOLERANCE,
    });
    return result.valid;
  }

  /**
   * Setup TOTP: store the credential after first successful verification.
   */
  async setupTOTP(
    userId: string,
    secret: string,
    token: string,
    name: string = 'Authenticator App'
  ): Promise<MFACredentialInfo> {
    // Verify the token first
    const valid = await this.verifyTOTP(secret, token);
    if (!valid) {
      throw new Error('Invalid TOTP code. Please try again.');
    }

    // Deactivate any existing TOTP credentials
    await prisma.mFACredential.updateMany({
      where: { userId, type: 'totp', isActive: true },
      data: { isActive: false },
    });

    // Store the new credential
    const credential = await prisma.mFACredential.create({
      data: {
        userId,
        type: 'totp',
        name,
        secret,
        isActive: true,
      },
    });

    return this.toCredentialInfo(credential);
  }

  /**
   * Verify a TOTP code during login for a given user.
   */
  async verifyUserTOTP(userId: string, token: string): Promise<boolean> {
    const credential = await prisma.mFACredential.findFirst({
      where: { userId, type: 'totp', isActive: true },
    });

    if (!credential) {
      throw new Error('No active TOTP credential found');
    }

    const isValid = await this.verifyTOTP(credential.secret, token);

    if (isValid) {
      await prisma.mFACredential.update({
        where: { id: credential.id },
        data: { lastUsed: new Date() },
      });
    }

    return isValid;
  }

  /**
   * Generate recovery codes for a user.
   */
  async generateRecoveryCodes(
    userId: string,
    count: number = RECOVERY_CODE_COUNT
  ): Promise<string[]> {
    // Remove any existing recovery codes
    await prisma.mFACredential.deleteMany({
      where: { userId, type: 'recovery' },
    });

    const codes: string[] = [];

    for (let i = 0; i < count; i++) {
      const code = this.generateRecoveryCode();
      codes.push(code);

      // Store hashed recovery code
      await prisma.mFACredential.create({
        data: {
          userId,
          type: 'recovery',
          name: `Recovery Code ${i + 1}`,
          secret: this.hashRecoveryCode(code),
          isActive: true,
        },
      });
    }

    return codes;
  }

  /**
   * Verify and consume a recovery code for login.
   */
  async verifyRecoveryCode(userId: string, code: string): Promise<boolean> {
    const hashedCode = this.hashRecoveryCode(code.trim().toLowerCase());

    const credential = await prisma.mFACredential.findFirst({
      where: {
        userId,
        type: 'recovery',
        secret: hashedCode,
        isActive: true,
      },
    });

    if (!credential) {
      return false;
    }

    // Invalidate the used recovery code (one-time use)
    await prisma.mFACredential.update({
      where: { id: credential.id },
      data: { isActive: false, lastUsed: new Date() },
    });

    return true;
  }

  /**
   * Get MFA status for a user.
   */
  async getMFAStatus(userId: string): Promise<MFAStatus> {
    const credentials = await prisma.mFACredential.findMany({
      where: { userId, isActive: true },
    });

    const methods = credentials
      .filter((c) => c.type !== 'recovery')
      .map(this.toCredentialInfo);

    const hasRecoveryCodes = credentials.some((c) => c.type === 'recovery');
    const enabled = methods.length > 0;

    return { enabled, methods, hasRecoveryCodes };
  }

  /**
   * Get recovery code counts (for display).
   */
  async getRecoveryCodes(userId: string): Promise<{ total: number; remaining: number }> {
    const all = await prisma.mFACredential.count({
      where: { userId, type: 'recovery' },
    });
    const remaining = await prisma.mFACredential.count({
      where: { userId, type: 'recovery', isActive: true },
    });

    return { total: all, remaining };
  }

  /**
   * Remove an MFA credential.
   */
  async removeCredential(userId: string, credentialId: string): Promise<void> {
    const credential = await prisma.mFACredential.findFirst({
      where: { id: credentialId, userId },
    });

    if (!credential) {
      throw new Error('MFA credential not found');
    }

    await prisma.mFACredential.delete({
      where: { id: credentialId },
    });
  }

  /**
   * Check if user has MFA enabled (any active non-recovery credential).
   */
  async hasMFAEnabled(userId: string): Promise<boolean> {
    const count = await prisma.mFACredential.count({
      where: { userId, type: { not: 'recovery' }, isActive: true },
    });
    return count > 0;
  }

  // TODO: WebAuthn requires browser SimpleWebAuthn integration
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async setupWebAuthn(_userId: string): Promise<{ message: string }> {
    return {
      message: 'WebAuthn registration not yet implemented. Requires browser SimpleWebAuthn integration.',
    };
  }

  // TODO: WebAuthn requires browser SimpleWebAuthn integration
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async verifyWebAuthn(_userId: string, _credential: unknown): Promise<boolean> {
    throw new Error('WebAuthn verification not yet implemented. Requires browser SimpleWebAuthn integration.');
  }

  // ==========================================================================
  // PRIVATE HELPERS
  // ==========================================================================

  private generateRecoveryCode(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let code = '';
    const bytes = crypto.randomBytes(RECOVERY_CODE_LENGTH);
    for (let i = 0; i < RECOVERY_CODE_LENGTH; i++) {
      code += chars[bytes[i] % chars.length];
    }
    return code;
  }

  hashRecoveryCode(code: string): string {
    return crypto.createHash('sha256').update(code.trim().toLowerCase()).digest('hex');
  }

  private toCredentialInfo(credential: {
    id: string;
    type: string;
    name: string;
    isActive: boolean;
    createdAt: Date;
    lastUsed: Date | null;
  }): MFACredentialInfo {
    return {
      id: credential.id,
      type: credential.type,
      name: credential.name,
      isActive: credential.isActive,
      createdAt: credential.createdAt,
      lastUsed: credential.lastUsed,
    };
  }
}

export const mfaService = new MFAService();
