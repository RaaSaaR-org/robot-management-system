/**
 * @file RobotRepository.test.ts
 * @description Unit tests for RobotRepository — the Prisma-backed data-access
 *   layer for Robot entities. The Prisma client (the I/O boundary) is mocked;
 *   the pure domain<->db mapper functions in database/types.ts run for real so
 *   the tests also exercise mapping.
 * @feature robots
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted Prisma mock (the only mocked boundary). Typed so member access on
// the vi.fn() mocks (mockResolvedValue / mockRejectedValue) typechecks.
// ---------------------------------------------------------------------------

const prismaMock = vi.hoisted(() => ({
  robot: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    upsert: vi.fn(),
  },
  robotEndpoints: {
    upsert: vi.fn(),
  },
  agentCard: {
    upsert: vi.fn(),
  },
  $transaction: vi.fn(),
}));

vi.mock('../../database/index.js', () => ({
  prisma: prismaMock,
}));

import { RobotRepository, robotRepository } from '../RobotRepository.js';
import type {
  Robot,
  RobotEndpoints,
  RobotStatus,
} from '../../services/RobotManager.js';
import type { A2AAgentCard } from '../../types/index.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXED_DATE = new Date('2026-06-22T12:00:00.000Z');

/** A valid Prisma Robot row shape that dbRobotToDomain accepts. */
function makeDbRobot(overrides: Record<string, unknown> = {}) {
  return {
    id: 'robot-1',
    name: 'Atlas',
    model: 'SO-ARM100',
    serialNumber: 'SN-001',
    status: 'online',
    batteryLevel: 87,
    location: JSON.stringify({ x: 1, y: 2, floor: '1' }),
    lastSeen: FIXED_DATE,
    currentTaskId: 'task-1',
    currentTaskName: 'Pick item',
    capabilities: JSON.stringify(['navigate', 'grasp']),
    firmware: 'v1.2.3',
    ipAddress: '10.0.0.5',
    metadata: JSON.stringify({ vendor: 'acme' }),
    createdAt: FIXED_DATE,
    updatedAt: FIXED_DATE,
    a2aEnabled: true,
    a2aAgentUrl: 'http://robot/a2a',
    // registration-related columns (present on the Prisma model)
    baseUrl: 'http://robot',
    isConnected: true,
    lastHealthCheck: FIXED_DATE,
    registeredAt: FIXED_DATE,
    ...overrides,
  };
}

/** A valid domain Robot. */
function makeDomainRobot(overrides: Partial<Robot> = {}): Robot {
  return {
    id: 'robot-1',
    name: 'Atlas',
    model: 'SO-ARM100',
    serialNumber: 'SN-001',
    status: 'online',
    batteryLevel: 87,
    location: { x: 1, y: 2, floor: '1' },
    lastSeen: FIXED_DATE.toISOString(),
    currentTaskId: 'task-1',
    currentTaskName: 'Pick item',
    capabilities: ['navigate', 'grasp'],
    firmware: 'v1.2.3',
    ipAddress: '10.0.0.5',
    metadata: { vendor: 'acme' },
    createdAt: FIXED_DATE.toISOString(),
    updatedAt: FIXED_DATE.toISOString(),
    a2aEnabled: true,
    a2aAgentUrl: 'http://robot/a2a',
    ...overrides,
  };
}

/** A valid Prisma RobotEndpoints row. */
function makeDbEndpoints(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ep-1',
    robotId: 'robot-1',
    robot: 'http://robot/info',
    command: 'http://robot/command',
    telemetry: 'http://robot/telemetry',
    telemetryWs: 'ws://robot/telemetry',
    ...overrides,
  };
}

/** A valid Prisma AgentCard row. */
function makeDbAgentCard(overrides: Record<string, unknown> = {}) {
  return {
    id: 'card-1',
    name: 'Atlas Agent',
    description: 'Robot agent',
    url: 'http://robot/agent',
    version: '1.0.0',
    documentationUrl: 'http://robot/docs',
    provider: JSON.stringify({ organization: 'Acme' }),
    capabilities: JSON.stringify({ streaming: true }),
    authentication: JSON.stringify({ schemes: ['bearer'] }),
    defaultInputModes: JSON.stringify(['text']),
    defaultOutputModes: JSON.stringify(['text']),
    skills: JSON.stringify([{ id: 's1', name: 'move' }]),
    robotId: 'robot-1',
    ...overrides,
  };
}

function makeDomainEndpoints(overrides: Partial<RobotEndpoints> = {}): RobotEndpoints {
  return {
    robot: 'http://robot/info',
    command: 'http://robot/command',
    telemetry: 'http://robot/telemetry',
    telemetryWs: 'ws://robot/telemetry',
    ...overrides,
  };
}

function makeAgentCard(overrides: Partial<A2AAgentCard> = {}): A2AAgentCard {
  return {
    name: 'Atlas Agent',
    description: 'Robot agent',
    url: 'http://robot/agent',
    version: '1.0.0',
    capabilities: { streaming: true },
    defaultInputModes: ['text'],
    defaultOutputModes: ['text'],
    skills: [{ id: 's1', name: 'move', description: 'move' }],
    ...overrides,
  };
}

const repo = new RobotRepository();

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// findById
// ---------------------------------------------------------------------------

describe('findById', () => {
  it('queries by id and maps the row to a domain robot', async () => {
    prismaMock.robot.findUnique.mockResolvedValue(makeDbRobot());

    const result = await repo.findById('robot-1');

    expect(prismaMock.robot.findUnique).toHaveBeenCalledWith({
      where: { id: 'robot-1' },
    });
    expect(result).not.toBeNull();
    // Mapping ran for real: JSON columns parsed, dates -> ISO strings.
    expect(result).toMatchObject({
      id: 'robot-1',
      name: 'Atlas',
      location: { x: 1, y: 2, floor: '1' },
      capabilities: ['navigate', 'grasp'],
      metadata: { vendor: 'acme' },
      lastSeen: FIXED_DATE.toISOString(),
      a2aEnabled: true,
    });
  });

  it('returns null when no robot exists', async () => {
    prismaMock.robot.findUnique.mockResolvedValue(null);

    const result = await repo.findById('missing');

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// findAll
// ---------------------------------------------------------------------------

describe('findAll', () => {
  it('returns all robots ordered by updatedAt desc, mapped to domain', async () => {
    prismaMock.robot.findMany.mockResolvedValue([
      makeDbRobot({ id: 'a' }),
      makeDbRobot({ id: 'b' }),
    ]);

    const result = await repo.findAll();

    expect(prismaMock.robot.findMany).toHaveBeenCalledWith({
      orderBy: { updatedAt: 'desc' },
    });
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('returns an empty array when there are no robots', async () => {
    prismaMock.robot.findMany.mockResolvedValue([]);

    const result = await repo.findAll();

    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// findByStatus
// ---------------------------------------------------------------------------

describe('findByStatus', () => {
  it('filters by status and orders by updatedAt desc', async () => {
    prismaMock.robot.findMany.mockResolvedValue([makeDbRobot({ status: 'busy' })]);

    const result = await repo.findByStatus('busy' as RobotStatus);

    expect(prismaMock.robot.findMany).toHaveBeenCalledWith({
      where: { status: 'busy' },
      orderBy: { updatedAt: 'desc' },
    });
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('busy');
  });
});

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

describe('create', () => {
  it('maps the domain robot to db input and returns the mapped created row', async () => {
    const created = makeDbRobot();
    prismaMock.robot.create.mockResolvedValue(created);

    const result = await repo.create(makeDomainRobot());

    expect(prismaMock.robot.create).toHaveBeenCalledTimes(1);
    const arg = prismaMock.robot.create.mock.calls[0][0] as { data: Record<string, unknown> };
    // domainRobotToDb ran for real: JSON-stringified columns + Date lastSeen.
    expect(arg.data).toMatchObject({
      id: 'robot-1',
      name: 'Atlas',
      location: JSON.stringify({ x: 1, y: 2, floor: '1' }),
      capabilities: JSON.stringify(['navigate', 'grasp']),
      metadata: JSON.stringify({ vendor: 'acme' }),
      a2aEnabled: true,
    });
    expect(arg.data.lastSeen).toBeInstanceOf(Date);
    expect(result.id).toBe('robot-1');
  });
});

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------

describe('update', () => {
  it('builds an update payload only from provided fields and maps the result', async () => {
    prismaMock.robot.update.mockResolvedValue(makeDbRobot({ name: 'Renamed' }));

    const result = await repo.update('robot-1', {
      name: 'Renamed',
      status: 'charging' as RobotStatus,
      location: { x: 5, y: 6 },
      lastSeen: FIXED_DATE.toISOString(),
      capabilities: ['x'],
      metadata: { k: 'v' },
      a2aEnabled: false,
    });

    expect(prismaMock.robot.update).toHaveBeenCalledTimes(1);
    const arg = prismaMock.robot.update.mock.calls[0][0] as {
      where: { id: string };
      data: Record<string, unknown>;
    };
    expect(arg.where).toEqual({ id: 'robot-1' });
    expect(arg.data).toEqual({
      name: 'Renamed',
      status: 'charging',
      location: JSON.stringify({ x: 5, y: 6 }),
      lastSeen: expect.any(Date),
      capabilities: JSON.stringify(['x']),
      metadata: JSON.stringify({ k: 'v' }),
      a2aEnabled: false,
    });
    expect(result?.name).toBe('Renamed');
  });

  it('returns null when prisma.update throws', async () => {
    prismaMock.robot.update.mockRejectedValue(new Error('not found'));

    const result = await repo.update('missing', { name: 'X' });

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// delete
// ---------------------------------------------------------------------------

describe('delete', () => {
  it('deletes by id and returns true on success', async () => {
    prismaMock.robot.delete.mockResolvedValue(makeDbRobot());

    const result = await repo.delete('robot-1');

    expect(prismaMock.robot.delete).toHaveBeenCalledWith({ where: { id: 'robot-1' } });
    expect(result).toBe(true);
  });

  it('returns false when prisma.delete throws', async () => {
    prismaMock.robot.delete.mockRejectedValue(new Error('missing'));

    const result = await repo.delete('missing');

    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// updateStatus
// ---------------------------------------------------------------------------

describe('updateStatus', () => {
  it('updates status, batteryLevel and lastSeen and returns true', async () => {
    prismaMock.robot.update.mockResolvedValue(makeDbRobot());

    const result = await repo.updateStatus('robot-1', 'error' as RobotStatus, 42);

    const arg = prismaMock.robot.update.mock.calls[0][0] as {
      where: { id: string };
      data: Record<string, unknown>;
    };
    expect(arg.where).toEqual({ id: 'robot-1' });
    expect(arg.data.status).toBe('error');
    expect(arg.data.batteryLevel).toBe(42);
    expect(arg.data.lastSeen).toBeInstanceOf(Date);
    expect(result).toBe(true);
  });

  it('passes batteryLevel as undefined when omitted', async () => {
    prismaMock.robot.update.mockResolvedValue(makeDbRobot());

    await repo.updateStatus('robot-1', 'offline' as RobotStatus);

    const arg = prismaMock.robot.update.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(arg.data.batteryLevel).toBeUndefined();
  });

  it('returns false when prisma.update throws', async () => {
    prismaMock.robot.update.mockRejectedValue(new Error('boom'));

    const result = await repo.updateStatus('missing', 'offline' as RobotStatus);

    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getRegisteredRobot
// ---------------------------------------------------------------------------

describe('getRegisteredRobot', () => {
  it('includes endpoints + agentCard and assembles a RegisteredRobot', async () => {
    prismaMock.robot.findUnique.mockResolvedValue(
      makeDbRobot({ endpoints: makeDbEndpoints(), agentCard: makeDbAgentCard() })
    );

    const result = await repo.getRegisteredRobot('robot-1');

    expect(prismaMock.robot.findUnique).toHaveBeenCalledWith({
      where: { id: 'robot-1' },
      include: { endpoints: true, agentCard: true },
    });
    expect(result).not.toBeNull();
    expect(result!.robot.id).toBe('robot-1');
    expect(result!.endpoints).toEqual(makeDomainEndpoints());
    expect(result!.agentCard).toMatchObject({
      name: 'Atlas Agent',
      provider: { organization: 'Acme' },
      capabilities: { streaming: true },
      authentication: { schemes: ['bearer'] },
      defaultInputModes: ['text'],
      skills: [{ id: 's1', name: 'move' }],
    });
    expect(result!.baseUrl).toBe('http://robot');
    expect(result!.isConnected).toBe(true);
    expect(result!.lastHealthCheck).toBe(FIXED_DATE.toISOString());
    expect(result!.registeredAt).toBe(FIXED_DATE.toISOString());
  });

  it('returns null when the robot does not exist', async () => {
    prismaMock.robot.findUnique.mockResolvedValue(null);

    expect(await repo.getRegisteredRobot('missing')).toBeNull();
  });

  it('returns null when endpoints are missing', async () => {
    prismaMock.robot.findUnique.mockResolvedValue(
      makeDbRobot({ endpoints: null, agentCard: makeDbAgentCard() })
    );

    expect(await repo.getRegisteredRobot('robot-1')).toBeNull();
  });

  it('returns null when agentCard is missing', async () => {
    prismaMock.robot.findUnique.mockResolvedValue(
      makeDbRobot({ endpoints: makeDbEndpoints(), agentCard: null })
    );

    expect(await repo.getRegisteredRobot('robot-1')).toBeNull();
  });

  it('falls back to undefined optional card fields and current time for null timestamps', async () => {
    prismaMock.robot.findUnique.mockResolvedValue(
      makeDbRobot({
        baseUrl: null,
        lastHealthCheck: null,
        registeredAt: null,
        endpoints: makeDbEndpoints(),
        agentCard: makeDbAgentCard({
          version: null,
          documentationUrl: null,
          provider: null,
          capabilities: null,
          authentication: null,
        }),
      })
    );

    const result = await repo.getRegisteredRobot('robot-1');

    expect(result!.agentCard.version).toBeUndefined();
    expect(result!.agentCard.provider).toBeUndefined();
    expect(result!.agentCard.capabilities).toBeUndefined();
    expect(result!.baseUrl).toBe('');
    expect(typeof result!.lastHealthCheck).toBe('string');
    expect(typeof result!.registeredAt).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// getAllRegisteredRobots
// ---------------------------------------------------------------------------

describe('getAllRegisteredRobots', () => {
  it('queries registered robots and filters out incomplete ones', async () => {
    prismaMock.robot.findMany.mockResolvedValue([
      makeDbRobot({ id: 'ok', endpoints: makeDbEndpoints(), agentCard: makeDbAgentCard() }),
      makeDbRobot({ id: 'no-ep', endpoints: null, agentCard: makeDbAgentCard() }),
      makeDbRobot({ id: 'no-card', endpoints: makeDbEndpoints(), agentCard: null }),
    ]);

    const result = await repo.getAllRegisteredRobots();

    expect(prismaMock.robot.findMany).toHaveBeenCalledWith({
      where: { registeredAt: { not: null } },
      include: { endpoints: true, agentCard: true },
      orderBy: { updatedAt: 'desc' },
    });
    expect(result).toHaveLength(1);
    expect(result[0].robot.id).toBe('ok');
    expect(result[0].endpoints).toEqual(makeDomainEndpoints());
  });

  it('returns an empty array when none are registered', async () => {
    prismaMock.robot.findMany.mockResolvedValue([]);

    expect(await repo.getAllRegisteredRobots()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// upsertWithRegistration
// ---------------------------------------------------------------------------

describe('upsertWithRegistration', () => {
  it('upserts robot/endpoints/agentCard inside a transaction and maps the robot', async () => {
    const tx = {
      robot: { upsert: vi.fn().mockResolvedValue(makeDbRobot()) },
      robotEndpoints: { upsert: vi.fn().mockResolvedValue(makeDbEndpoints()) },
      agentCard: { upsert: vi.fn().mockResolvedValue(makeDbAgentCard()) },
    };
    prismaMock.$transaction.mockImplementation(
      async (cb: (client: typeof tx) => unknown) => cb(tx)
    );

    const result = await repo.upsertWithRegistration(
      makeDomainRobot(),
      makeDomainEndpoints(),
      makeAgentCard(),
      'http://robot'
    );

    // robot upsert: where + create/update with registration flags
    expect(tx.robot.upsert).toHaveBeenCalledTimes(1);
    const robotArg = tx.robot.upsert.mock.calls[0][0] as {
      where: { id: string };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    };
    expect(robotArg.where).toEqual({ id: 'robot-1' });
    expect(robotArg.create).toMatchObject({
      id: 'robot-1',
      isConnected: true,
      baseUrl: 'http://robot',
    });
    expect(robotArg.create.registeredAt).toBeInstanceOf(Date);
    expect(robotArg.update).toMatchObject({ isConnected: true, baseUrl: 'http://robot' });

    // endpoints upsert keyed on robotId
    const epArg = tx.robotEndpoints.upsert.mock.calls[0][0] as {
      where: { robotId: string };
      create: Record<string, unknown>;
    };
    expect(epArg.where).toEqual({ robotId: 'robot-1' });
    expect(epArg.create).toMatchObject({
      robotId: 'robot-1',
      robot: 'http://robot/info',
      command: 'http://robot/command',
    });

    // agent card upsert keyed on name, with mapped JSON columns
    const cardArg = tx.agentCard.upsert.mock.calls[0][0] as {
      where: { name: string };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    };
    expect(cardArg.where).toEqual({ name: 'Atlas Agent' });
    expect(cardArg.create).toMatchObject({
      name: 'Atlas Agent',
      capabilities: JSON.stringify({ streaming: true }),
      skills: JSON.stringify([{ id: 's1', name: 'move', description: 'move' }]),
      robotId: 'robot-1',
    });
    expect(cardArg.update).toMatchObject({ robotId: 'robot-1' });

    expect(result.id).toBe('robot-1');
  });
});

// ---------------------------------------------------------------------------
// updateHealthCheck
// ---------------------------------------------------------------------------

describe('updateHealthCheck', () => {
  it('updates connection + timestamps and conditionally included fields', async () => {
    prismaMock.robot.update.mockResolvedValue(makeDbRobot());

    const result = await repo.updateHealthCheck(
      'robot-1',
      true,
      'online' as RobotStatus,
      55,
      { x: 9, y: 8 }
    );

    const arg = prismaMock.robot.update.mock.calls[0][0] as {
      where: { id: string };
      data: Record<string, unknown>;
    };
    expect(arg.where).toEqual({ id: 'robot-1' });
    expect(arg.data.isConnected).toBe(true);
    expect(arg.data.lastHealthCheck).toBeInstanceOf(Date);
    expect(arg.data.lastSeen).toBeInstanceOf(Date);
    expect(arg.data.status).toBe('online');
    expect(arg.data.batteryLevel).toBe(55);
    expect(arg.data.location).toBe(JSON.stringify({ x: 9, y: 8 }));
    expect(result).toBe(true);
  });

  it('omits optional fields when not provided', async () => {
    prismaMock.robot.update.mockResolvedValue(makeDbRobot());

    await repo.updateHealthCheck('robot-1', false);

    const arg = prismaMock.robot.update.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(arg.data.isConnected).toBe(false);
    expect('status' in arg.data).toBe(false);
    expect('location' in arg.data).toBe(false);
    // NOTE: batteryLevel === null is `!== undefined`, so it IS included as null.
    expect('batteryLevel' in arg.data).toBe(false);
  });

  it('includes batteryLevel: null when explicitly passed null', async () => {
    prismaMock.robot.update.mockResolvedValue(makeDbRobot());

    await repo.updateHealthCheck('robot-1', true, undefined, null);

    const arg = prismaMock.robot.update.mock.calls[0][0] as { data: Record<string, unknown> };
    expect('batteryLevel' in arg.data).toBe(true);
    expect(arg.data.batteryLevel).toBeNull();
  });

  it('returns false when prisma.update throws', async () => {
    prismaMock.robot.update.mockRejectedValue(new Error('boom'));

    expect(await repo.updateHealthCheck('missing', true)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Singleton smoke test (shares the mocked prisma)
// ---------------------------------------------------------------------------

describe('robotRepository singleton', () => {
  it('uses the same mocked prisma client', async () => {
    prismaMock.robot.findUnique.mockResolvedValue(makeDbRobot());
    const result = await robotRepository.findById('robot-1');
    expect(result?.id).toBe('robot-1');
  });
});
