/**
 * @file password.ts
 * @description Password complexity validation per NIS2 / CRA requirements
 * @feature auth
 */

import { prisma } from '../database/client.js';

// ============================================================================
// TYPES
// ============================================================================

export interface PasswordValidationResult {
  valid: boolean;
  errors: string[];
}

// ============================================================================
// CONSTANTS
// ============================================================================

const MIN_LENGTH = 12;

// ============================================================================
// FUNCTIONS
// ============================================================================

/**
 * Validate password complexity.
 * Rules: min 12 chars, at least 1 uppercase, 1 lowercase, 1 digit, 1 special char.
 */
export function validatePasswordComplexity(password: string): PasswordValidationResult {
  const errors: string[] = [];

  if (password.length < MIN_LENGTH) {
    errors.push(`Password must be at least ${MIN_LENGTH} characters long`);
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

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Check if this is the user's first login (no password change recorded).
 * Returns true if user should be forced to change password.
 */
export async function isFirstLogin(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { lastPasswordChange: true, forcePasswordChange: true },
  });

  if (!user) return false;

  return user.forcePasswordChange || user.lastPasswordChange === null;
}
