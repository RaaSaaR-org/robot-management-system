/**
 * @file TaskRepository.test.ts
 * @description Unit tests for TaskRepository — Prisma-backed CRUD for A2A tasks, exercising the real dbTaskToDomain mapper
 * @feature a2a
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Task as DbTask } from '@prisma/client';

// ---------------------------------------------------------------------------
// Hoisted mock for the Prisma client singleton (the I/O boundary).
// ---------------------------------------------------------------------------

const { mockPrisma } = vi.hoisted(() => {
  return {
    mockPrisma: {
      task: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
    },
  };
});

vi.mock('../../database/index.js', () => ({
  prisma: mockPrisma,
}));

import { TaskRepository, taskRepository } from '../TaskRepository.js';
import type { A2AMessage, A2AArtifact, A2ATaskStatus } from '../../types/index.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CREATED_AT = new Date('2026-01-01T00:00:00.000Z');
const UPDATED_AT = new Date('2026-01-02T00:00:00.000Z');
const STATUS_TS = new Date('2026-01-03T00:00:00.000Z');

function makeMessage(overrides: Partial<A2AMessage> = {}): A2AMessage {
  return {
    messageId: 'msg-1',
    role: 'agent',
    parts: [{ kind: 'text', text: 'hello' }],
    ...overrides,
  };
}

function makeArtifact(overrides: Partial<A2AArtifact> = {}): A2AArtifact {
  return {
    artifactId: 'art-1',
    name: 'output',
    parts: [{ kind: 'text', text: 'result' }],
    ...overrides,
  };
}

/** Build a valid DbTask row shape that dbTaskToDomain can map. */
function makeDbTask(overrides: Partial<DbTask> = {}): DbTask {
  return {
    id: 'task-1',
    conversationId: 'conv-1',
    state: 'submitted',
    statusMessage: null,
    statusTimestamp: STATUS_TS,
    artifacts: '[]',
    history: '[]',
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    ...overrides,
  } as DbTask;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// findById
// ---------------------------------------------------------------------------

describe('TaskRepository.findById', () => {
  it('queries by id and maps the row to a domain task', async () => {
    const message = makeMessage();
    const dbTask = makeDbTask({
      id: 'task-42',
      statusMessage: JSON.stringify(message),
      artifacts: JSON.stringify([makeArtifact()]),
      history: JSON.stringify([message]),
    });
    mockPrisma.task.findUnique.mockResolvedValue(dbTask);

    const result = await taskRepository.findById('task-42');

    expect(mockPrisma.task.findUnique).toHaveBeenCalledWith({ where: { id: 'task-42' } });
    expect(result).not.toBeNull();
    expect(result?.id).toBe('task-42');
    expect(result?.contextId).toBe('conv-1');
    expect(result?.status).toEqual<A2ATaskStatus>({
      state: 'submitted',
      message,
      timestamp: STATUS_TS.toISOString(),
    });
    expect(result?.artifacts).toEqual([makeArtifact()]);
    expect(result?.history).toEqual([message]);
    expect(result?.createdAt).toBe(CREATED_AT.toISOString());
    expect(result?.updatedAt).toBe(UPDATED_AT.toISOString());
  });

  it('maps a null conversationId to undefined contextId and no status message', async () => {
    mockPrisma.task.findUnique.mockResolvedValue(makeDbTask({ conversationId: null }));

    const result = await taskRepository.findById('task-1');

    expect(result?.contextId).toBeUndefined();
    expect(result?.status.message).toBeUndefined();
  });

  it('returns null when prisma returns null', async () => {
    mockPrisma.task.findUnique.mockResolvedValue(null);

    const result = await taskRepository.findById('missing');

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// findAll
// ---------------------------------------------------------------------------

describe('TaskRepository.findAll', () => {
  it('returns all tasks ordered by updatedAt desc, mapped to domain', async () => {
    mockPrisma.task.findMany.mockResolvedValue([
      makeDbTask({ id: 'a' }),
      makeDbTask({ id: 'b' }),
    ]);

    const result = await taskRepository.findAll();

    expect(mockPrisma.task.findMany).toHaveBeenCalledWith({ orderBy: { updatedAt: 'desc' } });
    expect(result.map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('returns an empty array when there are no tasks', async () => {
    mockPrisma.task.findMany.mockResolvedValue([]);

    const result = await taskRepository.findAll();

    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// findByConversationId
// ---------------------------------------------------------------------------

describe('TaskRepository.findByConversationId', () => {
  it('filters by conversationId and orders by createdAt asc', async () => {
    mockPrisma.task.findMany.mockResolvedValue([makeDbTask({ id: 'c1' })]);

    const result = await taskRepository.findByConversationId('conv-9');

    expect(mockPrisma.task.findMany).toHaveBeenCalledWith({
      where: { conversationId: 'conv-9' },
      orderBy: { createdAt: 'asc' },
    });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('c1');
  });
});

// ---------------------------------------------------------------------------
// findByState
// ---------------------------------------------------------------------------

describe('TaskRepository.findByState', () => {
  it('filters by state and orders by updatedAt desc', async () => {
    mockPrisma.task.findMany.mockResolvedValue([makeDbTask({ id: 'w1', state: 'working' })]);

    const result = await taskRepository.findByState('working');

    expect(mockPrisma.task.findMany).toHaveBeenCalledWith({
      where: { state: 'working' },
      orderBy: { updatedAt: 'desc' },
    });
    expect(result[0].status.state).toBe('working');
  });
});

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

describe('TaskRepository.create', () => {
  it('creates a submitted task with the given conversationId', async () => {
    mockPrisma.task.create.mockResolvedValue(makeDbTask({ id: 'new-1', state: 'submitted' }));

    const result = await taskRepository.create('conv-1');

    expect(mockPrisma.task.create).toHaveBeenCalledWith({
      data: {
        conversationId: 'conv-1',
        state: 'submitted',
        artifacts: '[]',
        history: '[]',
      },
    });
    expect(result.id).toBe('new-1');
    expect(result.status.state).toBe('submitted');
  });

  it('creates a task with undefined conversationId when none is provided', async () => {
    mockPrisma.task.create.mockResolvedValue(makeDbTask({ id: 'new-2', conversationId: null }));

    const result = await taskRepository.create();

    expect(mockPrisma.task.create).toHaveBeenCalledWith({
      data: {
        conversationId: undefined,
        state: 'submitted',
        artifacts: '[]',
        history: '[]',
      },
    });
    expect(result.contextId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// updateStatus
// ---------------------------------------------------------------------------

describe('TaskRepository.updateStatus', () => {
  it('appends the status message to history and persists the new status', async () => {
    const existingMessage = makeMessage({ messageId: 'old' });
    const newMessage = makeMessage({ messageId: 'new' });
    mockPrisma.task.findUnique.mockResolvedValue(
      makeDbTask({ id: 'task-1', history: JSON.stringify([existingMessage]) })
    );
    mockPrisma.task.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
      makeDbTask({
        id: 'task-1',
        state: data.state as string,
        statusMessage: data.statusMessage as string | null,
        statusTimestamp: data.statusTimestamp as Date,
        history: data.history as string,
      })
    );

    const status: A2ATaskStatus = {
      state: 'completed',
      message: newMessage,
      timestamp: '2026-05-05T00:00:00.000Z',
    };
    const result = await taskRepository.updateStatus('task-1', status);

    expect(mockPrisma.task.update).toHaveBeenCalledWith({
      where: { id: 'task-1' },
      data: {
        state: 'completed',
        statusMessage: JSON.stringify(newMessage),
        statusTimestamp: new Date('2026-05-05T00:00:00.000Z'),
        history: JSON.stringify([existingMessage, newMessage]),
      },
    });
    expect(result?.status.state).toBe('completed');
    expect(result?.history).toEqual([existingMessage, newMessage]);
  });

  it('keeps history unchanged and uses null statusMessage when status has no message', async () => {
    const existingMessage = makeMessage({ messageId: 'keep' });
    mockPrisma.task.findUnique.mockResolvedValue(
      makeDbTask({ id: 'task-1', history: JSON.stringify([existingMessage]) })
    );
    mockPrisma.task.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
      makeDbTask({
        id: 'task-1',
        state: data.state as string,
        statusMessage: data.statusMessage as string | null,
        history: data.history as string,
      })
    );

    const result = await taskRepository.updateStatus('task-1', { state: 'working' });

    const call = mockPrisma.task.update.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(call.data.statusMessage).toBeNull();
    expect(call.data.state).toBe('working');
    expect(call.data.history).toBe(JSON.stringify([existingMessage]));
    expect(call.data.statusTimestamp).toBeInstanceOf(Date);
    expect(result?.history).toEqual([existingMessage]);
  });

  it('returns null when the task does not exist (no update performed)', async () => {
    mockPrisma.task.findUnique.mockResolvedValue(null);

    const result = await taskRepository.updateStatus('missing', { state: 'failed' });

    expect(result).toBeNull();
    expect(mockPrisma.task.update).not.toHaveBeenCalled();
  });

  it('returns null and swallows the error when prisma.update throws', async () => {
    mockPrisma.task.findUnique.mockResolvedValue(makeDbTask());
    mockPrisma.task.update.mockRejectedValue(new Error('db down'));

    const result = await taskRepository.updateStatus('task-1', { state: 'failed' });

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// addArtifact
// ---------------------------------------------------------------------------

describe('TaskRepository.addArtifact', () => {
  it('appends the artifact to the existing artifacts and persists', async () => {
    const existing = makeArtifact({ artifactId: 'existing' });
    const added = makeArtifact({ artifactId: 'added' });
    mockPrisma.task.findUnique.mockResolvedValue(
      makeDbTask({ id: 'task-1', artifacts: JSON.stringify([existing]) })
    );
    mockPrisma.task.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
      makeDbTask({ id: 'task-1', artifacts: data.artifacts as string })
    );

    const result = await taskRepository.addArtifact('task-1', added);

    expect(mockPrisma.task.update).toHaveBeenCalledWith({
      where: { id: 'task-1' },
      data: { artifacts: JSON.stringify([existing, added]) },
    });
    expect(result?.artifacts).toEqual([existing, added]);
  });

  it('returns null when the task does not exist', async () => {
    mockPrisma.task.findUnique.mockResolvedValue(null);

    const result = await taskRepository.addArtifact('missing', makeArtifact());

    expect(result).toBeNull();
    expect(mockPrisma.task.update).not.toHaveBeenCalled();
  });

  it('returns null and swallows the error when prisma.update throws', async () => {
    mockPrisma.task.findUnique.mockResolvedValue(makeDbTask());
    mockPrisma.task.update.mockRejectedValue(new Error('db down'));

    const result = await taskRepository.addArtifact('task-1', makeArtifact());

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// delete
// ---------------------------------------------------------------------------

describe('TaskRepository.delete', () => {
  it('deletes by id and returns true on success', async () => {
    mockPrisma.task.delete.mockResolvedValue(makeDbTask());

    const result = await taskRepository.delete('task-1');

    expect(mockPrisma.task.delete).toHaveBeenCalledWith({ where: { id: 'task-1' } });
    expect(result).toBe(true);
  });

  it('returns false when prisma.delete throws', async () => {
    mockPrisma.task.delete.mockRejectedValue(new Error('not found'));

    const result = await taskRepository.delete('missing');

    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Class construction (shares the mocked prisma singleton)
// ---------------------------------------------------------------------------

describe('TaskRepository instance', () => {
  it('a freshly constructed instance uses the same mocked prisma', async () => {
    const repo = new TaskRepository();
    mockPrisma.task.findUnique.mockResolvedValue(makeDbTask({ id: 'fresh' }));

    const result = await repo.findById('fresh');

    expect(result?.id).toBe('fresh');
  });
});
