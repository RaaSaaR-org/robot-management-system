/**
 * @file MFAService.test.ts
 * @description Unit tests for MFAService — TOTP, recovery codes, lockout, password complexity
 * @feature auth
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock prisma before importing the service
vi.mock('../../database/index.js', () => ({
  prisma: {
    mFACredential: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import { MFAService } from '../MFAService.js';

describe('MFAService', () => {
  let service: MFAService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new MFAService();
  });

  // --------------------------------------------------------------------------
  // TOTP
  // --------------------------------------------------------------------------

  describe('generateTOTPSecret', () => {
    it('returns a base32 string secret', () => {
      const result = service.generateTOTPSecret('user@example.com');
      expect(result.secret).toBeDefined();
      expect(typeof result.secret).toBe('string');
      // Base32 characters: A-Z, 2-7
      expect(result.secret).toMatch(/^[A-Z2-7]+$/);
    });

    it('returns an otpauth:// URI', () => {
      const result = service.generateTOTPSecret('user@example.com');
      expect(result.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
      expect(result.otpauthUrl).toContain('NeoDEM');
      expect(result.otpauthUrl).toContain('user%40example.com');
    });

    it('returns a different secret each call', () => {
      const r1 = service.generateTOTPSecret('a@b.com');
      const r2 = service.generateTOTPSecret('a@b.com');
      expect(r1.secret).not.toBe(r2.secret);
    });
  });

  describe('verifyTOTP', () => {
    it('returns true for a valid token generated from the same secret', () => {
      // Generate a secret then generate a valid token for it
      const { generateSync } = require('otplib') as typeof import('otplib');
      const { secret } = service.generateTOTPSecret('test@test.com');
      const validToken = generateSync({ secret });
      expect(service.verifyTOTP(secret, validToken)).toBe(true);
    });

    it('returns false for an invalid token', () => {
      const { secret } = service.generateTOTPSecret('test@test.com');
      expect(service.verifyTOTP(secret, '000000')).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // RECOVERY CODES
  // --------------------------------------------------------------------------

  describe('generateRecoveryCodes', () => {
    it('returns 8 codes by default', () => {
      const codes = service.generateRecoveryCodes();
      expect(codes).toHaveLength(8);
    });

    it('returns uppercase hex codes of length 10', () => {
      const codes = service.generateRecoveryCodes();
      for (const code of codes) {
        expect(code).toMatch(/^[0-9A-F]{10}$/);
      }
    });

    it('returns unique codes', () => {
      const codes = service.generateRecoveryCodes();
      const unique = new Set(codes);
      expect(unique.size).toBe(codes.length);
    });
  });

  describe('hashRecoveryCodes', () => {
    it('hashes all codes (returns same count)', async () => {
      const codes = ['AAAAAAAAAA', 'BBBBBBBBBB', 'CCCCCCCCCC'];
      const hashed = await service.hashRecoveryCodes(codes);
      expect(hashed).toHaveLength(3);
      // Hashed codes should be bcrypt format
      for (const h of hashed) {
        expect(h).toMatch(/^\$2[aby]?\$/);
      }
    });

    it('produces different hashes for different codes', async () => {
      const hashed = await service.hashRecoveryCodes(['AAAAAAAAAA', 'BBBBBBBBBB']);
      expect(hashed[0]).not.toBe(hashed[1]);
    });
  });

  describe('verifyRecoveryCode', () => {
    it('returns true for a valid recovery code and removes it', async () => {
      const codes = ['TESTCODE01'];
      const hashed = await service.hashRecoveryCodes(codes);

      const { prisma } = await import('../../database/index.js');
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        recoveryCodes: JSON.stringify(hashed),
      } as any);
      vi.mocked(prisma.user.update).mockResolvedValue({} as any);

      const result = await service.verifyRecoveryCode('user-1', 'TESTCODE01');
      expect(result).toBe(true);

      // Should have called update to remove the used code
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { recoveryCodes: JSON.stringify([]) },
      });
    });

    it('returns false for an invalid recovery code', async () => {
      const codes = ['VALIDCODE1'];
      const hashed = await service.hashRecoveryCodes(codes);

      const { prisma } = await import('../../database/index.js');
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        recoveryCodes: JSON.stringify(hashed),
      } as any);

      const result = await service.verifyRecoveryCode('user-1', 'WRONGCODE1');
      expect(result).toBe(false);
    });

    it('returns false when user has no recovery codes', async () => {
      const { prisma } = await import('../../database/index.js');
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        recoveryCodes: null,
      } as any);

      const result = await service.verifyRecoveryCode('user-1', 'ANYCODE123');
      expect(result).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // PASSWORD COMPLEXITY
  // --------------------------------------------------------------------------

  describe('checkPasswordComplexity', () => {
    it('accepts a strong password', () => {
      const result = service.checkPasswordComplexity('SecureP@ss12!');
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('rejects password shorter than 12 chars', () => {
      const result = service.checkPasswordComplexity('Short1!aA');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Password must be at least 12 characters long');
    });

    it('rejects password without uppercase', () => {
      const result = service.checkPasswordComplexity('lowercaseonly1!a');
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('uppercase'))).toBe(true);
    });

    it('rejects password without digit', () => {
      const result = service.checkPasswordComplexity('NoDigitsHere!Ab');
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('digit'))).toBe(true);
    });

    it('rejects password without special character', () => {
      const result = service.checkPasswordComplexity('NoSpecial123Ab');
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('special'))).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // ACCOUNT LOCKOUT
  // --------------------------------------------------------------------------

  describe('recordFailedAttempt', () => {
    it('locks account after 5 attempts', async () => {
      const { prisma } = await import('../../database/index.js');
      vi.mocked(prisma.user.update).mockResolvedValue({ loginAttempts: 5 } as any);

      const result = await service.recordFailedAttempt('user-1');
      expect(result.locked).toBe(true);
      expect(result.attempts).toBe(5);
    });

    it('does not lock under 5 attempts', async () => {
      const { prisma } = await import('../../database/index.js');
      vi.mocked(prisma.user.update).mockResolvedValue({ loginAttempts: 3 } as any);

      const result = await service.recordFailedAttempt('user-1');
      expect(result.locked).toBe(false);
      expect(result.attempts).toBe(3);
    });
  });

  describe('isLocked', () => {
    it('returns true when lockedUntil is in the future', async () => {
      const { prisma } = await import('../../database/index.js');
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        lockedUntil: new Date(Date.now() + 60000),
      } as any);

      expect(await service.isLocked('user-1')).toBe(true);
    });

    it('returns false and clears lock when expired', async () => {
      const { prisma } = await import('../../database/index.js');
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        lockedUntil: new Date(Date.now() - 60000),
      } as any);
      vi.mocked(prisma.user.update).mockResolvedValue({} as any);

      expect(await service.isLocked('user-1')).toBe(false);
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { lockedUntil: null, loginAttempts: 0 },
      });
    });

    it('returns false when no lock exists', async () => {
      const { prisma } = await import('../../database/index.js');
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        lockedUntil: null,
      } as any);

      expect(await service.isLocked('user-1')).toBe(false);
    });
  });
});
