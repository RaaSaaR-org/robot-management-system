/**
 * @file RefreshTokenRepository.ts
 * @description Data access layer for RefreshToken entities
 */

import { prisma } from '../database/index.js';
import type { RefreshToken as PrismaRefreshToken } from '@prisma/client';

/**
 * Domain RefreshToken type
 */
export interface RefreshToken {
  id: string;
  token: string;
  userId: string;
  expiresAt: Date;
  createdAt: Date;
}

/**
 * Convert Prisma RefreshToken to domain RefreshToken
 */
function dbTokenToDomain(token: PrismaRefreshToken): RefreshToken {
  return {
    id: token.id,
    token: token.token,
    userId: token.userId,
    expiresAt: token.expiresAt,
    createdAt: token.createdAt,
  };
}

export class RefreshTokenRepository {
  /**
   * Create a new refresh token
   */
  async create(
    userId: string,
    token: string,
    expiresAt: Date
  ): Promise<RefreshToken> {
    const refreshToken = await prisma.refreshToken.create({
      data: {
        userId,
        token,
        expiresAt,
      },
    });
    return dbTokenToDomain(refreshToken);
  }

  /**
   * Find a refresh token by token string
   */
  async findByToken(token: string): Promise<RefreshToken | null> {
    const refreshToken = await prisma.refreshToken.findUnique({
      where: { token },
    });
    return refreshToken ? dbTokenToDomain(refreshToken) : null;
  }

  /**
   * Find a valid (non-expired) refresh token by token string
   */
  async findValidByToken(token: string): Promise<RefreshToken | null> {
    const refreshToken = await prisma.refreshToken.findFirst({
      where: {
        token,
        expiresAt: {
          gt: new Date(),
        },
      },
    });
    return refreshToken ? dbTokenToDomain(refreshToken) : null;
  }

  /**
   * Delete a refresh token by token string
   */
  async deleteByToken(token: string): Promise<boolean> {
    try {
      await prisma.refreshToken.delete({
        where: { token },
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Delete all refresh tokens for a user
   */
  async deleteAllForUser(userId: string): Promise<number> {
    const result = await prisma.refreshToken.deleteMany({
      where: { userId },
    });
    return result.count;
  }

  /**
   * Delete all expired refresh tokens
   */
  async deleteExpired(): Promise<number> {
    const result = await prisma.refreshToken.deleteMany({
      where: {
        expiresAt: {
          lt: new Date(),
        },
      },
    });
    return result.count;
  }

  /**
   * Count refresh tokens for a user
   */
  async countForUser(userId: string): Promise<number> {
    return prisma.refreshToken.count({
      where: { userId },
    });
  }

  /**
   * Delete oldest refresh tokens for a user if they exceed the limit
   */
  async pruneExcessTokens(userId: string, maxTokens: number = 5): Promise<number> {
    const count = await this.countForUser(userId);

    if (count <= maxTokens) {
      return 0;
    }

    // Get tokens to delete (oldest ones)
    const tokensToDelete = await prisma.refreshToken.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      take: count - maxTokens,
      select: { id: true },
    });

    const result = await prisma.refreshToken.deleteMany({
      where: {
        id: {
          in: tokensToDelete.map((t) => t.id),
        },
      },
    });

    return result.count;
  }
}

export const refreshTokenRepository = new RefreshTokenRepository();
