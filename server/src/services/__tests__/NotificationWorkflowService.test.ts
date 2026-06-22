/**
 * @file NotificationWorkflowService.test.ts
 * @description Unit tests for NotificationWorkflowService — incident notification
 *   workflow creation, timeline, notification/template management, and content
 *   generation. All repositories and downstream services are mocked.
 * @feature incidents
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  Incident,
  IncidentNotification,
  NotificationTemplate,
  RiskAssessment,
} from '../../types/incident.types.js';

// ---------------------------------------------------------------------------
// Mocks for external boundaries
// ---------------------------------------------------------------------------

vi.mock('../../repositories/IncidentRepository.js', () => ({
  incidentRepository: {
    findById: vi.fn(),
  },
  incidentNotificationRepository: {
    findById: vi.fn(),
    findByIncidentId: vi.fn(),
    findOverdue: vi.fn(),
    findPending: vi.fn(),
    createMany: vi.fn(),
    update: vi.fn(),
    markSent: vi.fn(),
    markOverdue: vi.fn(),
  },
  notificationTemplateRepository: {
    findAll: vi.fn(),
    findById: vi.fn(),
    findByRegulation: vi.fn(),
    findDefault: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('../BreachAssessmentService.js', () => ({
  breachAssessmentService: {
    assessRisk: vi.fn(),
    determineNotificationRequirements: vi.fn(),
  },
}));

vi.mock('../AlertService.js', () => ({
  alertService: {
    createAlert: vi.fn(),
  },
}));

import { NotificationWorkflowService } from '../NotificationWorkflowService.js';
import {
  incidentRepository,
  incidentNotificationRepository,
  notificationTemplateRepository,
} from '../../repositories/IncidentRepository.js';
import { breachAssessmentService } from '../BreachAssessmentService.js';
import { alertService } from '../AlertService.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeIncident(overrides: Partial<Incident> = {}): Incident {
  return {
    id: 'inc1',
    incidentNumber: 'INC-2026-001',
    type: 'safety',
    severity: 'high',
    status: 'detected',
    title: 'Test incident',
    description: 'A robot collided with a shelf',
    rootCause: null,
    resolution: null,
    riskScore: 80,
    affectedDataSubjects: 5,
    dataCategories: ['health', 'location'],
    detectedAt: new Date('2026-06-01T00:00:00.000Z'),
    containedAt: null,
    resolvedAt: null,
    closedAt: null,
    robotId: 'r1',
    complianceLogIds: [],
    alertIds: [],
    systemSnapshot: null,
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
    updatedAt: new Date('2026-06-01T00:00:00.000Z'),
    createdBy: 'system',
    ...overrides,
  };
}

function makeNotification(overrides: Partial<IncidentNotification> = {}): IncidentNotification {
  return {
    id: 'n1',
    incidentId: 'inc1',
    authority: 'dpa',
    regulation: 'gdpr',
    notificationType: 'initial',
    deadlineHours: 72,
    dueAt: new Date('2026-06-04T00:00:00.000Z'),
    status: 'pending',
    sentAt: null,
    acknowledgedAt: null,
    templateId: null,
    content: null,
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
    updatedAt: new Date('2026-06-01T00:00:00.000Z'),
    sentBy: null,
    ...overrides,
  };
}

function makeTemplate(overrides: Partial<NotificationTemplate> = {}): NotificationTemplate {
  return {
    id: 't1',
    name: 'GDPR DPA',
    regulation: 'gdpr',
    authority: 'dpa',
    type: 'initial',
    subject: 'Breach - {{incidentNumber}}',
    body: 'Incident {{incidentNumber}}: {{description}}. Severity {{severity}}.',
    isDefault: true,
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
    updatedAt: new Date('2026-06-01T00:00:00.000Z'),
    ...overrides,
  };
}

function makeAssessment(overrides: Partial<RiskAssessment> = {}): RiskAssessment {
  return {
    incidentId: 'inc1',
    impactLevel: 'major',
    likelihoodLevel: 'likely',
    riskScore: 80,
    affectedDataSubjects: 5,
    dataCategories: ['health'],
    potentialHarm: [],
    mitigatingFactors: [],
    assessedAt: new Date('2026-06-01T00:00:00.000Z'),
    assessedBy: 'system',
    ...overrides,
  };
}

// A fresh service instance per test (avoids shared `initialized` state)
let service: NotificationWorkflowService;

beforeEach(() => {
  vi.clearAllMocks();
  service = new NotificationWorkflowService();
  vi.mocked(alertService.createAlert).mockResolvedValue({} as never);
});

// ===========================================================================
// createNotificationWorkflow
// ===========================================================================

describe('createNotificationWorkflow', () => {
  it('throws when the incident does not exist', async () => {
    vi.mocked(incidentRepository.findById).mockResolvedValue(null);
    await expect(service.createNotificationWorkflow('missing')).rejects.toThrow(
      'Incident missing not found'
    );
  });

  it('returns empty array and creates nothing when no notifications are required', async () => {
    vi.mocked(incidentRepository.findById).mockResolvedValue(makeIncident());
    vi.mocked(breachAssessmentService.assessRisk).mockResolvedValue(makeAssessment());
    vi.mocked(breachAssessmentService.determineNotificationRequirements).mockReturnValue([]);

    const result = await service.createNotificationWorkflow('inc1');

    expect(result).toEqual([]);
    expect(incidentNotificationRepository.createMany).not.toHaveBeenCalled();
  });

  it('uses the provided assessment instead of re-assessing risk', async () => {
    vi.mocked(incidentRepository.findById).mockResolvedValue(makeIncident());
    vi.mocked(breachAssessmentService.determineNotificationRequirements).mockReturnValue([]);

    const provided = makeAssessment({ riskScore: 42 });
    await service.createNotificationWorkflow('inc1', provided);

    expect(breachAssessmentService.assessRisk).not.toHaveBeenCalled();
    expect(breachAssessmentService.determineNotificationRequirements).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'inc1' }),
      provided
    );
  });

  it('creates notifications with deadlines computed from detectedAt', async () => {
    const incident = makeIncident({ detectedAt: new Date('2026-06-01T00:00:00.000Z') });
    vi.mocked(incidentRepository.findById).mockResolvedValue(incident);
    vi.mocked(breachAssessmentService.assessRisk).mockResolvedValue(makeAssessment());
    vi.mocked(breachAssessmentService.determineNotificationRequirements).mockReturnValue([
      {
        regulation: 'gdpr',
        authority: 'dpa',
        notificationType: 'initial',
        deadlineHours: 72,
      },
    ] as never);
    const created = [makeNotification()];
    vi.mocked(incidentNotificationRepository.createMany).mockResolvedValue(1);
    vi.mocked(incidentNotificationRepository.findByIncidentId).mockResolvedValue(created);

    const result = await service.createNotificationWorkflow('inc1');

    expect(result).toBe(created);
    expect(incidentNotificationRepository.createMany).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(incidentNotificationRepository.createMany).mock.calls[0][0];
    expect(arg).toHaveLength(1);
    expect(arg[0]).toMatchObject({
      incidentId: 'inc1',
      authority: 'dpa',
      regulation: 'gdpr',
      notificationType: 'initial',
      deadlineHours: 72,
    });
    // detectedAt + 72h = 2026-06-04T00:00:00Z
    expect(arg[0].dueAt.toISOString()).toBe('2026-06-04T00:00:00.000Z');
    // returns the freshly persisted notifications for the incident
    expect(incidentNotificationRepository.findByIncidentId).toHaveBeenCalledWith('inc1');
  });
});

// ===========================================================================
// getNotificationTimeline
// ===========================================================================

describe('getNotificationTimeline', () => {
  it('returns null when the incident does not exist', async () => {
    vi.mocked(incidentRepository.findById).mockResolvedValue(null);
    const result = await service.getNotificationTimeline('missing');
    expect(result).toBeNull();
    expect(incidentRepository.findById).toHaveBeenCalledWith('missing', true);
  });

  it('handles an incident with no notifications', async () => {
    vi.mocked(incidentRepository.findById).mockResolvedValue(
      makeIncident({ notifications: undefined })
    );
    const result = await service.getNotificationTimeline('inc1');
    expect(result).not.toBeNull();
    expect(result!.notifications).toEqual([]);
    expect(result!.incidentNumber).toBe('INC-2026-001');
  });

  it('marks a past-due pending notification as overdue and computes negative hoursRemaining', async () => {
    const past = new Date(Date.now() - 5 * 60 * 60 * 1000); // 5h ago
    vi.mocked(incidentRepository.findById).mockResolvedValue(
      makeIncident({
        notifications: [makeNotification({ id: 'overdueN', status: 'pending', dueAt: past })],
      })
    );

    const result = await service.getNotificationTimeline('inc1');
    const n = result!.notifications[0];
    expect(n.isOverdue).toBe(true);
    expect(n.hoursRemaining).toBeLessThan(0);
  });

  it('does not mark a sent notification overdue even if past due, and sorts by dueAt', async () => {
    const past = new Date(Date.now() - 10 * 60 * 60 * 1000);
    const future = new Date(Date.now() + 10 * 60 * 60 * 1000);
    vi.mocked(incidentRepository.findById).mockResolvedValue(
      makeIncident({
        notifications: [
          makeNotification({ id: 'futureN', status: 'pending', dueAt: future }),
          makeNotification({ id: 'sentPast', status: 'sent', dueAt: past }),
        ],
      })
    );

    const result = await service.getNotificationTimeline('inc1');
    // sorted ascending by dueAt -> sentPast first
    expect(result!.notifications.map((n) => n.id)).toEqual(['sentPast', 'futureN']);
    const sent = result!.notifications.find((n) => n.id === 'sentPast')!;
    expect(sent.isOverdue).toBe(false);
  });
});

// ===========================================================================
// notification management passthroughs
// ===========================================================================

describe('getNotifications', () => {
  it('delegates to the repository by incidentId', async () => {
    const list = [makeNotification()];
    vi.mocked(incidentNotificationRepository.findByIncidentId).mockResolvedValue(list);
    const result = await service.getNotifications('inc1');
    expect(result).toBe(list);
    expect(incidentNotificationRepository.findByIncidentId).toHaveBeenCalledWith('inc1');
  });
});

describe('markNotificationSent', () => {
  it('returns the updated notification on success', async () => {
    const sent = makeNotification({ status: 'sent', sentBy: 'alice' });
    vi.mocked(incidentNotificationRepository.markSent).mockResolvedValue(sent);
    const result = await service.markNotificationSent('n1', 'alice');
    expect(result).toBe(sent);
    expect(incidentNotificationRepository.markSent).toHaveBeenCalledWith('n1', 'alice');
  });

  it('returns null when the notification is not found', async () => {
    vi.mocked(incidentNotificationRepository.markSent).mockResolvedValue(null);
    const result = await service.markNotificationSent('missing');
    expect(result).toBeNull();
  });
});

describe('updateNotificationContent', () => {
  it('updates content and resets status to draft', async () => {
    const updated = makeNotification({ content: 'hello', status: 'draft' });
    vi.mocked(incidentNotificationRepository.update).mockResolvedValue(updated);
    const result = await service.updateNotificationContent('n1', 'hello');
    expect(result).toBe(updated);
    expect(incidentNotificationRepository.update).toHaveBeenCalledWith('n1', {
      content: 'hello',
      status: 'draft',
    });
  });
});

describe('getOverdueNotifications / getPendingNotifications', () => {
  it('returns overdue notifications from the repository', async () => {
    const list = [makeNotification({ status: 'overdue' })];
    vi.mocked(incidentNotificationRepository.findOverdue).mockResolvedValue(list);
    expect(await service.getOverdueNotifications()).toBe(list);
  });

  it('returns pending notifications from the repository', async () => {
    const list = [makeNotification({ status: 'pending' })];
    vi.mocked(incidentNotificationRepository.findPending).mockResolvedValue(list);
    expect(await service.getPendingNotifications()).toBe(list);
  });
});

// ===========================================================================
// generateNotificationContent
// ===========================================================================

describe('generateNotificationContent', () => {
  it('returns null when the notification does not exist', async () => {
    vi.mocked(incidentNotificationRepository.findById).mockResolvedValue(null);
    const result = await service.generateNotificationContent('missing');
    expect(result).toBeNull();
    expect(incidentRepository.findById).not.toHaveBeenCalled();
  });

  it('returns null when the linked incident does not exist', async () => {
    vi.mocked(incidentNotificationRepository.findById).mockResolvedValue(makeNotification());
    vi.mocked(incidentRepository.findById).mockResolvedValue(null);
    const result = await service.generateNotificationContent('n1');
    expect(result).toBeNull();
  });

  it('returns null when no template is found', async () => {
    vi.mocked(incidentNotificationRepository.findById).mockResolvedValue(makeNotification());
    vi.mocked(incidentRepository.findById).mockResolvedValue(makeIncident());
    vi.mocked(notificationTemplateRepository.findDefault).mockResolvedValue(null);
    const result = await service.generateNotificationContent('n1');
    expect(result).toBeNull();
  });

  it('looks up a specific template by id when templateId is given', async () => {
    vi.mocked(incidentNotificationRepository.findById).mockResolvedValue(makeNotification());
    vi.mocked(incidentRepository.findById).mockResolvedValue(makeIncident());
    vi.mocked(notificationTemplateRepository.findById).mockResolvedValue(makeTemplate());
    vi.mocked(incidentNotificationRepository.update).mockResolvedValue(makeNotification());

    await service.generateNotificationContent('n1', 't1');

    expect(notificationTemplateRepository.findById).toHaveBeenCalledWith('t1');
    expect(notificationTemplateRepository.findDefault).not.toHaveBeenCalled();
  });

  it('falls back to the default template using the notification metadata', async () => {
    const notif = makeNotification({
      regulation: 'gdpr',
      authority: 'dpa',
      notificationType: 'initial',
    });
    vi.mocked(incidentNotificationRepository.findById).mockResolvedValue(notif);
    vi.mocked(incidentRepository.findById).mockResolvedValue(makeIncident());
    vi.mocked(notificationTemplateRepository.findDefault).mockResolvedValue(makeTemplate());
    vi.mocked(incidentNotificationRepository.update).mockResolvedValue(notif);

    await service.generateNotificationContent('n1');

    expect(notificationTemplateRepository.findDefault).toHaveBeenCalledWith(
      'gdpr',
      'dpa',
      'initial'
    );
  });

  it('replaces placeholders and persists the generated content as draft', async () => {
    vi.mocked(incidentNotificationRepository.findById).mockResolvedValue(makeNotification());
    vi.mocked(incidentRepository.findById).mockResolvedValue(
      makeIncident({
        incidentNumber: 'INC-2026-042',
        description: 'Sensor failure',
        severity: 'critical',
      })
    );
    vi.mocked(notificationTemplateRepository.findDefault).mockResolvedValue(
      makeTemplate({ body: 'Incident {{incidentNumber}}: {{description}}. Severity {{severity}}.' })
    );
    vi.mocked(incidentNotificationRepository.update).mockResolvedValue(makeNotification());

    const result = await service.generateNotificationContent('n1');

    expect(result).toBe('Incident INC-2026-042: Sensor failure. Severity critical.');
    expect(incidentNotificationRepository.update).toHaveBeenCalledWith('n1', {
      content: 'Incident INC-2026-042: Sensor failure. Severity critical.',
      status: 'draft',
    });
  });

  it('substitutes safe fallbacks for null incident fields', async () => {
    vi.mocked(incidentNotificationRepository.findById).mockResolvedValue(makeNotification());
    vi.mocked(incidentRepository.findById).mockResolvedValue(
      makeIncident({ rootCause: null, resolution: null, robotId: null, riskScore: null })
    );
    vi.mocked(notificationTemplateRepository.findDefault).mockResolvedValue(
      makeTemplate({
        body: 'cause={{rootCause}} res={{resolution}} robot={{robotId}} score={{riskScore}}',
      })
    );
    vi.mocked(incidentNotificationRepository.update).mockResolvedValue(makeNotification());

    const result = await service.generateNotificationContent('n1');

    expect(result).toBe(
      'cause=Under investigation res=Remediation in progress robot=N/A score=Not assessed'
    );
  });
});

// ===========================================================================
// template management passthroughs
// ===========================================================================

describe('template management', () => {
  it('getTemplates returns all templates', async () => {
    const all = [makeTemplate()];
    vi.mocked(notificationTemplateRepository.findAll).mockResolvedValue(all);
    expect(await service.getTemplates()).toBe(all);
  });

  it('getTemplatesByRegulation filters by regulation', async () => {
    const list = [makeTemplate({ regulation: 'nis2' })];
    vi.mocked(notificationTemplateRepository.findByRegulation).mockResolvedValue(list);
    expect(await service.getTemplatesByRegulation('nis2')).toBe(list);
    expect(notificationTemplateRepository.findByRegulation).toHaveBeenCalledWith('nis2');
  });

  it('getTemplate returns null when not found', async () => {
    vi.mocked(notificationTemplateRepository.findById).mockResolvedValue(null);
    expect(await service.getTemplate('missing')).toBeNull();
  });

  it('createTemplate delegates to the repository', async () => {
    const created = makeTemplate({ id: 'new' });
    vi.mocked(notificationTemplateRepository.create).mockResolvedValue(created);
    const input = {
      name: 'X',
      regulation: 'gdpr' as const,
      authority: 'dpa' as const,
      type: 'initial' as const,
      subject: 's',
      body: 'b',
    };
    expect(await service.createTemplate(input)).toBe(created);
    expect(notificationTemplateRepository.create).toHaveBeenCalledWith(input);
  });

  it('updateTemplate returns null when the template is missing', async () => {
    vi.mocked(notificationTemplateRepository.update).mockResolvedValue(null);
    expect(await service.updateTemplate('missing', { name: 'Y' })).toBeNull();
  });

  it('deleteTemplate returns false when deletion fails', async () => {
    vi.mocked(notificationTemplateRepository.delete).mockResolvedValue(false);
    expect(await service.deleteTemplate('missing')).toBe(false);
  });
});

// ===========================================================================
// initialize / shutdown
// ===========================================================================

describe('initialize and shutdown', () => {
  it('seeds default templates when none exist and starts the overdue checker', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(notificationTemplateRepository.findAll).mockResolvedValue([]);
      vi.mocked(notificationTemplateRepository.create).mockResolvedValue(makeTemplate());
      vi.mocked(incidentNotificationRepository.markOverdue).mockResolvedValue(0);

      await service.initialize();

      // seeded > 0 templates (default set is non-empty)
      expect(notificationTemplateRepository.create).toHaveBeenCalled();
      expect(incidentNotificationRepository.markOverdue).toHaveBeenCalled();

      // idempotent: second call is a no-op
      vi.mocked(notificationTemplateRepository.findAll).mockClear();
      await service.initialize();
      expect(notificationTemplateRepository.findAll).not.toHaveBeenCalled();

      service.shutdown();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not seed templates when some already exist', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(notificationTemplateRepository.findAll).mockResolvedValue([makeTemplate()]);
      vi.mocked(incidentNotificationRepository.markOverdue).mockResolvedValue(0);

      await service.initialize();

      expect(notificationTemplateRepository.create).not.toHaveBeenCalled();
      service.shutdown();
    } finally {
      vi.useRealTimers();
    }
  });

  it('creates an alert when the overdue checker marks notifications overdue', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(notificationTemplateRepository.findAll).mockResolvedValue([makeTemplate()]);
      vi.mocked(incidentNotificationRepository.markOverdue).mockResolvedValue(3);

      await service.initialize();
      // allow the immediate checkAndMarkOverdue() promise chain to settle
      await vi.waitFor(() => {
        expect(alertService.createAlert).toHaveBeenCalledWith(
          expect.objectContaining({
            severity: 'error',
            source: 'system',
            sourceId: 'notification-workflow',
          })
        );
      });

      service.shutdown();
    } finally {
      vi.useRealTimers();
    }
  });
});
