/**
 * @file TeamService.test.ts
 * @description Unit tests for TeamService — tenant-scoped team member management:
 *   list, add (with temp-password generation + bcrypt hashing + P2002 duplicate
 *   handling), changeRole / deactivate (transaction-wrapped last-owner guard),
 *   reactivate, the generateTempPassword helper, and audit-log fault tolerance.
 *   The prisma client and complianceLogService are mocked; bcrypt/crypto run real.
 * @feature team
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';

// ---------------------------------------------------------------------------
// Mocks for external boundaries (prisma touches the DB, compliance log writes)
// ---------------------------------------------------------------------------

vi.mock('../../database/index.js', () => ({
  prisma: {
    user: {
      findMany: vi.fn(),
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock('../ComplianceLogService.js', () => ({
  complianceLogService: {
    getOrCreateSession: vi.fn(),
    logAccess: vi.fn(),
  },
}));

import {
  TeamService,
  teamService,
  generateTempPassword,
  LastOwnerError,
  EmailTakenError,
  InvalidRoleError,
  TeamMemberNotFoundError,
} from '../TeamService.js';
import { prisma as _prisma } from '../../database/index.js';
import { complianceLogService as _complianceLogService } from '../ComplianceLogService.js';

// Retype mocked singletons so .mock* methods typecheck (runtime unchanged).
const prisma = vi.mocked(_prisma, true);
const complianceLogService = vi.mocked(_complianceLogService, true);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: string;
  isActive: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
}

function makeRow(overrides: Partial<UserRow> = {}): UserRow {
  return {
    id: 'u1',
    email: 'alice@example.com',
    name: 'Alice',
    role: 'member',
    isActive: true,
    lastLoginAt: null,
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

/**
 * A fake transaction client whose member functions delegate to the same vi.fn
 * mocks exposed on the prisma mock, so tests configure behavior in one place.
 */
function makeTxClient() {
  return {
    user: {
      findFirst: prisma.user.findFirst,
      update: prisma.user.update,
      count: prisma.user.count,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // $transaction runs the callback against the fake tx client by default.
  vi.mocked(prisma.$transaction).mockImplementation(
    async (cb: unknown) => (cb as (tx: unknown) => unknown)(makeTxClient())
  );
  // Audit log defaults so the side-effect never throws.
  complianceLogService.getOrCreateSession.mockReturnValue({
    sessionId: 'sess-1',
  } as never);
  complianceLogService.logAccess.mockResolvedValue(undefined as never);
});

// ===========================================================================
// generateTempPassword
// ===========================================================================

describe('generateTempPassword', () => {
  it('produces a 12-character password with all character classes', () => {
    for (let i = 0; i < 50; i++) {
      const pw = generateTempPassword();
      expect(pw).toHaveLength(12);
      expect(pw).toMatch(/[a-z]/);
      expect(pw).toMatch(/[A-Z]/);
      expect(pw).toMatch(/[2-9]/);
      expect(pw).toMatch(/[!@#$%^&*]/);
    }
  });

  it('excludes ambiguous glyphs (0, 1, i, l, o, I, L, O)', () => {
    for (let i = 0; i < 50; i++) {
      expect(generateTempPassword()).not.toMatch(/[01iloILO]/);
    }
  });

  it('returns a different password on each call', () => {
    expect(generateTempPassword()).not.toBe(generateTempPassword());
  });
});

// ===========================================================================
// list
// ===========================================================================

describe('list', () => {
  it('returns human members mapped to DTOs, scoped by tenant', async () => {
    const rows = [
      makeRow({ id: 'a', isActive: true }),
      makeRow({
        id: 'b',
        isActive: false,
        lastLoginAt: new Date('2025-02-02T00:00:00.000Z'),
      }),
    ];
    prisma.user.findMany.mockResolvedValue(rows as never);

    const result = await teamService.list('t1');

    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { tenantId: 't1', kind: 'human' },
      orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
    });
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('a');
    expect(result[0].lastLoginAt).toBeNull();
    expect(result[1].lastLoginAt).toBe('2025-02-02T00:00:00.000Z');
    expect(result[1].createdAt).toBe('2025-01-01T00:00:00.000Z');
  });

  it('returns an empty array when there are no members', async () => {
    prisma.user.findMany.mockResolvedValue([] as never);
    await expect(teamService.list('t1')).resolves.toEqual([]);
  });
});

// ===========================================================================
// add
// ===========================================================================

describe('add', () => {
  const baseInput = {
    tenantId: 't1',
    name: 'Bob',
    email: 'Bob@Example.com',
    role: 'member' as const,
    actorId: 'owner-1',
  };

  it('creates a member, hashes the password, audits, and returns the temp password', async () => {
    const created = makeRow({ id: 'new', email: 'bob@example.com', name: 'Bob' });
    prisma.user.create.mockResolvedValue(created as never);

    const result = await teamService.add(baseInput);

    expect(result.member.id).toBe('new');
    expect(typeof result.tempPassword).toBe('string');
    expect(result.tempPassword.length).toBeGreaterThanOrEqual(8);

    const createArg = prisma.user.create.mock.calls[0][0] as {
      data: { email: string; name: string; passwordHash: string; forcePasswordChange: boolean; tenantId: string; isActive: boolean };
    };
    // email lowercased + trimmed, password hashed (not raw)
    expect(createArg.data.email).toBe('bob@example.com');
    expect(createArg.data.name).toBe('Bob');
    expect(createArg.data.passwordHash).not.toBe(result.tempPassword);
    expect(createArg.data.passwordHash.length).toBeGreaterThan(0);
    expect(createArg.data.forcePasswordChange).toBe(true);
    expect(createArg.data.isActive).toBe(true);
    expect(createArg.data.tenantId).toBe('t1');

    expect(complianceLogService.logAccess).toHaveBeenCalledOnce();
  });

  it('honors a caller-supplied temp password', async () => {
    prisma.user.create.mockResolvedValue(makeRow({ id: 'new' }) as never);
    const result = await teamService.add({
      ...baseInput,
      tempPassword: '  ManualPass99  ',
    });
    expect(result.tempPassword).toBe('ManualPass99');
  });

  it('throws when name or email is blank', async () => {
    await expect(
      teamService.add({ ...baseInput, name: '  ' })
    ).rejects.toThrow('name and email are required');
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('throws InvalidRoleError for a disallowed role', async () => {
    await expect(
      // @ts-expect-error intentionally invalid role
      teamService.add({ ...baseInput, role: 'super-admin' })
    ).rejects.toThrow(InvalidRoleError);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('throws when a supplied temp password is too short', async () => {
    await expect(
      teamService.add({ ...baseInput, tempPassword: 'short' })
    ).rejects.toThrow('Temporary password must be at least 8 characters');
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('maps a Prisma P2002 unique violation to EmailTakenError', async () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError('dup', {
      code: 'P2002',
      clientVersion: 'x',
    });
    prisma.user.create.mockRejectedValue(p2002 as never);

    await expect(teamService.add(baseInput)).rejects.toThrow(EmailTakenError);
    expect(complianceLogService.logAccess).not.toHaveBeenCalled();
  });

  it('rethrows non-P2002 create errors', async () => {
    prisma.user.create.mockRejectedValue(new Error('db down') as never);
    await expect(teamService.add(baseInput)).rejects.toThrow('db down');
  });
});

// ===========================================================================
// changeRole
// ===========================================================================

describe('changeRole', () => {
  const params = {
    tenantId: 't1',
    userId: 'u1',
    newRole: 'viewer' as const,
    actorId: 'owner-1',
  };

  it('updates the role and writes an audit entry', async () => {
    prisma.user.findFirst.mockResolvedValue(makeRow({ role: 'member' }) as never);
    prisma.user.update.mockResolvedValue(
      makeRow({ role: 'viewer' }) as never
    );

    const result = await teamService.changeRole(params);

    expect(result.role).toBe('viewer');
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { role: 'viewer' },
    });
    expect(prisma.user.count).not.toHaveBeenCalled();
    expect(complianceLogService.logAccess).toHaveBeenCalledOnce();
  });

  it('runs the last-owner guard when demoting an owner and proceeds if others exist', async () => {
    prisma.user.findFirst.mockResolvedValue(makeRow({ role: 'owner' }) as never);
    prisma.user.count.mockResolvedValue(2 as never);
    prisma.user.update.mockResolvedValue(makeRow({ role: 'viewer' }) as never);

    const result = await teamService.changeRole(params);

    expect(prisma.user.count).toHaveBeenCalledOnce();
    expect(result.role).toBe('viewer');
  });

  it('throws LastOwnerError when demoting the only active owner', async () => {
    prisma.user.findFirst.mockResolvedValue(makeRow({ role: 'owner' }) as never);
    prisma.user.count.mockResolvedValue(0 as never);

    await expect(teamService.changeRole(params)).rejects.toThrow(LastOwnerError);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('throws InvalidRoleError before any DB access', async () => {
    await expect(
      // @ts-expect-error invalid role
      teamService.changeRole({ ...params, newRole: 'admin' })
    ).rejects.toThrow(InvalidRoleError);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('throws TeamMemberNotFoundError when the user is missing', async () => {
    prisma.user.findFirst.mockResolvedValue(null as never);
    await expect(teamService.changeRole(params)).rejects.toThrow(
      TeamMemberNotFoundError
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('skips the owner guard when promoting an owner to owner (no-op role)', async () => {
    prisma.user.findFirst.mockResolvedValue(makeRow({ role: 'owner' }) as never);
    prisma.user.update.mockResolvedValue(makeRow({ role: 'owner' }) as never);

    await teamService.changeRole({ ...params, newRole: 'owner' });
    expect(prisma.user.count).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// deactivate
// ===========================================================================

describe('deactivate', () => {
  const params = { tenantId: 't1', userId: 'u1', actorId: 'owner-1' };

  it('deactivates a non-owner without the last-owner guard', async () => {
    prisma.user.findFirst.mockResolvedValue(makeRow({ role: 'member' }) as never);
    prisma.user.update.mockResolvedValue(
      makeRow({ isActive: false }) as never
    );

    const result = await teamService.deactivate(params);

    expect(result.isActive).toBe(false);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { isActive: false },
    });
    expect(prisma.user.count).not.toHaveBeenCalled();
    expect(complianceLogService.logAccess).toHaveBeenCalledOnce();
  });

  it('runs the last-owner guard when deactivating an owner', async () => {
    prisma.user.findFirst.mockResolvedValue(makeRow({ role: 'owner' }) as never);
    prisma.user.count.mockResolvedValue(1 as never);
    prisma.user.update.mockResolvedValue(makeRow({ isActive: false }) as never);

    await teamService.deactivate(params);
    expect(prisma.user.count).toHaveBeenCalledOnce();
  });

  it('throws LastOwnerError when deactivating the only active owner', async () => {
    prisma.user.findFirst.mockResolvedValue(makeRow({ role: 'owner' }) as never);
    prisma.user.count.mockResolvedValue(0 as never);

    await expect(teamService.deactivate(params)).rejects.toThrow(LastOwnerError);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('throws TeamMemberNotFoundError when the user is missing', async () => {
    prisma.user.findFirst.mockResolvedValue(null as never);
    await expect(teamService.deactivate(params)).rejects.toThrow(
      TeamMemberNotFoundError
    );
  });
});

// ===========================================================================
// reactivate
// ===========================================================================

describe('reactivate', () => {
  const params = { tenantId: 't1', userId: 'u1', actorId: 'owner-1' };

  it('reactivates a member and audits', async () => {
    prisma.user.findFirst.mockResolvedValue(
      makeRow({ isActive: false }) as never
    );
    prisma.user.update.mockResolvedValue(makeRow({ isActive: true }) as never);

    const result = await teamService.reactivate(params);

    expect(result.isActive).toBe(true);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { isActive: true },
    });
    expect(complianceLogService.logAccess).toHaveBeenCalledOnce();
  });

  it('throws TeamMemberNotFoundError when the user is missing', async () => {
    prisma.user.findFirst.mockResolvedValue(null as never);
    await expect(teamService.reactivate(params)).rejects.toThrow(
      TeamMemberNotFoundError
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// audit-log fault tolerance
// ===========================================================================

describe('audit logging', () => {
  it('does not fail the primary mutation when audit logging throws', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    prisma.user.create.mockResolvedValue(makeRow({ id: 'new' }) as never);
    complianceLogService.logAccess.mockRejectedValue(
      new Error('audit boom') as never
    );

    const result = await teamService.add({
      tenantId: 't1',
      name: 'Bob',
      email: 'bob@example.com',
      role: 'member',
      actorId: 'owner-1',
    });

    expect(result.member.id).toBe('new');
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

// ===========================================================================
// class export sanity
// ===========================================================================

describe('TeamService class', () => {
  it('is constructable and the singleton is an instance of it', () => {
    expect(teamService).toBeInstanceOf(TeamService);
    expect(new TeamService()).toBeInstanceOf(TeamService);
  });
});
