/**
 * @file AgentRepository.test.ts
 * @description Unit tests for AgentRepository — CRUD over AgentCard via Prisma + real domain<->db mappers
 * @feature a2a
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock for the singleton Prisma client (I/O boundary only).
// The mappers from database/types are NOT mocked — they run for real.
// ---------------------------------------------------------------------------

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    agentCard: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

vi.mock('../../database/index.js', () => ({
  prisma: mockPrisma,
}));

import { AgentRepository, agentRepository } from '../AgentRepository.js';
import type { A2AAgentCard } from '../../types/index.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A valid db-row shape that dbAgentCardToDomain can map. */
function makeDbRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'agent-1',
    name: 'so101-agent',
    description: 'Robot arm agent',
    url: 'http://localhost:41243',
    version: '1.0.0',
    documentationUrl: 'http://docs.local',
    provider: JSON.stringify({ organization: 'EmAI', url: 'http://emai.local' }),
    capabilities: JSON.stringify({ streaming: true, pushNotifications: false }),
    authentication: JSON.stringify({ schemes: ['bearer'] }),
    defaultInputModes: JSON.stringify(['text']),
    defaultOutputModes: JSON.stringify(['text', 'data']),
    skills: JSON.stringify([{ id: 's1', name: 'navigate' }]),
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    robotId: 'robot-1',
    ...overrides,
  };
}

/** A minimal domain card (optional JSON fields absent). */
function makeDomainCard(overrides: Partial<A2AAgentCard> = {}): A2AAgentCard {
  return {
    name: 'so101-agent',
    description: 'Robot arm agent',
    url: 'http://localhost:41243',
    version: '1.0.0',
    documentationUrl: 'http://docs.local',
    provider: { organization: 'EmAI', url: 'http://emai.local' },
    capabilities: { streaming: true, pushNotifications: false },
    authentication: { schemes: ['bearer'] },
    defaultInputModes: ['text'],
    defaultOutputModes: ['text', 'data'],
    skills: [{ id: 's1', name: 'navigate', description: 'nav', tags: [] }],
    ...overrides,
  };
}

const repo = new AgentRepository();

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// findByName
// ---------------------------------------------------------------------------

describe('AgentRepository.findByName', () => {
  it('queries by unique name and maps the db row to a domain card', async () => {
    mockPrisma.agentCard.findUnique.mockResolvedValue(makeDbRow());

    const result = await repo.findByName('so101-agent');

    expect(mockPrisma.agentCard.findUnique).toHaveBeenCalledWith({
      where: { name: 'so101-agent' },
    });
    expect(result).not.toBeNull();
    expect(result).toMatchObject({
      name: 'so101-agent',
      description: 'Robot arm agent',
      url: 'http://localhost:41243',
      version: '1.0.0',
      documentationUrl: 'http://docs.local',
      provider: { organization: 'EmAI', url: 'http://emai.local' },
      capabilities: { streaming: true, pushNotifications: false },
      authentication: { schemes: ['bearer'] },
      defaultInputModes: ['text'],
      defaultOutputModes: ['text', 'data'],
      skills: [{ id: 's1', name: 'navigate' }],
    });
  });

  it('maps nullable optional columns to undefined', async () => {
    mockPrisma.agentCard.findUnique.mockResolvedValue(
      makeDbRow({
        version: null,
        documentationUrl: null,
        provider: null,
        capabilities: null,
        authentication: null,
      })
    );

    const result = await repo.findByName('so101-agent');

    expect(result?.version).toBeUndefined();
    expect(result?.documentationUrl).toBeUndefined();
    expect(result?.provider).toBeUndefined();
    expect(result?.capabilities).toBeUndefined();
    expect(result?.authentication).toBeUndefined();
    // Required JSON columns still parse to arrays
    expect(result?.defaultInputModes).toEqual(['text']);
  });

  it('returns null when no agent is found', async () => {
    mockPrisma.agentCard.findUnique.mockResolvedValue(null);

    const result = await repo.findByName('missing');

    expect(result).toBeNull();
    expect(mockPrisma.agentCard.findUnique).toHaveBeenCalledWith({
      where: { name: 'missing' },
    });
  });
});

// ---------------------------------------------------------------------------
// findByRobotId
// ---------------------------------------------------------------------------

describe('AgentRepository.findByRobotId', () => {
  it('queries by unique robotId and maps the result', async () => {
    mockPrisma.agentCard.findUnique.mockResolvedValue(makeDbRow());

    const result = await repo.findByRobotId('robot-1');

    expect(mockPrisma.agentCard.findUnique).toHaveBeenCalledWith({
      where: { robotId: 'robot-1' },
    });
    expect(result?.name).toBe('so101-agent');
  });

  it('returns null when no agent matches the robotId', async () => {
    mockPrisma.agentCard.findUnique.mockResolvedValue(null);

    const result = await repo.findByRobotId('robot-x');

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// findAll
// ---------------------------------------------------------------------------

describe('AgentRepository.findAll', () => {
  it('fetches all agents ordered by name asc and maps each', async () => {
    mockPrisma.agentCard.findMany.mockResolvedValue([
      makeDbRow({ name: 'a-agent' }),
      makeDbRow({ name: 'b-agent' }),
    ]);

    const result = await repo.findAll();

    expect(mockPrisma.agentCard.findMany).toHaveBeenCalledWith({
      orderBy: { name: 'asc' },
    });
    expect(result).toHaveLength(2);
    expect(result.map((a) => a.name)).toEqual(['a-agent', 'b-agent']);
  });

  it('returns an empty array when there are no agents', async () => {
    mockPrisma.agentCard.findMany.mockResolvedValue([]);

    const result = await repo.findAll();

    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// upsert
// ---------------------------------------------------------------------------

describe('AgentRepository.upsert', () => {
  it('builds create + update payloads from the domain card and maps the result', async () => {
    const returnedRow = makeDbRow();
    mockPrisma.agentCard.upsert.mockResolvedValue(returnedRow);

    const card = makeDomainCard();
    const result = await repo.upsert(card, 'robot-1');

    expect(mockPrisma.agentCard.upsert).toHaveBeenCalledTimes(1);
    const arg = mockPrisma.agentCard.upsert.mock.calls[0][0];

    // where clause keyed by name
    expect(arg.where).toEqual({ name: 'so101-agent' });

    // create payload mirrors domainAgentCardToDb (real mapper output)
    expect(arg.create).toEqual({
      name: 'so101-agent',
      description: 'Robot arm agent',
      url: 'http://localhost:41243',
      version: '1.0.0',
      documentationUrl: 'http://docs.local',
      provider: JSON.stringify({ organization: 'EmAI', url: 'http://emai.local' }),
      capabilities: JSON.stringify({ streaming: true, pushNotifications: false }),
      authentication: JSON.stringify({ schemes: ['bearer'] }),
      defaultInputModes: JSON.stringify(['text']),
      defaultOutputModes: JSON.stringify(['text', 'data']),
      skills: JSON.stringify([{ id: 's1', name: 'navigate', description: 'nav', tags: [] }]),
      robotId: 'robot-1',
    });

    // update payload omits name and createdAt-style fields, keeps robotId
    expect(arg.update).toEqual({
      description: 'Robot arm agent',
      url: 'http://localhost:41243',
      version: '1.0.0',
      documentationUrl: 'http://docs.local',
      provider: JSON.stringify({ organization: 'EmAI', url: 'http://emai.local' }),
      capabilities: JSON.stringify({ streaming: true, pushNotifications: false }),
      authentication: JSON.stringify({ schemes: ['bearer'] }),
      defaultInputModes: JSON.stringify(['text']),
      defaultOutputModes: JSON.stringify(['text', 'data']),
      skills: JSON.stringify([{ id: 's1', name: 'navigate', description: 'nav', tags: [] }]),
      robotId: 'robot-1',
    });

    expect(result.name).toBe('so101-agent');
  });

  it('passes undefined robotId when none provided and serializes empty optionals', async () => {
    mockPrisma.agentCard.upsert.mockResolvedValue(
      makeDbRow({
        provider: null,
        capabilities: null,
        authentication: null,
        version: null,
        documentationUrl: null,
        defaultInputModes: '[]',
        defaultOutputModes: '[]',
        skills: '[]',
        robotId: null,
      })
    );

    const card = makeDomainCard({
      provider: undefined,
      capabilities: undefined,
      authentication: undefined,
      version: undefined,
      documentationUrl: undefined,
      defaultInputModes: undefined,
      defaultOutputModes: undefined,
      skills: undefined,
    });

    await repo.upsert(card);

    const arg = mockPrisma.agentCard.upsert.mock.calls[0][0];
    expect(arg.create.robotId).toBeUndefined();
    expect(arg.create.provider).toBeUndefined();
    expect(arg.create.capabilities).toBeUndefined();
    expect(arg.create.authentication).toBeUndefined();
    // empty arrays still serialized to "[]"
    expect(arg.create.defaultInputModes).toBe('[]');
    expect(arg.create.defaultOutputModes).toBe('[]');
    expect(arg.create.skills).toBe('[]');
  });
});

// ---------------------------------------------------------------------------
// delete
// ---------------------------------------------------------------------------

describe('AgentRepository.delete', () => {
  it('deletes by name and returns true on success', async () => {
    mockPrisma.agentCard.delete.mockResolvedValue(makeDbRow());

    const result = await repo.delete('so101-agent');

    expect(mockPrisma.agentCard.delete).toHaveBeenCalledWith({
      where: { name: 'so101-agent' },
    });
    expect(result).toBe(true);
  });

  it('returns false when prisma.delete throws', async () => {
    mockPrisma.agentCard.delete.mockRejectedValue(new Error('record not found'));

    const result = await repo.delete('missing');

    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// deleteByRobotId
// ---------------------------------------------------------------------------

describe('AgentRepository.deleteByRobotId', () => {
  it('deletes by robotId and returns true on success', async () => {
    mockPrisma.agentCard.delete.mockResolvedValue(makeDbRow());

    const result = await repo.deleteByRobotId('robot-1');

    expect(mockPrisma.agentCard.delete).toHaveBeenCalledWith({
      where: { robotId: 'robot-1' },
    });
    expect(result).toBe(true);
  });

  it('returns false when prisma.delete throws', async () => {
    mockPrisma.agentCard.delete.mockRejectedValue(new Error('record not found'));

    const result = await repo.deleteByRobotId('robot-x');

    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

describe('agentRepository singleton', () => {
  it('shares the mocked prisma client with constructed instances', async () => {
    mockPrisma.agentCard.findUnique.mockResolvedValue(makeDbRow());

    const result = await agentRepository.findByName('so101-agent');

    expect(result?.name).toBe('so101-agent');
    expect(mockPrisma.agentCard.findUnique).toHaveBeenCalled();
  });
});
