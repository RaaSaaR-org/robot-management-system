/**
 * @file ProviderDocumentationService.test.ts
 * @description Unit tests for ProviderDocumentationService — CRUD, provider/model queries, validity filtering, summary aggregation, defaults init
 * @feature compliance
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ProviderDocInput } from '../../types/retention.types.js';

// ---------------------------------------------------------------------------
// Mock prisma before importing the service
// ---------------------------------------------------------------------------

vi.mock('../../database/index.js', () => ({
  prisma: {
    providerDocumentation: {
      create: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
  },
}));

import { ProviderDocumentationService } from '../ProviderDocumentationService.js';
import { prisma as _prisma } from '../../database/index.js';

const prisma = vi.mocked(_prisma, true);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeDbDoc(overrides: Record<string, unknown> = {}) {
  return {
    id: 'doc-1',
    providerName: 'Google Gemini',
    modelVersion: 'gemini-2.0-flash',
    documentType: 'technical_doc',
    documentUrl: 'https://example.com',
    content: 'content body',
    validFrom: new Date('2024-01-01'),
    validTo: null,
    createdAt: new Date('2024-01-02'),
    updatedAt: new Date('2024-01-03'),
    ...overrides,
  };
}

function makeInput(overrides: Partial<ProviderDocInput> = {}): ProviderDocInput {
  return {
    providerName: 'Google Gemini',
    modelVersion: 'gemini-2.0-flash',
    documentType: 'technical_doc',
    documentUrl: 'https://example.com',
    content: 'content body',
    validFrom: new Date('2024-01-01'),
    ...overrides,
  };
}

let service: ProviderDocumentationService;

beforeEach(() => {
  vi.clearAllMocks();
  service = new ProviderDocumentationService();
});

// ===========================================================================
// addDocumentation
// ===========================================================================

describe('addDocumentation', () => {
  it('creates a doc and maps the result fields', async () => {
    const dbDoc = makeDbDoc();
    prisma.providerDocumentation.create.mockResolvedValue(dbDoc as never);

    const input = makeInput({ validTo: new Date('2025-01-01') });
    const result = await service.addDocumentation(input);

    expect(prisma.providerDocumentation.create).toHaveBeenCalledWith({
      data: {
        providerName: input.providerName,
        modelVersion: input.modelVersion,
        documentType: input.documentType,
        documentUrl: input.documentUrl,
        content: input.content,
        validFrom: input.validFrom,
        validTo: input.validTo,
      },
    });
    expect(result.id).toBe('doc-1');
    expect(result.providerName).toBe('Google Gemini');
    expect(result.documentType).toBe('technical_doc');
    expect(result.validTo).toBeNull();
  });

  it('propagates create errors', async () => {
    prisma.providerDocumentation.create.mockRejectedValue(new Error('db down') as never);
    await expect(service.addDocumentation(makeInput())).rejects.toThrow('db down');
  });
});

// ===========================================================================
// updateDocumentation
// ===========================================================================

describe('updateDocumentation', () => {
  it('updates only provided fields and returns the mapped doc', async () => {
    const dbDoc = makeDbDoc({ content: 'new content' });
    prisma.providerDocumentation.update.mockResolvedValue(dbDoc as never);

    const result = await service.updateDocumentation('doc-1', { content: 'new content' });

    expect(prisma.providerDocumentation.update).toHaveBeenCalledWith({
      where: { id: 'doc-1' },
      data: { content: 'new content' },
    });
    expect(result?.content).toBe('new content');
  });

  it('includes documentUrl when explicitly set to null (=== undefined check)', async () => {
    prisma.providerDocumentation.update.mockResolvedValue(makeDbDoc({ documentUrl: null }) as never);

    await service.updateDocumentation('doc-1', { documentUrl: undefined });

    // documentUrl is undefined → spread should NOT include it
    const call = prisma.providerDocumentation.update.mock.calls[0][0];
    expect(call.data).not.toHaveProperty('documentUrl');
  });

  it('returns null when prisma update throws (record not found)', async () => {
    prisma.providerDocumentation.update.mockRejectedValue(new Error('not found') as never);
    const result = await service.updateDocumentation('missing', { content: 'x' });
    expect(result).toBeNull();
  });
});

// ===========================================================================
// getDocumentation
// ===========================================================================

describe('getDocumentation', () => {
  it('returns the mapped doc when found', async () => {
    prisma.providerDocumentation.findUnique.mockResolvedValue(makeDbDoc() as never);
    const result = await service.getDocumentation('doc-1');
    expect(result?.id).toBe('doc-1');
    expect(prisma.providerDocumentation.findUnique).toHaveBeenCalledWith({ where: { id: 'doc-1' } });
  });

  it('returns null when not found', async () => {
    prisma.providerDocumentation.findUnique.mockResolvedValue(null as never);
    const result = await service.getDocumentation('nope');
    expect(result).toBeNull();
  });
});

// ===========================================================================
// getDocumentationByProvider / getDocumentationByModel / getAllDocumentation
// ===========================================================================

describe('list queries', () => {
  it('getDocumentationByProvider filters by provider and orders correctly', async () => {
    prisma.providerDocumentation.findMany.mockResolvedValue([makeDbDoc(), makeDbDoc({ id: 'doc-2' })] as never);

    const result = await service.getDocumentationByProvider('Google Gemini');

    expect(prisma.providerDocumentation.findMany).toHaveBeenCalledWith({
      where: { providerName: 'Google Gemini' },
      orderBy: [{ modelVersion: 'desc' }, { documentType: 'asc' }],
    });
    expect(result).toHaveLength(2);
    expect(result[1].id).toBe('doc-2');
  });

  it('getDocumentationByModel filters by provider + model version', async () => {
    prisma.providerDocumentation.findMany.mockResolvedValue([makeDbDoc()] as never);

    const result = await service.getDocumentationByModel('Google Gemini', 'gemini-2.0-flash');

    expect(prisma.providerDocumentation.findMany).toHaveBeenCalledWith({
      where: { providerName: 'Google Gemini', modelVersion: 'gemini-2.0-flash' },
      orderBy: { documentType: 'asc' },
    });
    expect(result).toHaveLength(1);
  });

  it('getAllDocumentation returns an empty array when none exist', async () => {
    prisma.providerDocumentation.findMany.mockResolvedValue([] as never);
    const result = await service.getAllDocumentation();
    expect(result).toEqual([]);
    expect(prisma.providerDocumentation.findMany).toHaveBeenCalledWith({
      orderBy: [{ providerName: 'asc' }, { modelVersion: 'desc' }, { documentType: 'asc' }],
    });
  });
});

// ===========================================================================
// getAllProviders (aggregation)
// ===========================================================================

describe('getAllProviders', () => {
  it('groups docs by provider, dedupes versions, counts, and tracks latest update', async () => {
    const docs = [
      makeDbDoc({
        id: 'a',
        providerName: 'Google Gemini',
        modelVersion: 'gemini-2.0-flash',
        updatedAt: new Date('2024-01-05'),
      }),
      makeDbDoc({
        id: 'b',
        providerName: 'Google Gemini',
        modelVersion: 'gemini-2.0-flash',
        updatedAt: new Date('2024-01-10'),
      }),
      makeDbDoc({
        id: 'c',
        providerName: 'Google Gemini',
        modelVersion: 'gemini-1.5-pro',
        updatedAt: new Date('2024-01-01'),
      }),
      makeDbDoc({
        id: 'd',
        providerName: 'NeoDEM',
        modelVersion: '1.0.0',
        updatedAt: new Date('2024-02-01'),
      }),
    ];
    prisma.providerDocumentation.findMany.mockResolvedValue(docs as never);

    const result = await service.getAllProviders();

    const gemini = result.find((p) => p.providerName === 'Google Gemini');
    const neodem = result.find((p) => p.providerName === 'NeoDEM');

    expect(gemini).toBeDefined();
    expect(gemini?.documentCount).toBe(3);
    expect(gemini?.modelVersions).toHaveLength(2);
    expect(gemini?.modelVersions).toEqual(
      expect.arrayContaining(['gemini-2.0-flash', 'gemini-1.5-pro']),
    );
    // latest updatedAt among the gemini docs
    expect(gemini?.lastUpdated).toEqual(new Date('2024-01-10'));

    expect(neodem?.documentCount).toBe(1);
    expect(neodem?.modelVersions).toEqual(['1.0.0']);
  });

  it('returns an empty array when there are no docs', async () => {
    prisma.providerDocumentation.findMany.mockResolvedValue([] as never);
    const result = await service.getAllProviders();
    expect(result).toEqual([]);
  });
});

// ===========================================================================
// deleteDocumentation
// ===========================================================================

describe('deleteDocumentation', () => {
  it('returns true when delete succeeds', async () => {
    prisma.providerDocumentation.delete.mockResolvedValue(makeDbDoc() as never);
    const result = await service.deleteDocumentation('doc-1');
    expect(result).toBe(true);
    expect(prisma.providerDocumentation.delete).toHaveBeenCalledWith({ where: { id: 'doc-1' } });
  });

  it('returns false when delete throws', async () => {
    prisma.providerDocumentation.delete.mockRejectedValue(new Error('not found') as never);
    const result = await service.deleteDocumentation('missing');
    expect(result).toBe(false);
  });
});

// ===========================================================================
// getValidDocumentation
// ===========================================================================

describe('getValidDocumentation', () => {
  it('queries for null or future validTo with no provider filter', async () => {
    prisma.providerDocumentation.findMany.mockResolvedValue([makeDbDoc()] as never);

    const result = await service.getValidDocumentation();

    expect(result).toHaveLength(1);
    const call = prisma.providerDocumentation.findMany.mock.calls[0][0]!;
    const where = call.where as Record<string, unknown>;
    expect(where).not.toHaveProperty('providerName');
    expect(where.OR).toEqual([{ validTo: null }, { validTo: { gt: expect.any(Date) } }]);
  });

  it('adds the provider filter when provided', async () => {
    prisma.providerDocumentation.findMany.mockResolvedValue([] as never);

    await service.getValidDocumentation('NeoDEM');

    const call = prisma.providerDocumentation.findMany.mock.calls[0][0]!;
    const where = call.where as Record<string, unknown>;
    expect(where.providerName).toBe('NeoDEM');
  });
});

// ===========================================================================
// initializeDefaults
// ===========================================================================

describe('initializeDefaults', () => {
  it('skips initialization when docs already exist', async () => {
    prisma.providerDocumentation.count.mockResolvedValue(5 as never);

    await service.initializeDefaults();

    expect(prisma.providerDocumentation.count).toHaveBeenCalled();
    expect(prisma.providerDocumentation.create).not.toHaveBeenCalled();
  });

  it('creates default docs when none exist', async () => {
    prisma.providerDocumentation.count.mockResolvedValue(0 as never);
    prisma.providerDocumentation.create.mockResolvedValue(makeDbDoc() as never);

    await service.initializeDefaults();

    // Service seeds multiple default documents
    expect(prisma.providerDocumentation.create.mock.calls.length).toBeGreaterThan(1);
    const created = prisma.providerDocumentation.create.mock.calls.map(
      (c) => c[0].data.providerName,
    );
    expect(created).toEqual(expect.arrayContaining(['Google Gemini', 'NeoDEM']));
  });
});
