/**
 * @file FederatedLearningService.test.ts
 * @description Unit tests for FederatedLearningService — federated round lifecycle,
 *   participant selection, model distribution/updates, FedAvg aggregation, privacy
 *   budgets, and ROHE metrics. All external boundaries (Prisma) are mocked.
 * @feature fleet
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FederatedRoundConfig } from '../../types/federated.types.js';
import { DEFAULT_ROUND_CONFIG } from '../../types/federated.types.js';

// ---------------------------------------------------------------------------
// Hoisted mock for the Prisma client (the service does `new PrismaClient()`)
// ---------------------------------------------------------------------------

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    federatedRound: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
    federatedParticipant: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
    robotPrivacyBudget: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    interventionRecord: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

vi.mock('@prisma/client', () => ({
  PrismaClient: class {
    federatedRound = mockPrisma.federatedRound;
    federatedParticipant = mockPrisma.federatedParticipant;
    robotPrivacyBudget = mockPrisma.robotPrivacyBudget;
    interventionRecord = mockPrisma.interventionRecord;
  },
}));

import { FederatedLearningService } from '../FederatedLearningService.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<FederatedRoundConfig> = {}): FederatedRoundConfig {
  return { ...DEFAULT_ROUND_CONFIG, ...overrides };
}

function makeRoundRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'round-1',
    status: 'created',
    globalModelVersion: 'v1',
    newModelVersion: null,
    config: makeConfig(),
    participantCount: 0,
    completedParticipants: 0,
    failedParticipants: 0,
    totalLocalSamples: 0,
    metrics: null,
    startedAt: null,
    completedAt: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  };
}

function makeParticipantRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'part-1',
    roundId: 'round-1',
    robotId: 'robot-1',
    status: 'selected',
    localSamples: null,
    localLoss: null,
    aggregationWeight: null,
    privacyBudgetUsed: null,
    failureReason: null,
    modelReceivedAt: null,
    trainingStartedAt: null,
    uploadedAt: null,
    ...overrides,
  };
}

function makeBudgetRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'budget-1',
    robotId: 'robot-1',
    totalEpsilon: 10,
    usedEpsilon: 0,
    remainingEpsilon: 10,
    roundsParticipated: 0,
    lastUpdated: new Date('2024-01-01'),
    ...overrides,
  };
}

function makeInterventionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'int-1',
    robotId: 'robot-1',
    task: 'pick',
    interventionType: 'correction',
    confidenceBefore: 0.5,
    confidenceAfter: 0.8,
    description: 'fixed grip',
    timestamp: new Date('2024-01-02'),
    ...overrides,
  };
}

// Fresh service per test. The constructor is private; bypass it so each test
// gets its own in-memory `modelUpdates` Map and EventEmitter listeners.
function freshService(): FederatedLearningService {
  return new (FederatedLearningService as unknown as { new (): FederatedLearningService })();
}

let service: FederatedLearningService;

beforeEach(() => {
  vi.clearAllMocks();
  service = freshService();
});

// ===========================================================================
// createRound
// ===========================================================================

describe('createRound', () => {
  it('merges config with defaults, creates the round, and emits round:created', async () => {
    mockPrisma.federatedRound.create.mockResolvedValue(
      makeRoundRow({ id: 'r-new', globalModelVersion: 'v2' })
    );
    const events: unknown[] = [];
    service.on('round:created', (e) => events.push(e));

    const result = await service.createRound({
      globalModelVersion: 'v2',
      config: { minParticipants: 5 },
    });

    expect(result.id).toBe('r-new');
    expect(result.globalModelVersion).toBe('v2');
    const data = mockPrisma.federatedRound.create.mock.calls[0][0].data;
    expect(data.status).toBe('created');
    // merged config keeps the override and the defaults
    expect(data.config.minParticipants).toBe(5);
    expect(data.config.maxParticipants).toBe(DEFAULT_ROUND_CONFIG.maxParticipants);
    expect(events).toHaveLength(1);
  });
});

// ===========================================================================
// getRound / listRounds
// ===========================================================================

describe('getRound', () => {
  it('returns the mapped round when found', async () => {
    mockPrisma.federatedRound.findUnique.mockResolvedValue(makeRoundRow());
    const result = await service.getRound('round-1');
    expect(result?.id).toBe('round-1');
  });

  it('returns undefined when not found', async () => {
    mockPrisma.federatedRound.findUnique.mockResolvedValue(null);
    const result = await service.getRound('missing');
    expect(result).toBeUndefined();
  });
});

describe('listRounds', () => {
  it('applies status and version filters and returns rounds with total', async () => {
    mockPrisma.federatedRound.findMany.mockResolvedValue([makeRoundRow()]);
    mockPrisma.federatedRound.count.mockResolvedValue(1);

    const result = await service.listRounds({
      status: 'created',
      globalModelVersion: 'v1',
      limit: 10,
      offset: 0,
    });

    expect(result.total).toBe(1);
    expect(result.rounds).toHaveLength(1);
    const where = mockPrisma.federatedRound.findMany.mock.calls[0][0].where;
    expect(where).toEqual({ status: 'created', globalModelVersion: 'v1' });
  });

  it('uses an empty where clause when no options are given', async () => {
    mockPrisma.federatedRound.findMany.mockResolvedValue([]);
    mockPrisma.federatedRound.count.mockResolvedValue(0);

    const result = await service.listRounds();
    expect(result.total).toBe(0);
    expect(mockPrisma.federatedRound.findMany.mock.calls[0][0].where).toEqual({});
  });
});

// ===========================================================================
// selectParticipants
// ===========================================================================

describe('selectParticipants', () => {
  it('throws when the round does not exist', async () => {
    mockPrisma.federatedRound.findUnique.mockResolvedValue(null);
    await expect(
      service.selectParticipants('round-x', {})
    ).rejects.toThrow('Round not found');
  });

  it('throws when the round is not in a selectable status', async () => {
    mockPrisma.federatedRound.findUnique.mockResolvedValue(
      makeRoundRow({ status: 'training' })
    );
    await expect(
      service.selectParticipants('round-1', {})
    ).rejects.toThrow('Cannot select participants in status: training');
  });

  it('selects the requested robots and updates participantCount', async () => {
    mockPrisma.federatedRound.findUnique.mockResolvedValue(
      makeRoundRow({ status: 'created', config: makeConfig({ maxParticipants: 10 }) })
    );
    mockPrisma.federatedRound.update.mockResolvedValue(makeRoundRow());
    let counter = 0;
    mockPrisma.federatedParticipant.create.mockImplementation(async (args: { data: { robotId: string } }) =>
      makeParticipantRow({ id: `part-${++counter}`, robotId: args.data.robotId })
    );

    const result = await service.selectParticipants('round-1', {
      robotIds: ['robot-a', 'robot-b'],
      strategy: 'random',
    });

    expect(result).toHaveLength(2);
    // status -> selecting first, then participantCount update
    const lastUpdate =
      mockPrisma.federatedRound.update.mock.calls[
        mockPrisma.federatedRound.update.mock.calls.length - 1
      ][0];
    expect(lastUpdate.data.participantCount).toBe(2);
  });

  it('falls back to mock robots when no robotIds provided, capped by maxParticipants', async () => {
    mockPrisma.federatedRound.findUnique.mockResolvedValue(
      makeRoundRow({ status: 'selecting', config: makeConfig({ maxParticipants: 2 }) })
    );
    mockPrisma.federatedRound.update.mockResolvedValue(makeRoundRow());
    let counter = 0;
    mockPrisma.federatedParticipant.create.mockImplementation(async (args: { data: { robotId: string } }) =>
      makeParticipantRow({ id: `part-${++counter}`, robotId: args.data.robotId })
    );

    const result = await service.selectParticipants('round-1', {});
    expect(result).toHaveLength(2);
  });

  it('uses round_robin strategy ordering by participation count', async () => {
    mockPrisma.federatedRound.findUnique.mockResolvedValue(
      makeRoundRow({ status: 'created', config: makeConfig({ maxParticipants: 10 }) })
    );
    mockPrisma.federatedRound.update.mockResolvedValue(makeRoundRow());
    // robot-b has fewer past participations, so should be selected first
    mockPrisma.federatedParticipant.count.mockImplementation(async (args: { where: { robotId: string } }) =>
      args.where.robotId === 'robot-b' ? 1 : 5
    );
    mockPrisma.federatedParticipant.create.mockImplementation(async (args: { data: { robotId: string } }) =>
      makeParticipantRow({ id: `p-${args.data.robotId}`, robotId: args.data.robotId })
    );

    const result = await service.selectParticipants('round-1', {
      robotIds: ['robot-a', 'robot-b'],
      count: 1,
      strategy: 'round_robin',
    });

    expect(result).toHaveLength(1);
    expect(result[0].robotId).toBe('robot-b');
  });
});

// ===========================================================================
// distributeModel
// ===========================================================================

describe('distributeModel', () => {
  it('throws when round not found', async () => {
    mockPrisma.federatedRound.findUnique.mockResolvedValue(null);
    await expect(service.distributeModel('r')).rejects.toThrow('Round not found');
  });

  it('throws when status is not selecting', async () => {
    mockPrisma.federatedRound.findUnique.mockResolvedValue(
      makeRoundRow({ status: 'created' })
    );
    await expect(service.distributeModel('round-1')).rejects.toThrow(
      'Cannot distribute in status: created'
    );
  });

  it('throws when participantCount is below minParticipants', async () => {
    mockPrisma.federatedRound.findUnique.mockResolvedValue(
      makeRoundRow({ status: 'selecting', participantCount: 1, config: makeConfig({ minParticipants: 3 }) })
    );
    await expect(service.distributeModel('round-1')).rejects.toThrow(
      'Need at least 3 participants, have 1'
    );
  });

  it('transitions to training and marks participants model_received', async () => {
    mockPrisma.federatedRound.findUnique.mockResolvedValue(
      makeRoundRow({ status: 'selecting', participantCount: 2, config: makeConfig({ minParticipants: 2 }) })
    );
    mockPrisma.federatedParticipant.findMany.mockResolvedValue([
      makeParticipantRow({ id: 'p1', robotId: 'robot-1' }),
      makeParticipantRow({ id: 'p2', robotId: 'robot-2' }),
    ]);
    mockPrisma.federatedParticipant.update.mockResolvedValue(makeParticipantRow());
    mockPrisma.federatedRound.update.mockResolvedValue(
      makeRoundRow({ status: 'training' })
    );

    const result = await service.distributeModel('round-1');

    expect(result.status).toBe('training');
    expect(mockPrisma.federatedParticipant.update).toHaveBeenCalledTimes(2);
    // first round update sets distributing+startedAt, last sets training
    const lastRoundUpdate =
      mockPrisma.federatedRound.update.mock.calls[
        mockPrisma.federatedRound.update.mock.calls.length - 1
      ][0];
    expect(lastRoundUpdate.data.status).toBe('training');
  });
});

// ===========================================================================
// submitModelUpdate
// ===========================================================================

describe('submitModelUpdate', () => {
  const baseRequest = {
    participantId: 'part-1',
    robotId: 'robot-1',
    localSamples: 100,
    localLoss: 0.2,
    modelDelta: Buffer.from(JSON.stringify([0.1, 0.2])).toString('base64'),
    updateHash: 'hash',
  };

  it('throws when participant not found', async () => {
    mockPrisma.federatedParticipant.findUnique.mockResolvedValue(null);
    await expect(service.submitModelUpdate(baseRequest)).rejects.toThrow(
      'Participant not found'
    );
  });

  it('throws when round not found', async () => {
    mockPrisma.federatedParticipant.findUnique.mockResolvedValue(makeParticipantRow());
    mockPrisma.federatedRound.findUnique.mockResolvedValue(null);
    await expect(service.submitModelUpdate(baseRequest)).rejects.toThrow('Round not found');
  });

  it('throws when round status does not allow submission', async () => {
    mockPrisma.federatedParticipant.findUnique.mockResolvedValue(makeParticipantRow());
    mockPrisma.federatedRound.findUnique.mockResolvedValue(
      makeRoundRow({ status: 'created' })
    );
    await expect(service.submitModelUpdate(baseRequest)).rejects.toThrow(
      'Cannot submit update in status: created'
    );
  });

  it('stores the update, updates participant and round, and transitions to collecting', async () => {
    mockPrisma.federatedParticipant.findUnique.mockResolvedValue(makeParticipantRow());
    mockPrisma.federatedRound.findUnique
      .mockResolvedValueOnce(makeRoundRow({ status: 'training', config: makeConfig({ minParticipants: 1 }) }))
      .mockResolvedValueOnce(makeRoundRow({ status: 'training', completedParticipants: 1 }));
    mockPrisma.federatedParticipant.update.mockResolvedValue(makeParticipantRow());
    mockPrisma.federatedRound.update.mockResolvedValue(makeRoundRow());

    const result = await service.submitModelUpdate(baseRequest);

    expect(result.participantId).toBe('part-1');
    expect(result.localSamples).toBe(100);
    // round transitioned to collecting (last update call)
    const calls = mockPrisma.federatedRound.update.mock.calls;
    const collecting = calls.find((c) => c[0].data.status === 'collecting');
    expect(collecting).toBeDefined();
  });

  it('throws when privacy budget is insufficient and DP is enabled', async () => {
    mockPrisma.federatedParticipant.findUnique.mockResolvedValue(makeParticipantRow());
    mockPrisma.federatedRound.findUnique.mockResolvedValue(
      makeRoundRow({ status: 'training', config: makeConfig({ privacyEpsilon: 5, minParticipants: 1 }) })
    );
    mockPrisma.robotPrivacyBudget.findUnique.mockResolvedValue(
      makeBudgetRow({ remainingEpsilon: 1 })
    );

    await expect(service.submitModelUpdate(baseRequest)).rejects.toThrow(
      'Insufficient privacy budget'
    );
  });

  it('deducts privacy budget when DP enabled and sufficient', async () => {
    mockPrisma.federatedParticipant.findUnique.mockResolvedValue(makeParticipantRow());
    mockPrisma.federatedRound.findUnique
      .mockResolvedValueOnce(makeRoundRow({ status: 'training', config: makeConfig({ privacyEpsilon: 2, minParticipants: 99 }) }))
      .mockResolvedValueOnce(makeRoundRow({ status: 'training', completedParticipants: 1 }));
    mockPrisma.robotPrivacyBudget.findUnique.mockResolvedValue(makeBudgetRow());
    mockPrisma.robotPrivacyBudget.update.mockResolvedValue(makeBudgetRow());
    mockPrisma.federatedParticipant.update.mockResolvedValue(makeParticipantRow());
    mockPrisma.federatedRound.update.mockResolvedValue(makeRoundRow());

    await service.submitModelUpdate(baseRequest);

    expect(mockPrisma.robotPrivacyBudget.update).toHaveBeenCalledTimes(1);
    const budgetData = mockPrisma.robotPrivacyBudget.update.mock.calls[0][0].data;
    expect(budgetData.usedEpsilon).toBe(2);
  });
});

// ===========================================================================
// markParticipantFailed
// ===========================================================================

describe('markParticipantFailed', () => {
  it('returns undefined when participant not found', async () => {
    mockPrisma.federatedParticipant.findUnique.mockResolvedValue(null);
    const result = await service.markParticipantFailed('p-x', 'timeout');
    expect(result).toBeUndefined();
  });

  it('marks failed and increments round failedParticipants', async () => {
    mockPrisma.federatedParticipant.findUnique.mockResolvedValue(makeParticipantRow());
    mockPrisma.federatedParticipant.update.mockResolvedValue(
      makeParticipantRow({ status: 'failed', failureReason: 'timeout' })
    );
    mockPrisma.federatedRound.update.mockResolvedValue(makeRoundRow());

    const result = await service.markParticipantFailed('part-1', 'timeout');

    expect(result?.status).toBe('failed');
    expect(result?.failureReason).toBe('timeout');
    expect(mockPrisma.federatedRound.update).toHaveBeenCalledWith({
      where: { id: 'round-1' },
      data: { failedParticipants: { increment: 1 } },
    });
  });
});

// ===========================================================================
// aggregateUpdates (FedAvg)
// ===========================================================================

describe('aggregateUpdates', () => {
  it('throws when round not found', async () => {
    mockPrisma.federatedRound.findUnique.mockResolvedValue(null);
    await expect(service.aggregateUpdates('r')).rejects.toThrow('Round not found');
  });

  it('throws when status is not collecting', async () => {
    mockPrisma.federatedRound.findUnique.mockResolvedValue(
      makeRoundRow({ status: 'training' })
    );
    await expect(service.aggregateUpdates('round-1')).rejects.toThrow(
      'Cannot aggregate in status: training'
    );
  });

  it('throws when there are not enough stored updates', async () => {
    mockPrisma.federatedRound.findUnique.mockResolvedValue(
      makeRoundRow({ status: 'collecting', config: makeConfig({ minParticipants: 2 }) })
    );
    mockPrisma.federatedRound.update.mockResolvedValue(makeRoundRow());
    mockPrisma.federatedParticipant.findMany.mockResolvedValue([]);

    await expect(service.aggregateUpdates('round-1')).rejects.toThrow(
      /Not enough updates/
    );
  });

  it('computes a weighted FedAvg over stored updates', async () => {
    // First submit two updates to populate the in-memory map.
    const submitRequest = (id: string, samples: number, delta: number[]) => ({
      participantId: id,
      robotId: `robot-${id}`,
      localSamples: samples,
      localLoss: 0.1,
      modelDelta: Buffer.from(JSON.stringify(delta)).toString('base64'),
      updateHash: 'h',
    });

    // Submit p1 (weight via 100 samples) and p2 (100 samples) -> equal weights
    const submissions: Array<[string, number[]]> = [
      ['p1', [1, 1]],
      ['p2', [3, 3]],
    ];
    for (const [pid, delta] of submissions) {
      mockPrisma.federatedParticipant.findUnique.mockResolvedValue(
        makeParticipantRow({ id: pid, roundId: 'round-1' })
      );
      mockPrisma.federatedRound.findUnique
        .mockResolvedValueOnce(makeRoundRow({ status: 'training', config: makeConfig({ minParticipants: 99 }) }))
        .mockResolvedValueOnce(makeRoundRow({ status: 'training', completedParticipants: 1 }));
      mockPrisma.federatedParticipant.update.mockResolvedValue(makeParticipantRow());
      mockPrisma.federatedRound.update.mockResolvedValue(makeRoundRow());
      await service.submitModelUpdate(submitRequest(pid, 100, delta));
    }

    // Now aggregate.
    mockPrisma.federatedRound.findUnique.mockResolvedValue(
      makeRoundRow({ status: 'collecting', config: makeConfig({ minParticipants: 2 }) })
    );
    mockPrisma.federatedRound.update.mockResolvedValue(makeRoundRow());
    mockPrisma.federatedParticipant.findMany.mockResolvedValue([
      makeParticipantRow({ id: 'p1', status: 'uploaded' }),
      makeParticipantRow({ id: 'p2', status: 'uploaded' }),
    ]);
    mockPrisma.federatedParticipant.update.mockResolvedValue(makeParticipantRow());

    const result = await service.aggregateUpdates('round-1');

    expect(result.participantCount).toBe(2);
    expect(result.totalSamples).toBe(200);
    // equal weights 0.5 each: 0.5*[1,1] + 0.5*[3,3] = [2,2]
    expect(result.aggregatedDelta).toEqual([2, 2]);
    // new model version recorded
    const versionUpdate = mockPrisma.federatedRound.update.mock.calls.find(
      (c) => typeof c[0].data.newModelVersion === 'string'
    );
    expect(versionUpdate).toBeDefined();
  });
});

// ===========================================================================
// finalizeRound
// ===========================================================================

describe('finalizeRound', () => {
  it('throws when round not found', async () => {
    mockPrisma.federatedRound.findUnique.mockResolvedValue(null);
    await expect(service.finalizeRound('r')).rejects.toThrow('Round not found');
  });

  it('computes avg local loss from uploaded participants and completes', async () => {
    mockPrisma.federatedRound.findUnique.mockResolvedValue(
      makeRoundRow({ status: 'aggregating', startedAt: new Date(Date.now() - 1000) })
    );
    mockPrisma.federatedParticipant.findMany.mockResolvedValue([
      makeParticipantRow({ id: 'p1', status: 'uploaded', localLoss: 0.2 }),
      makeParticipantRow({ id: 'p2', status: 'uploaded', localLoss: 0.4 }),
      makeParticipantRow({ id: 'p3', status: 'failed', localLoss: null }),
    ]);
    mockPrisma.federatedRound.update.mockResolvedValue(
      makeRoundRow({ status: 'completed', newModelVersion: 'v1_fedavg_123' })
    );

    const result = await service.finalizeRound('round-1');

    expect(result.status).toBe('completed');
    const updateData = mockPrisma.federatedRound.update.mock.calls[0][0].data;
    expect(updateData.status).toBe('completed');
    // avg of 0.2 and 0.4 (failed one excluded)
    expect(updateData.metrics.avgLocalLoss).toBeCloseTo(0.3);
  });
});

// ===========================================================================
// Privacy budget
// ===========================================================================

describe('getOrCreatePrivacyBudget', () => {
  it('returns existing budget without creating', async () => {
    mockPrisma.robotPrivacyBudget.findUnique.mockResolvedValue(makeBudgetRow());
    const result = await service.getOrCreatePrivacyBudget('robot-1');
    expect(result.robotId).toBe('robot-1');
    expect(mockPrisma.robotPrivacyBudget.create).not.toHaveBeenCalled();
  });

  it('creates a default budget when none exists', async () => {
    mockPrisma.robotPrivacyBudget.findUnique.mockResolvedValue(null);
    mockPrisma.robotPrivacyBudget.create.mockResolvedValue(makeBudgetRow());

    const result = await service.getOrCreatePrivacyBudget('robot-1');

    expect(mockPrisma.robotPrivacyBudget.create).toHaveBeenCalledTimes(1);
    const data = mockPrisma.robotPrivacyBudget.create.mock.calls[0][0].data;
    expect(data.totalEpsilon).toBe(10);
    expect(data.remainingEpsilon).toBe(10);
    expect(result.totalEpsilon).toBe(10);
  });
});

describe('getPrivacyBudget', () => {
  it('returns undefined when no budget exists', async () => {
    mockPrisma.robotPrivacyBudget.findUnique.mockResolvedValue(null);
    expect(await service.getPrivacyBudget('robot-x')).toBeUndefined();
  });

  it('returns the mapped budget', async () => {
    mockPrisma.robotPrivacyBudget.findUnique.mockResolvedValue(makeBudgetRow({ usedEpsilon: 3 }));
    const result = await service.getPrivacyBudget('robot-1');
    expect(result?.usedEpsilon).toBe(3);
  });
});

describe('listPrivacyBudgets', () => {
  it('maps all budgets', async () => {
    mockPrisma.robotPrivacyBudget.findMany.mockResolvedValue([
      makeBudgetRow({ robotId: 'a' }),
      makeBudgetRow({ robotId: 'b' }),
    ]);
    const result = await service.listPrivacyBudgets();
    expect(result.map((b) => b.robotId)).toEqual(['a', 'b']);
  });
});

describe('resetPrivacyBudget', () => {
  it('resets used to 0 and remaining to total', async () => {
    mockPrisma.robotPrivacyBudget.findUnique.mockResolvedValue(
      makeBudgetRow({ usedEpsilon: 7, remainingEpsilon: 3 })
    );
    mockPrisma.robotPrivacyBudget.update.mockResolvedValue(
      makeBudgetRow({ usedEpsilon: 0, remainingEpsilon: 10 })
    );

    const result = await service.resetPrivacyBudget('robot-1');

    const data = mockPrisma.robotPrivacyBudget.update.mock.calls[0][0].data;
    expect(data.usedEpsilon).toBe(0);
    expect(data.remainingEpsilon).toBe(10);
    expect(result.remainingEpsilon).toBe(10);
  });
});

// ===========================================================================
// ROHE metrics
// ===========================================================================

describe('recordIntervention', () => {
  it('creates an intervention record and emits an event', async () => {
    mockPrisma.interventionRecord.create.mockResolvedValue(makeInterventionRow());
    const events: unknown[] = [];
    service.on('intervention:recorded', (e) => events.push(e));

    const result = await service.recordIntervention(
      'robot-1',
      'pick',
      'correction',
      0.5,
      0.8,
      'fixed grip'
    );

    expect(result.id).toBe('int-1');
    expect(result.interventionType).toBe('correction');
    expect(events).toHaveLength(1);
    const data = mockPrisma.interventionRecord.create.mock.calls[0][0].data;
    expect(data.confidenceBefore).toBe(0.5);
    expect(data.confidenceAfter).toBe(0.8);
  });
});

describe('computeROHEMetrics', () => {
  it('returns zeroed metrics when there are no interventions', async () => {
    mockPrisma.interventionRecord.findMany.mockResolvedValue([]);
    const result = await service.computeROHEMetrics();
    expect(result.totalInterventions).toBe(0);
    expect(result.performanceImprovement).toBe(0);
    expect(result.improvementPerIntervention).toBe(0);
    expect(result.byRobot).toEqual({});
    expect(result.byTask).toEqual({});
  });

  it('aggregates improvement per robot and per task', async () => {
    mockPrisma.interventionRecord.findMany.mockResolvedValue([
      makeInterventionRow({ id: 'i1', robotId: 'r1', task: 'pick', confidenceBefore: 0.4, confidenceAfter: 0.6 }),
      makeInterventionRow({ id: 'i2', robotId: 'r1', task: 'place', confidenceBefore: 0.5, confidenceAfter: 0.9 }),
      makeInterventionRow({ id: 'i3', robotId: 'r2', task: 'pick', confidenceBefore: null, confidenceAfter: null }),
    ]);

    const result = await service.computeROHEMetrics({ robotId: 'r1' });

    expect(result.totalInterventions).toBe(3);
    expect(result.byRobot.r1.interventions).toBe(2);
    // r1 improvement = 0.2 + 0.4 = 0.6 across 2 interventions -> rohe 0.3
    expect(result.byRobot.r1.improvement).toBeCloseTo(0.6);
    expect(result.byRobot.r1.rohe).toBeCloseTo(0.3);
    // r2 has null confidences -> no improvement, rohe 0
    expect(result.byRobot.r2.improvement).toBe(0);
    // by task picks aggregated across robots
    expect(result.byTask.pick.interventions).toBe(2);
    // overall performanceImprovement averages only entries with both confidences (0.2, 0.4)
    expect(result.performanceImprovement).toBeCloseTo(0.3);
    // improvementPerIntervention divides total improvement (0.6) by all 3
    expect(result.improvementPerIntervention).toBeCloseTo(0.2);
  });

  it('passes date and task filters into the query', async () => {
    mockPrisma.interventionRecord.findMany.mockResolvedValue([]);
    const start = new Date('2024-01-01');
    const end = new Date('2024-02-01');

    await service.computeROHEMetrics({ startDate: start, endDate: end, task: 'pick' });

    const where = mockPrisma.interventionRecord.findMany.mock.calls[0][0].where;
    expect(where.task).toBe('pick');
    expect(where.timestamp.gte).toBe(start);
    expect(where.timestamp.lte).toBe(end);
  });
});

// ===========================================================================
// getParticipantsForRound
// ===========================================================================

describe('getParticipantsForRound', () => {
  it('maps participants for a round', async () => {
    mockPrisma.federatedParticipant.findMany.mockResolvedValue([
      makeParticipantRow({ id: 'p1' }),
      makeParticipantRow({ id: 'p2' }),
    ]);
    const result = await service.getParticipantsForRound('round-1');
    expect(result.map((p) => p.id)).toEqual(['p1', 'p2']);
  });
});
