/**
 * @file AccountLockoutService.ts
 * @description Account lockout logic — brute-force protection per NIS2 Art. 21(2)(j)
 * @feature auth
 */

import { prisma } from '../database/client.js';

// ============================================================================
// CONSTANTS
// ============================================================================

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes

// ============================================================================
// SERVICE
// ============================================================================

export class AccountLockoutService {
  /**
   * Record a failed login attempt. Locks the account after MAX_FAILED_ATTEMPTS.
   */
  async recordFailedAttempt(userId: string): Promise<{ locked: boolean; remainingAttempts: number }> {
    const lockout = await prisma.accountLockout.upsert({
      where: { userId },
      create: {
        userId,
        failedAttempts: 1,
        lastAttempt: new Date(),
      },
      update: {
        failedAttempts: { increment: 1 },
        lastAttempt: new Date(),
      },
    });

    const failedAttempts = lockout.failedAttempts;

    if (failedAttempts >= MAX_FAILED_ATTEMPTS) {
      const lockedUntil = new Date(Date.now() + LOCK_DURATION_MS);
      await prisma.accountLockout.update({
        where: { userId },
        data: { lockedUntil },
      });
      return { locked: true, remainingAttempts: 0 };
    }

    return {
      locked: false,
      remainingAttempts: MAX_FAILED_ATTEMPTS - failedAttempts,
    };
  }

  /**
   * Check if an account is currently locked.
   */
  async isLocked(userId: string): Promise<boolean> {
    const lockout = await prisma.accountLockout.findUnique({
      where: { userId },
    });

    if (!lockout) return false;
    if (!lockout.lockedUntil) return false;

    // Lock has expired
    if (lockout.lockedUntil <= new Date()) {
      await this.resetLockout(userId);
      return false;
    }

    return lockout.failedAttempts >= MAX_FAILED_ATTEMPTS;
  }

  /**
   * Get lock info for error messaging.
   */
  async getLockInfo(userId: string): Promise<{ locked: boolean; lockedUntil: Date | null; failedAttempts: number }> {
    const lockout = await prisma.accountLockout.findUnique({
      where: { userId },
    });

    if (!lockout) {
      return { locked: false, lockedUntil: null, failedAttempts: 0 };
    }

    const locked = lockout.lockedUntil ? lockout.lockedUntil > new Date() && lockout.failedAttempts >= MAX_FAILED_ATTEMPTS : false;

    return {
      locked,
      lockedUntil: locked ? lockout.lockedUntil : null,
      failedAttempts: lockout.failedAttempts,
    };
  }

  /**
   * Reset lockout on successful login.
   */
  async resetLockout(userId: string): Promise<void> {
    await prisma.accountLockout.upsert({
      where: { userId },
      create: {
        userId,
        failedAttempts: 0,
        lockedUntil: null,
        lastAttempt: new Date(),
      },
      update: {
        failedAttempts: 0,
        lockedUntil: null,
        lastAttempt: new Date(),
      },
    });
  }
}

export const accountLockoutService = new AccountLockoutService();
