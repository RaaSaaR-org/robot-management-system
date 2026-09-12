/**
 * @file seedTenantBackfill.test.ts
 * @description Covers the TASK-286 backfill: `SensorScan` is stamped in pages
 * rather than by one unbounded `updateMany`, and `seedDefaultTenant()` reaches
 * all three newly-scoped tables and names them in its log.
 *
 * Prisma is mocked in this file rather than relied upon from a global setup:
 * `server/src/__tests__/setup.ts` is inert (vitest.config.ts lists only
 * `./vitest.setup.ts` in setupFiles), so no ambient prisma mock exists. The
 * hoisted-mock shape follows SimulationJobRepository.test.ts.
 *
 * @feature multi-tenancy
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Every model seedDefaultTenant() backfills. Listed here so a model added to
// the seeder without a label (or vice versa) shows up as an undefined call.
// ---------------------------------------------------------------------------

const UNPAGED_MODELS = [
  'user', 'robot', 'dataset', 'trainingJob',
  'alert', 'incident', 'robotTask', 'robotCommand',
  'processDefinition', 'processInstance', 'approvalRequest', 'event',
  'modelVersion', 'deployment', 'simulationJob', 'syntheticJob',
  'zone', 'conversation',
  'apiToken',
  'episodeReward', 'interventionEpisode',
  'digitalTwin', 'scanSession', 'simScene',
  'motionClip', 'vlaSession',
] as const;

const { mockPrisma, mockLogger, mockEnsureDefaultTenant } = vi.hoisted(() => {
  const prisma: Record<string, unknown> = {};
  for (const model of [
    'user', 'robot', 'dataset', 'trainingJob',
    'alert', 'incident', 'robotTask', 'robotCommand',
    'processDefinition', 'processInstance', 'approvalRequest', 'event',
    'modelVersion', 'deployment', 'simulationJob', 'syntheticJob',
    'zone', 'conversation',
    'apiToken',
    'episodeReward', 'interventionEpisode',
    'digitalTwin', 'scanSession', 'simScene',
    'motionClip', 'vlaSession',
  ]) {
    prisma[model] = { updateMany: vi.fn().mockResolvedValue({ count: 0 }) };
  }
  prisma.sensorScan = { findMany: vi.fn(), updateMany: vi.fn() };

  return {
    mockPrisma: prisma as Record<
      string,
      { updateMany: ReturnType<typeof vi.fn>; findMany?: ReturnType<typeof vi.fn> }
    >,
    mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    mockEnsureDefaultTenant: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('../client.js', () => ({ prisma: mockPrisma }));
vi.mock('../defaultTenant.js', () => ({ ensureDefaultTenant: mockEnsureDefaultTenant }));
vi.mock('../../utils/logger.js', () => ({ logger: mockLogger }));
vi.mock('../../config/features.js', () => ({
  MULTI_TENANCY_ENABLED: true,
  DEFAULT_TENANT_ID: 'default',
}));

import { seedDefaultTenant, backfillPaged } from '../seedTenant.js';

/**
 * A fake model backed by an in-memory table, so the paging loop runs against
 * something that actually changes as it is stamped — a mock returning a fixed
 * page would loop forever and prove nothing.
 */
function fakePagedModel(rowCount: number) {
  const rows = Array.from({ length: rowCount }, (_, i) => ({
    id: `scan-${i}`,
    tenantId: null as string | null,
  }));

  const findMany = vi.fn(async ({ take }: { take: number }) =>
    rows.filter((r) => r.tenantId === null).slice(0, take).map((r) => ({ id: r.id }))
  );

  const updateMany = vi.fn(
    async ({ where, data }: { where: { id: { in: string[] } }; data: { tenantId: string } }) => {
      const ids = new Set(where.id.in);
      let count = 0;
      for (const row of rows) {
        if (ids.has(row.id)) {
          row.tenantId = data.tenantId;
          count += 1;
        }
      }
      return { count };
    }
  );

  return { rows, findMany, updateMany };
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const model of UNPAGED_MODELS) {
    mockPrisma[model].updateMany.mockResolvedValue({ count: 0 });
  }
  mockPrisma.sensorScan.findMany!.mockResolvedValue([]);
  mockPrisma.sensorScan.updateMany.mockResolvedValue({ count: 0 });
});

describe('backfillPaged (TASK-286)', () => {
  it('stamps every row across more than one page', async () => {
    const model = fakePagedModel(25);

    const result = await backfillPaged(model, 'sensorScans', 10);

    expect(result.count).toBe(25);
    expect(model.rows.every((r) => r.tenantId === 'default')).toBe(true);
    // 25 rows at a page size of 10: three stamping passes, not one statement.
    expect(model.updateMany).toHaveBeenCalledTimes(3);
    expect(model.updateMany.mock.calls[0][0].where.id.in).toHaveLength(10);
    expect(model.updateMany.mock.calls[2][0].where.id.in).toHaveLength(5);
  });

  it('never issues an unbounded updateMany', async () => {
    const model = fakePagedModel(25);
    await backfillPaged(model, 'sensorScans', 10);

    // The defect this closes: a single `where: { tenantId: null }` update over
    // a table that grows per LiDAR frame, inside the boot path.
    for (const [args] of model.updateMany.mock.calls) {
      expect(args.where).toHaveProperty('id');
      expect(args.where).not.toHaveProperty('tenantId');
    }
  });

  it('logs progress per page so a long backfill is visible', async () => {
    const model = fakePagedModel(25);
    await backfillPaged(model, 'sensorScans', 10);

    const lines = mockLogger.info.mock.calls.map(([first]) => String(first));
    expect(lines.filter((l) => l.includes('sensorScans: stamped'))).toHaveLength(3);
  });

  it('does nothing when there is nothing to stamp', async () => {
    const model = fakePagedModel(0);
    const result = await backfillPaged(model, 'sensorScans', 10);

    expect(result.count).toBe(0);
    expect(model.updateMany).not.toHaveBeenCalled();
  });

  it('stops instead of looping forever when a page stamps nothing', async () => {
    // A page that matches but cannot be stamped (a concurrent writer, a failing
    // predicate) would otherwise re-select the same ids on every pass.
    const findMany = vi.fn().mockResolvedValue([{ id: 'scan-0' }]);
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });

    const result = await backfillPaged({ findMany, updateMany }, 'sensorScans', 10);

    expect(result.count).toBe(0);
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(mockLogger.warn).toHaveBeenCalled();
  });
});

describe('seedDefaultTenant — TASK-286 tables', () => {
  it('backfills motionClip and vlaSession with the unpaged helper', async () => {
    await seedDefaultTenant();

    for (const model of ['motionClip', 'vlaSession'] as const) {
      expect(mockPrisma[model].updateMany).toHaveBeenCalledWith({
        where: { tenantId: null },
        data: { tenantId: 'default' },
      });
    }
  });

  it('backfills sensorScan through the paged helper, not updateMany-all', async () => {
    mockPrisma.sensorScan.findMany!
      .mockResolvedValueOnce([{ id: 's1' }, { id: 's2' }])
      .mockResolvedValueOnce([]);
    mockPrisma.sensorScan.updateMany.mockResolvedValue({ count: 2 });

    await seedDefaultTenant();

    expect(mockPrisma.sensorScan.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: null }, select: { id: true } })
    );
    expect(mockPrisma.sensorScan.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['s1', 's2'] } },
      data: { tenantId: 'default' },
    });
  });

  it('names all three tables in the summary log', async () => {
    mockPrisma.sensorScan.findMany!
      .mockResolvedValueOnce([{ id: 's1' }])
      .mockResolvedValueOnce([]);
    mockPrisma.sensorScan.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.motionClip.updateMany.mockResolvedValue({ count: 2 });
    mockPrisma.vlaSession.updateMany.mockResolvedValue({ count: 3 });

    await seedDefaultTenant();

    const summary = mockLogger.info.mock.calls.find(
      ([, message]) => typeof message === 'string' && message.includes('backfilled')
    );
    expect(summary, 'expected a per-table summary log').toBeDefined();

    const counts = summary![0] as Record<string, number>;
    expect(counts.sensorScans).toBe(1);
    expect(counts.motionClips).toBe(2);
    expect(counts.vlaSessions).toBe(3);
    expect(summary![1]).toContain('backfilled 6 row(s)');
  });

  it('is a no-op path for every label — counts line up with results', async () => {
    await seedDefaultTenant();

    // Nothing to stamp anywhere: the seeder must take the "nothing to backfill"
    // branch rather than logging a mislabelled summary.
    expect(mockLogger.info).toHaveBeenCalledWith(
      '[MULTI_TENANCY] DEFAULT tenant ready (nothing to backfill)'
    );
  });
});
