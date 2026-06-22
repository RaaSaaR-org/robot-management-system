/**
 * @file TrainingDataDocService.test.ts
 * @description Unit tests for TrainingDataDocService — EU AI Act GPAI training data
 *   documentation: provenance, training-data summaries, bias assessments, exports, and events.
 * @feature compliance
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  DatasetProvenance,
  TrainingDataSummary,
  BiasAssessment,
} from '../../types/training-docs.types.js';
import { AI_ACT_UPDATE_INTERVAL_DAYS } from '../../types/training-docs.types.js';

// ---------------------------------------------------------------------------
// Hoisted mock for the Prisma client (the service does `new PrismaClient()`)
// ---------------------------------------------------------------------------

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    datasetProvenance: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    trainingDataSummary: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    biasAssessment: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
  },
}));

vi.mock('@prisma/client', () => ({
  PrismaClient: class {
    datasetProvenance = mockPrisma.datasetProvenance;
    trainingDataSummary = mockPrisma.trainingDataSummary;
    biasAssessment = mockPrisma.biasAssessment;
  },
}));

import { TrainingDataDocService } from '../TrainingDataDocService.js';

// ---------------------------------------------------------------------------
// Fixtures (shaped like the Prisma rows the service's `to*` helpers consume)
// ---------------------------------------------------------------------------

function makeProvenanceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'prov-1',
    datasetId: 'ds-1',
    sourceType: 'collected',
    sourceName: 'Internal Set',
    sourceUrl: null,
    collectionMethod: 'teleop',
    collectionPeriod: null,
    labelingProcedure: null,
    annotatorInfo: null,
    cleaningSteps: null,
    licenseType: null,
    copyrightCompliance: null,
    chainOfCustody: null,
    recordedBy: 'user-1',
    recordedAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-02T00:00:00Z'),
    ...overrides,
  };
}

function makeSummaryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sum-1',
    modelVersionId: 'mv-1',
    datasetIds: ['ds-1', 'ds-2'],
    totalTrajectories: 2000,
    publicDatasets: null,
    privateDatasets: ['ds-1', 'ds-2'],
    webScrapingSources: null,
    copyrightMeasures: 'opt-out honored',
    processingPurposes: ['Training VLA'],
    knownGaps: [],
    limitations: null,
    generatedAt: new Date('2025-01-01T00:00:00Z'),
    lastUpdated: new Date('2025-01-01T00:00:00Z'),
    nextUpdateDue: new Date('2025-06-30T00:00:00Z'),
    generatedBy: 'user-1',
    ...overrides,
  };
}

function makeBiasRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'bias-1',
    modelVersionId: 'mv-1',
    assessmentVersion: 1,
    demographicCoverage: { age: 'broad' },
    geographicCoverage: null,
    taskCoverage: null,
    knownLimitations: ['edge cases'],
    potentialBiasSources: ['selection bias'],
    mitigationMeasures: ['resampling'],
    testingResults: null,
    assessedBy: 'user-1',
    reviewedBy: null,
    assessmentDate: new Date('2025-01-01T00:00:00Z'),
    reviewedDate: null,
    status: 'draft',
    notes: null,
    ...overrides,
  };
}

// Each test gets a fresh instance (constructor is private; reach it via cast)
// to avoid leaking EventEmitter listeners across tests.
function newService(): TrainingDataDocService {
  const Ctor = TrainingDataDocService as unknown as { new (): TrainingDataDocService };
  return new Ctor();
}

let service: TrainingDataDocService;

beforeEach(() => {
  vi.clearAllMocks();
  service = newService();
});

// ===========================================================================
// recordProvenance
// ===========================================================================

describe('recordProvenance', () => {
  it('creates a new provenance record when none exists and emits an event', async () => {
    mockPrisma.datasetProvenance.findUnique.mockResolvedValue(null);
    mockPrisma.datasetProvenance.create.mockResolvedValue(makeProvenanceRow());
    const onEvent = vi.fn();
    service.on('provenance:recorded', onEvent);

    const result = await service.recordProvenance(
      'ds-1',
      { sourceType: 'collected', sourceName: 'Internal Set' },
      'user-1'
    );

    expect(mockPrisma.datasetProvenance.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.datasetProvenance.update).not.toHaveBeenCalled();
    expect(result.datasetId).toBe('ds-1');
    expect(result.sourceType).toBe('collected');
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent.mock.calls[0][0]).toMatchObject({
      type: 'provenance:recorded',
      entityType: 'provenance',
      datasetId: 'ds-1',
    });
  });

  it('updates an existing provenance record and serializes collectionPeriod', async () => {
    mockPrisma.datasetProvenance.findUnique.mockResolvedValue(makeProvenanceRow());
    const updatedRow = makeProvenanceRow({
      sourceType: 'purchased',
      collectionPeriod: { start: '2025-01-01', end: '2025-02-01' },
    });
    mockPrisma.datasetProvenance.update.mockResolvedValue(updatedRow);

    const result = await service.recordProvenance(
      'ds-1',
      {
        sourceType: 'purchased',
        collectionPeriod: { start: '2025-01-01', end: '2025-02-01' },
      },
      'user-1'
    );

    expect(mockPrisma.datasetProvenance.update).toHaveBeenCalledTimes(1);
    expect(mockPrisma.datasetProvenance.create).not.toHaveBeenCalled();
    const updateArg = mockPrisma.datasetProvenance.update.mock.calls[0][0] as {
      data: { collectionPeriod: unknown };
    };
    expect(updateArg.data.collectionPeriod).toEqual({
      start: '2025-01-01',
      end: '2025-02-01',
    });
    expect(result.sourceType).toBe('purchased');
    expect(result.collectionPeriod?.start).toBeInstanceOf(Date);
  });

  it('propagates errors from the underlying prisma call', async () => {
    mockPrisma.datasetProvenance.findUnique.mockRejectedValue(new Error('db down'));
    await expect(
      service.recordProvenance('ds-1', { sourceType: 'collected' }, 'user-1')
    ).rejects.toThrow('db down');
  });
});

// ===========================================================================
// getProvenance / listProvenance
// ===========================================================================

describe('getProvenance', () => {
  it('returns a mapped record when found', async () => {
    mockPrisma.datasetProvenance.findUnique.mockResolvedValue(makeProvenanceRow());
    const result = await service.getProvenance('ds-1');
    expect(result?.id).toBe('prov-1');
    expect(result?.datasetId).toBe('ds-1');
  });

  it('returns null when not found', async () => {
    mockPrisma.datasetProvenance.findUnique.mockResolvedValue(null);
    const result = await service.getProvenance('missing');
    expect(result).toBeNull();
  });
});

describe('listProvenance', () => {
  it('lists all records when no filter is given', async () => {
    mockPrisma.datasetProvenance.findMany.mockResolvedValue([
      makeProvenanceRow({ id: 'p1', datasetId: 'd1' }),
      makeProvenanceRow({ id: 'p2', datasetId: 'd2' }),
    ]);

    const result = await service.listProvenance();

    expect(result).toHaveLength(2);
    const whereArg = mockPrisma.datasetProvenance.findMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect(whereArg.where).toEqual({});
  });

  it('filters by sourceType when provided', async () => {
    mockPrisma.datasetProvenance.findMany.mockResolvedValue([]);
    await service.listProvenance('open_source');
    const whereArg = mockPrisma.datasetProvenance.findMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect(whereArg.where).toEqual({ sourceType: 'open_source' });
  });
});

// ===========================================================================
// generateSummary
// ===========================================================================

describe('generateSummary', () => {
  it('classifies datasets into public/private and computes trajectories', async () => {
    // ds-1 is open_source (public), ds-2 has no provenance (private)
    mockPrisma.datasetProvenance.findUnique.mockImplementation(
      async ({ where }: { where: { datasetId: string } }) =>
        where.datasetId === 'ds-1'
          ? makeProvenanceRow({ datasetId: 'ds-1', sourceType: 'open_source' })
          : null
    );
    mockPrisma.trainingDataSummary.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) =>
        makeSummaryRow({ ...data, id: 'sum-new' })
    );
    const onEvent = vi.fn();
    service.on('summary:generated', onEvent);

    const result = await service.generateSummary(
      'mv-1',
      {
        datasetIds: ['ds-1', 'ds-2'],
        copyrightMeasures: 'opt-out honored',
        processingPurposes: ['Training VLA'],
      },
      'user-1'
    );

    const createArg = mockPrisma.trainingDataSummary.create.mock.calls[0][0] as {
      data: { totalTrajectories: number; publicDatasets: string[]; privateDatasets: string[] };
    };
    expect(createArg.data.totalTrajectories).toBe(2000); // 2 datasets * 1000
    expect(createArg.data.publicDatasets).toEqual(['ds-1']);
    expect(createArg.data.privateDatasets).toEqual(['ds-2']);
    expect(result.modelVersionId).toBe('mv-1');
    expect(onEvent).toHaveBeenCalledTimes(1);
  });

  it('sets nextUpdateDue AI_ACT_UPDATE_INTERVAL_DAYS in the future and defaults knownGaps', async () => {
    mockPrisma.datasetProvenance.findUnique.mockResolvedValue(null);
    mockPrisma.trainingDataSummary.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) =>
        makeSummaryRow({ ...data, id: 'sum-new' })
    );

    const before = Date.now();
    await service.generateSummary(
      'mv-2',
      { datasetIds: ['ds-x'], copyrightMeasures: 'm', processingPurposes: ['p'] },
      'user-1'
    );

    const createArg = mockPrisma.trainingDataSummary.create.mock.calls[0][0] as {
      data: { nextUpdateDue: Date; knownGaps: string[] };
    };
    expect(createArg.data.knownGaps).toEqual([]);
    const due = createArg.data.nextUpdateDue.getTime();
    const expected = before + AI_ACT_UPDATE_INTERVAL_DAYS * 24 * 60 * 60 * 1000;
    // allow a generous window for clock + day-arithmetic differences
    expect(Math.abs(due - expected)).toBeLessThan(2 * 24 * 60 * 60 * 1000);
  });
});

// ===========================================================================
// getSummary
// ===========================================================================

describe('getSummary', () => {
  it('returns null when the summary does not exist', async () => {
    mockPrisma.trainingDataSummary.findUnique.mockResolvedValue(null);
    const result = await service.getSummary('mv-missing');
    expect(result).toBeNull();
  });

  it('enriches datasets and flags overdue summaries', async () => {
    const pastDue = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    mockPrisma.trainingDataSummary.findUnique.mockResolvedValue(
      makeSummaryRow({ datasetIds: ['ds-1'], nextUpdateDue: pastDue })
    );
    mockPrisma.datasetProvenance.findUnique.mockResolvedValue(
      makeProvenanceRow({ datasetId: 'ds-1', sourceType: 'open_source', sourceName: 'Public DS' })
    );

    const result = await service.getSummary('mv-1');

    expect(result).not.toBeNull();
    expect(result?.isUpdateOverdue).toBe(true);
    expect(result?.daysUntilUpdateDue).toBe(0); // clamped to >= 0
    expect(result?.datasets).toHaveLength(1);
    expect(result?.datasets[0]).toMatchObject({
      id: 'ds-1',
      name: 'Public DS',
      sourceType: 'open_source',
      isPublic: true,
    });
  });

  it('uses fallback dataset name when provenance is missing', async () => {
    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    mockPrisma.trainingDataSummary.findUnique.mockResolvedValue(
      makeSummaryRow({ datasetIds: ['abcdef1234567890'], nextUpdateDue: future })
    );
    mockPrisma.datasetProvenance.findUnique.mockResolvedValue(null);

    const result = await service.getSummary('mv-1');

    expect(result?.isUpdateOverdue).toBe(false);
    expect(result?.datasets[0].name).toBe('Dataset abcdef12');
    expect(result?.datasets[0].sourceType).toBe('collected');
    expect(result?.datasets[0].isPublic).toBe(false);
  });
});

// ===========================================================================
// updateSummary
// ===========================================================================

describe('updateSummary', () => {
  it('returns null when the summary does not exist', async () => {
    mockPrisma.trainingDataSummary.findUnique.mockResolvedValue(null);
    const result = await service.updateSummary('mv-missing', { knownGaps: ['x'] });
    expect(result).toBeNull();
    expect(mockPrisma.trainingDataSummary.update).not.toHaveBeenCalled();
  });

  it('only writes provided fields and refreshes the due date, emitting an event', async () => {
    mockPrisma.trainingDataSummary.findUnique.mockResolvedValue(makeSummaryRow());
    mockPrisma.trainingDataSummary.update.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => makeSummaryRow(data)
    );
    const onEvent = vi.fn();
    service.on('summary:updated', onEvent);

    const result = await service.updateSummary('mv-1', { copyrightMeasures: 'new measure' });

    const updateArg = mockPrisma.trainingDataSummary.update.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(updateArg.data.copyrightMeasures).toBe('new measure');
    expect(updateArg.data).toHaveProperty('lastUpdated');
    expect(updateArg.data).toHaveProperty('nextUpdateDue');
    // fields not supplied are not written
    expect(updateArg.data).not.toHaveProperty('processingPurposes');
    expect(updateArg.data).not.toHaveProperty('knownGaps');
    expect(updateArg.data).not.toHaveProperty('limitations');
    expect(result?.modelVersionId).toBe('mv-1');
    expect(onEvent).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// getSummariesDue
// ===========================================================================

describe('getSummariesDue', () => {
  it('returns due summaries with overdue count and pagination defaults', async () => {
    const overdue = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    mockPrisma.trainingDataSummary.findMany.mockResolvedValue([
      makeSummaryRow({ modelVersionId: 'mv-overdue', nextUpdateDue: overdue }),
    ]);
    // count is called twice: total then overdueCount
    mockPrisma.trainingDataSummary.count
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1);

    const result = await service.getSummariesDue();

    expect(result.total).toBe(1);
    expect(result.overdueCount).toBe(1);
    expect(result.summaries).toHaveLength(1);
    expect(result.summaries[0].isOverdue).toBe(true);
    // default pagination → skip 0, take 50
    const findArg = mockPrisma.trainingDataSummary.findMany.mock.calls[0][0] as {
      skip: number;
      take: number;
    };
    expect(findArg.skip).toBe(0);
    expect(findArg.take).toBe(50);
  });

  it('honors custom pagination and daysAhead', async () => {
    mockPrisma.trainingDataSummary.findMany.mockResolvedValue([]);
    mockPrisma.trainingDataSummary.count.mockResolvedValue(0);

    await service.getSummariesDue({ page: 3, limit: 10, daysAhead: 7 });

    const findArg = mockPrisma.trainingDataSummary.findMany.mock.calls[0][0] as {
      skip: number;
      take: number;
    };
    expect(findArg.skip).toBe(20); // (3-1)*10
    expect(findArg.take).toBe(10);
  });
});

// ===========================================================================
// createBiasAssessment
// ===========================================================================

describe('createBiasAssessment', () => {
  it('assigns an incrementing version, defaults status to draft, and emits an event', async () => {
    mockPrisma.biasAssessment.count.mockResolvedValue(2);
    mockPrisma.biasAssessment.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => makeBiasRow({ ...data, id: 'bias-new' })
    );
    const onEvent = vi.fn();
    service.on('bias:assessed', onEvent);

    const result = await service.createBiasAssessment(
      'mv-1',
      {
        demographicCoverage: { age: 'broad' },
        knownLimitations: ['edge cases'],
        potentialBiasSources: ['selection bias'],
        mitigationMeasures: ['resampling'],
      },
      'user-1'
    );

    const createArg = mockPrisma.biasAssessment.create.mock.calls[0][0] as {
      data: { assessmentVersion: number; status: string };
    };
    expect(createArg.data.assessmentVersion).toBe(3); // existingCount + 1
    expect(createArg.data.status).toBe('draft');
    expect(result.modelVersionId).toBe('mv-1');
    expect(onEvent).toHaveBeenCalledTimes(1);
  });

  it('serializes testingResults to plain JSON', async () => {
    mockPrisma.biasAssessment.count.mockResolvedValue(0);
    mockPrisma.biasAssessment.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => makeBiasRow({ ...data, id: 'bias-new' })
    );

    await service.createBiasAssessment(
      'mv-1',
      {
        demographicCoverage: { age: 'broad' },
        knownLimitations: [],
        potentialBiasSources: [],
        mitigationMeasures: [],
        testingResults: {
          testDate: new Date('2025-01-01T00:00:00Z'),
          testMethodology: 'audit',
          metrics: [{ name: 'parity', value: 0.1 }],
          overallAssessment: 'pass',
        },
      },
      'user-1'
    );

    const createArg = mockPrisma.biasAssessment.create.mock.calls[0][0] as {
      data: { testingResults: { testMethodology: string; testDate: string } };
    };
    // JSON.parse(JSON.stringify(...)) turns the Date into an ISO string
    expect(createArg.data.testingResults.testMethodology).toBe('audit');
    expect(typeof createArg.data.testingResults.testDate).toBe('string');
  });
});

// ===========================================================================
// getBiasAssessment / history / by id
// ===========================================================================

describe('getBiasAssessment', () => {
  it('returns the latest assessment by version', async () => {
    mockPrisma.biasAssessment.findFirst.mockResolvedValue(makeBiasRow({ assessmentVersion: 4 }));
    const result = await service.getBiasAssessment('mv-1');
    expect(result?.assessmentVersion).toBe(4);
    const arg = mockPrisma.biasAssessment.findFirst.mock.calls[0][0] as {
      orderBy: { assessmentVersion: string };
    };
    expect(arg.orderBy).toEqual({ assessmentVersion: 'desc' });
  });

  it('returns null when none exist', async () => {
    mockPrisma.biasAssessment.findFirst.mockResolvedValue(null);
    expect(await service.getBiasAssessment('mv-1')).toBeNull();
  });
});

describe('getBiasAssessmentHistory', () => {
  it('maps all assessments for a model version', async () => {
    mockPrisma.biasAssessment.findMany.mockResolvedValue([
      makeBiasRow({ id: 'b2', assessmentVersion: 2 }),
      makeBiasRow({ id: 'b1', assessmentVersion: 1 }),
    ]);
    const result = await service.getBiasAssessmentHistory('mv-1');
    expect(result.map((a) => a.id)).toEqual(['b2', 'b1']);
  });
});

describe('getBiasAssessmentById', () => {
  it('returns the assessment when found', async () => {
    mockPrisma.biasAssessment.findUnique.mockResolvedValue(makeBiasRow());
    const result = await service.getBiasAssessmentById('bias-1');
    expect(result?.id).toBe('bias-1');
  });

  it('returns null when not found', async () => {
    mockPrisma.biasAssessment.findUnique.mockResolvedValue(null);
    expect(await service.getBiasAssessmentById('nope')).toBeNull();
  });
});

// ===========================================================================
// updateBiasAssessment
// ===========================================================================

describe('updateBiasAssessment', () => {
  it('returns null when the assessment does not exist', async () => {
    mockPrisma.biasAssessment.findUnique.mockResolvedValue(null);
    const result = await service.updateBiasAssessment('nope', { notes: 'x' });
    expect(result).toBeNull();
    expect(mockPrisma.biasAssessment.update).not.toHaveBeenCalled();
  });

  it('sets reviewedBy/reviewedDate when transitioning to approved and emits bias:approved', async () => {
    mockPrisma.biasAssessment.findUnique.mockResolvedValue(makeBiasRow());
    mockPrisma.biasAssessment.update.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) =>
        makeBiasRow({ ...data, id: 'bias-1' })
    );
    const onEvent = vi.fn();
    service.on('bias:approved', onEvent);

    const result = await service.updateBiasAssessment(
      'bias-1',
      { status: 'approved' },
      'reviewer-1'
    );

    const updateArg = mockPrisma.biasAssessment.update.mock.calls[0][0] as {
      data: { status: string; reviewedBy: string; reviewedDate: Date };
    };
    expect(updateArg.data.status).toBe('approved');
    expect(updateArg.data.reviewedBy).toBe('reviewer-1');
    expect(updateArg.data.reviewedDate).toBeInstanceOf(Date);
    expect(result?.id).toBe('bias-1');
    expect(onEvent).toHaveBeenCalledTimes(1);
  });

  it('emits bias:reviewed for a reviewed transition', async () => {
    mockPrisma.biasAssessment.findUnique.mockResolvedValue(makeBiasRow());
    mockPrisma.biasAssessment.update.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => makeBiasRow({ ...data, id: 'bias-1' })
    );
    const onEvent = vi.fn();
    service.on('bias:reviewed', onEvent);

    await service.updateBiasAssessment('bias-1', { status: 'reviewed' }, 'reviewer-1');

    expect(onEvent).toHaveBeenCalledTimes(1);
  });

  it('does not set review fields for non-review updates and emits bias:assessed', async () => {
    mockPrisma.biasAssessment.findUnique.mockResolvedValue(makeBiasRow());
    mockPrisma.biasAssessment.update.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => makeBiasRow({ ...data, id: 'bias-1' })
    );
    const onEvent = vi.fn();
    service.on('bias:assessed', onEvent);

    await service.updateBiasAssessment('bias-1', { notes: 'updated notes' });

    const updateArg = mockPrisma.biasAssessment.update.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(updateArg.data.notes).toBe('updated notes');
    expect(updateArg.data).not.toHaveProperty('reviewedBy');
    expect(updateArg.data).not.toHaveProperty('status');
    expect(onEvent).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// exportDocumentation
// ===========================================================================

describe('exportDocumentation', () => {
  it('produces JSON containing summary, bias, and provenance sections', async () => {
    mockPrisma.trainingDataSummary.findUnique.mockResolvedValue(
      makeSummaryRow({ datasetIds: ['ds-1'] })
    );
    mockPrisma.datasetProvenance.findUnique.mockResolvedValue(
      makeProvenanceRow({ datasetId: 'ds-1' })
    );
    mockPrisma.biasAssessment.findMany.mockResolvedValue([makeBiasRow()]);

    const result = await service.exportDocumentation('mv-1', 'json');

    expect(result.format).toBe('json');
    expect(result.filename).toBe('training-docs-mv-1.json');
    expect(result.sections).toEqual(['summary', 'provenance', 'bias_assessment']);
    const parsed = JSON.parse(result.content) as { modelVersionId: string; summary: unknown };
    expect(parsed.modelVersionId).toBe('mv-1');
    expect(parsed.summary).not.toBeNull();
  });

  it('produces markdown and honors include flags', async () => {
    mockPrisma.trainingDataSummary.findUnique.mockResolvedValue(
      makeSummaryRow({ datasetIds: ['ds-1'], knownGaps: ['gap1'] })
    );
    // provenance + bias excluded
    const result = await service.exportDocumentation('mv-1', 'markdown', false, false);

    expect(result.format).toBe('markdown');
    expect(result.filename).toBe('training-docs-mv-1.md');
    expect(result.sections).toEqual(['summary']);
    expect(result.content).toContain('# Training Data Documentation');
    expect(result.content).toContain('Known Gaps');
    // provenance lookup should not happen when includeProvenance is false
    expect(mockPrisma.datasetProvenance.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.biasAssessment.findMany).not.toHaveBeenCalled();
  });

  it('handles a missing summary gracefully (summary section only)', async () => {
    mockPrisma.trainingDataSummary.findUnique.mockResolvedValue(null);
    mockPrisma.biasAssessment.findMany.mockResolvedValue([]);

    const result = await service.exportDocumentation('mv-missing', 'markdown');

    expect(result.sections).toEqual(['summary']);
    expect(result.content).toContain('# Training Data Documentation');
  });
});

// ===========================================================================
// generatePdfBuffer
// ===========================================================================

describe('generatePdfBuffer', () => {
  it('returns a non-empty PDF buffer with summary, bias, and provenance', async () => {
    mockPrisma.trainingDataSummary.findUnique.mockResolvedValue(
      makeSummaryRow({ datasetIds: ['ds-1'], knownGaps: ['gap1'] })
    );
    mockPrisma.datasetProvenance.findUnique.mockResolvedValue(
      makeProvenanceRow({ datasetId: 'ds-1' })
    );
    mockPrisma.biasAssessment.findMany.mockResolvedValue([makeBiasRow()]);

    const buffer = await service.generatePdfBuffer('mv-1');

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(0);
    // PDF files start with the %PDF magic header
    expect(buffer.subarray(0, 4).toString('latin1')).toBe('%PDF');
  });

  it('produces a valid PDF even when there is no summary or assessments', async () => {
    mockPrisma.trainingDataSummary.findUnique.mockResolvedValue(null);
    mockPrisma.biasAssessment.findMany.mockResolvedValue([]);

    const buffer = await service.generatePdfBuffer('mv-empty', false, true);

    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 4).toString('latin1')).toBe('%PDF');
  });
});

// ===========================================================================
// Event helpers / type mapping
// ===========================================================================

describe('event emission', () => {
  it('emits both the generic channel and the typed channel', async () => {
    mockPrisma.datasetProvenance.findUnique.mockResolvedValue(null);
    mockPrisma.datasetProvenance.create.mockResolvedValue(makeProvenanceRow());

    const generic = vi.fn();
    const typed = vi.fn();
    service.on('training-docs:event', generic);
    service.on('provenance:recorded', typed);

    await service.recordProvenance('ds-1', { sourceType: 'collected' }, 'user-1');

    expect(generic).toHaveBeenCalledTimes(1);
    expect(typed).toHaveBeenCalledTimes(1);
  });
});

// Light type-level smoke checks so the imported types are actually referenced.
describe('type mapping smoke', () => {
  it('maps provenance/summary/bias shapes consistently', async () => {
    mockPrisma.datasetProvenance.findUnique.mockResolvedValue(makeProvenanceRow());
    const prov: DatasetProvenance | null = await service.getProvenance('ds-1');
    expect(prov?.recordedAt).toBeInstanceOf(Date);

    mockPrisma.trainingDataSummary.findUnique.mockResolvedValue(null);
    mockPrisma.trainingDataSummary.update.mockResolvedValue(makeSummaryRow());
    mockPrisma.trainingDataSummary.findUnique.mockResolvedValueOnce(makeSummaryRow());
    const sum: TrainingDataSummary | null = await service.updateSummary('mv-1', {});
    expect(sum?.generatedAt).toBeInstanceOf(Date);

    mockPrisma.biasAssessment.findUnique.mockResolvedValue(makeBiasRow());
    const bias: BiasAssessment | null = await service.getBiasAssessmentById('bias-1');
    expect(bias?.status).toBe('draft');
  });
});
