/**
 * @file ComplianceTrackerService.test.ts
 * @description Unit tests for ComplianceTrackerService — compliance dashboard, deadlines,
 *              gaps, document expiry, training records, inspections, risk assessments, activity.
 * @feature compliance
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock the only external boundary: the prisma client (via database/index.js).
// The service imports `{ prisma }` from '../database/index.js'.
// ---------------------------------------------------------------------------

const prismaMock = vi.hoisted(() => ({
  complianceGap: {
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  },
  regulatoryDeadline: {
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  },
  providerDocumentation: {
    findMany: vi.fn(),
    count: vi.fn(),
  },
  trainingRecord: {
    findMany: vi.fn(),
    create: vi.fn(),
    count: vi.fn(),
  },
  inspectionSchedule: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  },
  riskAssessment: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  },
  complianceActivity: {
    findMany: vi.fn(),
    create: vi.fn(),
  },
}));

vi.mock('../../database/index.js', () => ({
  prisma: prismaMock,
}));

import { ComplianceTrackerService } from '../ComplianceTrackerService.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DAY = 24 * 60 * 60 * 1000;

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * DAY);
}

function makeGap(overrides: Record<string, unknown> = {}) {
  return {
    id: 'gap-1',
    framework: 'ai_act',
    requirement: 'Risk management',
    articleReference: 'Art. 9',
    severity: 'critical',
    description: 'desc',
    currentState: 'cur',
    targetState: 'tgt',
    remediation: 'fix',
    estimatedEffort: 'medium',
    dueDate: null as Date | null,
    assignedTo: null,
    status: 'open',
    createdAt: new Date(),
    closedAt: null,
    closedBy: null,
    ...overrides,
  };
}

let service: ComplianceTrackerService;

beforeEach(() => {
  vi.clearAllMocks();
  // Sensible default resolves so unrelated calls don't blow up.
  for (const model of Object.values(prismaMock)) {
    for (const fn of Object.values(model)) {
      (fn as ReturnType<typeof vi.fn>).mockReset();
    }
  }
  service = new ComplianceTrackerService();
});

// ===========================================================================
// getDashboardStats / framework scores / alerts
// ===========================================================================

describe('getDashboardStats', () => {
  it('aggregates framework scores and alerts into an overall score', async () => {
    // No gaps, no deadlines for every framework -> score 100 each.
    prismaMock.complianceGap.findMany.mockResolvedValue([]);
    prismaMock.regulatoryDeadline.findMany.mockResolvedValue([]);
    // Alert counts.
    prismaMock.complianceGap.count.mockResolvedValue(0);
    prismaMock.providerDocumentation.count.mockResolvedValue(0);
    prismaMock.trainingRecord.count.mockResolvedValue(0);
    prismaMock.inspectionSchedule.count.mockResolvedValue(0);
    prismaMock.regulatoryDeadline.count.mockResolvedValue(0);
    prismaMock.riskAssessment.count.mockResolvedValue(0);

    const stats = await service.getDashboardStats();

    expect(stats.overallScore).toBe(100);
    expect(stats.frameworkScores).toHaveLength(7);
    expect(stats.alerts).toEqual({
      criticalGaps: 0,
      expiringDocuments: 0,
      overdueTraining: 0,
      overdueInspections: 0,
      upcomingDeadlines: 0,
      pendingRiskReviews: 0,
    });
    expect(typeof stats.lastUpdated).toBe('string');
  });

  it('penalizes scores by gap severity and computes the weighted overall', async () => {
    // Return critical gaps only for the FIRST framework (ai_act), empty otherwise.
    let call = 0;
    prismaMock.complianceGap.findMany.mockImplementation(async () => {
      call += 1;
      if (call === 1) {
        // 2 critical gaps -> penalty 40 -> score 60 -> 'at_risk'
        return [makeGap({ severity: 'critical' }), makeGap({ severity: 'critical' })];
      }
      return [];
    });
    prismaMock.regulatoryDeadline.findMany.mockResolvedValue([]);
    prismaMock.complianceGap.count.mockResolvedValue(0);
    prismaMock.providerDocumentation.count.mockResolvedValue(0);
    prismaMock.trainingRecord.count.mockResolvedValue(0);
    prismaMock.inspectionSchedule.count.mockResolvedValue(0);
    prismaMock.regulatoryDeadline.count.mockResolvedValue(0);
    prismaMock.riskAssessment.count.mockResolvedValue(0);

    const stats = await service.getDashboardStats();

    const aiAct = stats.frameworkScores.find((f) => f.framework === 'ai_act')!;
    expect(aiAct.score).toBe(60);
    expect(aiAct.status).toBe('at_risk');
    // 6 frameworks at 100, one at 60 -> (600+60)/7 = 94.28 -> rounds to 94
    expect(stats.overallScore).toBe(94);
  });

  it('reports critical-gap status as overdue when score is below 50', async () => {
    let call = 0;
    prismaMock.complianceGap.findMany.mockImplementation(async () => {
      call += 1;
      if (call === 1) {
        // 3 critical -> penalty 60 -> score 40 -> not >=50, criticalGaps>0 -> 'overdue'
        return [
          makeGap({ severity: 'critical' }),
          makeGap({ severity: 'critical' }),
          makeGap({ severity: 'critical' }),
        ];
      }
      return [];
    });
    prismaMock.regulatoryDeadline.findMany.mockResolvedValue([]);
    prismaMock.complianceGap.count.mockResolvedValue(0);
    prismaMock.providerDocumentation.count.mockResolvedValue(0);
    prismaMock.trainingRecord.count.mockResolvedValue(0);
    prismaMock.inspectionSchedule.count.mockResolvedValue(0);
    prismaMock.regulatoryDeadline.count.mockResolvedValue(0);
    prismaMock.riskAssessment.count.mockResolvedValue(0);

    const stats = await service.getDashboardStats();
    const aiAct = stats.frameworkScores.find((f) => f.framework === 'ai_act')!;
    expect(aiAct.score).toBe(40);
    expect(aiAct.status).toBe('overdue');
  });

  it('propagates errors from the underlying prisma client', async () => {
    prismaMock.complianceGap.findMany.mockRejectedValue(new Error('db down'));
    await expect(service.getDashboardStats()).rejects.toThrow('db down');
  });
});

// ===========================================================================
// getRegulatoryDeadlines
// ===========================================================================

describe('getRegulatoryDeadlines', () => {
  it('computes daysUntilDeadline and compliant status when all requirements done', async () => {
    prismaMock.regulatoryDeadline.findMany.mockResolvedValue([
      {
        id: 'd1',
        framework: 'nis2',
        name: 'Reg',
        deadline: daysFromNow(10),
        description: 'x',
        requirements: JSON.stringify(['a', 'b']),
        completedRequirements: JSON.stringify(['a', 'b']),
      },
    ]);

    const result = await service.getRegulatoryDeadlines();
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('compliant');
    expect(result[0].daysUntilDeadline).toBeGreaterThanOrEqual(9);
    expect(result[0].daysUntilDeadline).toBeLessThanOrEqual(10);
  });

  it('marks past deadlines with incomplete requirements as overdue', async () => {
    prismaMock.regulatoryDeadline.findMany.mockResolvedValue([
      {
        id: 'd2',
        framework: 'cra',
        name: 'Late',
        deadline: daysFromNow(-5),
        description: 'x',
        requirements: JSON.stringify(['a', 'b']),
        completedRequirements: JSON.stringify(['a']),
      },
    ]);

    const result = await service.getRegulatoryDeadlines();
    expect(result[0].status).toBe('overdue');
    expect(result[0].daysUntilDeadline).toBeLessThan(0);
  });

  it('treats deadlines with zero requirements as compliant (completion 1)', async () => {
    prismaMock.regulatoryDeadline.findMany.mockResolvedValue([
      {
        id: 'd3',
        framework: 'gdpr',
        name: 'Empty',
        deadline: daysFromNow(30),
        description: 'x',
        requirements: JSON.stringify([]),
        completedRequirements: JSON.stringify([]),
      },
    ]);

    const result = await service.getRegulatoryDeadlines();
    expect(result[0].status).toBe('compliant');
  });

  it('flags near-future low-progress deadlines as at_risk', async () => {
    prismaMock.regulatoryDeadline.findMany.mockResolvedValue([
      {
        id: 'd4',
        framework: 'ai_act',
        name: 'Soon',
        deadline: daysFromNow(30),
        description: 'x',
        requirements: JSON.stringify(['a', 'b', 'c', 'd']),
        completedRequirements: JSON.stringify(['a']), // 25% < 50%
      },
    ]);

    const result = await service.getRegulatoryDeadlines();
    expect(result[0].status).toBe('at_risk');
  });

  it('returns an empty array when there are no deadlines', async () => {
    prismaMock.regulatoryDeadline.findMany.mockResolvedValue([]);
    const result = await service.getRegulatoryDeadlines();
    expect(result).toEqual([]);
  });
});

describe('createRegulatoryDeadline', () => {
  it('serializes requirements and defaults priority to medium', async () => {
    prismaMock.regulatoryDeadline.create.mockResolvedValue({ id: 'new' });
    const input = {
      framework: 'nis2' as const,
      name: 'X',
      deadline: new Date('2025-01-01'),
      description: 'd',
      requirements: ['r1', 'r2'],
    };

    const result = await service.createRegulatoryDeadline(input);
    expect(result).toEqual({ id: 'new' });
    expect(prismaMock.regulatoryDeadline.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        framework: 'nis2',
        requirements: JSON.stringify(['r1', 'r2']),
        completedRequirements: JSON.stringify([]),
        priority: 'medium',
      }),
    });
  });

  it('respects an explicit priority', async () => {
    prismaMock.regulatoryDeadline.create.mockResolvedValue({ id: 'new2' });
    await service.createRegulatoryDeadline({
      framework: 'cra',
      name: 'X',
      deadline: new Date(),
      description: 'd',
      requirements: [],
      priority: 'critical',
    });
    expect(prismaMock.regulatoryDeadline.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ priority: 'critical' }),
    });
  });
});

describe('updateDeadlineProgress', () => {
  it('serializes completed requirements and updates by id', async () => {
    prismaMock.regulatoryDeadline.update.mockResolvedValue({ id: 'd1' });
    await service.updateDeadlineProgress('d1', ['a', 'b']);
    expect(prismaMock.regulatoryDeadline.update).toHaveBeenCalledWith({
      where: { id: 'd1' },
      data: { completedRequirements: JSON.stringify(['a', 'b']) },
    });
  });
});

// ===========================================================================
// getGaps / createGap / closeGap / getGapSummaryByFramework
// ===========================================================================

describe('getGaps', () => {
  it('applies filters and computes daysUntilDue', async () => {
    prismaMock.complianceGap.findMany.mockResolvedValue([
      makeGap({ id: 'g1', dueDate: daysFromNow(10) }),
      makeGap({ id: 'g2', dueDate: null }),
    ]);

    const result = await service.getGaps({ framework: 'ai_act', severity: 'critical', status: 'open' });

    expect(prismaMock.complianceGap.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { framework: 'ai_act', severity: 'critical', status: 'open' },
      })
    );
    expect(result[0].daysUntilDue).toBeGreaterThanOrEqual(9);
    expect(result[1].daysUntilDue).toBeNull();
  });

  it('queries with no filter when no options are given', async () => {
    prismaMock.complianceGap.findMany.mockResolvedValue([]);
    await service.getGaps();
    expect(prismaMock.complianceGap.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} })
    );
  });
});

describe('createGap', () => {
  it('creates a gap with status open and logs an activity', async () => {
    const created = makeGap({ id: 'g-new' });
    prismaMock.complianceGap.create.mockResolvedValue(created);
    prismaMock.complianceActivity.create.mockResolvedValue({});

    const result = await service.createGap({
      framework: 'ai_act',
      requirement: 'New req',
      articleReference: 'Art. 1',
      severity: 'high',
      description: 'd',
      currentState: 'c',
      targetState: 't',
      remediation: 'r',
    });

    expect(result).toBe(created);
    expect(prismaMock.complianceGap.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: 'open', estimatedEffort: 'medium' }),
    });
    // A newly identified gap logs a distinct 'gap_opened' activity (not 'gap_closed').
    expect(prismaMock.complianceActivity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'gap_opened',
        description: 'New gap identified: New req',
        framework: 'ai_act',
      }),
    });
  });

  it('propagates errors when gap creation fails', async () => {
    prismaMock.complianceGap.create.mockRejectedValue(new Error('insert failed'));
    await expect(
      service.createGap({
        framework: 'gdpr',
        requirement: 'x',
        articleReference: 'a',
        severity: 'low',
        description: 'd',
        currentState: 'c',
        targetState: 't',
        remediation: 'r',
      })
    ).rejects.toThrow('insert failed');
    expect(prismaMock.complianceActivity.create).not.toHaveBeenCalled();
  });
});

describe('closeGap', () => {
  it('sets status closed with closedBy and logs activity', async () => {
    const closed = makeGap({ id: 'g1', status: 'closed', requirement: 'R', framework: 'nis2' });
    prismaMock.complianceGap.update.mockResolvedValue(closed);
    prismaMock.complianceActivity.create.mockResolvedValue({});

    const result = await service.closeGap('g1', 'alice');

    expect(result).toBe(closed);
    expect(prismaMock.complianceGap.update).toHaveBeenCalledWith({
      where: { id: 'g1' },
      data: expect.objectContaining({ status: 'closed', closedBy: 'alice' }),
    });
    expect(prismaMock.complianceActivity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'gap_closed',
        description: 'Gap closed: R',
        framework: 'nis2',
      }),
    });
  });
});

describe('getGapSummaryByFramework', () => {
  it('aggregates counts per framework and severity', async () => {
    prismaMock.complianceGap.findMany.mockResolvedValue([
      makeGap({ framework: 'ai_act', severity: 'critical' }),
      makeGap({ framework: 'ai_act', severity: 'high' }),
      makeGap({ framework: 'gdpr', severity: 'low' }),
    ]);

    const summary = await service.getGapSummaryByFramework();
    expect(summary.ai_act).toEqual({ total: 2, critical: 1, high: 1, medium: 0, low: 0 });
    expect(summary.gdpr).toEqual({ total: 1, critical: 0, high: 0, medium: 0, low: 1 });
  });

  it('returns an empty object when there are no open gaps', async () => {
    prismaMock.complianceGap.findMany.mockResolvedValue([]);
    const summary = await service.getGapSummaryByFramework();
    expect(summary).toEqual({});
  });
});

// ===========================================================================
// getExpiringDocuments
// ===========================================================================

describe('getExpiringDocuments', () => {
  it('classifies expired, expiring_soon, and valid documents', async () => {
    const withinDays = 30;
    prismaMock.providerDocumentation.findMany.mockResolvedValue([
      { id: 'doc-expired', validTo: daysFromNow(-2) },
      { id: 'doc-soon', validTo: daysFromNow(10) },
      { id: 'doc-valid', validTo: daysFromNow(100) },
    ]);

    const result = await service.getExpiringDocuments(withinDays);
    const byId = Object.fromEntries(result.map((d) => [d.id, d]));
    expect(byId['doc-expired'].status).toBe('expired');
    expect(byId['doc-soon'].status).toBe('expiring_soon');
    expect(byId['doc-valid'].status).toBe('valid');
    expect(byId['doc-soon'].daysUntilExpiry).toBeGreaterThan(0);
  });

  it('uses the default window of 30 days', async () => {
    prismaMock.providerDocumentation.findMany.mockResolvedValue([]);
    await service.getExpiringDocuments();
    const arg = prismaMock.providerDocumentation.findMany.mock.calls[0][0];
    expect(arg.where.validTo.lte).toBeInstanceOf(Date);
    // ~30 days out
    const diffDays = (arg.where.validTo.lte.getTime() - Date.now()) / DAY;
    expect(diffDays).toBeGreaterThan(29);
    expect(diffDays).toBeLessThan(31);
  });
});

// ===========================================================================
// Training records
// ===========================================================================

describe('getTrainingRecords', () => {
  it('computes status and filters by the requested status', async () => {
    prismaMock.trainingRecord.findMany.mockResolvedValue([
      { id: 't-expired', userId: 'u1', expiresAt: daysFromNow(-1) },
      { id: 't-soon', userId: 'u2', expiresAt: daysFromNow(10) },
      { id: 't-valid', userId: 'u3', expiresAt: daysFromNow(100) },
    ]);

    const all = await service.getTrainingRecords();
    expect(all).toHaveLength(3);

    const expired = await service.getTrainingRecords({ status: 'expired' });
    expect(expired).toHaveLength(1);
    expect(expired[0].id).toBe('t-expired');
  });

  it('passes userId and trainingType filters to prisma', async () => {
    prismaMock.trainingRecord.findMany.mockResolvedValue([]);
    await service.getTrainingRecords({ userId: 'u1', trainingType: 'safety_training' });
    expect(prismaMock.trainingRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'u1', trainingType: 'safety_training' },
      })
    );
  });
});

describe('createTrainingRecord', () => {
  it('creates a record and logs a training_completed activity for dguv', async () => {
    prismaMock.trainingRecord.create.mockResolvedValue({ id: 'tr1' });
    prismaMock.complianceActivity.create.mockResolvedValue({});

    const result = await service.createTrainingRecord({
      userId: 'u1',
      userName: 'Bob',
      trainingType: 'safety_training',
      completedAt: new Date(),
      expiresAt: daysFromNow(365),
    });

    expect(result).toEqual({ id: 'tr1' });
    expect(prismaMock.complianceActivity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'training_completed',
        description: 'Bob completed safety_training',
        framework: 'dguv',
      }),
    });
  });
});

describe('getTrainingSummary', () => {
  it('counts valid/expiring/expired and unique employees', async () => {
    prismaMock.trainingRecord.findMany.mockResolvedValue([
      { userId: 'u1', expiresAt: daysFromNow(-1) }, // expired
      { userId: 'u1', expiresAt: daysFromNow(10) }, // expiring soon (same user)
      { userId: 'u2', expiresAt: daysFromNow(100) }, // valid
    ]);

    const summary = await service.getTrainingSummary();
    expect(summary.totalRecords).toBe(3);
    expect(summary.totalEmployees).toBe(2);
    expect(summary.expired).toBe(1);
    expect(summary.expiringSoon).toBe(1);
    expect(summary.valid).toBe(1);
  });

  it('returns zeros with no records', async () => {
    prismaMock.trainingRecord.findMany.mockResolvedValue([]);
    const summary = await service.getTrainingSummary();
    expect(summary).toEqual({
      totalRecords: 0,
      totalEmployees: 0,
      valid: 0,
      expiringSoon: 0,
      expired: 0,
    });
  });
});

// ===========================================================================
// Inspection schedules
// ===========================================================================

describe('getInspectionSchedules', () => {
  it('computes status and filters by status option', async () => {
    prismaMock.inspectionSchedule.findMany.mockResolvedValue([
      { id: 'i-overdue', nextDueDate: daysFromNow(-1) },
      { id: 'i-soon', nextDueDate: daysFromNow(10) },
      { id: 'i-current', nextDueDate: daysFromNow(100) },
    ]);

    const overdue = await service.getInspectionSchedules({ status: 'overdue' });
    expect(overdue).toHaveLength(1);
    expect(overdue[0].id).toBe('i-overdue');

    const all = await service.getInspectionSchedules();
    expect(all).toHaveLength(3);
  });
});

describe('createInspectionSchedule', () => {
  it('forwards all fields to prisma create', async () => {
    prismaMock.inspectionSchedule.create.mockResolvedValue({ id: 'is1' });
    const result = await service.createInspectionSchedule({
      inspectionType: 'electrical',
      lastInspectionDate: new Date('2024-01-01'),
      nextDueDate: new Date('2025-01-01'),
      intervalYears: 1,
    });
    expect(result).toEqual({ id: 'is1' });
    expect(prismaMock.inspectionSchedule.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ inspectionType: 'electrical', intervalYears: 1 }),
    });
  });
});

describe('recordInspectionCompletion', () => {
  it('throws when the schedule is not found', async () => {
    prismaMock.inspectionSchedule.findUnique.mockResolvedValue(null);
    await expect(service.recordInspectionCompletion('nope')).rejects.toThrow(
      'Inspection schedule not found'
    );
    expect(prismaMock.inspectionSchedule.update).not.toHaveBeenCalled();
  });

  it('advances nextDueDate by intervalYears and logs activity', async () => {
    prismaMock.inspectionSchedule.findUnique.mockResolvedValue({
      id: 'is1',
      inspectionType: 'electrical',
      intervalYears: 2,
      reportUrl: 'old-url',
      inspectorName: 'old-name',
    });
    prismaMock.inspectionSchedule.update.mockImplementation(async (args: any) => args.data);
    prismaMock.complianceActivity.create.mockResolvedValue({});

    const result = await service.recordInspectionCompletion('is1', 'new-url', 'new-name');

    const updateArg = prismaMock.inspectionSchedule.update.mock.calls[0][0];
    expect(updateArg.where).toEqual({ id: 'is1' });
    const yearsDiff =
      updateArg.data.nextDueDate.getFullYear() - updateArg.data.lastInspectionDate.getFullYear();
    expect(yearsDiff).toBe(2);
    expect(result.reportUrl).toBe('new-url');
    expect(result.inspectorName).toBe('new-name');
    expect(prismaMock.complianceActivity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ type: 'inspection_done', framework: 'dguv' }),
    });
  });

  it('falls back to existing report/inspector when not provided', async () => {
    prismaMock.inspectionSchedule.findUnique.mockResolvedValue({
      id: 'is2',
      inspectionType: 'electrical',
      intervalYears: 1,
      reportUrl: 'keep-url',
      inspectorName: 'keep-name',
    });
    prismaMock.inspectionSchedule.update.mockImplementation(async (args: any) => args.data);
    prismaMock.complianceActivity.create.mockResolvedValue({});

    const result = await service.recordInspectionCompletion('is2');
    expect(result.reportUrl).toBe('keep-url');
    expect(result.inspectorName).toBe('keep-name');
  });
});

describe('getInspectionSummary', () => {
  it('counts statuses and identifies the next upcoming inspection', async () => {
    prismaMock.inspectionSchedule.findMany.mockResolvedValue([
      { id: 'overdue', nextDueDate: daysFromNow(-5) },
      { id: 'soon', nextDueDate: daysFromNow(5) },
      { id: 'later', nextDueDate: daysFromNow(50) },
    ]);

    const summary = await service.getInspectionSummary();
    expect(summary.totalScheduled).toBe(3);
    expect(summary.overdue).toBe(1);
    expect(summary.dueSoon).toBe(1);
    expect(summary.current).toBe(1);
    expect(summary.nextInspection?.id).toBe('soon');
    expect(summary.nextInspection?.daysUntilDue).toBeGreaterThan(0);
  });

  it('returns null nextInspection when all are overdue', async () => {
    prismaMock.inspectionSchedule.findMany.mockResolvedValue([
      { id: 'overdue', nextDueDate: daysFromNow(-5) },
    ]);
    const summary = await service.getInspectionSummary();
    expect(summary.nextInspection).toBeNull();
  });
});

// ===========================================================================
// Risk assessments
// ===========================================================================

describe('getRiskAssessments', () => {
  it('computes status and filters', async () => {
    prismaMock.riskAssessment.findMany.mockResolvedValue([
      { id: 'a-update', nextReviewDate: daysFromNow(-1) },
      { id: 'a-review', nextReviewDate: daysFromNow(10) },
      { id: 'a-current', nextReviewDate: daysFromNow(100) },
    ]);

    const all = await service.getRiskAssessments();
    expect(all).toHaveLength(3);

    const needReview = await service.getRiskAssessments({ status: 'review_needed' });
    expect(needReview).toHaveLength(1);
    expect(needReview[0].id).toBe('a-review');
  });
});

describe('createRiskAssessment', () => {
  it('serializes trigger conditions and initializes triggeredUpdates', async () => {
    prismaMock.riskAssessment.create.mockResolvedValue({ id: 'ra1' });
    await service.createRiskAssessment({
      assessmentType: 'ai_risk',
      name: 'AI Risk',
      version: '1.0',
      lastUpdated: new Date(),
      nextReviewDate: daysFromNow(365),
      triggerConditions: ['cond1'],
    });
    expect(prismaMock.riskAssessment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        triggerConditions: JSON.stringify(['cond1']),
        triggeredUpdates: JSON.stringify([]),
      }),
    });
  });
});

describe('updateRiskAssessment', () => {
  it('throws when the assessment does not exist', async () => {
    prismaMock.riskAssessment.findUnique.mockResolvedValue(null);
    await expect(service.updateRiskAssessment('nope', '2.0', daysFromNow(30))).rejects.toThrow(
      'Risk assessment not found'
    );
  });

  it('appends a triggeredUpdates entry and logs an activity', async () => {
    prismaMock.riskAssessment.findUnique.mockResolvedValue({
      id: 'ra1',
      name: 'AI Risk',
      documentUrl: 'old-doc',
      triggeredUpdates: JSON.stringify(['prior']),
    });
    prismaMock.riskAssessment.update.mockImplementation(async (args: any) => args.data);
    prismaMock.complianceActivity.create.mockResolvedValue({});

    const result = await service.updateRiskAssessment('ra1', '2.0', daysFromNow(60));

    const updateArg = prismaMock.riskAssessment.update.mock.calls[0][0];
    expect(updateArg.data.version).toBe('2.0');
    const updates = JSON.parse(updateArg.data.triggeredUpdates);
    expect(updates).toHaveLength(2);
    expect(updates[0]).toBe('prior');
    expect(updates[1]).toContain('Updated to 2.0');
    // documentUrl falls back to existing when not provided
    expect(result.documentUrl).toBe('old-doc');
    expect(prismaMock.complianceActivity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ type: 'assessment_updated' }),
    });
  });
});

// ===========================================================================
// Activity log
// ===========================================================================

describe('getRecentActivity', () => {
  it('queries ordered by timestamp desc with the default limit', async () => {
    prismaMock.complianceActivity.findMany.mockResolvedValue([{ id: 'act1' }]);
    const result = await service.getRecentActivity();
    expect(result).toEqual([{ id: 'act1' }]);
    expect(prismaMock.complianceActivity.findMany).toHaveBeenCalledWith({
      orderBy: { timestamp: 'desc' },
      take: 20,
    });
  });

  it('respects a custom limit', async () => {
    prismaMock.complianceActivity.findMany.mockResolvedValue([]);
    await service.getRecentActivity(5);
    expect(prismaMock.complianceActivity.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 5 })
    );
  });
});

// ===========================================================================
// initializeDefaults
// ===========================================================================

describe('initializeDefaults', () => {
  it('skips initialization when deadlines already exist', async () => {
    prismaMock.regulatoryDeadline.count.mockResolvedValue(3);
    await service.initializeDefaults();
    expect(prismaMock.regulatoryDeadline.create).not.toHaveBeenCalled();
  });

  it('creates the five default deadlines when empty', async () => {
    prismaMock.regulatoryDeadline.count.mockResolvedValue(0);
    prismaMock.regulatoryDeadline.create.mockResolvedValue({ id: 'x' });

    await service.initializeDefaults();

    expect(prismaMock.regulatoryDeadline.create).toHaveBeenCalledTimes(5);
  });
});
