/**
 * @file LogExportService.test.ts
 * @description Unit tests for LogExportService — export filtering, formatting, decryption, history grouping
 * @feature compliance
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExportOptions } from '../../types/retention.types.js';

// Mock prisma before importing the service
vi.mock('../../database/index.js', () => ({
  prisma: {
    complianceLog: {
      findMany: vi.fn(),
    },
    complianceLogAccess: {
      createMany: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

// Mock encryption so we control decrypt behavior
vi.mock('../../security/encryption.js', () => ({
  decrypt: vi.fn(),
}));

import { LogExportService } from '../LogExportService.js';

// Helper to build a raw prisma compliance log row
function makeLog(overrides: Record<string, unknown> = {}) {
  return {
    id: 'log-1',
    sessionId: 'sess-1',
    robotId: 'robot-1',
    operatorId: 'op-1',
    eventType: 'ai_decision',
    severity: 'info',
    payloadHash: 'phash',
    payloadEncrypted: 'cipher',
    payloadIv: 'iv',
    modelVersion: 'm1',
    inputHash: 'ih',
    outputHash: 'oh',
    previousHash: 'prev',
    currentHash: 'curr',
    decisionId: 'dec-1',
    timestamp: new Date('2024-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('LogExportService', () => {
  let service: LogExportService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new LogExportService();
  });

  describe('exportToJson — query building', () => {
    it('builds an empty where clause when no options provided', async () => {
      const { prisma } = await import('../../database/index.js');
      vi.mocked(prisma.complianceLog.findMany).mockResolvedValue([] as never);

      await service.exportToJson({});

      expect(prisma.complianceLog.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: { timestamp: 'asc' },
      });
    });

    it('combines startDate and endDate into a single timestamp range', async () => {
      const { prisma } = await import('../../database/index.js');
      vi.mocked(prisma.complianceLog.findMany).mockResolvedValue([] as never);

      const start = new Date('2024-01-01T00:00:00.000Z');
      const end = new Date('2024-02-01T00:00:00.000Z');
      const options: ExportOptions = { startDate: start, endDate: end };
      await service.exportToJson(options);

      const callArg = vi.mocked(prisma.complianceLog.findMany).mock.calls[0][0] as {
        where: { timestamp: { gte: Date; lte: Date } };
      };
      expect(callArg.where.timestamp.gte).toBe(start);
      expect(callArg.where.timestamp.lte).toBe(end);
    });

    it('applies eventTypes, robotIds, and sessionIds filters with `in`', async () => {
      const { prisma } = await import('../../database/index.js');
      vi.mocked(prisma.complianceLog.findMany).mockResolvedValue([] as never);

      await service.exportToJson({
        eventTypes: ['ai_decision', 'safety_action'],
        robotIds: ['r1'],
        sessionIds: ['s1', 's2'],
      });

      const callArg = vi.mocked(prisma.complianceLog.findMany).mock.calls[0][0] as {
        where: {
          eventType: { in: string[] };
          robotId: { in: string[] };
          sessionId: { in: string[] };
        };
      };
      expect(callArg.where.eventType).toEqual({ in: ['ai_decision', 'safety_action'] });
      expect(callArg.where.robotId).toEqual({ in: ['r1'] });
      expect(callArg.where.sessionId).toEqual({ in: ['s1', 's2'] });
    });

    it('ignores empty array filters', async () => {
      const { prisma } = await import('../../database/index.js');
      vi.mocked(prisma.complianceLog.findMany).mockResolvedValue([] as never);

      await service.exportToJson({ eventTypes: [], robotIds: [], sessionIds: [] });

      expect(prisma.complianceLog.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: { timestamp: 'asc' },
      });
    });
  });

  describe('exportToJson — result formatting', () => {
    it('maps log fields and formats timestamp as ISO string', async () => {
      const { prisma } = await import('../../database/index.js');
      vi.mocked(prisma.complianceLog.findMany).mockResolvedValue([makeLog()] as never);
      vi.mocked(prisma.complianceLogAccess.createMany).mockResolvedValue({ count: 1 } as never);

      const result = await service.exportToJson({}, 'admin');

      expect(result.recordCount).toBe(1);
      expect(result.exportedBy).toBe('admin');
      expect(result.filename).toMatch(/^compliance-export-.*\.json$/);
      expect(result.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

      const log = result.data[0];
      expect(log.id).toBe('log-1');
      expect(log.timestamp).toBe('2024-01-01T00:00:00.000Z');
      // payload omitted when not decrypting
      expect(log.payload).toBeUndefined();
    });

    it('returns exportedBy as null when not supplied', async () => {
      const { prisma } = await import('../../database/index.js');
      vi.mocked(prisma.complianceLog.findMany).mockResolvedValue([] as never);

      const result = await service.exportToJson({});
      expect(result.exportedBy).toBeNull();
    });

    it('does not record access when there are no logs', async () => {
      const { prisma } = await import('../../database/index.js');
      vi.mocked(prisma.complianceLog.findMany).mockResolvedValue([] as never);

      await service.exportToJson({}, 'admin');
      expect(prisma.complianceLogAccess.createMany).not.toHaveBeenCalled();
    });

    it('records an export access entry per log', async () => {
      const { prisma } = await import('../../database/index.js');
      vi.mocked(prisma.complianceLog.findMany).mockResolvedValue([
        makeLog({ id: 'a' }),
        makeLog({ id: 'b' }),
      ] as never);
      vi.mocked(prisma.complianceLogAccess.createMany).mockResolvedValue({ count: 2 } as never);

      await service.exportToJson({}, 'admin');

      expect(prisma.complianceLogAccess.createMany).toHaveBeenCalledWith({
        data: [
          { logId: 'a', userId: 'admin', accessType: 'export' },
          { logId: 'b', userId: 'admin', accessType: 'export' },
        ],
      });
    });
  });

  describe('exportToJson — decryption', () => {
    it('decrypts and parses payload when includeDecrypted is true', async () => {
      const { prisma } = await import('../../database/index.js');
      const { decrypt } = await import('../../security/encryption.js');
      vi.mocked(prisma.complianceLog.findMany).mockResolvedValue([makeLog()] as never);
      vi.mocked(prisma.complianceLogAccess.createMany).mockResolvedValue({ count: 1 } as never);
      vi.mocked(decrypt).mockReturnValue(JSON.stringify({ action: 'pick' }));

      const result = await service.exportToJson({ includeDecrypted: true });

      expect(decrypt).toHaveBeenCalledWith({ ciphertext: 'cipher', iv: 'iv' });
      expect(result.data[0].payload).toEqual({ action: 'pick' });
    });

    it('sets an error payload when decryption throws', async () => {
      const { prisma } = await import('../../database/index.js');
      const { decrypt } = await import('../../security/encryption.js');
      vi.mocked(prisma.complianceLog.findMany).mockResolvedValue([makeLog()] as never);
      vi.mocked(prisma.complianceLogAccess.createMany).mockResolvedValue({ count: 1 } as never);
      vi.mocked(decrypt).mockImplementation(() => {
        throw new Error('boom');
      });

      const result = await service.exportToJson({ includeDecrypted: true });
      expect(result.data[0].payload).toEqual({ error: 'Decryption failed' });
    });
  });

  describe('getExportHistory', () => {
    it('groups accesses within the same second + user and counts them', async () => {
      const { prisma } = await import('../../database/index.js');
      const t = new Date('2024-01-01T12:00:00.500Z');
      const tSameSecond = new Date('2024-01-01T12:00:00.900Z');
      const tOther = new Date('2024-01-01T12:00:05.000Z');

      vi.mocked(prisma.complianceLogAccess.findMany).mockResolvedValue([
        { timestamp: t, userId: 'u1' },
        { timestamp: tSameSecond, userId: 'u1' },
        { timestamp: tOther, userId: 'u1' },
      ] as never);

      const history = await service.getExportHistory();

      expect(history).toHaveLength(2);
      const first = history.find((h) => h.logCount === 2);
      expect(first).toBeDefined();
      expect(first?.userId).toBe('u1');
    });

    it('treats different users in the same second as separate groups', async () => {
      const { prisma } = await import('../../database/index.js');
      const t = new Date('2024-01-01T12:00:00.000Z');

      vi.mocked(prisma.complianceLogAccess.findMany).mockResolvedValue([
        { timestamp: t, userId: 'u1' },
        { timestamp: t, userId: 'u2' },
      ] as never);

      const history = await service.getExportHistory();
      expect(history).toHaveLength(2);
      expect(history.every((h) => h.logCount === 1)).toBe(true);
    });

    it('respects the limit parameter', async () => {
      const { prisma } = await import('../../database/index.js');
      // Three distinct-second groups, limit 2 => only 2 returned
      vi.mocked(prisma.complianceLogAccess.findMany).mockResolvedValue([
        { timestamp: new Date('2024-01-01T12:00:01.000Z'), userId: 'u1' },
        { timestamp: new Date('2024-01-01T12:00:02.000Z'), userId: 'u1' },
        { timestamp: new Date('2024-01-01T12:00:03.000Z'), userId: 'u1' },
      ] as never);

      const history = await service.getExportHistory(2);
      expect(history).toHaveLength(2);
    });
  });
});
