/**
 * @file ConsentService.test.ts
 * @description Unit tests for ConsentService — GDPR consent grant/revoke/update, queries, metrics
 * @feature gdpr
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ConsentType, ConsentUpdateBatch } from '../../types/gdpr.types.js';

// ---------------------------------------------------------------------------
// Mock prisma before importing the service
// ---------------------------------------------------------------------------

vi.mock('../../database/index.js', () => ({
  prisma: {
    userConsent: {
      upsert: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      groupBy: vi.fn(),
    },
    user: {
      count: vi.fn(),
    },
  },
}));

import { ConsentService } from '../ConsentService.js';
import { prisma as _prisma } from '../../database/index.js';

// Retype the mocked prisma so `.mockResolvedValue` etc. typecheck.
const prisma = vi.mocked(_prisma, true);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'consent-1',
    userId: 'user-1',
    consentType: 'marketing',
    granted: true,
    grantedAt: new Date('2024-01-01'),
    revokedAt: null,
    version: '1.0.0',
    ipAddress: '127.0.0.1',
    userAgent: 'jest',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-02'),
    ...overrides,
  };
}

let service: ConsentService;

beforeEach(() => {
  vi.clearAllMocks();
  service = new ConsentService();
});

// ===========================================================================
// grantConsent
// ===========================================================================

describe('grantConsent', () => {
  it('upserts consent as granted and maps the result', async () => {
    prisma.userConsent.upsert.mockResolvedValue(makeRow() as never);

    const result = await service.grantConsent('user-1', 'marketing', '1.2.3.4', 'agent');

    expect(result.id).toBe('consent-1');
    expect(result.granted).toBe(true);
    expect(result.consentType).toBe('marketing');
    expect(prisma.userConsent.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_consentType: { userId: 'user-1', consentType: 'marketing' } },
        create: expect.objectContaining({ granted: true, ipAddress: '1.2.3.4', userAgent: 'agent' }),
        update: expect.objectContaining({ granted: true, revokedAt: null }),
      }),
    );
  });

  it('propagates errors from prisma', async () => {
    prisma.userConsent.upsert.mockRejectedValue(new Error('db down') as never);
    await expect(service.grantConsent('user-1', 'analytics')).rejects.toThrow('db down');
  });
});

// ===========================================================================
// revokeConsent
// ===========================================================================

describe('revokeConsent', () => {
  it('updates consent to not granted with a revokedAt timestamp', async () => {
    prisma.userConsent.update.mockResolvedValue(
      makeRow({ granted: false, revokedAt: new Date('2024-02-01') }) as never,
    );

    const result = await service.revokeConsent('user-1', 'marketing');

    expect(result.granted).toBe(false);
    expect(result.revokedAt).toEqual(new Date('2024-02-01'));
    expect(prisma.userConsent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_consentType: { userId: 'user-1', consentType: 'marketing' } },
        data: expect.objectContaining({ granted: false }),
      }),
    );
  });

  it('propagates errors when the record does not exist', async () => {
    prisma.userConsent.update.mockRejectedValue(new Error('not found') as never);
    await expect(service.revokeConsent('user-1', 'marketing')).rejects.toThrow('not found');
  });
});

// ===========================================================================
// updateConsent
// ===========================================================================

describe('updateConsent', () => {
  it('delegates to grant when granted=true', async () => {
    prisma.userConsent.upsert.mockResolvedValue(makeRow() as never);

    const result = await service.updateConsent('user-1', 'marketing', true);

    expect(result.granted).toBe(true);
    expect(prisma.userConsent.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.userConsent.update).not.toHaveBeenCalled();
  });

  it('delegates to revoke when granted=false', async () => {
    prisma.userConsent.update.mockResolvedValue(makeRow({ granted: false }) as never);

    const result = await service.updateConsent('user-1', 'marketing', false);

    expect(result.granted).toBe(false);
    expect(prisma.userConsent.update).toHaveBeenCalledTimes(1);
    expect(prisma.userConsent.upsert).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// updateMultipleConsents
// ===========================================================================

describe('updateMultipleConsents', () => {
  it('processes each entry and returns all results', async () => {
    prisma.userConsent.upsert.mockResolvedValue(makeRow({ consentType: 'marketing' }) as never);
    prisma.userConsent.update.mockResolvedValue(
      makeRow({ consentType: 'analytics', granted: false }) as never,
    );

    const batch: ConsentUpdateBatch = {
      consents: [
        { consentType: 'marketing', granted: true },
        { consentType: 'analytics', granted: false },
      ],
      ipAddress: '9.9.9.9',
      userAgent: 'batch',
    };

    const results = await service.updateMultipleConsents('user-1', batch);

    expect(results).toHaveLength(2);
    expect(prisma.userConsent.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.userConsent.update).toHaveBeenCalledTimes(1);
    // batch ip/userAgent forwarded to grant path
    expect(prisma.userConsent.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ ipAddress: '9.9.9.9', userAgent: 'batch' }),
      }),
    );
  });

  it('returns an empty array for an empty batch', async () => {
    const results = await service.updateMultipleConsents('user-1', { consents: [] });
    expect(results).toEqual([]);
  });
});

// ===========================================================================
// getUserConsents
// ===========================================================================

describe('getUserConsents', () => {
  it('returns mapped consents ordered by type', async () => {
    prisma.userConsent.findMany.mockResolvedValue([
      makeRow({ id: 'a', consentType: 'analytics' }),
      makeRow({ id: 'm', consentType: 'marketing' }),
    ] as never);

    const result = await service.getUserConsents('user-1');

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('a');
    expect(prisma.userConsent.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      orderBy: { consentType: 'asc' },
    });
  });

  it('returns an empty array when the user has no consents', async () => {
    prisma.userConsent.findMany.mockResolvedValue([] as never);
    const result = await service.getUserConsents('user-1');
    expect(result).toEqual([]);
  });
});

// ===========================================================================
// hasConsent
// ===========================================================================

describe('hasConsent', () => {
  it('returns true when a granted consent exists', async () => {
    prisma.userConsent.findUnique.mockResolvedValue(makeRow({ granted: true }) as never);
    await expect(service.hasConsent('user-1', 'marketing')).resolves.toBe(true);
  });

  it('returns false when the consent is revoked', async () => {
    prisma.userConsent.findUnique.mockResolvedValue(makeRow({ granted: false }) as never);
    await expect(service.hasConsent('user-1', 'marketing')).resolves.toBe(false);
  });

  it('returns false when no consent record exists', async () => {
    prisma.userConsent.findUnique.mockResolvedValue(null as never);
    await expect(service.hasConsent('user-1', 'marketing')).resolves.toBe(false);
  });
});

// ===========================================================================
// getConsent
// ===========================================================================

describe('getConsent', () => {
  it('returns a mapped consent when found', async () => {
    prisma.userConsent.findUnique.mockResolvedValue(makeRow() as never);
    const result = await service.getConsent('user-1', 'marketing');
    expect(result?.id).toBe('consent-1');
  });

  it('returns null when not found', async () => {
    prisma.userConsent.findUnique.mockResolvedValue(null as never);
    const result = await service.getConsent('user-1', 'marketing');
    expect(result).toBeNull();
  });
});

// ===========================================================================
// revokeAllConsents
// ===========================================================================

describe('revokeAllConsents', () => {
  it('updates all granted consents and returns the count', async () => {
    prisma.userConsent.updateMany.mockResolvedValue({ count: 3 } as never);

    const count = await service.revokeAllConsents('user-1');

    expect(count).toBe(3);
    expect(prisma.userConsent.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-1', granted: true },
        data: expect.objectContaining({ granted: false }),
      }),
    );
  });

  it('propagates errors', async () => {
    prisma.userConsent.updateMany.mockRejectedValue(new Error('boom') as never);
    await expect(service.revokeAllConsents('user-1')).rejects.toThrow('boom');
  });
});

// ===========================================================================
// initializeDefaults
// ===========================================================================

describe('initializeDefaults', () => {
  it('creates all five default consents when none exist', async () => {
    prisma.userConsent.findUnique.mockResolvedValue(null as never);
    prisma.userConsent.create.mockImplementation(
      (async (args: { data: { consentType: string } }) =>
        makeRow({ granted: false, consentType: args.data.consentType })) as never,
    );

    const result = await service.initializeDefaults('user-1');

    expect(result).toHaveLength(5);
    expect(prisma.userConsent.create).toHaveBeenCalledTimes(5);
    const types = result.map((c) => c.consentType).sort();
    expect(types).toEqual(['ai_processing', 'analytics', 'data_sharing', 'marketing', 'third_party']);
  });

  it('skips consents that already exist', async () => {
    // Every type already exists.
    prisma.userConsent.findUnique.mockResolvedValue(makeRow() as never);

    const result = await service.initializeDefaults('user-1');

    expect(result).toEqual([]);
    expect(prisma.userConsent.create).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// getConsentMetrics
// ===========================================================================

describe('getConsentMetrics', () => {
  it('aggregates grant/revoke counts per consent type', async () => {
    prisma.user.count.mockResolvedValue(10 as never);
    prisma.userConsent.groupBy.mockResolvedValue([
      { consentType: 'marketing', granted: true, _count: 7 },
      { consentType: 'marketing', granted: false, _count: 3 },
      { consentType: 'analytics', granted: true, _count: 5 },
    ] as never);

    const result = await service.getConsentMetrics();

    expect(result.totalUsers).toBe(10);
    expect(result.consentsByType['marketing']).toEqual({ granted: 7, revoked: 3 });
    expect(result.consentsByType['analytics']).toEqual({ granted: 5, revoked: 0 });
    expect(prisma.user.count).toHaveBeenCalledWith({ where: { isActive: true } });
  });

  it('returns empty consentsByType when there are no consent rows', async () => {
    prisma.user.count.mockResolvedValue(0 as never);
    prisma.userConsent.groupBy.mockResolvedValue([] as never);

    const result = await service.getConsentMetrics();

    expect(result.totalUsers).toBe(0);
    expect(result.consentsByType).toEqual({});
  });
});

// ===========================================================================
// type-narrowing helper usage (ensures ConsentType import is exercised)
// ===========================================================================

describe('consent type handling', () => {
  it('handles all known consent types via hasConsent', async () => {
    const types: ConsentType[] = ['marketing', 'analytics', 'ai_processing', 'data_sharing', 'third_party'];
    prisma.userConsent.findUnique.mockResolvedValue(makeRow({ granted: true }) as never);

    for (const t of types) {
      await expect(service.hasConsent('user-1', t)).resolves.toBe(true);
    }
    expect(prisma.userConsent.findUnique).toHaveBeenCalledTimes(types.length);
  });
});
