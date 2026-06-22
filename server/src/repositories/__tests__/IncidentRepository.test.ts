/**
 * @file IncidentRepository.test.ts
 * @description Unit tests for IncidentRepository, IncidentNotificationRepository,
 *   and NotificationTemplateRepository — the data-access layer for incident
 *   reporting. The prisma client (the I/O boundary) is mocked; the inline
 *   dbIncidentToDomain / dbNotificationToDomain / dbTemplateToDomain mappers run
 *   for real so JSON-string parsing, Date passthrough, and nullable mapping are
 *   exercised end-to-end.
 * @feature incidents
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type {
  Incident as PrismaIncident,
  IncidentNotification as PrismaNotification,
  NotificationTemplate as PrismaTemplate,
} from '@prisma/client';

// ---------------------------------------------------------------------------
// Mock prisma before importing the repository. The repo touches three models:
// incident, incidentNotification, notificationTemplate.
// ---------------------------------------------------------------------------

vi.mock('../../database/index.js', () => ({
  prisma: {
    incident: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      groupBy: vi.fn(),
    },
    incidentNotification: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      createMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
      groupBy: vi.fn(),
    },
    notificationTemplate: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

import { prisma as _prisma } from '../../database/index.js';
import {
  IncidentRepository,
  IncidentNotificationRepository,
  NotificationTemplateRepository,
  incidentRepository,
  incidentNotificationRepository,
  notificationTemplateRepository,
} from '../IncidentRepository.js';

// Retype the mocked prisma so `.mockResolvedValue` etc. typecheck.
const prisma = vi.mocked(_prisma, true);

// ---------------------------------------------------------------------------
// Fixtures — db-row shapes the mappers accept (JSON-string array columns, Date
// columns, nullable columns as null).
// ---------------------------------------------------------------------------

function makeIncidentRow(
  overrides: Partial<PrismaIncident> & { notifications?: PrismaNotification[] } = {}
): PrismaIncident & { notifications?: PrismaNotification[] } {
  return {
    id: 'inc-1',
    incidentNumber: 'INC-2026-001',
    type: 'safety',
    severity: 'high',
    status: 'detected',
    title: 'Test Incident',
    description: 'Something happened',
    rootCause: null,
    resolution: null,
    riskScore: null,
    affectedDataSubjects: null,
    dataCategories: JSON.stringify(['personal']),
    detectedAt: new Date('2026-06-20T00:00:00.000Z'),
    containedAt: null,
    resolvedAt: null,
    closedAt: null,
    robotId: null,
    complianceLogIds: JSON.stringify(['log-1']),
    alertIds: JSON.stringify(['alert-1']),
    systemSnapshot: null,
    createdAt: new Date('2026-06-20T00:00:00.000Z'),
    updatedAt: new Date('2026-06-20T00:00:00.000Z'),
    createdBy: null,
    ...overrides,
  } as PrismaIncident & { notifications?: PrismaNotification[] };
}

function makeNotificationRow(
  overrides: Partial<PrismaNotification> = {}
): PrismaNotification {
  return {
    id: 'notif-1',
    incidentId: 'inc-1',
    authority: 'dpa',
    regulation: 'gdpr',
    notificationType: 'initial',
    deadlineHours: 72,
    dueAt: new Date('2026-06-23T00:00:00.000Z'),
    status: 'pending',
    sentAt: null,
    acknowledgedAt: null,
    templateId: null,
    content: null,
    createdAt: new Date('2026-06-20T00:00:00.000Z'),
    updatedAt: new Date('2026-06-20T00:00:00.000Z'),
    sentBy: null,
    ...overrides,
  } as PrismaNotification;
}

function makeTemplateRow(overrides: Partial<PrismaTemplate> = {}): PrismaTemplate {
  return {
    id: 'tpl-1',
    name: 'GDPR DPA Notice',
    regulation: 'gdpr',
    authority: 'dpa',
    type: 'initial',
    subject: 'Data breach',
    body: 'Body text',
    isDefault: false,
    createdAt: new Date('2026-06-20T00:00:00.000Z'),
    updatedAt: new Date('2026-06-20T00:00:00.000Z'),
    ...overrides,
  } as PrismaTemplate;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

// ===========================================================================
// IncidentRepository
// ===========================================================================

describe('IncidentRepository', () => {
  const repo = new IncidentRepository();

  it('exports a singleton instance', () => {
    expect(incidentRepository).toBeInstanceOf(IncidentRepository);
  });

  describe('generateIncidentNumber', () => {
    it('returns INC-YYYY-001 when no prior incident exists for the year', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-03-01T00:00:00.000Z'));
      prisma.incident.findFirst.mockResolvedValue(null);

      const num = await repo.generateIncidentNumber();

      expect(num).toBe('INC-2026-001');
      expect(prisma.incident.findFirst).toHaveBeenCalledWith({
        where: { incidentNumber: { startsWith: 'INC-2026-' } },
        orderBy: { incidentNumber: 'desc' },
      });
    });

    it('increments the latest number and zero-pads to 3 digits', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-03-01T00:00:00.000Z'));
      prisma.incident.findFirst.mockResolvedValue(
        makeIncidentRow({ incidentNumber: 'INC-2026-009' })
      );

      const num = await repo.generateIncidentNumber();

      expect(num).toBe('INC-2026-010');
    });
  });

  describe('findById', () => {
    it('maps the db row to a domain incident and parses JSON arrays', async () => {
      prisma.incident.findUnique.mockResolvedValue(makeIncidentRow());

      const result = await repo.findById('inc-1');

      expect(prisma.incident.findUnique).toHaveBeenCalledWith({
        where: { id: 'inc-1' },
        include: undefined,
      });
      expect(result).not.toBeNull();
      expect(result!.id).toBe('inc-1');
      expect(result!.dataCategories).toEqual(['personal']);
      expect(result!.complianceLogIds).toEqual(['log-1']);
      expect(result!.alertIds).toEqual(['alert-1']);
      expect(result!.systemSnapshot).toBeNull();
      expect(result!.detectedAt).toBeInstanceOf(Date);
    });

    it('includes notifications when requested and maps them', async () => {
      prisma.incident.findUnique.mockResolvedValue(
        makeIncidentRow({ notifications: [makeNotificationRow()] })
      );

      const result = await repo.findById('inc-1', true);

      expect(prisma.incident.findUnique).toHaveBeenCalledWith({
        where: { id: 'inc-1' },
        include: { notifications: true },
      });
      expect(result!.notifications).toHaveLength(1);
      expect(result!.notifications![0].id).toBe('notif-1');
    });

    it('returns null when prisma returns null', async () => {
      prisma.incident.findUnique.mockResolvedValue(null);
      expect(await repo.findById('missing')).toBeNull();
    });

    it('parses systemSnapshot JSON when present', async () => {
      const snapshot = {
        capturedAt: new Date('2026-06-20T00:00:00.000Z'),
        robots: [],
        activeAlerts: [],
        systemHealth: { serverUptime: 1, connectedRobots: 0, activeWebSockets: 0 },
      };
      prisma.incident.findUnique.mockResolvedValue(
        makeIncidentRow({ systemSnapshot: JSON.stringify(snapshot) })
      );

      const result = await repo.findById('inc-1');
      expect(result!.systemSnapshot).toMatchObject({
        robots: [],
        activeAlerts: [],
      });
    });
  });

  describe('findByNumber', () => {
    it('queries by incidentNumber with notifications included', async () => {
      prisma.incident.findUnique.mockResolvedValue(makeIncidentRow());

      const result = await repo.findByNumber('INC-2026-001');

      expect(prisma.incident.findUnique).toHaveBeenCalledWith({
        where: { incidentNumber: 'INC-2026-001' },
        include: { notifications: true },
      });
      expect(result!.incidentNumber).toBe('INC-2026-001');
    });

    it('returns null when not found', async () => {
      prisma.incident.findUnique.mockResolvedValue(null);
      expect(await repo.findByNumber('nope')).toBeNull();
    });
  });

  describe('findAll', () => {
    it('applies default pagination and default ordering', async () => {
      prisma.incident.findMany.mockResolvedValue([makeIncidentRow()]);
      prisma.incident.count.mockResolvedValue(1);

      const result = await repo.findAll();

      expect(prisma.incident.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: { detectedAt: 'desc' },
        skip: 0,
        take: 20,
        include: { notifications: true },
      });
      expect(prisma.incident.count).toHaveBeenCalledWith({ where: {} });
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
      expect(result.totalPages).toBe(1);
      expect(result.incidents).toHaveLength(1);
    });

    it('computes skip/take from page+limit and totalPages from count', async () => {
      prisma.incident.findMany.mockResolvedValue([]);
      prisma.incident.count.mockResolvedValue(45);

      const result = await repo.findAll({ page: 3, limit: 10 });

      expect(prisma.incident.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 })
      );
      expect(result.totalPages).toBe(5);
      expect(result.page).toBe(3);
    });

    it('builds where clause with array filters (in) and scalar filters', async () => {
      prisma.incident.findMany.mockResolvedValue([]);
      prisma.incident.count.mockResolvedValue(0);

      await repo.findAll({
        type: ['safety', 'security'],
        severity: 'high',
        status: ['detected'],
        robotId: 'robot-9',
      });

      expect(prisma.incident.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            type: { in: ['safety', 'security'] },
            severity: 'high',
            status: { in: ['detected'] },
            robotId: 'robot-9',
          },
        })
      );
    });

    it('builds a detectedAt range from startDate/endDate', async () => {
      prisma.incident.findMany.mockResolvedValue([]);
      prisma.incident.count.mockResolvedValue(0);
      const start = new Date('2026-01-01T00:00:00.000Z');
      const end = new Date('2026-02-01T00:00:00.000Z');

      await repo.findAll({ startDate: start, endDate: end });

      expect(prisma.incident.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { detectedAt: { gte: start, lte: end } },
        })
      );
    });

    it('honors custom sortBy/sortOrder', async () => {
      prisma.incident.findMany.mockResolvedValue([]);
      prisma.incident.count.mockResolvedValue(0);

      await repo.findAll({ sortBy: 'severity', sortOrder: 'asc' });

      expect(prisma.incident.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { severity: 'asc' } })
      );
    });
  });

  describe('findOpen', () => {
    it('queries non-closed incidents and re-sorts by severity priority', async () => {
      prisma.incident.findMany.mockResolvedValue([
        makeIncidentRow({ id: 'a', severity: 'low' }),
        makeIncidentRow({ id: 'b', severity: 'critical' }),
        makeIncidentRow({ id: 'c', severity: 'medium' }),
      ]);

      const result = await repo.findOpen();

      expect(prisma.incident.findMany).toHaveBeenCalledWith({
        where: { status: { not: 'closed' } },
        orderBy: [{ severity: 'asc' }, { detectedAt: 'desc' }],
        include: { notifications: true },
      });
      expect(result.map((i) => i.id)).toEqual(['b', 'c', 'a']);
    });

    it('returns an empty array when there are no open incidents', async () => {
      prisma.incident.findMany.mockResolvedValue([]);
      expect(await repo.findOpen()).toEqual([]);
    });
  });

  describe('create', () => {
    it('generates a number, applies defaults, and JSON-encodes array columns', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-06-20T00:00:00.000Z'));
      prisma.incident.findFirst.mockResolvedValue(null); // generateIncidentNumber
      prisma.incident.create.mockResolvedValue(makeIncidentRow());

      const result = await repo.create({
        type: 'data_breach',
        title: 'Breach',
        description: 'desc',
      });

      expect(prisma.incident.create).toHaveBeenCalledWith({
        data: {
          incidentNumber: 'INC-2026-001',
          type: 'data_breach',
          severity: 'medium',
          status: 'detected',
          title: 'Breach',
          description: 'desc',
          detectedAt: new Date('2026-06-20T00:00:00.000Z'),
          robotId: undefined,
          complianceLogIds: JSON.stringify([]),
          alertIds: JSON.stringify([]),
          createdBy: undefined,
          dataCategories: JSON.stringify([]),
        },
        include: { notifications: true },
      });
      expect(result.id).toBe('inc-1');
    });

    it('passes through provided severity, links, detectedAt, createdBy', async () => {
      prisma.incident.findFirst.mockResolvedValue(null);
      prisma.incident.create.mockResolvedValue(makeIncidentRow());
      const detectedAt = new Date('2026-05-01T00:00:00.000Z');

      await repo.create({
        type: 'security',
        severity: 'critical',
        title: 't',
        description: 'd',
        robotId: 'r-1',
        complianceLogIds: ['l1', 'l2'],
        alertIds: ['a1'],
        detectedAt,
        createdBy: 'user-1',
      });

      expect(prisma.incident.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            severity: 'critical',
            robotId: 'r-1',
            complianceLogIds: JSON.stringify(['l1', 'l2']),
            alertIds: JSON.stringify(['a1']),
            detectedAt,
            createdBy: 'user-1',
          }),
        })
      );
    });
  });

  describe('update', () => {
    it('updates with provided fields and JSON-encodes dataCategories', async () => {
      prisma.incident.update.mockResolvedValue(makeIncidentRow({ status: 'resolved' }));

      const result = await repo.update('inc-1', {
        status: 'resolved',
        dataCategories: ['health'],
        riskScore: 80,
      });

      expect(prisma.incident.update).toHaveBeenCalledWith({
        where: { id: 'inc-1' },
        data: {
          status: 'resolved',
          severity: undefined,
          title: undefined,
          description: undefined,
          rootCause: undefined,
          resolution: undefined,
          riskScore: 80,
          affectedDataSubjects: undefined,
          dataCategories: JSON.stringify(['health']),
          containedAt: undefined,
          resolvedAt: undefined,
          closedAt: undefined,
        },
        include: { notifications: true },
      });
      expect(result!.status).toBe('resolved');
    });

    it('leaves dataCategories undefined when not provided', async () => {
      prisma.incident.update.mockResolvedValue(makeIncidentRow());

      await repo.update('inc-1', { title: 'new title' });

      expect(prisma.incident.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ dataCategories: undefined, title: 'new title' }),
        })
      );
    });

    it('returns null when prisma.update throws', async () => {
      prisma.incident.update.mockRejectedValue(new Error('not found'));
      expect(await repo.update('missing', { title: 'x' })).toBeNull();
    });
  });

  describe('updateSnapshot', () => {
    it('JSON-encodes and stores the snapshot', async () => {
      const snapshot = {
        capturedAt: new Date('2026-06-20T00:00:00.000Z'),
        robots: [],
        activeAlerts: [],
        systemHealth: { serverUptime: 5, connectedRobots: 1, activeWebSockets: 2 },
      };
      prisma.incident.update.mockResolvedValue(
        makeIncidentRow({ systemSnapshot: JSON.stringify(snapshot) })
      );

      const result = await repo.updateSnapshot('inc-1', snapshot);

      expect(prisma.incident.update).toHaveBeenCalledWith({
        where: { id: 'inc-1' },
        data: { systemSnapshot: JSON.stringify(snapshot) },
        include: { notifications: true },
      });
      expect(result!.systemSnapshot!.systemHealth.serverUptime).toBe(5);
    });

    it('returns null on error', async () => {
      prisma.incident.update.mockRejectedValue(new Error('fail'));
      const snapshot = {
        capturedAt: new Date(),
        robots: [],
        activeAlerts: [],
        systemHealth: { serverUptime: 0, connectedRobots: 0, activeWebSockets: 0 },
      };
      expect(await repo.updateSnapshot('inc-1', snapshot)).toBeNull();
    });
  });

  describe('linkEvidence', () => {
    it('merges new evidence ids with existing (deduped) and updates', async () => {
      prisma.incident.findUnique.mockResolvedValue(
        makeIncidentRow({
          complianceLogIds: JSON.stringify(['log-1']),
          alertIds: JSON.stringify(['alert-1']),
        })
      );
      prisma.incident.update.mockResolvedValue(makeIncidentRow());

      await repo.linkEvidence('inc-1', ['log-1', 'log-2'], ['alert-2']);

      expect(prisma.incident.update).toHaveBeenCalledWith({
        where: { id: 'inc-1' },
        data: {
          complianceLogIds: JSON.stringify(['log-1', 'log-2']),
          alertIds: JSON.stringify(['alert-1', 'alert-2']),
        },
        include: { notifications: true },
      });
    });

    it('keeps existing ids when no new ids are passed for that field', async () => {
      prisma.incident.findUnique.mockResolvedValue(
        makeIncidentRow({
          complianceLogIds: JSON.stringify(['log-1']),
          alertIds: JSON.stringify(['alert-1']),
        })
      );
      prisma.incident.update.mockResolvedValue(makeIncidentRow());

      await repo.linkEvidence('inc-1', ['log-9']);

      expect(prisma.incident.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            complianceLogIds: JSON.stringify(['log-1', 'log-9']),
            alertIds: JSON.stringify(['alert-1']),
          },
        })
      );
    });

    it('returns null when the incident does not exist (no update issued)', async () => {
      prisma.incident.findUnique.mockResolvedValue(null);

      const result = await repo.linkEvidence('missing', ['log-1']);

      expect(result).toBeNull();
      expect(prisma.incident.update).not.toHaveBeenCalled();
    });

    it('returns null when prisma.update throws', async () => {
      prisma.incident.findUnique.mockResolvedValue(makeIncidentRow());
      prisma.incident.update.mockRejectedValue(new Error('fail'));
      expect(await repo.linkEvidence('inc-1', ['log-1'])).toBeNull();
    });
  });

  describe('delete', () => {
    it('returns true on successful delete', async () => {
      prisma.incident.delete.mockResolvedValue(makeIncidentRow());
      const result = await repo.delete('inc-1');
      expect(result).toBe(true);
      expect(prisma.incident.delete).toHaveBeenCalledWith({ where: { id: 'inc-1' } });
    });

    it('returns false when prisma.delete throws', async () => {
      prisma.incident.delete.mockRejectedValue(new Error('not found'));
      expect(await repo.delete('missing')).toBe(false);
    });
  });

  describe('getStats', () => {
    it('aggregates counts into severity/type/status maps', async () => {
      prisma.incident.count
        .mockResolvedValueOnce(10) // total
        .mockResolvedValueOnce(4); // open
      prisma.incident.groupBy
        .mockResolvedValueOnce([
          { severity: 'critical', _count: { id: 2 } },
          { severity: 'low', _count: { id: 3 } },
        ] as never)
        .mockResolvedValueOnce([
          { type: 'safety', _count: { id: 5 } },
        ] as never)
        .mockResolvedValueOnce([
          { status: 'detected', _count: { id: 4 } },
          { status: 'closed', _count: { id: 6 } },
        ] as never);

      const stats = await repo.getStats();

      expect(prisma.incident.count).toHaveBeenNthCalledWith(1);
      expect(prisma.incident.count).toHaveBeenNthCalledWith(2, {
        where: { status: { not: 'closed' } },
      });
      expect(stats).toEqual({
        total: 10,
        open: 4,
        bySeverity: { critical: 2, high: 0, medium: 0, low: 3 },
        byType: { safety: 5, security: 0, data_breach: 0, ai_malfunction: 0, vulnerability: 0 },
        byStatus: { detected: 4, investigating: 0, contained: 0, resolved: 0, closed: 6 },
      });
    });

    it('returns all-zero maps when there are no incidents', async () => {
      prisma.incident.count.mockResolvedValue(0);
      prisma.incident.groupBy.mockResolvedValue([] as never);

      const stats = await repo.getStats();

      expect(stats.total).toBe(0);
      expect(stats.bySeverity).toEqual({ critical: 0, high: 0, medium: 0, low: 0 });
    });
  });
});

// ===========================================================================
// IncidentNotificationRepository
// ===========================================================================

describe('IncidentNotificationRepository', () => {
  const repo = new IncidentNotificationRepository();

  it('exports a singleton instance', () => {
    expect(incidentNotificationRepository).toBeInstanceOf(IncidentNotificationRepository);
  });

  describe('findById', () => {
    it('maps the db row to a domain notification', async () => {
      prisma.incidentNotification.findUnique.mockResolvedValue(makeNotificationRow());

      const result = await repo.findById('notif-1');

      expect(prisma.incidentNotification.findUnique).toHaveBeenCalledWith({
        where: { id: 'notif-1' },
      });
      expect(result!.id).toBe('notif-1');
      expect(result!.regulation).toBe('gdpr');
      expect(result!.dueAt).toBeInstanceOf(Date);
    });

    it('returns null when not found', async () => {
      prisma.incidentNotification.findUnique.mockResolvedValue(null);
      expect(await repo.findById('missing')).toBeNull();
    });
  });

  describe('findByIncidentId', () => {
    it('queries by incidentId ordered by dueAt asc', async () => {
      prisma.incidentNotification.findMany.mockResolvedValue([makeNotificationRow()]);

      const result = await repo.findByIncidentId('inc-1');

      expect(prisma.incidentNotification.findMany).toHaveBeenCalledWith({
        where: { incidentId: 'inc-1' },
        orderBy: { dueAt: 'asc' },
      });
      expect(result).toHaveLength(1);
    });
  });

  describe('findOverdue', () => {
    it('filters pending/draft with dueAt < now', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-06-23T12:00:00.000Z'));
      prisma.incidentNotification.findMany.mockResolvedValue([makeNotificationRow()]);

      await repo.findOverdue();

      expect(prisma.incidentNotification.findMany).toHaveBeenCalledWith({
        where: {
          status: { in: ['pending', 'draft'] },
          dueAt: { lt: new Date('2026-06-23T12:00:00.000Z') },
        },
        orderBy: { dueAt: 'asc' },
      });
    });
  });

  describe('findPending', () => {
    it('filters by status pending ordered by dueAt asc', async () => {
      prisma.incidentNotification.findMany.mockResolvedValue([]);

      await repo.findPending();

      expect(prisma.incidentNotification.findMany).toHaveBeenCalledWith({
        where: { status: 'pending' },
        orderBy: { dueAt: 'asc' },
      });
    });
  });

  describe('create', () => {
    it('creates with status pending and maps the result', async () => {
      prisma.incidentNotification.create.mockResolvedValue(makeNotificationRow());
      const dueAt = new Date('2026-06-25T00:00:00.000Z');

      const result = await repo.create({
        incidentId: 'inc-1',
        authority: 'dpa',
        regulation: 'gdpr',
        notificationType: 'initial',
        deadlineHours: 72,
        dueAt,
        templateId: 'tpl-1',
        content: 'hello',
      });

      expect(prisma.incidentNotification.create).toHaveBeenCalledWith({
        data: {
          incidentId: 'inc-1',
          authority: 'dpa',
          regulation: 'gdpr',
          notificationType: 'initial',
          deadlineHours: 72,
          dueAt,
          status: 'pending',
          templateId: 'tpl-1',
          content: 'hello',
        },
      });
      expect(result.id).toBe('notif-1');
    });
  });

  describe('createMany', () => {
    it('creates many records each with status pending and returns the count', async () => {
      prisma.incidentNotification.createMany.mockResolvedValue({ count: 2 });
      const dueAt = new Date('2026-06-25T00:00:00.000Z');

      const count = await repo.createMany([
        {
          incidentId: 'inc-1',
          authority: 'dpa',
          regulation: 'gdpr',
          notificationType: 'initial',
          deadlineHours: 72,
          dueAt,
        },
        {
          incidentId: 'inc-1',
          authority: 'csirt',
          regulation: 'nis2',
          notificationType: 'early_warning',
          deadlineHours: 24,
          dueAt,
        },
      ]);

      expect(count).toBe(2);
      expect(prisma.incidentNotification.createMany).toHaveBeenCalledWith({
        data: [
          {
            incidentId: 'inc-1',
            authority: 'dpa',
            regulation: 'gdpr',
            notificationType: 'initial',
            deadlineHours: 72,
            dueAt,
            status: 'pending',
            templateId: undefined,
            content: undefined,
          },
          {
            incidentId: 'inc-1',
            authority: 'csirt',
            regulation: 'nis2',
            notificationType: 'early_warning',
            deadlineHours: 24,
            dueAt,
            status: 'pending',
            templateId: undefined,
            content: undefined,
          },
        ],
      });
    });
  });

  describe('update', () => {
    it('updates allowed fields and maps the result', async () => {
      prisma.incidentNotification.update.mockResolvedValue(
        makeNotificationRow({ status: 'sent' })
      );
      const sentAt = new Date('2026-06-24T00:00:00.000Z');

      const result = await repo.update('notif-1', {
        status: 'sent',
        content: 'body',
        sentAt,
        sentBy: 'user-1',
      });

      expect(prisma.incidentNotification.update).toHaveBeenCalledWith({
        where: { id: 'notif-1' },
        data: {
          status: 'sent',
          content: 'body',
          sentAt,
          acknowledgedAt: undefined,
          sentBy: 'user-1',
        },
      });
      expect(result!.status).toBe('sent');
    });

    it('returns null when prisma.update throws', async () => {
      prisma.incidentNotification.update.mockRejectedValue(new Error('fail'));
      expect(await repo.update('missing', { status: 'sent' })).toBeNull();
    });
  });

  describe('markSent', () => {
    it('delegates to update with status sent and a sentAt timestamp', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-06-24T00:00:00.000Z'));
      prisma.incidentNotification.update.mockResolvedValue(
        makeNotificationRow({ status: 'sent' })
      );

      const result = await repo.markSent('notif-1', 'user-9');

      expect(prisma.incidentNotification.update).toHaveBeenCalledWith({
        where: { id: 'notif-1' },
        data: {
          status: 'sent',
          content: undefined,
          sentAt: new Date('2026-06-24T00:00:00.000Z'),
          acknowledgedAt: undefined,
          sentBy: 'user-9',
        },
      });
      expect(result!.status).toBe('sent');
    });

    it('returns null when underlying update throws', async () => {
      prisma.incidentNotification.update.mockRejectedValue(new Error('fail'));
      expect(await repo.markSent('missing')).toBeNull();
    });
  });

  describe('markOverdue', () => {
    it('bulk-updates pending/draft past-due records to overdue', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-06-23T12:00:00.000Z'));
      prisma.incidentNotification.updateMany.mockResolvedValue({ count: 3 });

      const count = await repo.markOverdue();

      expect(count).toBe(3);
      expect(prisma.incidentNotification.updateMany).toHaveBeenCalledWith({
        where: {
          status: { in: ['pending', 'draft'] },
          dueAt: { lt: new Date('2026-06-23T12:00:00.000Z') },
        },
        data: { status: 'overdue' },
      });
    });
  });

  describe('delete', () => {
    it('returns true on success', async () => {
      prisma.incidentNotification.delete.mockResolvedValue(makeNotificationRow());
      expect(await repo.delete('notif-1')).toBe(true);
      expect(prisma.incidentNotification.delete).toHaveBeenCalledWith({
        where: { id: 'notif-1' },
      });
    });

    it('returns false when delete throws', async () => {
      prisma.incidentNotification.delete.mockRejectedValue(new Error('fail'));
      expect(await repo.delete('missing')).toBe(false);
    });
  });

  describe('getCountsByStatus', () => {
    it('maps groupBy results into a full status record', async () => {
      prisma.incidentNotification.groupBy.mockResolvedValue([
        { status: 'pending', _count: { id: 2 } },
        { status: 'sent', _count: { id: 5 } },
      ] as never);

      const result = await repo.getCountsByStatus();

      expect(prisma.incidentNotification.groupBy).toHaveBeenCalledWith({
        by: ['status'],
        _count: { id: true },
      });
      expect(result).toEqual({
        pending: 2,
        draft: 0,
        sent: 5,
        acknowledged: 0,
        overdue: 0,
      });
    });

    it('returns all-zero record when there are no notifications', async () => {
      prisma.incidentNotification.groupBy.mockResolvedValue([] as never);
      const result = await repo.getCountsByStatus();
      expect(result).toEqual({
        pending: 0,
        draft: 0,
        sent: 0,
        acknowledged: 0,
        overdue: 0,
      });
    });
  });
});

// ===========================================================================
// NotificationTemplateRepository
// ===========================================================================

describe('NotificationTemplateRepository', () => {
  const repo = new NotificationTemplateRepository();

  it('exports a singleton instance', () => {
    expect(notificationTemplateRepository).toBeInstanceOf(NotificationTemplateRepository);
  });

  describe('findById', () => {
    it('maps the db row to a domain template', async () => {
      prisma.notificationTemplate.findUnique.mockResolvedValue(makeTemplateRow());

      const result = await repo.findById('tpl-1');

      expect(prisma.notificationTemplate.findUnique).toHaveBeenCalledWith({
        where: { id: 'tpl-1' },
      });
      expect(result!.name).toBe('GDPR DPA Notice');
      expect(result!.isDefault).toBe(false);
    });

    it('returns null when not found', async () => {
      prisma.notificationTemplate.findUnique.mockResolvedValue(null);
      expect(await repo.findById('missing')).toBeNull();
    });
  });

  describe('findAll', () => {
    it('orders by regulation, authority, type', async () => {
      prisma.notificationTemplate.findMany.mockResolvedValue([makeTemplateRow()]);

      const result = await repo.findAll();

      expect(prisma.notificationTemplate.findMany).toHaveBeenCalledWith({
        orderBy: [{ regulation: 'asc' }, { authority: 'asc' }, { type: 'asc' }],
      });
      expect(result).toHaveLength(1);
    });
  });

  describe('findByRegulation', () => {
    it('filters by regulation ordered by authority, type', async () => {
      prisma.notificationTemplate.findMany.mockResolvedValue([]);

      await repo.findByRegulation('gdpr');

      expect(prisma.notificationTemplate.findMany).toHaveBeenCalledWith({
        where: { regulation: 'gdpr' },
        orderBy: [{ authority: 'asc' }, { type: 'asc' }],
      });
    });
  });

  describe('findDefault', () => {
    it('queries for the matching default template', async () => {
      prisma.notificationTemplate.findFirst.mockResolvedValue(
        makeTemplateRow({ isDefault: true })
      );

      const result = await repo.findDefault('gdpr', 'dpa', 'initial');

      expect(prisma.notificationTemplate.findFirst).toHaveBeenCalledWith({
        where: { regulation: 'gdpr', authority: 'dpa', type: 'initial', isDefault: true },
      });
      expect(result!.isDefault).toBe(true);
    });

    it('returns null when no default exists', async () => {
      prisma.notificationTemplate.findFirst.mockResolvedValue(null);
      expect(await repo.findDefault('gdpr', 'dpa', 'initial')).toBeNull();
    });
  });

  describe('create', () => {
    it('creates with isDefault defaulting to false', async () => {
      prisma.notificationTemplate.create.mockResolvedValue(makeTemplateRow());

      await repo.create({
        name: 'GDPR DPA Notice',
        regulation: 'gdpr',
        authority: 'dpa',
        type: 'initial',
        subject: 'Data breach',
        body: 'Body text',
      });

      expect(prisma.notificationTemplate.create).toHaveBeenCalledWith({
        data: {
          name: 'GDPR DPA Notice',
          regulation: 'gdpr',
          authority: 'dpa',
          type: 'initial',
          subject: 'Data breach',
          body: 'Body text',
          isDefault: false,
        },
      });
    });

    it('passes through isDefault when provided', async () => {
      prisma.notificationTemplate.create.mockResolvedValue(makeTemplateRow({ isDefault: true }));

      await repo.create({
        name: 'n',
        regulation: 'nis2',
        authority: 'csirt',
        type: 'final',
        subject: 's',
        body: 'b',
        isDefault: true,
      });

      expect(prisma.notificationTemplate.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ isDefault: true }) })
      );
    });
  });

  describe('update', () => {
    it('updates allowed fields and maps the result', async () => {
      prisma.notificationTemplate.update.mockResolvedValue(
        makeTemplateRow({ name: 'Updated' })
      );

      const result = await repo.update('tpl-1', { name: 'Updated', isDefault: true });

      expect(prisma.notificationTemplate.update).toHaveBeenCalledWith({
        where: { id: 'tpl-1' },
        data: {
          name: 'Updated',
          subject: undefined,
          body: undefined,
          isDefault: true,
        },
      });
      expect(result!.name).toBe('Updated');
    });

    it('returns null when prisma.update throws', async () => {
      prisma.notificationTemplate.update.mockRejectedValue(new Error('fail'));
      expect(await repo.update('missing', { name: 'x' })).toBeNull();
    });
  });

  describe('delete', () => {
    it('returns true on success', async () => {
      prisma.notificationTemplate.delete.mockResolvedValue(makeTemplateRow());
      expect(await repo.delete('tpl-1')).toBe(true);
      expect(prisma.notificationTemplate.delete).toHaveBeenCalledWith({
        where: { id: 'tpl-1' },
      });
    });

    it('returns false when delete throws', async () => {
      prisma.notificationTemplate.delete.mockRejectedValue(new Error('fail'));
      expect(await repo.delete('missing')).toBe(false);
    });
  });
});
