/**
 * @file RopaService.test.ts
 * @description Unit tests for RopaService — RoPA record building, JSON (de)serialization, report generation
 * @feature compliance
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RopaEntryInput } from '../../types/retention.types.js';

// Mock prisma before importing the service
vi.mock('../../database/index.js', () => ({
  prisma: {
    ropaEntry: {
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
  },
}));

import { RopaService } from '../RopaService.js';

const sampleInput: RopaEntryInput = {
  processingActivity: 'Test Activity',
  purpose: 'Testing',
  dataCategories: ['a', 'b'],
  dataSubjects: ['operators'],
  recipients: ['internal'],
  thirdCountryTransfers: 'none',
  retentionPeriod: '1 year',
  securityMeasures: ['encryption'],
  legalBasis: 'consent',
};

// A Prisma row stores arrays as JSON strings
const makeRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'ropa-1',
  processingActivity: 'Test Activity',
  purpose: 'Testing',
  dataCategories: JSON.stringify(['a', 'b']),
  dataSubjects: JSON.stringify(['operators']),
  recipients: JSON.stringify(['internal']),
  thirdCountryTransfers: 'none',
  retentionPeriod: '1 year',
  securityMeasures: JSON.stringify(['encryption']),
  legalBasis: 'consent',
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-02'),
  ...overrides,
});

describe('RopaService', () => {
  let service: RopaService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new RopaService();
  });

  describe('createEntry', () => {
    it('serializes array fields to JSON strings when writing to the DB', async () => {
      const { prisma } = await import('../../database/index.js');
      vi.mocked(prisma.ropaEntry.create).mockResolvedValue(makeRow() as never);

      await service.createEntry(sampleInput);

      const callArg = vi.mocked(prisma.ropaEntry.create).mock.calls[0][0];
      expect(callArg.data.dataCategories).toBe(JSON.stringify(['a', 'b']));
      expect(callArg.data.dataSubjects).toBe(JSON.stringify(['operators']));
      expect(callArg.data.recipients).toBe(JSON.stringify(['internal']));
      expect(callArg.data.securityMeasures).toBe(JSON.stringify(['encryption']));
      expect(callArg.data.processingActivity).toBe('Test Activity');
    });

    it('deserializes JSON array fields back into string[] in the returned entry', async () => {
      const { prisma } = await import('../../database/index.js');
      vi.mocked(prisma.ropaEntry.create).mockResolvedValue(makeRow() as never);

      const entry = await service.createEntry(sampleInput);

      expect(entry.dataCategories).toEqual(['a', 'b']);
      expect(entry.dataSubjects).toEqual(['operators']);
      expect(entry.recipients).toEqual(['internal']);
      expect(entry.securityMeasures).toEqual(['encryption']);
      expect(entry.id).toBe('ropa-1');
    });

    it('returns empty arrays when stored JSON is malformed', async () => {
      const { prisma } = await import('../../database/index.js');
      vi.mocked(prisma.ropaEntry.create).mockResolvedValue(
        makeRow({ dataCategories: 'not-json' }) as never
      );

      const entry = await service.createEntry(sampleInput);
      expect(entry.dataCategories).toEqual([]);
    });
  });

  describe('updateEntry', () => {
    it('only includes provided fields in the update payload', async () => {
      const { prisma } = await import('../../database/index.js');
      vi.mocked(prisma.ropaEntry.update).mockResolvedValue(makeRow() as never);

      await service.updateEntry('ropa-1', { purpose: 'New purpose' });

      const callArg = vi.mocked(prisma.ropaEntry.update).mock.calls[0][0];
      expect(callArg.data.purpose).toBe('New purpose');
      expect(callArg.data.processingActivity).toBeUndefined();
      expect(callArg.data.dataCategories).toBeUndefined();
    });

    it('serializes array fields when present in the partial update', async () => {
      const { prisma } = await import('../../database/index.js');
      vi.mocked(prisma.ropaEntry.update).mockResolvedValue(makeRow() as never);

      await service.updateEntry('ropa-1', { recipients: ['x', 'y'] });

      const callArg = vi.mocked(prisma.ropaEntry.update).mock.calls[0][0];
      expect(callArg.data.recipients).toBe(JSON.stringify(['x', 'y']));
    });

    it('includes thirdCountryTransfers when explicitly set to empty string', async () => {
      const { prisma } = await import('../../database/index.js');
      vi.mocked(prisma.ropaEntry.update).mockResolvedValue(makeRow() as never);

      await service.updateEntry('ropa-1', { thirdCountryTransfers: '' });

      const callArg = vi.mocked(prisma.ropaEntry.update).mock.calls[0][0];
      expect(callArg.data.thirdCountryTransfers).toBe('');
    });

    it('returns null when the DB update throws (entry not found)', async () => {
      const { prisma } = await import('../../database/index.js');
      vi.mocked(prisma.ropaEntry.update).mockRejectedValue(new Error('not found'));

      const result = await service.updateEntry('missing', { purpose: 'x' });
      expect(result).toBeNull();
    });
  });

  describe('getAllEntries', () => {
    it('maps and deserializes all rows', async () => {
      const { prisma } = await import('../../database/index.js');
      vi.mocked(prisma.ropaEntry.findMany).mockResolvedValue([
        makeRow({ id: 'a' }),
        makeRow({ id: 'b' }),
      ] as never);

      const entries = await service.getAllEntries();
      expect(entries).toHaveLength(2);
      expect(entries[0].id).toBe('a');
      expect(entries[1].dataCategories).toEqual(['a', 'b']);
    });
  });

  describe('getEntry', () => {
    it('returns null when not found', async () => {
      const { prisma } = await import('../../database/index.js');
      vi.mocked(prisma.ropaEntry.findUnique).mockResolvedValue(null as never);

      expect(await service.getEntry('missing')).toBeNull();
    });

    it('returns a deserialized entry when found', async () => {
      const { prisma } = await import('../../database/index.js');
      vi.mocked(prisma.ropaEntry.findUnique).mockResolvedValue(makeRow() as never);

      const entry = await service.getEntry('ropa-1');
      expect(entry?.securityMeasures).toEqual(['encryption']);
    });
  });

  describe('deleteEntry', () => {
    it('returns true on successful delete', async () => {
      const { prisma } = await import('../../database/index.js');
      vi.mocked(prisma.ropaEntry.delete).mockResolvedValue(makeRow() as never);

      expect(await service.deleteEntry('ropa-1')).toBe(true);
    });

    it('returns false when delete throws', async () => {
      const { prisma } = await import('../../database/index.js');
      vi.mocked(prisma.ropaEntry.delete).mockRejectedValue(new Error('missing'));

      expect(await service.deleteEntry('missing')).toBe(false);
    });
  });

  describe('generateReport', () => {
    it('builds a report with entries, count, and default org name', async () => {
      const { prisma } = await import('../../database/index.js');
      vi.mocked(prisma.ropaEntry.findMany).mockResolvedValue([
        makeRow({ id: 'a' }),
        makeRow({ id: 'b' }),
      ] as never);

      const report = await service.generateReport();
      expect(report.organizationName).toBe('NeoDEM');
      expect(report.totalProcessingActivities).toBe(2);
      expect(report.entries).toHaveLength(2);
      expect(() => new Date(report.generatedAt).toISOString()).not.toThrow();
    });

    it('uses the supplied organization name', async () => {
      const { prisma } = await import('../../database/index.js');
      vi.mocked(prisma.ropaEntry.findMany).mockResolvedValue([] as never);

      const report = await service.generateReport('ACME GmbH');
      expect(report.organizationName).toBe('ACME GmbH');
      expect(report.totalProcessingActivities).toBe(0);
    });
  });

  describe('initializeDefaults', () => {
    it('skips initialization when entries already exist', async () => {
      const { prisma } = await import('../../database/index.js');
      vi.mocked(prisma.ropaEntry.count).mockResolvedValue(3 as never);

      await service.initializeDefaults();
      expect(prisma.ropaEntry.create).not.toHaveBeenCalled();
    });

    it('creates the three default entries when DB is empty', async () => {
      const { prisma } = await import('../../database/index.js');
      vi.mocked(prisma.ropaEntry.count).mockResolvedValue(0 as never);
      vi.mocked(prisma.ropaEntry.create).mockResolvedValue(makeRow() as never);

      await service.initializeDefaults();
      expect(prisma.ropaEntry.create).toHaveBeenCalledTimes(3);

      const activities = vi
        .mocked(prisma.ropaEntry.create)
        .mock.calls.map((c) => c[0].data.processingActivity);
      expect(activities).toContain('AI Command Interpretation');
      expect(activities).toContain('Safety Monitoring');
      expect(activities).toContain('Compliance Audit Trail');
    });
  });
});
