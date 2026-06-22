/**
 * @file ServiceAccountService.test.ts
 * @description Unit tests for ServiceAccountService — service account CRUD, API
 *   token mint/list/revoke/rotate, and the `authenticateServiceToken` middleware
 *   helper. All external boundaries (prisma client, ComplianceLogService, token
 *   generation, logger) are mocked. No real DB / network / filesystem access.
 * @feature auth
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';

// ---------------------------------------------------------------------------
// Mock external boundaries
// ---------------------------------------------------------------------------

// Prisma client (service imports `{ prisma }` from '../database/index.js').
const prismaMock = vi.hoisted(() => ({
  user: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  apiToken: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('../../database/index.js', () => ({
  prisma: prismaMock,
}));

// Compliance audit log — fire-and-forget side effect.
vi.mock('../ComplianceLogService.js', () => ({
  complianceLogService: {
    getOrCreateSession: vi.fn(() => ({ sessionId: 'sess-1' })),
    logAccess: vi.fn(),
  },
}));

// Deterministic token generation (wraps crypto otherwise).
vi.mock('../../utils/tokens.js', () => ({
  generateToken: vi.fn(() => ({
    plaintext: 'ndsa_PLAINTEXT_TOKEN',
    prefix: 'ndsa_PREFIX',
    hash: 'deadbeef',
  })),
  hashToken: vi.fn((raw: string) => `hash(${raw})`),
  timingSafeEqualHex: vi.fn((a: string, b: string) => a === b),
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import {
  ServiceAccountService,
  serviceAccountService,
  authenticateServiceToken,
  InvalidServiceRoleError,
  ServiceAccountNotFoundError,
  TokenNotFoundError,
  DuplicateNameError,
  DuplicateTokenNameError,
} from '../ServiceAccountService.js';
import { complianceLogService as _complianceLogService } from '../ComplianceLogService.js';
import {
  generateToken as _generateToken,
  hashToken as _hashToken,
  timingSafeEqualHex as _timingSafeEqualHex,
} from '../../utils/tokens.js';

// Retyped mock handles so .mock* methods typecheck.
const prisma = prismaMock;
const complianceLogService = vi.mocked(_complianceLogService, true);
const generateToken = vi.mocked(_generateToken);
const hashToken = vi.mocked(_hashToken);
const timingSafeEqualHex = vi.mocked(_timingSafeEqualHex);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOW = new Date('2026-01-01T00:00:00.000Z');

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: string;
  isActive: boolean;
  kind: string;
  tenantId: string | null;
  createdById: string | null;
  createdAt: Date;
  apiTokens?: Array<{ lastUsedAt: Date | null }>;
}

function makeUserRow(overrides: Partial<UserRow> = {}): UserRow {
  return {
    id: 'sa-1',
    email: 'bot@service.local',
    name: 'Bot',
    role: 'member',
    isActive: true,
    kind: 'service',
    tenantId: 't1',
    createdById: 'actor-1',
    createdAt: NOW,
    ...overrides,
  };
}

interface TokenRow {
  id: string;
  name: string;
  prefix: string;
  hash: string;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  createdById: string;
}

function makeTokenRow(overrides: Partial<TokenRow> = {}): TokenRow {
  return {
    id: 'tok-1',
    name: 'CI token',
    prefix: 'ndsa_PREFIX',
    hash: 'deadbeef',
    expiresAt: new Date('2026-04-01T00:00:00.000Z'),
    lastUsedAt: null,
    revokedAt: null,
    createdAt: NOW,
    createdById: 'actor-1',
    ...overrides,
  };
}

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '5.0.0',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  complianceLogService.getOrCreateSession.mockReturnValue({ sessionId: 'sess-1' } as never);
  complianceLogService.logAccess.mockResolvedValue(undefined as never);
  generateToken.mockReturnValue({
    plaintext: 'ndsa_PLAINTEXT_TOKEN',
    prefix: 'ndsa_PREFIX',
    hash: 'deadbeef',
  });
});

// ===========================================================================
// list
// ===========================================================================

describe('list', () => {
  it('maps rows to DTOs, counts active tokens and picks the latest lastUsedAt', async () => {
    const used1 = new Date('2026-02-01T00:00:00.000Z');
    const used2 = new Date('2026-03-01T00:00:00.000Z');
    prisma.user.findMany.mockResolvedValue([
      makeUserRow({
        id: 'sa-1',
        apiTokens: [{ lastUsedAt: used1 }, { lastUsedAt: used2 }, { lastUsedAt: null }],
      }),
    ] as never);

    const result = await serviceAccountService.list('t1');

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'sa-1',
      kind: 'service',
      tokenCount: 3,
      lastUsedAt: used2.toISOString(),
      createdAt: NOW.toISOString(),
    });
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: 't1', kind: 'service' } })
    );
  });

  it('returns lastUsedAt=null when no tokens have ever been used', async () => {
    prisma.user.findMany.mockResolvedValue([
      makeUserRow({ apiTokens: [{ lastUsedAt: null }] }),
    ] as never);

    const result = await serviceAccountService.list('t1');
    expect(result[0].lastUsedAt).toBeNull();
    expect(result[0].tokenCount).toBe(1);
  });
});

// ===========================================================================
// create
// ===========================================================================

describe('create', () => {
  it('creates a service account user and writes an audit log', async () => {
    prisma.user.create.mockResolvedValue(
      makeUserRow({ id: 'sa-new', name: 'My Bot', email: 'my-bot@service.local' }) as never
    );

    const result = await serviceAccountService.create({
      tenantId: 't1',
      name: 'My Bot',
      role: 'member',
      actorId: 'actor-1',
    });

    expect(result).toMatchObject({ id: 'sa-new', kind: 'service', tokenCount: 0, lastUsedAt: null });
    // email slugified
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'my-bot@service.local',
          name: 'My Bot',
          kind: 'service',
          role: 'member',
          tenantId: 't1',
          createdById: 'actor-1',
        }),
      })
    );
    expect(complianceLogService.logAccess).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ action: 'service_account.create' }),
      })
    );
  });

  it('rejects an unassignable role before touching the DB', async () => {
    await expect(
      serviceAccountService.create({
        tenantId: 't1',
        name: 'Bad',
        // intentionally invalid role to exercise validation
        role: 'owner' as never,
        actorId: 'actor-1',
      })
    ).rejects.toBeInstanceOf(InvalidServiceRoleError);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('translates a P2002 unique violation into DuplicateNameError', async () => {
    prisma.user.create.mockRejectedValue(p2002());

    await expect(
      serviceAccountService.create({
        tenantId: 't1',
        name: 'Dupe',
        role: 'viewer',
        actorId: 'actor-1',
      })
    ).rejects.toBeInstanceOf(DuplicateNameError);
  });

  it('re-throws unknown DB errors unchanged', async () => {
    const boom = new Error('connection lost');
    prisma.user.create.mockRejectedValue(boom);

    await expect(
      serviceAccountService.create({
        tenantId: 't1',
        name: 'X',
        role: 'member',
        actorId: 'actor-1',
      })
    ).rejects.toBe(boom);
  });
});

// ===========================================================================
// delete
// ===========================================================================

describe('delete', () => {
  it('soft-deletes (isActive=false) and audits', async () => {
    prisma.user.findFirst.mockResolvedValue(makeUserRow() as never);
    prisma.user.update.mockResolvedValue(makeUserRow({ isActive: false }) as never);

    await serviceAccountService.delete({
      tenantId: 't1',
      serviceAccountId: 'sa-1',
      actorId: 'actor-1',
    });

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'sa-1' },
      data: { isActive: false },
    });
    expect(complianceLogService.logAccess).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ action: 'service_account.delete' }),
      })
    );
  });

  it('throws ServiceAccountNotFoundError when no matching account', async () => {
    prisma.user.findFirst.mockResolvedValue(null as never);

    await expect(
      serviceAccountService.delete({
        tenantId: 't1',
        serviceAccountId: 'missing',
        actorId: 'actor-1',
      })
    ).rejects.toBeInstanceOf(ServiceAccountNotFoundError);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// listTokens
// ===========================================================================

describe('listTokens', () => {
  it('maps token rows to DTOs with ISO date strings', async () => {
    const revoked = new Date('2026-05-01T00:00:00.000Z');
    prisma.apiToken.findMany.mockResolvedValue([
      makeTokenRow({ id: 'tok-1' }),
      makeTokenRow({ id: 'tok-2', expiresAt: null, revokedAt: revoked }),
    ] as never);

    const result = await serviceAccountService.listTokens('sa-1');

    expect(result).toHaveLength(2);
    expect(result[0].expiresAt).toBe(new Date('2026-04-01T00:00:00.000Z').toISOString());
    expect(result[1].expiresAt).toBeNull();
    expect(result[1].revokedAt).toBe(revoked.toISOString());
    expect(prisma.apiToken.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'sa-1' } })
    );
  });
});

// ===========================================================================
// createToken
// ===========================================================================

describe('createToken', () => {
  it('mints a token and returns the plaintext exactly once', async () => {
    prisma.user.findFirst.mockResolvedValue(makeUserRow() as never);
    prisma.apiToken.create.mockResolvedValue(makeTokenRow({ id: 'tok-new' }) as never);

    const result = await serviceAccountService.createToken({
      serviceAccountId: 'sa-1',
      name: 'CI token',
      actorId: 'actor-1',
    });

    expect(result.plaintext).toBe('ndsa_PLAINTEXT_TOKEN');
    expect(result.token.id).toBe('tok-new');
    expect(result.token.revokedAt).toBeNull();
    expect(prisma.apiToken.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'sa-1',
          prefix: 'ndsa_PREFIX',
          hash: 'deadbeef',
          createdById: 'actor-1',
        }),
      })
    );
    expect(complianceLogService.logAccess).toHaveBeenCalledWith(
      expect.objectContaining({ payload: expect.objectContaining({ action: 'token.create' }) })
    );
  });

  it('throws ServiceAccountNotFoundError when the account is missing', async () => {
    prisma.user.findFirst.mockResolvedValue(null as never);

    await expect(
      serviceAccountService.createToken({
        serviceAccountId: 'missing',
        name: 'x',
        actorId: 'actor-1',
      })
    ).rejects.toBeInstanceOf(ServiceAccountNotFoundError);
    expect(prisma.apiToken.create).not.toHaveBeenCalled();
  });

  it('rejects an out-of-range expiry', async () => {
    prisma.user.findFirst.mockResolvedValue(makeUserRow() as never);

    await expect(
      serviceAccountService.createToken({
        serviceAccountId: 'sa-1',
        name: 'x',
        expiresInDays: 9999,
        actorId: 'actor-1',
      })
    ).rejects.toThrow('Token expiry must be between 1 and 365 days');
    expect(prisma.apiToken.create).not.toHaveBeenCalled();
  });

  it('translates a P2002 unique violation into DuplicateTokenNameError', async () => {
    prisma.user.findFirst.mockResolvedValue(makeUserRow() as never);
    prisma.apiToken.create.mockRejectedValue(p2002());

    await expect(
      serviceAccountService.createToken({
        serviceAccountId: 'sa-1',
        name: 'dupe',
        actorId: 'actor-1',
      })
    ).rejects.toBeInstanceOf(DuplicateTokenNameError);
  });
});

// ===========================================================================
// revokeToken
// ===========================================================================

describe('revokeToken', () => {
  it('sets revokedAt and returns the updated DTO', async () => {
    const revoked = new Date('2026-06-01T00:00:00.000Z');
    prisma.apiToken.findFirst.mockResolvedValue(makeTokenRow() as never);
    prisma.apiToken.update.mockResolvedValue(makeTokenRow({ revokedAt: revoked }) as never);

    const result = await serviceAccountService.revokeToken({
      tokenId: 'tok-1',
      serviceAccountId: 'sa-1',
      actorId: 'actor-1',
    });

    expect(result.revokedAt).toBe(revoked.toISOString());
    expect(prisma.apiToken.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'tok-1' },
        data: expect.objectContaining({ revokedAt: expect.any(Date) }),
      })
    );
    expect(complianceLogService.logAccess).toHaveBeenCalledWith(
      expect.objectContaining({ payload: expect.objectContaining({ action: 'token.revoke' }) })
    );
  });

  it('throws TokenNotFoundError for an unknown token', async () => {
    prisma.apiToken.findFirst.mockResolvedValue(null as never);

    await expect(
      serviceAccountService.revokeToken({
        tokenId: 'missing',
        serviceAccountId: 'sa-1',
        actorId: 'actor-1',
      })
    ).rejects.toBeInstanceOf(TokenNotFoundError);
    expect(prisma.apiToken.update).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// rotateToken
// ===========================================================================

describe('rotateToken', () => {
  it('grace-expires the old token, mints a renamed new token and returns both', async () => {
    prisma.apiToken.findFirst.mockResolvedValue(makeTokenRow({ name: 'CI token' }) as never);
    prisma.apiToken.update.mockResolvedValue(makeTokenRow() as never);
    prisma.apiToken.create.mockResolvedValue(
      makeTokenRow({ id: 'tok-rotated', name: 'CI token (rotated)' }) as never
    );

    const result = await serviceAccountService.rotateToken({
      tokenId: 'tok-1',
      serviceAccountId: 'sa-1',
      actorId: 'actor-1',
    });

    expect(result.newToken.id).toBe('tok-rotated');
    expect(result.newToken.name).toBe('CI token (rotated)');
    expect(result.plaintext).toBe('ndsa_PLAINTEXT_TOKEN');
    expect(typeof result.oldTokenExpiresAt).toBe('string');

    // old token given a grace expiry
    expect(prisma.apiToken.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'tok-1' },
        data: expect.objectContaining({ expiresAt: expect.any(Date) }),
      })
    );
    // new token created with the rotated name
    expect(prisma.apiToken.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: 'CI token (rotated)', userId: 'sa-1' }),
      })
    );
    expect(complianceLogService.logAccess).toHaveBeenCalledWith(
      expect.objectContaining({ payload: expect.objectContaining({ action: 'token.rotate' }) })
    );
  });

  it('throws TokenNotFoundError when the source token is missing', async () => {
    prisma.apiToken.findFirst.mockResolvedValue(null as never);

    await expect(
      serviceAccountService.rotateToken({
        tokenId: 'missing',
        serviceAccountId: 'sa-1',
        actorId: 'actor-1',
      })
    ).rejects.toBeInstanceOf(TokenNotFoundError);
    expect(prisma.apiToken.update).not.toHaveBeenCalled();
    expect(prisma.apiToken.create).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// authenticateServiceToken
// ===========================================================================

describe('authenticateServiceToken', () => {
  function makeCandidate(overrides: {
    token?: Partial<TokenRow>;
    user?: Partial<UserRow>;
  } = {}) {
    return {
      ...makeTokenRow({ hash: 'hash(ndsa_GOODTOKEN)', expiresAt: null, ...overrides.token }),
      user: makeUserRow({ kind: 'service', isActive: true, ...overrides.user }),
    };
  }

  it('returns the resolved identity for a valid active service token', async () => {
    prisma.apiToken.findMany.mockResolvedValue([makeCandidate()] as never);
    prisma.apiToken.update.mockResolvedValue(makeTokenRow() as never);
    // hashToken / timingSafeEqualHex are mocked: expected hash == stored hash.
    hashToken.mockReturnValue('hash(ndsa_GOODTOKEN)');
    timingSafeEqualHex.mockImplementation((a, b) => a === b);

    const result = await authenticateServiceToken('ndsa_GOODTOKEN');

    expect(result).not.toBeNull();
    expect(result?.userId).toBe('sa-1');
    expect(result?.tokenId).toBe('tok-1');
    expect(result?.role).toBe('member');
    // best-effort lastUsedAt stamp issued
    expect(prisma.apiToken.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'tok-1' } })
    );
  });

  it('returns null when no hash matches', async () => {
    prisma.apiToken.findMany.mockResolvedValue([makeCandidate()] as never);
    hashToken.mockReturnValue('hash(wrong)');
    timingSafeEqualHex.mockImplementation((a, b) => a === b);

    const result = await authenticateServiceToken('ndsa_WRONG');
    expect(result).toBeNull();
    expect(prisma.apiToken.update).not.toHaveBeenCalled();
  });

  it('rejects non-service or inactive users even with a matching hash', async () => {
    prisma.apiToken.findMany.mockResolvedValue([
      makeCandidate({ user: { kind: 'human', isActive: true } }),
    ] as never);
    hashToken.mockReturnValue('hash(ndsa_GOODTOKEN)');
    timingSafeEqualHex.mockImplementation((a, b) => a === b);

    const result = await authenticateServiceToken('ndsa_GOODTOKEN');
    expect(result).toBeNull();
  });

  it('rejects an expired token', async () => {
    prisma.apiToken.findMany.mockResolvedValue([
      makeCandidate({ token: { expiresAt: new Date('2000-01-01T00:00:00.000Z') } }),
    ] as never);
    hashToken.mockReturnValue('hash(ndsa_GOODTOKEN)');
    timingSafeEqualHex.mockImplementation((a, b) => a === b);

    const result = await authenticateServiceToken('ndsa_GOODTOKEN');
    expect(result).toBeNull();
  });

  it('returns null when there are no candidates for the prefix', async () => {
    prisma.apiToken.findMany.mockResolvedValue([] as never);
    const result = await authenticateServiceToken('ndsa_NONE');
    expect(result).toBeNull();
  });
});

// ===========================================================================
// audit log resilience
// ===========================================================================

describe('audit log resilience', () => {
  it('does not fail the operation when the compliance log throws', async () => {
    prisma.user.create.mockResolvedValue(makeUserRow({ id: 'sa-x' }) as never);
    complianceLogService.logAccess.mockRejectedValue(new Error('audit down') as never);

    await expect(
      serviceAccountService.create({
        tenantId: 't1',
        name: 'Resilient',
        role: 'member',
        actorId: 'actor-1',
      })
    ).resolves.toMatchObject({ id: 'sa-x' });
  });
});

describe('module exports', () => {
  it('exposes a singleton instance of the service class', () => {
    expect(serviceAccountService).toBeInstanceOf(ServiceAccountService);
  });
});
