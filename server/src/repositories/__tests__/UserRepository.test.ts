/**
 * @file UserRepository.test.ts
 * @description Unit tests for UserRepository — Prisma-backed user CRUD, auth lookups,
 *              password-reset token handling, and the inline db<->domain mappers (run for real).
 * @feature auth
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { User as PrismaUser } from '@prisma/client';

// ---------------------------------------------------------------------------
// Hoisted mock for the Prisma client singleton (the I/O boundary).
// UserRepository imports `prisma` from '../database/index.js'.
// ---------------------------------------------------------------------------

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    user: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
  } as {
    user: {
      findUnique: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      delete: ReturnType<typeof vi.fn>;
      count: ReturnType<typeof vi.fn>;
    };
  },
}));

vi.mock('../../database/index.js', () => ({
  prisma: mockPrisma,
}));

import { UserRepository, userRepository } from '../UserRepository.js';

// ---------------------------------------------------------------------------
// Fixtures — valid Prisma User db-row shapes (Date fields, nullable columns).
// The inline mappers (dbUserToDomain / dbUserToUserWithPassword) run for real,
// so the row must contain the fields they read with the correct types.
// ---------------------------------------------------------------------------

const CREATED_AT = new Date('2026-01-01T00:00:00.000Z');
const UPDATED_AT = new Date('2026-02-02T12:30:00.000Z');
const LAST_LOGIN = new Date('2026-03-03T09:00:00.000Z');

function makeDbUser(overrides: Partial<PrismaUser> = {}): PrismaUser {
  return {
    id: 'user-1',
    email: 'alice@example.com',
    passwordHash: 'hash-abc',
    name: 'Alice',
    role: 'owner',
    avatar: 'https://img/avatar.png',
    tenantId: 'tenant-1',
    isActive: true,
    passwordResetToken: 'reset-token',
    passwordResetExpires: new Date('2026-12-31T00:00:00.000Z'),
    lastLoginAt: LAST_LOGIN,
    lastPasswordChange: null,
    forcePasswordChange: false,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    kind: 'human',
    createdById: null,
    mfaEnabled: false,
    loginAttempts: 0,
    lockedUntil: null,
    passwordChangedAt: null,
    recoveryCodes: null,
    ...overrides,
  } as PrismaUser;
}

const repo = new UserRepository();

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// findById
// ---------------------------------------------------------------------------

describe('UserRepository.findById', () => {
  it('looks up by id and maps to a domain User (no password fields)', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(makeDbUser());

    const result = await repo.findById('user-1');

    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 'user-1' } });
    expect(result).toEqual({
      id: 'user-1',
      email: 'alice@example.com',
      name: 'Alice',
      role: 'owner',
      avatar: 'https://img/avatar.png',
      tenantId: 'tenant-1',
      isActive: true,
      forcePasswordChange: false,
      lastLoginAt: LAST_LOGIN.toISOString(),
      createdAt: CREATED_AT.toISOString(),
      updatedAt: UPDATED_AT.toISOString(),
    });
    // password fields must NOT leak into the plain domain mapper
    expect(result).not.toHaveProperty('passwordHash');
  });

  it('maps null optional columns to undefined', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(
      makeDbUser({ avatar: null, tenantId: null, lastLoginAt: null })
    );

    const result = await repo.findById('user-1');

    expect(result?.avatar).toBeUndefined();
    expect(result?.tenantId).toBeUndefined();
    expect(result?.lastLoginAt).toBeUndefined();
  });

  it('returns null when prisma finds no row', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    const result = await repo.findById('missing');

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// findByIdWithPassword
// ---------------------------------------------------------------------------

describe('UserRepository.findByIdWithPassword', () => {
  it('returns the user including password + reset fields', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(makeDbUser());

    const result = await repo.findByIdWithPassword('user-1');

    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 'user-1' } });
    expect(result?.passwordHash).toBe('hash-abc');
    expect(result?.passwordResetToken).toBe('reset-token');
    expect(result?.passwordResetExpires).toEqual(new Date('2026-12-31T00:00:00.000Z'));
  });

  it('maps null reset fields to undefined', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(
      makeDbUser({ passwordResetToken: null, passwordResetExpires: null })
    );

    const result = await repo.findByIdWithPassword('user-1');

    expect(result?.passwordResetToken).toBeUndefined();
    expect(result?.passwordResetExpires).toBeUndefined();
  });

  it('returns null when prisma finds no row', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    expect(await repo.findByIdWithPassword('missing')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// findByEmail / findByEmailWithPassword — email is lower-cased
// ---------------------------------------------------------------------------

describe('UserRepository.findByEmail', () => {
  it('lower-cases the email in the where clause and maps the result', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(makeDbUser());

    const result = await repo.findByEmail('Alice@Example.COM');

    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: 'alice@example.com' },
    });
    expect(result?.email).toBe('alice@example.com');
  });

  it('returns null when not found', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    expect(await repo.findByEmail('nobody@x.com')).toBeNull();
  });
});

describe('UserRepository.findByEmailWithPassword', () => {
  it('lower-cases the email and returns password fields', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(makeDbUser());

    const result = await repo.findByEmailWithPassword('ALICE@EXAMPLE.com');

    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: 'alice@example.com' },
    });
    expect(result?.passwordHash).toBe('hash-abc');
  });

  it('returns null when not found', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    expect(await repo.findByEmailWithPassword('nobody@x.com')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// findAll
// ---------------------------------------------------------------------------

describe('UserRepository.findAll', () => {
  it('orders by createdAt desc and maps every row', async () => {
    mockPrisma.user.findMany.mockResolvedValue([
      makeDbUser({ id: 'u1' }),
      makeDbUser({ id: 'u2' }),
    ]);

    const result = await repo.findAll();

    expect(mockPrisma.user.findMany).toHaveBeenCalledWith({
      orderBy: { createdAt: 'desc' },
    });
    expect(result).toHaveLength(2);
    expect(result.map((u) => u.id)).toEqual(['u1', 'u2']);
  });

  it('returns an empty array when there are no users', async () => {
    mockPrisma.user.findMany.mockResolvedValue([]);
    expect(await repo.findAll()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

describe('UserRepository.create', () => {
  it('lower-cases email and applies defaults, returning a mapped domain user', async () => {
    mockPrisma.user.create.mockResolvedValue(
      makeDbUser({ id: 'new', email: 'bob@example.com', role: 'viewer' })
    );

    const result = await repo.create({
      email: 'Bob@Example.com',
      passwordHash: 'h',
      name: 'Bob',
    });

    expect(mockPrisma.user.create).toHaveBeenCalledWith({
      data: {
        email: 'bob@example.com',
        passwordHash: 'h',
        name: 'Bob',
        role: 'viewer', // default applied
        avatar: undefined,
        tenantId: undefined,
      },
    });
    expect(result.id).toBe('new');
    expect(result.role).toBe('viewer');
  });

  it('passes through an explicit role, avatar and tenantId', async () => {
    mockPrisma.user.create.mockResolvedValue(makeDbUser());

    await repo.create({
      email: 'a@b.com',
      passwordHash: 'h',
      name: 'A',
      role: 'owner',
      avatar: 'pic.png',
      tenantId: 't-9',
    });

    expect(mockPrisma.user.create).toHaveBeenCalledWith({
      data: {
        email: 'a@b.com',
        passwordHash: 'h',
        name: 'A',
        role: 'owner',
        avatar: 'pic.png',
        tenantId: 't-9',
      },
    });
  });
});

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------

describe('UserRepository.update', () => {
  it('builds a partial update payload (lower-casing email) and maps the result', async () => {
    mockPrisma.user.update.mockResolvedValue(makeDbUser({ name: 'New Name' }));

    const result = await repo.update('user-1', {
      email: 'NEW@Example.com',
      name: 'New Name',
      isActive: false,
      forcePasswordChange: true,
    });

    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: {
        email: 'new@example.com',
        name: 'New Name',
        isActive: false,
        forcePasswordChange: true,
      },
    });
    expect(result?.name).toBe('New Name');
  });

  it('omits undefined fields from the update payload', async () => {
    mockPrisma.user.update.mockResolvedValue(makeDbUser());

    await repo.update('user-1', { role: 'member' });

    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { role: 'member' },
    });
  });

  it('returns null when prisma.update throws (e.g. record not found)', async () => {
    mockPrisma.user.update.mockRejectedValue(new Error('not found'));
    expect(await repo.update('missing', { name: 'X' })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// updatePassword — clears reset token + forcePasswordChange, stamps lastPasswordChange
// ---------------------------------------------------------------------------

describe('UserRepository.updatePassword', () => {
  it('updates the hash and clears reset/force-change flags', async () => {
    mockPrisma.user.update.mockResolvedValue(makeDbUser());

    const ok = await repo.updatePassword('user-1', 'new-hash');

    expect(ok).toBe(true);
    expect(mockPrisma.user.update).toHaveBeenCalledTimes(1);
    const arg = mockPrisma.user.update.mock.calls[0][0];
    expect(arg.where).toEqual({ id: 'user-1' });
    expect(arg.data.passwordHash).toBe('new-hash');
    expect(arg.data.passwordResetToken).toBeNull();
    expect(arg.data.passwordResetExpires).toBeNull();
    expect(arg.data.forcePasswordChange).toBe(false);
    expect(arg.data.lastPasswordChange).toBeInstanceOf(Date);
  });

  it('returns false when prisma throws', async () => {
    mockPrisma.user.update.mockRejectedValue(new Error('db down'));
    expect(await repo.updatePassword('user-1', 'h')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// setPasswordResetToken / clearPasswordResetToken
// ---------------------------------------------------------------------------

describe('UserRepository.setPasswordResetToken', () => {
  it('writes token + expiry and returns true', async () => {
    mockPrisma.user.update.mockResolvedValue(makeDbUser());
    const expires = new Date('2026-06-30T00:00:00.000Z');

    const ok = await repo.setPasswordResetToken('user-1', 'tok', expires);

    expect(ok).toBe(true);
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { passwordResetToken: 'tok', passwordResetExpires: expires },
    });
  });

  it('returns false when prisma throws', async () => {
    mockPrisma.user.update.mockRejectedValue(new Error('boom'));
    expect(await repo.setPasswordResetToken('user-1', 'tok', new Date())).toBe(false);
  });
});

describe('UserRepository.clearPasswordResetToken', () => {
  it('nulls the reset token + expiry and returns true', async () => {
    mockPrisma.user.update.mockResolvedValue(makeDbUser());

    const ok = await repo.clearPasswordResetToken('user-1');

    expect(ok).toBe(true);
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { passwordResetToken: null, passwordResetExpires: null },
    });
  });

  it('returns false when prisma throws', async () => {
    mockPrisma.user.update.mockRejectedValue(new Error('boom'));
    expect(await repo.clearPasswordResetToken('user-1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// findByPasswordResetToken — findFirst with unexpired token
// ---------------------------------------------------------------------------

describe('UserRepository.findByPasswordResetToken', () => {
  it('queries by token with an unexpired (gt: now) guard and maps with password', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(makeDbUser());
    const before = Date.now();

    const result = await repo.findByPasswordResetToken('tok');

    const after = Date.now();
    expect(mockPrisma.user.findFirst).toHaveBeenCalledTimes(1);
    const arg = mockPrisma.user.findFirst.mock.calls[0][0];
    expect(arg.where.passwordResetToken).toBe('tok');
    expect(arg.where.passwordResetExpires.gt).toBeInstanceOf(Date);
    const gt = (arg.where.passwordResetExpires.gt as Date).getTime();
    expect(gt).toBeGreaterThanOrEqual(before);
    expect(gt).toBeLessThanOrEqual(after);
    expect(result?.passwordHash).toBe('hash-abc');
  });

  it('returns null when no matching (unexpired) token row exists', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(null);
    expect(await repo.findByPasswordResetToken('tok')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// updateLastLogin
// ---------------------------------------------------------------------------

describe('UserRepository.updateLastLogin', () => {
  it('stamps lastLoginAt with a Date and returns true', async () => {
    mockPrisma.user.update.mockResolvedValue(makeDbUser());

    const ok = await repo.updateLastLogin('user-1');

    expect(ok).toBe(true);
    const arg = mockPrisma.user.update.mock.calls[0][0];
    expect(arg.where).toEqual({ id: 'user-1' });
    expect(arg.data.lastLoginAt).toBeInstanceOf(Date);
  });

  it('returns false when prisma throws', async () => {
    mockPrisma.user.update.mockRejectedValue(new Error('boom'));
    expect(await repo.updateLastLogin('user-1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// delete
// ---------------------------------------------------------------------------

describe('UserRepository.delete', () => {
  it('deletes by id and returns true on success', async () => {
    mockPrisma.user.delete.mockResolvedValue(makeDbUser());

    const ok = await repo.delete('user-1');

    expect(ok).toBe(true);
    expect(mockPrisma.user.delete).toHaveBeenCalledWith({ where: { id: 'user-1' } });
  });

  it('returns false when prisma.delete throws (record not found)', async () => {
    mockPrisma.user.delete.mockRejectedValue(new Error('not found'));
    expect(await repo.delete('missing')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// emailExists — count > 0, email lower-cased
// ---------------------------------------------------------------------------

describe('UserRepository.emailExists', () => {
  it('returns true when count > 0 and lower-cases the email', async () => {
    mockPrisma.user.count.mockResolvedValue(1);

    const exists = await repo.emailExists('Alice@Example.COM');

    expect(exists).toBe(true);
    expect(mockPrisma.user.count).toHaveBeenCalledWith({
      where: { email: 'alice@example.com' },
    });
  });

  it('returns false when count is 0', async () => {
    mockPrisma.user.count.mockResolvedValue(0);
    expect(await repo.emailExists('nobody@x.com')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Exported singleton shares the mocked prisma
// ---------------------------------------------------------------------------

describe('userRepository singleton', () => {
  it('uses the same mocked prisma client', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(makeDbUser());
    const result = await userRepository.findById('user-1');
    expect(result?.id).toBe('user-1');
  });
});
