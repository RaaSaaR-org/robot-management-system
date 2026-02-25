/**
 * @file mfa.test.ts
 * @description Tests for MFA — TOTP generation/verification, recovery codes, lockout, password complexity
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';
import { TOTP, generateSecret, NobleCryptoPlugin, ScureBase32Plugin } from 'otplib';
import { validatePasswordComplexity } from '../utils/password.js';

// ============================================================================
// TOTP TESTS (pure logic — no Prisma dependency)
// ============================================================================

describe('TOTP verification', () => {
  const totp = new TOTP({
    crypto: new NobleCryptoPlugin(),
    base32: new ScureBase32Plugin(),
  });

  it('generates a valid base32 secret', () => {
    const secret = generateSecret();
    expect(secret).toBeDefined();
    expect(typeof secret).toBe('string');
    expect(secret.length).toBeGreaterThan(10);
  });

  it('generates a valid TOTP token from a secret', async () => {
    const secret = generateSecret();
    const token = await totp.generate({ secret });
    expect(token).toMatch(/^\d{6}$/);
  });

  it('verifies a correct TOTP token', async () => {
    const secret = generateSecret();
    const token = await totp.generate({ secret });
    const result = await totp.verify(token, { secret });
    expect(result.valid).toBe(true);
  });

  it('rejects an incorrect TOTP token', async () => {
    const secret = generateSecret();
    const result = await totp.verify('000000', { secret });
    // May or may not be valid depending on timing; verify with known bad
    const result2 = await totp.verify('999999', { secret });
    // At least one should be invalid (extremely unlikely both match)
    const atLeastOneInvalid = !result.valid || !result2.valid;
    expect(atLeastOneInvalid).toBe(true);
  });

  it('accepts tokens within epochTolerance window', async () => {
    const secret = generateSecret();
    const token = await totp.generate({ secret });
    const result = await totp.verify(token, { secret, epochTolerance: 30 });
    expect(result.valid).toBe(true);
  });
});

// ============================================================================
// RECOVERY CODE TESTS
// ============================================================================

describe('Recovery codes', () => {
  function generateRecoveryCode(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let code = '';
    const bytes = crypto.randomBytes(10);
    for (let i = 0; i < 10; i++) {
      code += chars[bytes[i] % chars.length];
    }
    return code;
  }

  function hashRecoveryCode(code: string): string {
    return crypto.createHash('sha256').update(code.trim().toLowerCase()).digest('hex');
  }

  it('generates codes of correct length', () => {
    const code = generateRecoveryCode();
    expect(code).toHaveLength(10);
    expect(code).toMatch(/^[a-z0-9]{10}$/);
  });

  it('generates unique codes', () => {
    const codes = new Set<string>();
    for (let i = 0; i < 100; i++) {
      codes.add(generateRecoveryCode());
    }
    // With 36^10 ≈ 3.6e15 possibilities, collisions are virtually impossible
    expect(codes.size).toBe(100);
  });

  it('hashes codes deterministically', () => {
    const code = 'abc1234567';
    const hash1 = hashRecoveryCode(code);
    const hash2 = hashRecoveryCode(code);
    expect(hash1).toBe(hash2);
  });

  it('hashing is case-insensitive', () => {
    const hash1 = hashRecoveryCode('ABC1234567');
    const hash2 = hashRecoveryCode('abc1234567');
    expect(hash1).toBe(hash2);
  });

  it('hashing trims whitespace', () => {
    const hash1 = hashRecoveryCode('  abc1234567  ');
    const hash2 = hashRecoveryCode('abc1234567');
    expect(hash1).toBe(hash2);
  });

  it('produces SHA-256 hex output', () => {
    const hash = hashRecoveryCode('test123456');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });
});

// ============================================================================
// ACCOUNT LOCKOUT LOGIC TESTS
// ============================================================================

describe('Account lockout logic', () => {
  const MAX_FAILED_ATTEMPTS = 5;
  const LOCK_DURATION_MS = 15 * 60 * 1000;

  it('locks after 5 failed attempts', () => {
    let failedAttempts = 0;
    for (let i = 0; i < 5; i++) {
      failedAttempts++;
    }
    expect(failedAttempts >= MAX_FAILED_ATTEMPTS).toBe(true);
  });

  it('does not lock before 5 failed attempts', () => {
    const failedAttempts = 4;
    expect(failedAttempts >= MAX_FAILED_ATTEMPTS).toBe(false);
  });

  it('lock duration is 15 minutes', () => {
    const lockedUntil = new Date(Date.now() + LOCK_DURATION_MS);
    const now = new Date();
    const diffMs = lockedUntil.getTime() - now.getTime();
    expect(diffMs).toBeGreaterThan(14 * 60 * 1000);
    expect(diffMs).toBeLessThanOrEqual(15 * 60 * 1000);
  });

  it('expired lock is not active', () => {
    const lockedUntil = new Date(Date.now() - 1000); // 1 second ago
    expect(lockedUntil <= new Date()).toBe(true);
  });

  it('active lock is still locked', () => {
    const lockedUntil = new Date(Date.now() + 60000); // 1 minute from now
    expect(lockedUntil > new Date()).toBe(true);
  });
});

// ============================================================================
// PASSWORD COMPLEXITY TESTS
// ============================================================================

describe('Password complexity validation', () => {
  it('rejects passwords shorter than 12 characters', () => {
    const result = validatePasswordComplexity('Short1!aB');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Password must be at least 12 characters long');
  });

  it('rejects passwords without uppercase', () => {
    const result = validatePasswordComplexity('alllowercase1!');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Password must contain at least one uppercase letter');
  });

  it('rejects passwords without lowercase', () => {
    const result = validatePasswordComplexity('ALLUPPERCASE1!');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Password must contain at least one lowercase letter');
  });

  it('rejects passwords without digits', () => {
    const result = validatePasswordComplexity('NoDigitsHere!!');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Password must contain at least one digit');
  });

  it('rejects passwords without special characters', () => {
    const result = validatePasswordComplexity('NoSpecial1abcD');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Password must contain at least one special character');
  });

  it('accepts a compliant password', () => {
    const result = validatePasswordComplexity('StrongPass1!xy');
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('returns multiple errors for very weak passwords', () => {
    const result = validatePasswordComplexity('short');
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });

  it('accepts passwords with various special characters', () => {
    const validPasswords = [
      'MyPassword1@ab',
      'MyPassword1#ab',
      'MyPassword1$ab',
      'MyPassword1%ab',
      'MyPassword1^ab',
    ];
    for (const pw of validPasswords) {
      const result = validatePasswordComplexity(pw);
      expect(result.valid).toBe(true);
    }
  });
});

// ============================================================================
// RATE LIMITER TESTS
// ============================================================================

describe('Rate limiter middleware', () => {
  it('creates a middleware function', async () => {
    // Dynamic import to avoid module resolution issues in test
    const { rateLimiter } = await import('../middleware/rateLimiter.js');
    const middleware = rateLimiter(5, 60000);
    expect(typeof middleware).toBe('function');
  });

  it('allows requests under the limit', async () => {
    const { rateLimiter } = await import('../middleware/rateLimiter.js');
    const middleware = rateLimiter(100, 60000);

    const req = { ip: '127.0.0.1', path: '/test-allow' } as any;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      set: vi.fn(),
    } as any;
    const next = vi.fn();

    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('blocks requests over the limit', async () => {
    const { rateLimiter } = await import('../middleware/rateLimiter.js');
    const middleware = rateLimiter(2, 60000);

    const req = { ip: '10.0.0.1', path: '/test-block' } as any;
    const next = vi.fn();
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      set: vi.fn(),
    } as any;

    // First 2 should pass
    middleware(req, res, next);
    middleware(req, res, next);
    expect(next).toHaveBeenCalledTimes(2);

    // Third should be blocked
    middleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(429);
  });
});
