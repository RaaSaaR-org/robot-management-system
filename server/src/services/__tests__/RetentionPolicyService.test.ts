/**
 * @file RetentionPolicyService.test.ts
 * @description Unit tests for RetentionPolicyService — defaults, upsert, expiration window, deletion guard
 * @feature compliance
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DEFAULT_RETENTION_DAYS } from '../../types/retention.types.js';

// Mock prisma before importing the service
vi.mock('../../database/index.js', () => ({
  prisma: {
    retentionPolicy: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      findMany: vi.fn(),
      delete: vi.fn(),
      create: vi.fn(),
    },
  },
}));

import { RetentionPolicyService } from '../RetentionPolicyService.js';

describe('RetentionPolicyService', () => {
  let service: RetentionPolicyService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new RetentionPolicyService();
  });

  describe('getPolicy', () => {
    it('returns a custom policy when one exists', async () => {
      const { prisma } = await import('../../database/index.js');
      vi.mocked(prisma.retentionPolicy.findUnique).mockResolvedValue({
        id: 'p1',
        eventType: 'ai_decision',
        retentionDays: 100,
        description: 'custom',
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-02'),
      } as never);

      const policy = await service.getPolicy('ai_decision');
      expect(policy.id).toBe('p1');
      expect(policy.retentionDays).toBe(100);
      expect(policy.description).toBe('custom');
    });

    it('falls back to the default policy when none exists', async () => {
      const { prisma } = await import('../../database/index.js');
      vi.mocked(prisma.retentionPolicy.findUnique).mockResolvedValue(null as never);

      const policy = await service.getPolicy('safety_action');
      expect(policy.id).toBe('default-safety_action');
      expect(policy.retentionDays).toBe(DEFAULT_RETENTION_DAYS.safety_action);
      expect(policy.eventType).toBe('safety_action');
    });
  });

  describe('setPolicy', () => {
    it('upserts the policy with create and update payloads', async () => {
      const { prisma } = await import('../../database/index.js');
      vi.mocked(prisma.retentionPolicy.upsert).mockResolvedValue({
        id: 'p1',
        eventType: 'command_execution',
        retentionDays: 30,
        description: 'desc',
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
      } as never);

      const result = await service.setPolicy({
        eventType: 'command_execution',
        retentionDays: 30,
        description: 'desc',
      });

      expect(prisma.retentionPolicy.upsert).toHaveBeenCalledWith({
        where: { eventType: 'command_execution' },
        create: {
          eventType: 'command_execution',
          retentionDays: 30,
          description: 'desc',
        },
        update: {
          retentionDays: 30,
          description: 'desc',
        },
      });
      expect(result.retentionDays).toBe(30);
    });
  });

  describe('getAllPolicies', () => {
    it('returns all five event types, mixing custom and default', async () => {
      const { prisma } = await import('../../database/index.js');
      vi.mocked(prisma.retentionPolicy.findMany).mockResolvedValue([
        {
          id: 'p-ai',
          eventType: 'ai_decision',
          retentionDays: 999,
          description: 'custom ai',
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01'),
        },
      ] as never);

      const policies = await service.getAllPolicies();
      expect(policies).toHaveLength(5);

      const ai = policies.find((p) => p.eventType === 'ai_decision');
      expect(ai?.id).toBe('p-ai');
      expect(ai?.retentionDays).toBe(999);

      const system = policies.find((p) => p.eventType === 'system_event');
      expect(system?.id).toBe('default-system_event');
      expect(system?.retentionDays).toBe(DEFAULT_RETENTION_DAYS.system_event);
    });
  });

  describe('calculateExpirationDate', () => {
    it('adds the policy retentionDays to the current date', async () => {
      const { prisma } = await import('../../database/index.js');
      vi.mocked(prisma.retentionPolicy.findUnique).mockResolvedValue(null as never);

      const before = new Date();
      const expiration = await service.calculateExpirationDate('ai_decision');

      const expected = new Date();
      expected.setDate(before.getDate() + DEFAULT_RETENTION_DAYS.ai_decision);

      // Allow a small tolerance for execution time (within a couple of days/ms drift)
      const diffMs = Math.abs(expiration.getTime() - expected.getTime());
      expect(diffMs).toBeLessThan(1000 * 60 * 60); // < 1 hour drift
      expect(expiration.getTime()).toBeGreaterThan(before.getTime());
    });

    it('uses a custom policy retentionDays when present', async () => {
      const { prisma } = await import('../../database/index.js');
      vi.mocked(prisma.retentionPolicy.findUnique).mockResolvedValue({
        id: 'p1',
        eventType: 'system_event',
        retentionDays: 10,
        description: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as never);

      const now = new Date();
      const expiration = await service.calculateExpirationDate('system_event');
      const expected = new Date();
      expected.setDate(now.getDate() + 10);

      expect(Math.abs(expiration.getTime() - expected.getTime())).toBeLessThan(1000 * 60 * 60);
    });
  });

  describe('deletePolicy', () => {
    it('returns true when delete succeeds', async () => {
      const { prisma } = await import('../../database/index.js');
      vi.mocked(prisma.retentionPolicy.delete).mockResolvedValue({} as never);

      expect(await service.deletePolicy('access_audit')).toBe(true);
    });

    it('returns false when the policy does not exist (delete throws)', async () => {
      const { prisma } = await import('../../database/index.js');
      vi.mocked(prisma.retentionPolicy.delete).mockRejectedValue(new Error('not found'));

      expect(await service.deletePolicy('access_audit')).toBe(false);
    });
  });

  describe('initializeDefaults', () => {
    it('creates only missing policies', async () => {
      const { prisma } = await import('../../database/index.js');
      // Iteration order in the service: ai_decision, safety_action, command_execution,
      // system_event, access_audit. First one exists, the rest are missing.
      const findUnique = vi.mocked(prisma.retentionPolicy.findUnique);
      findUnique.mockResolvedValueOnce({ id: 'existing' } as never);
      findUnique.mockResolvedValue(null as never);
      vi.mocked(prisma.retentionPolicy.create).mockResolvedValue({} as never);

      await service.initializeDefaults();

      // 5 event types, 1 exists => 4 creates
      expect(prisma.retentionPolicy.create).toHaveBeenCalledTimes(4);
      const created = vi
        .mocked(prisma.retentionPolicy.create)
        .mock.calls.map((c) => (c[0] as { data: { eventType: string } }).data.eventType);
      expect(created).not.toContain('ai_decision');
      expect(created).toContain('safety_action');
    });
  });
});
