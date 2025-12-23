/**
 * @file UserRepository.ts
 * @description Data access layer for User entities
 */

import { prisma } from '../database/index.js';
import type { User as PrismaUser } from '@prisma/client';

/**
 * Domain User type (matches frontend auth.types.ts)
 */
export interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'operator' | 'viewer';
  avatar?: string;
  tenantId?: string;
  isActive: boolean;
  lastLoginAt?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * User with password hash (internal use only)
 */
export interface UserWithPassword extends User {
  passwordHash: string;
  passwordResetToken?: string;
  passwordResetExpires?: Date;
}

/**
 * Input for creating a new user
 */
export interface CreateUserInput {
  email: string;
  passwordHash: string;
  name: string;
  role?: 'admin' | 'operator' | 'viewer';
  avatar?: string;
  tenantId?: string;
}

/**
 * Input for updating a user
 */
export interface UpdateUserInput {
  email?: string;
  name?: string;
  role?: 'admin' | 'operator' | 'viewer';
  avatar?: string;
  tenantId?: string;
  isActive?: boolean;
}

/**
 * Convert Prisma User to domain User
 */
function dbUserToDomain(user: PrismaUser): User {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role as 'admin' | 'operator' | 'viewer',
    avatar: user.avatar ?? undefined,
    tenantId: user.tenantId ?? undefined,
    isActive: user.isActive,
    lastLoginAt: user.lastLoginAt?.toISOString(),
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

/**
 * Convert Prisma User to domain User with password
 */
function dbUserToUserWithPassword(user: PrismaUser): UserWithPassword {
  return {
    ...dbUserToDomain(user),
    passwordHash: user.passwordHash,
    passwordResetToken: user.passwordResetToken ?? undefined,
    passwordResetExpires: user.passwordResetExpires ?? undefined,
  };
}

export class UserRepository {
  /**
   * Find a user by ID
   */
  async findById(id: string): Promise<User | null> {
    const user = await prisma.user.findUnique({
      where: { id },
    });
    return user ? dbUserToDomain(user) : null;
  }

  /**
   * Find a user by ID with password hash (for auth)
   */
  async findByIdWithPassword(id: string): Promise<UserWithPassword | null> {
    const user = await prisma.user.findUnique({
      where: { id },
    });
    return user ? dbUserToUserWithPassword(user) : null;
  }

  /**
   * Find a user by email
   */
  async findByEmail(email: string): Promise<User | null> {
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });
    return user ? dbUserToDomain(user) : null;
  }

  /**
   * Find a user by email with password hash (for auth)
   */
  async findByEmailWithPassword(email: string): Promise<UserWithPassword | null> {
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });
    return user ? dbUserToUserWithPassword(user) : null;
  }

  /**
   * Find all users
   */
  async findAll(): Promise<User[]> {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return users.map(dbUserToDomain);
  }

  /**
   * Create a new user
   */
  async create(input: CreateUserInput): Promise<User> {
    const user = await prisma.user.create({
      data: {
        email: input.email.toLowerCase(),
        passwordHash: input.passwordHash,
        name: input.name,
        role: input.role ?? 'viewer',
        avatar: input.avatar,
        tenantId: input.tenantId,
      },
    });
    return dbUserToDomain(user);
  }

  /**
   * Update a user
   */
  async update(id: string, data: UpdateUserInput): Promise<User | null> {
    try {
      const updateData: Record<string, unknown> = {};

      if (data.email !== undefined) updateData.email = data.email.toLowerCase();
      if (data.name !== undefined) updateData.name = data.name;
      if (data.role !== undefined) updateData.role = data.role;
      if (data.avatar !== undefined) updateData.avatar = data.avatar;
      if (data.tenantId !== undefined) updateData.tenantId = data.tenantId;
      if (data.isActive !== undefined) updateData.isActive = data.isActive;

      const user = await prisma.user.update({
        where: { id },
        data: updateData,
      });
      return dbUserToDomain(user);
    } catch {
      return null;
    }
  }

  /**
   * Update user password
   */
  async updatePassword(id: string, passwordHash: string): Promise<boolean> {
    try {
      await prisma.user.update({
        where: { id },
        data: {
          passwordHash,
          passwordResetToken: null,
          passwordResetExpires: null,
        },
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Set password reset token
   */
  async setPasswordResetToken(
    id: string,
    token: string,
    expires: Date
  ): Promise<boolean> {
    try {
      await prisma.user.update({
        where: { id },
        data: {
          passwordResetToken: token,
          passwordResetExpires: expires,
        },
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Clear password reset token
   */
  async clearPasswordResetToken(id: string): Promise<boolean> {
    try {
      await prisma.user.update({
        where: { id },
        data: {
          passwordResetToken: null,
          passwordResetExpires: null,
        },
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Find user by password reset token
   */
  async findByPasswordResetToken(token: string): Promise<UserWithPassword | null> {
    const user = await prisma.user.findFirst({
      where: {
        passwordResetToken: token,
        passwordResetExpires: {
          gt: new Date(),
        },
      },
    });
    return user ? dbUserToUserWithPassword(user) : null;
  }

  /**
   * Update last login timestamp
   */
  async updateLastLogin(id: string): Promise<boolean> {
    try {
      await prisma.user.update({
        where: { id },
        data: {
          lastLoginAt: new Date(),
        },
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Delete a user
   */
  async delete(id: string): Promise<boolean> {
    try {
      await prisma.user.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if email exists
   */
  async emailExists(email: string): Promise<boolean> {
    const count = await prisma.user.count({
      where: { email: email.toLowerCase() },
    });
    return count > 0;
  }
}

export const userRepository = new UserRepository();
