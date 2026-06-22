/**
 * @file EventRepository.test.ts
 * @description Unit tests for EventRepository — Prisma-backed CRUD for A2A events with real domain<->db mapping
 * @feature a2a
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock for the Prisma singleton (the I/O boundary).
// Mappers from ../../database/types.js are NOT mocked — they run for real.
// ---------------------------------------------------------------------------

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    event: {
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

vi.mock('../../database/index.js', () => ({
  prisma: mockPrisma,
}));

import { EventRepository, eventRepository } from '../EventRepository.js';
import type { A2AEvent } from '../../types/index.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TS = 1_700_000_000_000;

function makeDomainEvent(overrides: Partial<A2AEvent> = {}): A2AEvent {
  return {
    id: 'evt-1',
    actor: 'robot-1',
    content: {
      messageId: 'msg-1',
      role: 'agent',
      parts: [{ kind: 'text', text: 'hello' }],
    },
    timestamp: TS,
    ...overrides,
  };
}

/** A db-row shape that dbEventToDomain accepts (content = JSON string, timestamp = Date). */
function makeDbRow(overrides: Partial<{ id: string; actor: string; content: string; timestamp: Date }> = {}) {
  return {
    id: 'evt-1',
    actor: 'robot-1',
    content: JSON.stringify({ messageId: 'msg-1', role: 'agent', parts: [] }),
    timestamp: new Date(TS),
    ...overrides,
  };
}

describe('EventRepository', () => {
  let repo: EventRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new EventRepository();
    // Default: count low enough that pruneOldEvents is a no-op.
    mockPrisma.event.count.mockResolvedValue(0);
    mockPrisma.event.create.mockResolvedValue(undefined);
    mockPrisma.event.deleteMany.mockResolvedValue({ count: 0 });
  });

  describe('create', () => {
    it('maps the domain event to a db row and calls prisma.event.create', async () => {
      const event = makeDomainEvent();

      await repo.create(event);

      expect(mockPrisma.event.create).toHaveBeenCalledTimes(1);
      const arg = mockPrisma.event.create.mock.calls[0][0];
      expect(arg.data.id).toBe('evt-1');
      expect(arg.data.actor).toBe('robot-1');
      // content is JSON-stringified by the real mapper
      expect(typeof arg.data.content).toBe('string');
      expect(JSON.parse(arg.data.content)).toEqual(event.content);
      // timestamp is converted to a Date by the real mapper
      expect(arg.data.timestamp).toBeInstanceOf(Date);
      expect((arg.data.timestamp as Date).getTime()).toBe(TS);
    });

    it('triggers async pruning that does nothing when count <= MAX_EVENTS', async () => {
      mockPrisma.event.count.mockResolvedValue(500);

      await repo.create(makeDomainEvent());
      // let the fire-and-forget prune promise settle
      await Promise.resolve();
      await Promise.resolve();

      expect(mockPrisma.event.deleteMany).not.toHaveBeenCalled();
    });

    it('prunes oldest events when count exceeds MAX_EVENTS', async () => {
      mockPrisma.event.count.mockResolvedValue(1002);
      mockPrisma.event.findMany.mockResolvedValue([{ id: 'old-1' }, { id: 'old-2' }]);

      await repo.create(makeDomainEvent());
      await new Promise((r) => setImmediate(r));

      expect(mockPrisma.event.findMany).toHaveBeenCalledWith({
        orderBy: { timestamp: 'asc' },
        take: 2,
        select: { id: true },
      });
      expect(mockPrisma.event.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['old-1', 'old-2'] } },
      });
    });

    it('swallows pruning errors (create still resolves)', async () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockPrisma.event.count.mockRejectedValue(new Error('boom'));

      await expect(repo.create(makeDomainEvent())).resolves.toBeUndefined();
      await new Promise((r) => setImmediate(r));

      expect(errSpy).toHaveBeenCalled();
      errSpy.mockRestore();
    });
  });

  describe('findAll', () => {
    it('queries ordered ascending with MAX_EVENTS take and maps results', async () => {
      mockPrisma.event.findMany.mockResolvedValue([makeDbRow(), makeDbRow({ id: 'evt-2' })]);

      const result = await repo.findAll();

      expect(mockPrisma.event.findMany).toHaveBeenCalledWith({
        orderBy: { timestamp: 'asc' },
        take: 1000,
      });
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: 'evt-1',
        actor: 'robot-1',
        content: { messageId: 'msg-1', role: 'agent', parts: [] },
        timestamp: TS,
      });
      expect(result[1].id).toBe('evt-2');
    });

    it('returns an empty array when there are no events', async () => {
      mockPrisma.event.findMany.mockResolvedValue([]);
      await expect(repo.findAll()).resolves.toEqual([]);
    });
  });

  describe('findSince', () => {
    it('filters by timestamp > given Date, ordered ascending', async () => {
      mockPrisma.event.findMany.mockResolvedValue([makeDbRow()]);

      const result = await repo.findSince(TS);

      expect(mockPrisma.event.findMany).toHaveBeenCalledTimes(1);
      const arg = mockPrisma.event.findMany.mock.calls[0][0];
      expect(arg.orderBy).toEqual({ timestamp: 'asc' });
      expect(arg.where.timestamp.gt).toBeInstanceOf(Date);
      expect((arg.where.timestamp.gt as Date).getTime()).toBe(TS);
      expect(result[0].id).toBe('evt-1');
    });

    it('returns empty array when nothing is newer', async () => {
      mockPrisma.event.findMany.mockResolvedValue([]);
      await expect(repo.findSince(TS)).resolves.toEqual([]);
    });
  });

  describe('findByActor', () => {
    it('filters by actor, ordered ascending, and maps results', async () => {
      mockPrisma.event.findMany.mockResolvedValue([makeDbRow({ actor: 'robot-9' })]);

      const result = await repo.findByActor('robot-9');

      expect(mockPrisma.event.findMany).toHaveBeenCalledWith({
        where: { actor: 'robot-9' },
        orderBy: { timestamp: 'asc' },
      });
      expect(result[0].actor).toBe('robot-9');
    });

    it('falls back to the DEFAULT_MESSAGE when content JSON is invalid', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      mockPrisma.event.findMany.mockResolvedValue([makeDbRow({ content: 'not-json{' })]);

      const result = await repo.findByActor('robot-1');

      expect(result[0].content).toEqual({ messageId: 'unknown', role: 'agent', parts: [] });
      warnSpy.mockRestore();
    });
  });

  describe('count', () => {
    it('returns the prisma count', async () => {
      mockPrisma.event.count.mockResolvedValue(42);
      await expect(repo.count()).resolves.toBe(42);
      expect(mockPrisma.event.count).toHaveBeenCalledWith();
    });
  });

  describe('clear', () => {
    it('deletes all events', async () => {
      await repo.clear();
      expect(mockPrisma.event.deleteMany).toHaveBeenCalledWith();
    });
  });

  describe('singleton export', () => {
    it('shares the mocked prisma client', async () => {
      mockPrisma.event.count.mockResolvedValue(7);
      await expect(eventRepository.count()).resolves.toBe(7);
    });
  });
});
