/**
 * @file RefreshTokenRepository.test.ts
 * @description Unit tests for RefreshTokenRepository — CRUD over refresh tokens, validity filtering, pruning, and db->domain mapping
 * @feature auth
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RefreshToken as PrismaRefreshToken } from '@prisma/client';

// ---------------------------------------------------------------------------
// Hoisted mock for the Prisma singleton (repo does `import { prisma }`)
// ---------------------------------------------------------------------------

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    refreshToken: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
      count: vi.fn(),
    },
  } as {
    refreshToken: {
      create: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      delete: ReturnType<typeof vi.fn>;
      deleteMany: ReturnType<typeof vi.fn>;
      count: ReturnType<typeof vi.fn>;
    };
  },
}));

vi.mock('../../database/index.js', () => ({
  prisma: mockPrisma,
}));

import {
  RefreshTokenRepository,
  refreshTokenRepository,
} from '../RefreshTokenRepository.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeDbToken(
  overrides: Partial<PrismaRefreshToken> = {}
): PrismaRefreshToken {
  return {
    id: 'rt-1',
    token: 'tok-abc',
    userId: 'user-1',
    expiresAt: new Date('2030-01-01T00:00:00.000Z'),
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
    ...overrides,
  } as PrismaRefreshToken;
}

describe('RefreshTokenRepository', () => {
  const repo = new RefreshTokenRepository();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exports a shared singleton instance', () => {
    expect(refreshTokenRepository).toBeInstanceOf(RefreshTokenRepository);
  });

  // -------------------------------------------------------------------------
  // create
  // -------------------------------------------------------------------------
  describe('create', () => {
    it('creates a token with the expected data and maps the result to domain', async () => {
      const expiresAt = new Date('2030-06-01T12:00:00.000Z');
      const dbRow = makeDbToken({
        userId: 'user-7',
        token: 'tok-new',
        expiresAt,
      });
      mockPrisma.refreshToken.create.mockResolvedValue(dbRow);

      const result = await repo.create('user-7', 'tok-new', expiresAt);

      expect(mockPrisma.refreshToken.create).toHaveBeenCalledTimes(1);
      expect(mockPrisma.refreshToken.create).toHaveBeenCalledWith({
        data: { userId: 'user-7', token: 'tok-new', expiresAt },
      });
      expect(result).toEqual({
        id: dbRow.id,
        token: 'tok-new',
        userId: 'user-7',
        expiresAt,
        createdAt: dbRow.createdAt,
      });
    });
  });

  // -------------------------------------------------------------------------
  // findByToken
  // -------------------------------------------------------------------------
  describe('findByToken', () => {
    it('finds by token string and maps to domain', async () => {
      const dbRow = makeDbToken({ token: 'tok-find' });
      mockPrisma.refreshToken.findUnique.mockResolvedValue(dbRow);

      const result = await repo.findByToken('tok-find');

      expect(mockPrisma.refreshToken.findUnique).toHaveBeenCalledWith({
        where: { token: 'tok-find' },
      });
      expect(result).toEqual({
        id: dbRow.id,
        token: 'tok-find',
        userId: dbRow.userId,
        expiresAt: dbRow.expiresAt,
        createdAt: dbRow.createdAt,
      });
    });

    it('returns null when no token is found', async () => {
      mockPrisma.refreshToken.findUnique.mockResolvedValue(null);

      const result = await repo.findByToken('missing');

      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // findValidByToken
  // -------------------------------------------------------------------------
  describe('findValidByToken', () => {
    it('queries with an expiresAt > now filter and maps the result', async () => {
      const dbRow = makeDbToken({ token: 'tok-valid' });
      mockPrisma.refreshToken.findFirst.mockResolvedValue(dbRow);

      const result = await repo.findValidByToken('tok-valid');

      expect(mockPrisma.refreshToken.findFirst).toHaveBeenCalledTimes(1);
      const arg = mockPrisma.refreshToken.findFirst.mock.calls[0][0];
      expect(arg.where.token).toBe('tok-valid');
      expect(arg.where.expiresAt.gt).toBeInstanceOf(Date);
      expect(result?.token).toBe('tok-valid');
    });

    it('returns null when no valid token matches', async () => {
      mockPrisma.refreshToken.findFirst.mockResolvedValue(null);

      const result = await repo.findValidByToken('expired');

      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // deleteByToken
  // -------------------------------------------------------------------------
  describe('deleteByToken', () => {
    it('deletes by token and returns true on success', async () => {
      mockPrisma.refreshToken.delete.mockResolvedValue(makeDbToken());

      const result = await repo.deleteByToken('tok-del');

      expect(mockPrisma.refreshToken.delete).toHaveBeenCalledWith({
        where: { token: 'tok-del' },
      });
      expect(result).toBe(true);
    });

    it('returns false when prisma throws (e.g. record not found)', async () => {
      mockPrisma.refreshToken.delete.mockRejectedValue(
        new Error('Record to delete does not exist')
      );

      const result = await repo.deleteByToken('nope');

      expect(result).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // deleteAllForUser
  // -------------------------------------------------------------------------
  describe('deleteAllForUser', () => {
    it('deletes all tokens for a user and returns the count', async () => {
      mockPrisma.refreshToken.deleteMany.mockResolvedValue({ count: 3 });

      const result = await repo.deleteAllForUser('user-9');

      expect(mockPrisma.refreshToken.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-9' },
      });
      expect(result).toBe(3);
    });

    it('returns 0 when no tokens exist for the user', async () => {
      mockPrisma.refreshToken.deleteMany.mockResolvedValue({ count: 0 });

      const result = await repo.deleteAllForUser('user-empty');

      expect(result).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // deleteExpired
  // -------------------------------------------------------------------------
  describe('deleteExpired', () => {
    it('deletes tokens with expiresAt < now and returns the count', async () => {
      mockPrisma.refreshToken.deleteMany.mockResolvedValue({ count: 5 });

      const result = await repo.deleteExpired();

      expect(mockPrisma.refreshToken.deleteMany).toHaveBeenCalledTimes(1);
      const arg = mockPrisma.refreshToken.deleteMany.mock.calls[0][0];
      expect(arg.where.expiresAt.lt).toBeInstanceOf(Date);
      expect(result).toBe(5);
    });
  });

  // -------------------------------------------------------------------------
  // countForUser
  // -------------------------------------------------------------------------
  describe('countForUser', () => {
    it('counts tokens scoped to the user', async () => {
      mockPrisma.refreshToken.count.mockResolvedValue(2);

      const result = await repo.countForUser('user-2');

      expect(mockPrisma.refreshToken.count).toHaveBeenCalledWith({
        where: { userId: 'user-2' },
      });
      expect(result).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // pruneExcessTokens
  // -------------------------------------------------------------------------
  describe('pruneExcessTokens', () => {
    it('returns 0 without deleting when count is within the limit', async () => {
      mockPrisma.refreshToken.count.mockResolvedValue(3);

      const result = await repo.pruneExcessTokens('user-3', 5);

      expect(result).toBe(0);
      expect(mockPrisma.refreshToken.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.refreshToken.deleteMany).not.toHaveBeenCalled();
    });

    it('returns 0 when count equals the limit (boundary)', async () => {
      mockPrisma.refreshToken.count.mockResolvedValue(5);

      const result = await repo.pruneExcessTokens('user-3', 5);

      expect(result).toBe(0);
      expect(mockPrisma.refreshToken.deleteMany).not.toHaveBeenCalled();
    });

    it('deletes the oldest excess tokens when over the limit', async () => {
      mockPrisma.refreshToken.count.mockResolvedValue(8);
      mockPrisma.refreshToken.findMany.mockResolvedValue([
        { id: 'a' },
        { id: 'b' },
        { id: 'c' },
      ]);
      mockPrisma.refreshToken.deleteMany.mockResolvedValue({ count: 3 });

      const result = await repo.pruneExcessTokens('user-4', 5);

      expect(mockPrisma.refreshToken.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-4' },
        orderBy: { createdAt: 'asc' },
        take: 3, // 8 - 5
        select: { id: true },
      });
      expect(mockPrisma.refreshToken.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['a', 'b', 'c'] } },
      });
      expect(result).toBe(3);
    });

    it('uses the default maxTokens of 5 when not provided', async () => {
      mockPrisma.refreshToken.count.mockResolvedValue(6);
      mockPrisma.refreshToken.findMany.mockResolvedValue([{ id: 'x' }]);
      mockPrisma.refreshToken.deleteMany.mockResolvedValue({ count: 1 });

      const result = await repo.pruneExcessTokens('user-5');

      expect(mockPrisma.refreshToken.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 1 })
      );
      expect(result).toBe(1);
    });
  });
});
