/**
 * @file ConversationRepository.test.ts
 * @description Unit tests for ConversationRepository — Prisma-backed CRUD for A2A conversations + messages, with real domain<->db mapping
 * @feature a2a
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { A2AMessage } from '../../types/index.js';

// ---------------------------------------------------------------------------
// Hoisted mock for the Prisma singleton (the I/O boundary).
// The repo imports { prisma } from '../database/index.js'.
// ---------------------------------------------------------------------------

const { mockPrisma } = vi.hoisted(() => {
  return {
    mockPrisma: {
      conversation: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        count: vi.fn(),
      },
      message: {
        create: vi.fn(),
        findMany: vi.fn(),
      },
    } as {
      conversation: {
        findUnique: ReturnType<typeof vi.fn>;
        findMany: ReturnType<typeof vi.fn>;
        create: ReturnType<typeof vi.fn>;
        update: ReturnType<typeof vi.fn>;
        count: ReturnType<typeof vi.fn>;
      };
      message: {
        create: ReturnType<typeof vi.fn>;
        findMany: ReturnType<typeof vi.fn>;
      };
    },
  };
});

vi.mock('../../database/index.js', () => ({
  prisma: mockPrisma,
}));

import { ConversationRepository, conversationRepository } from '../ConversationRepository.js';

// ---------------------------------------------------------------------------
// Fixtures — shapes must satisfy the REAL mappers in database/types.ts
// (dbConversationToDomain, dbMessageToDomain). JSON-string fields + Date fields.
// ---------------------------------------------------------------------------

function makeDbMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: 'msg-1',
    role: 'user',
    parts: JSON.stringify([{ kind: 'text', text: 'hello' }]),
    conversationId: 'conv-1',
    taskId: null,
    metadata: null,
    timestamp: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function makeDbConversation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'conv-1',
    name: 'Test Conversation',
    isActive: true,
    robotId: 'robot-1',
    deletedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    messages: [makeDbMessage()],
    tasks: [{ id: 'task-1' }, { id: 'task-2' }],
    ...overrides,
  };
}

function makeDomainMessage(overrides: Partial<A2AMessage> = {}): A2AMessage {
  return {
    messageId: 'msg-domain-1',
    role: 'agent',
    parts: [{ kind: 'text', text: 'hi there' }],
    contextId: 'conv-1',
    timestamp: '2026-02-01T00:00:00.000Z',
    ...overrides,
  } as A2AMessage;
}

const repo = new ConversationRepository();

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// findById
// ---------------------------------------------------------------------------

describe('ConversationRepository.findById', () => {
  it('queries findUnique with deletedAt:null and includes ordered messages + tasks (default includeMessages)', async () => {
    mockPrisma.conversation.findUnique.mockResolvedValue(makeDbConversation());

    const result = await repo.findById('conv-1');

    expect(mockPrisma.conversation.findUnique).toHaveBeenCalledWith({
      where: { id: 'conv-1', deletedAt: null },
      include: {
        messages: { orderBy: { timestamp: 'asc' } },
        tasks: true,
      },
    });
    expect(result).not.toBeNull();
    expect(result!.conversationId).toBe('conv-1');
    expect(result!.name).toBe('Test Conversation');
    expect(result!.isActive).toBe(true);
    expect(result!.robotId).toBe('robot-1');
    expect(result!.taskIds).toEqual(['task-1', 'task-2']);
    expect(result!.messages).toHaveLength(1);
    expect(result!.messages[0].messageId).toBe('msg-1');
    expect(result!.messages[0].parts).toEqual([{ kind: 'text', text: 'hello' }]);
    expect(result!.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(result!.updatedAt).toBe('2026-01-02T00:00:00.000Z');
  });

  it('passes messages:false to include when includeMessages=false', async () => {
    mockPrisma.conversation.findUnique.mockResolvedValue(
      makeDbConversation({ messages: undefined })
    );

    const result = await repo.findById('conv-1', false);

    expect(mockPrisma.conversation.findUnique).toHaveBeenCalledWith({
      where: { id: 'conv-1', deletedAt: null },
      include: {
        messages: false,
        tasks: true,
      },
    });
    // mapper falls back to [] when messages are absent
    expect(result!.messages).toEqual([]);
  });

  it('returns null when prisma returns null', async () => {
    mockPrisma.conversation.findUnique.mockResolvedValue(null);

    const result = await repo.findById('missing');

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// findAll
// ---------------------------------------------------------------------------

describe('ConversationRepository.findAll', () => {
  it('queries findMany with deletedAt:null, ordered by updatedAt desc, mapping each row', async () => {
    mockPrisma.conversation.findMany.mockResolvedValue([
      makeDbConversation({ id: 'conv-1' }),
      makeDbConversation({ id: 'conv-2', messages: [], tasks: [] }),
    ]);

    const result = await repo.findAll();

    expect(mockPrisma.conversation.findMany).toHaveBeenCalledWith({
      where: { deletedAt: null },
      include: {
        messages: { orderBy: { timestamp: 'asc' } },
        tasks: true,
      },
      orderBy: { updatedAt: 'desc' },
    });
    expect(result).toHaveLength(2);
    expect(result[0].conversationId).toBe('conv-1');
    expect(result[1].conversationId).toBe('conv-2');
    expect(result[1].taskIds).toEqual([]);
    expect(result[1].messages).toEqual([]);
  });

  it('returns an empty array when there are no conversations', async () => {
    mockPrisma.conversation.findMany.mockResolvedValue([]);

    const result = await repo.findAll();

    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// findByRobotId
// ---------------------------------------------------------------------------

describe('ConversationRepository.findByRobotId', () => {
  it('filters by robotId + deletedAt:null and maps results', async () => {
    mockPrisma.conversation.findMany.mockResolvedValue([
      makeDbConversation({ robotId: 'robot-9' }),
    ]);

    const result = await repo.findByRobotId('robot-9');

    expect(mockPrisma.conversation.findMany).toHaveBeenCalledWith({
      where: { robotId: 'robot-9', deletedAt: null },
      include: {
        messages: { orderBy: { timestamp: 'asc' } },
        tasks: true,
      },
      orderBy: { updatedAt: 'desc' },
    });
    expect(result).toHaveLength(1);
    expect(result[0].robotId).toBe('robot-9');
  });

  it('returns empty array when robot has no conversations', async () => {
    mockPrisma.conversation.findMany.mockResolvedValue([]);

    const result = await repo.findByRobotId('robot-none');

    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

describe('ConversationRepository.create', () => {
  it('creates with name, robotId, isActive:true and includes messages + tasks', async () => {
    mockPrisma.conversation.create.mockResolvedValue(
      makeDbConversation({ id: 'new-conv', name: 'Fresh', robotId: 'robot-3', messages: [], tasks: [] })
    );

    const result = await repo.create({ name: 'Fresh', robotId: 'robot-3' });

    expect(mockPrisma.conversation.create).toHaveBeenCalledWith({
      data: {
        name: 'Fresh',
        robotId: 'robot-3',
        isActive: true,
      },
      include: {
        messages: true,
        tasks: true,
      },
    });
    expect(result.conversationId).toBe('new-conv');
    expect(result.name).toBe('Fresh');
    expect(result.robotId).toBe('robot-3');
    expect(result.isActive).toBe(true);
  });

  it('passes robotId as undefined when not provided', async () => {
    mockPrisma.conversation.create.mockResolvedValue(
      makeDbConversation({ id: 'c2', name: 'NoRobot', robotId: null, messages: [], tasks: [] })
    );

    const result = await repo.create({ name: 'NoRobot' });

    expect(mockPrisma.conversation.create).toHaveBeenCalledWith({
      data: {
        name: 'NoRobot',
        robotId: undefined,
        isActive: true,
      },
      include: {
        messages: true,
        tasks: true,
      },
    });
    // mapper converts null robotId to undefined
    expect(result.robotId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// delete (soft delete)
// ---------------------------------------------------------------------------

describe('ConversationRepository.delete', () => {
  it('soft-deletes by setting deletedAt + isActive:false and returns true', async () => {
    mockPrisma.conversation.update.mockResolvedValue(makeDbConversation());

    const result = await repo.delete('conv-1');

    expect(result).toBe(true);
    expect(mockPrisma.conversation.update).toHaveBeenCalledTimes(1);
    const call = mockPrisma.conversation.update.mock.calls[0][0];
    expect(call.where).toEqual({ id: 'conv-1' });
    expect(call.data.isActive).toBe(false);
    expect(call.data.deletedAt).toBeInstanceOf(Date);
  });

  it('returns false when prisma throws', async () => {
    mockPrisma.conversation.update.mockRejectedValue(new Error('not found'));

    const result = await repo.delete('missing');

    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------

describe('ConversationRepository.update', () => {
  it('updates provided fields plus updatedAt and returns true', async () => {
    mockPrisma.conversation.update.mockResolvedValue(makeDbConversation());

    const result = await repo.update('conv-1', { name: 'Renamed', isActive: false });

    expect(result).toBe(true);
    const call = mockPrisma.conversation.update.mock.calls[0][0];
    expect(call.where).toEqual({ id: 'conv-1' });
    expect(call.data.name).toBe('Renamed');
    expect(call.data.isActive).toBe(false);
    expect(call.data.updatedAt).toBeInstanceOf(Date);
  });

  it('returns false when prisma throws', async () => {
    mockPrisma.conversation.update.mockRejectedValue(new Error('boom'));

    const result = await repo.update('conv-1', { name: 'x' });

    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// addMessage
// ---------------------------------------------------------------------------

describe('ConversationRepository.addMessage', () => {
  it('creates the message via domainMessageToDb mapping then bumps conversation updatedAt, returning mapped domain message', async () => {
    const created = makeDbMessage({
      id: 'msg-domain-1',
      role: 'agent',
      parts: JSON.stringify([{ kind: 'text', text: 'hi there' }]),
      conversationId: 'conv-1',
      timestamp: new Date('2026-02-01T00:00:00.000Z'),
    });
    mockPrisma.message.create.mockResolvedValue(created);
    mockPrisma.conversation.update.mockResolvedValue(makeDbConversation());

    const result = await repo.addMessage('conv-1', makeDomainMessage());

    // message.create called with the db-shaped data (parts stringified)
    expect(mockPrisma.message.create).toHaveBeenCalledTimes(1);
    const createArg = mockPrisma.message.create.mock.calls[0][0];
    expect(createArg.data.id).toBe('msg-domain-1');
    expect(createArg.data.role).toBe('agent');
    expect(createArg.data.parts).toBe(JSON.stringify([{ kind: 'text', text: 'hi there' }]));
    expect(createArg.data.conversationId).toBe('conv-1');
    expect(createArg.data.timestamp).toBeInstanceOf(Date);

    // conversation timestamp bumped
    expect(mockPrisma.conversation.update).toHaveBeenCalledTimes(1);
    const updateArg = mockPrisma.conversation.update.mock.calls[0][0];
    expect(updateArg.where).toEqual({ id: 'conv-1' });
    expect(updateArg.data.updatedAt).toBeInstanceOf(Date);

    // returned domain message is mapped from the created db row
    expect(result.messageId).toBe('msg-domain-1');
    expect(result.role).toBe('agent');
    expect(result.parts).toEqual([{ kind: 'text', text: 'hi there' }]);
    expect(result.timestamp).toBe('2026-02-01T00:00:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// getMessages
// ---------------------------------------------------------------------------

describe('ConversationRepository.getMessages', () => {
  it('queries messages by conversationId ordered by timestamp asc and maps them', async () => {
    mockPrisma.message.findMany.mockResolvedValue([
      makeDbMessage({ id: 'm1' }),
      makeDbMessage({ id: 'm2', metadata: JSON.stringify({ a: 1 }) }),
    ]);

    const result = await repo.getMessages('conv-1');

    expect(mockPrisma.message.findMany).toHaveBeenCalledWith({
      where: { conversationId: 'conv-1' },
      orderBy: { timestamp: 'asc' },
    });
    expect(result).toHaveLength(2);
    expect(result[0].messageId).toBe('m1');
    expect(result[1].metadata).toEqual({ a: 1 });
  });

  it('returns empty array when no messages', async () => {
    mockPrisma.message.findMany.mockResolvedValue([]);

    const result = await repo.getMessages('conv-1');

    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// count
// ---------------------------------------------------------------------------

describe('ConversationRepository.count', () => {
  it('counts non-deleted conversations', async () => {
    mockPrisma.conversation.count.mockResolvedValue(7);

    const result = await repo.count();

    expect(mockPrisma.conversation.count).toHaveBeenCalledWith({
      where: { deletedAt: null },
    });
    expect(result).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// singleton shares the mocked prisma
// ---------------------------------------------------------------------------

describe('conversationRepository singleton', () => {
  it('uses the same mocked prisma client', async () => {
    mockPrisma.conversation.count.mockResolvedValue(3);
    const result = await conversationRepository.count();
    expect(result).toBe(3);
  });
});
