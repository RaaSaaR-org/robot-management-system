/**
 * @file IncidentService.test.ts
 * @description Unit tests for IncidentService — incident detection, CRUD, snapshots, dashboard stats, notifications, events
 * @feature incidents
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  Incident,
  SafetyEventTrigger,
  IncidentNotification,
} from '../../types/incident.types.js';

// ---------------------------------------------------------------------------
// Mocks for external boundaries (repositories + collaborating services)
// ---------------------------------------------------------------------------

vi.mock('../../repositories/IncidentRepository.js', () => ({
  incidentRepository: {
    create: vi.fn(),
    findById: vi.fn(),
    findByNumber: vi.fn(),
    findAll: vi.fn(),
    findOpen: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    updateSnapshot: vi.fn(),
    linkEvidence: vi.fn(),
    getStats: vi.fn(),
  },
  incidentNotificationRepository: {
    getCountsByStatus: vi.fn(),
    findOverdue: vi.fn(),
    markOverdue: vi.fn(),
  },
}));

vi.mock('../SafetyService.js', () => ({
  safetyService: {
    onEStopEvent: vi.fn(() => () => {}),
  },
}));

vi.mock('../RobotManager.js', () => ({
  robotManager: {
    listRobots: vi.fn(),
  },
}));

vi.mock('../AlertService.js', () => ({
  alertService: {
    createAlert: vi.fn(),
    getActiveAlerts: vi.fn(),
  },
}));

import { IncidentService, incidentService } from '../IncidentService.js';
import {
  incidentRepository,
  incidentNotificationRepository,
} from '../../repositories/IncidentRepository.js';
import { safetyService } from '../SafetyService.js';
import { robotManager } from '../RobotManager.js';
import { alertService } from '../AlertService.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeIncident(overrides: Partial<Incident> = {}): Incident {
  return {
    id: 'inc-1',
    incidentNumber: 'INC-2026-001',
    type: 'safety',
    severity: 'high',
    status: 'detected',
    title: 'Test Incident',
    description: 'A test incident',
    rootCause: null,
    resolution: null,
    riskScore: null,
    affectedDataSubjects: null,
    dataCategories: [],
    detectedAt: new Date('2026-06-01T00:00:00Z'),
    containedAt: null,
    resolvedAt: null,
    closedAt: null,
    robotId: null,
    complianceLogIds: [],
    alertIds: [],
    systemSnapshot: null,
    createdAt: new Date('2026-06-01T00:00:00Z'),
    updatedAt: new Date('2026-06-01T00:00:00Z'),
    createdBy: 'system',
    ...overrides,
  };
}

function makeTrigger(overrides: Partial<SafetyEventTrigger> = {}): SafetyEventTrigger {
  return {
    type: 'safety',
    eventType: 'emergency_stop',
    robotId: 'r1',
    reason: 'overheating',
    severity: 'high',
    timestamp: new Date('2026-06-01T12:00:00Z'),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // sensible default mocks so happy paths don't throw on incidental deps
  vi.mocked(alertService.createAlert).mockResolvedValue({} as never);
  vi.mocked(alertService.getActiveAlerts).mockResolvedValue([] as never);
  vi.mocked(robotManager.listRobots).mockResolvedValue([] as never);
  vi.mocked(incidentRepository.findById).mockResolvedValue(null);
  vi.mocked(incidentRepository.updateSnapshot).mockResolvedValue(null);
});

// ===========================================================================
// createIncident
// ===========================================================================

describe('createIncident', () => {
  it('delegates to the repository and returns the created incident', async () => {
    const created = makeIncident();
    vi.mocked(incidentRepository.create).mockResolvedValue(created);

    const result = await incidentService.createIncident({
      type: 'safety',
      title: 'Test Incident',
      description: 'A test incident',
    });

    expect(result).toBe(created);
    expect(incidentRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'safety', title: 'Test Incident' })
    );
  });

  it('emits an incident_created event to subscribers', async () => {
    const created = makeIncident();
    vi.mocked(incidentRepository.create).mockResolvedValue(created);

    const svc = new IncidentService();
    const cb = vi.fn();
    svc.onIncidentEvent(cb);

    await svc.createIncident({ type: 'safety', title: 't', description: 'd' });

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0]).toMatchObject({
      type: 'incident_created',
      incident: created,
    });
  });

  it('propagates repository errors', async () => {
    vi.mocked(incidentRepository.create).mockRejectedValue(new Error('db down'));
    await expect(
      incidentService.createIncident({ type: 'safety', title: 't', description: 'd' })
    ).rejects.toThrow('db down');
  });
});

// ===========================================================================
// getIncident / getIncidentByNumber / listIncidents / getOpenIncidents
// ===========================================================================

describe('read operations', () => {
  it('getIncident returns the incident and requests notifications', async () => {
    const incident = makeIncident();
    vi.mocked(incidentRepository.findById).mockResolvedValue(incident);

    const result = await incidentService.getIncident('inc-1');

    expect(result).toBe(incident);
    expect(incidentRepository.findById).toHaveBeenCalledWith('inc-1', true);
  });

  it('getIncident returns null when not found', async () => {
    vi.mocked(incidentRepository.findById).mockResolvedValue(null);
    const result = await incidentService.getIncident('missing');
    expect(result).toBeNull();
  });

  it('getIncidentByNumber delegates to findByNumber', async () => {
    const incident = makeIncident();
    vi.mocked(incidentRepository.findByNumber).mockResolvedValue(incident);

    const result = await incidentService.getIncidentByNumber('INC-2026-001');

    expect(result).toBe(incident);
    expect(incidentRepository.findByNumber).toHaveBeenCalledWith('INC-2026-001');
  });

  it('listIncidents forwards query params', async () => {
    const response = { incidents: [], total: 0, page: 1, limit: 20, totalPages: 0 };
    vi.mocked(incidentRepository.findAll).mockResolvedValue(response);

    const result = await incidentService.listIncidents({ severity: 'high' });

    expect(result).toBe(response);
    expect(incidentRepository.findAll).toHaveBeenCalledWith({ severity: 'high' });
  });

  it('getOpenIncidents delegates to findOpen', async () => {
    const open = [makeIncident()];
    vi.mocked(incidentRepository.findOpen).mockResolvedValue(open);

    const result = await incidentService.getOpenIncidents();

    expect(result).toBe(open);
    expect(incidentRepository.findOpen).toHaveBeenCalled();
  });
});

// ===========================================================================
// updateIncident
// ===========================================================================

describe('updateIncident', () => {
  it('returns the updated incident and emits an incident_updated event', async () => {
    const updated = makeIncident({ status: 'resolved' });
    vi.mocked(incidentRepository.update).mockResolvedValue(updated);

    const svc = new IncidentService();
    const cb = vi.fn();
    svc.onIncidentEvent(cb);

    const result = await svc.updateIncident('inc-1', { status: 'resolved' });

    expect(result).toBe(updated);
    expect(incidentRepository.update).toHaveBeenCalledWith('inc-1', { status: 'resolved' });
    expect(cb).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'incident_updated', incident: updated })
    );
  });

  it('returns null and does NOT emit when the incident is not found', async () => {
    vi.mocked(incidentRepository.update).mockResolvedValue(null);

    const svc = new IncidentService();
    const cb = vi.fn();
    svc.onIncidentEvent(cb);

    const result = await svc.updateIncident('missing', { status: 'closed' });

    expect(result).toBeNull();
    expect(cb).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// deleteIncident
// ===========================================================================

describe('deleteIncident', () => {
  it('returns true when the repository deletes', async () => {
    vi.mocked(incidentRepository.delete).mockResolvedValue(true);
    await expect(incidentService.deleteIncident('inc-1')).resolves.toBe(true);
    expect(incidentRepository.delete).toHaveBeenCalledWith('inc-1');
  });

  it('returns false when the repository reports failure', async () => {
    vi.mocked(incidentRepository.delete).mockResolvedValue(false);
    await expect(incidentService.deleteIncident('missing')).resolves.toBe(false);
  });
});

// ===========================================================================
// detectIncident
// ===========================================================================

describe('detectIncident', () => {
  it('creates an incident, captures a snapshot, and raises an alert', async () => {
    const created = makeIncident({ id: 'inc-9', incidentNumber: 'INC-2026-009' });
    vi.mocked(incidentRepository.create).mockResolvedValue(created);
    vi.mocked(incidentRepository.findById).mockResolvedValue(created);
    vi.mocked(incidentRepository.updateSnapshot).mockResolvedValue(created);

    const trigger = makeTrigger({ severity: 'critical' });
    const result = await incidentService.detectIncident(trigger);

    expect(result).toBe(created);
    // create called with derived title/description and system creator
    expect(incidentRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'safety',
        severity: 'critical',
        createdBy: 'system',
        robotId: 'r1',
      })
    );
    // title is built from the event type map
    const createArg = vi.mocked(incidentRepository.create).mock.calls[0][0];
    expect(createArg.title).toContain('Emergency Stop');
    // snapshot capture attempted for the new incident id
    expect(incidentRepository.findById).toHaveBeenCalledWith('inc-9');
    // critical severity maps to a critical alert
    expect(alertService.createAlert).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'critical', source: 'system', sourceId: 'inc-9' })
    );
  });

  it('omits robotId when the trigger robot is "unknown" and uses error alert for non-critical', async () => {
    const created = makeIncident();
    vi.mocked(incidentRepository.create).mockResolvedValue(created);

    const trigger = makeTrigger({ robotId: 'unknown', severity: 'high' });
    await incidentService.detectIncident(trigger);

    const createArg = vi.mocked(incidentRepository.create).mock.calls[0][0];
    expect(createArg.robotId).toBeUndefined();
    expect(alertService.createAlert).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'error' })
    );
  });
});

// ===========================================================================
// captureSystemSnapshot
// ===========================================================================

describe('captureSystemSnapshot', () => {
  it('returns null when the incident does not exist', async () => {
    vi.mocked(incidentRepository.findById).mockResolvedValue(null);

    const result = await incidentService.captureSystemSnapshot('missing');

    expect(result).toBeNull();
    expect(incidentRepository.updateSnapshot).not.toHaveBeenCalled();
  });

  it('builds a snapshot from robots + active alerts and persists it', async () => {
    const incident = makeIncident();
    vi.mocked(incidentRepository.findById).mockResolvedValue(incident);
    vi.mocked(robotManager.listRobots).mockResolvedValue([
      {
        id: 'r1',
        name: 'Robot One',
        status: 'online',
        location: { x: 1, y: 2 },
        batteryLevel: 80,
        currentTaskName: 'patrol',
        metadata: { operatingMode: 'auto' },
      },
      { id: 'r2', name: 'Robot Two', status: 'offline' },
    ] as never);
    vi.mocked(alertService.getActiveAlerts).mockResolvedValue([
      { id: 'a1', severity: 'error', title: 'Alert One' },
    ] as never);
    vi.mocked(incidentRepository.updateSnapshot).mockResolvedValue(incident);

    const result = await incidentService.captureSystemSnapshot('inc-1');

    expect(result).toBe(incident);
    expect(incidentRepository.updateSnapshot).toHaveBeenCalledTimes(1);
    const [id, snapshot] = vi.mocked(incidentRepository.updateSnapshot).mock.calls[0];
    expect(id).toBe('inc-1');
    expect(snapshot.robots).toHaveLength(2);
    // location z defaulted to 0
    expect(snapshot.robots[0].location).toEqual({ x: 1, y: 2, z: 0 });
    expect(snapshot.robots[0].operatingMode).toBe('auto');
    expect(snapshot.activeAlerts).toHaveLength(1);
    // only non-offline robots counted as connected
    expect(snapshot.systemHealth.connectedRobots).toBe(1);
  });

  it('caps active alerts at 20 entries', async () => {
    vi.mocked(incidentRepository.findById).mockResolvedValue(makeIncident());
    const manyAlerts = Array.from({ length: 30 }, (_, i) => ({
      id: `a${i}`,
      severity: 'info',
      title: `Alert ${i}`,
    }));
    vi.mocked(alertService.getActiveAlerts).mockResolvedValue(manyAlerts as never);
    vi.mocked(incidentRepository.updateSnapshot).mockResolvedValue(makeIncident());

    await incidentService.captureSystemSnapshot('inc-1');

    const [, snapshot] = vi.mocked(incidentRepository.updateSnapshot).mock.calls[0];
    expect(snapshot.activeAlerts).toHaveLength(20);
  });
});

// ===========================================================================
// linkEvidence
// ===========================================================================

describe('linkEvidence', () => {
  it('returns the updated incident and emits an event', async () => {
    const updated = makeIncident({ complianceLogIds: ['c1'] });
    vi.mocked(incidentRepository.linkEvidence).mockResolvedValue(updated);

    const svc = new IncidentService();
    const cb = vi.fn();
    svc.onIncidentEvent(cb);

    const result = await svc.linkEvidence('inc-1', ['c1'], ['a1']);

    expect(result).toBe(updated);
    expect(incidentRepository.linkEvidence).toHaveBeenCalledWith('inc-1', ['c1'], ['a1']);
    expect(cb).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'incident_updated' })
    );
  });

  it('returns null and does not emit when nothing was updated', async () => {
    vi.mocked(incidentRepository.linkEvidence).mockResolvedValue(null);

    const svc = new IncidentService();
    const cb = vi.fn();
    svc.onIncidentEvent(cb);

    const result = await svc.linkEvidence('missing');

    expect(result).toBeNull();
    expect(cb).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// getDashboardStats
// ===========================================================================

describe('getDashboardStats', () => {
  const baseStats = {
    total: 10,
    open: 3,
    bySeverity: { critical: 1, high: 2, medium: 4, low: 3 },
    byType: { safety: 5, security: 2, data_breach: 1, ai_malfunction: 1, vulnerability: 1 },
    byStatus: { detected: 2, investigating: 1, contained: 0, resolved: 4, closed: 3 },
  };

  it('aggregates stats and computes average resolution time', async () => {
    vi.mocked(incidentRepository.getStats).mockResolvedValue(baseStats as never);
    vi.mocked(incidentNotificationRepository.getCountsByStatus).mockResolvedValue({
      pending: 2,
      draft: 0,
      sent: 5,
      acknowledged: 1,
      overdue: 3,
    } as never);

    const recent = { incidents: [makeIncident()], total: 1, page: 1, limit: 5, totalPages: 1 };
    const resolved = {
      incidents: [
        makeIncident({
          detectedAt: new Date('2026-06-01T00:00:00Z'),
          resolvedAt: new Date('2026-06-01T02:00:00Z'), // 2h
        }),
        makeIncident({
          detectedAt: new Date('2026-06-01T00:00:00Z'),
          resolvedAt: new Date('2026-06-01T04:00:00Z'), // 4h
        }),
      ],
      total: 2,
      page: 1,
      limit: 100,
      totalPages: 1,
    };
    // first findAll call = recent, second = resolved
    vi.mocked(incidentRepository.findAll)
      .mockResolvedValueOnce(recent)
      .mockResolvedValueOnce(resolved);

    const result = await incidentService.getDashboardStats();

    expect(result.totalIncidents).toBe(10);
    expect(result.openIncidents).toBe(3);
    expect(result.incidentsBySeverity).toEqual(baseStats.bySeverity);
    expect(result.overdueNotifications).toBe(3);
    expect(result.pendingNotifications).toBe(2);
    expect(result.recentIncidents).toEqual(recent.incidents);
    // average of 2h and 4h = 3h
    expect(result.averageResolutionTimeHours).toBe(3);
  });

  it('reports null average resolution time when no resolved incidents have timestamps', async () => {
    vi.mocked(incidentRepository.getStats).mockResolvedValue(baseStats as never);
    vi.mocked(incidentNotificationRepository.getCountsByStatus).mockResolvedValue({
      pending: 0,
      draft: 0,
      sent: 0,
      acknowledged: 0,
      overdue: 0,
    } as never);
    const empty = { incidents: [], total: 0, page: 1, limit: 5, totalPages: 0 };
    vi.mocked(incidentRepository.findAll).mockResolvedValue(empty);

    const result = await incidentService.getDashboardStats();

    expect(result.averageResolutionTimeHours).toBeNull();
  });
});

// ===========================================================================
// getNotificationTimeline
// ===========================================================================

describe('getNotificationTimeline', () => {
  function makeNotification(overrides: Partial<IncidentNotification> = {}): IncidentNotification {
    return {
      id: 'n1',
      incidentId: 'inc-1',
      authority: 'dpa',
      regulation: 'gdpr',
      notificationType: 'initial',
      deadlineHours: 72,
      dueAt: new Date(Date.now() + 60 * 60 * 1000), // +1h
      status: 'pending',
      sentAt: null,
      acknowledgedAt: null,
      templateId: null,
      content: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      sentBy: null,
      ...overrides,
    };
  }

  it('returns null when the incident does not exist', async () => {
    vi.mocked(incidentRepository.findById).mockResolvedValue(null);
    const result = await incidentService.getNotificationTimeline('missing');
    expect(result).toBeNull();
    expect(incidentRepository.findById).toHaveBeenCalledWith('missing', true);
  });

  it('flags overdue pending notifications and marks future ones as not overdue', async () => {
    const overdue = makeNotification({
      id: 'overdue',
      dueAt: new Date(Date.now() - 60 * 60 * 1000), // -1h, pending
      status: 'pending',
    });
    const future = makeNotification({
      id: 'future',
      dueAt: new Date(Date.now() + 2 * 60 * 60 * 1000), // +2h
      status: 'pending',
    });
    const sentPast = makeNotification({
      id: 'sent',
      dueAt: new Date(Date.now() - 60 * 60 * 1000), // -1h but already sent
      status: 'sent',
    });

    vi.mocked(incidentRepository.findById).mockResolvedValue(
      makeIncident({ notifications: [overdue, future, sentPast] })
    );

    const result = await incidentService.getNotificationTimeline('inc-1');

    expect(result).not.toBeNull();
    const byId = Object.fromEntries(result!.notifications.map((n) => [n.id, n]));
    expect(byId.overdue.isOverdue).toBe(true);
    expect(byId.future.isOverdue).toBe(false);
    // already-sent notifications are never overdue even past due
    expect(byId.sent.isOverdue).toBe(false);
  });

  it('handles an incident with no notifications', async () => {
    vi.mocked(incidentRepository.findById).mockResolvedValue(
      makeIncident({ notifications: undefined })
    );
    const result = await incidentService.getNotificationTimeline('inc-1');
    expect(result!.notifications).toEqual([]);
  });
});

// ===========================================================================
// overdue notifications
// ===========================================================================

describe('overdue notifications', () => {
  it('getOverdueNotifications delegates to the repository', async () => {
    const overdue = [{ id: 'n1' }] as never;
    vi.mocked(incidentNotificationRepository.findOverdue).mockResolvedValue(overdue);
    const result = await incidentService.getOverdueNotifications();
    expect(result).toBe(overdue);
  });

  it('markOverdueNotifications returns the count', async () => {
    vi.mocked(incidentNotificationRepository.markOverdue).mockResolvedValue(4);
    const result = await incidentService.markOverdueNotifications();
    expect(result).toBe(4);
  });

  it('markOverdueNotifications returns 0 when nothing is overdue', async () => {
    vi.mocked(incidentNotificationRepository.markOverdue).mockResolvedValue(0);
    const result = await incidentService.markOverdueNotifications();
    expect(result).toBe(0);
  });
});

// ===========================================================================
// initialize / shutdown
// ===========================================================================

describe('initialize and shutdown', () => {
  it('subscribes to E-stop events once and is idempotent', () => {
    const unsub = vi.fn();
    vi.mocked(safetyService.onEStopEvent).mockReturnValue(unsub);

    const svc = new IncidentService();
    svc.initialize();
    svc.initialize(); // second call should be a no-op

    expect(safetyService.onEStopEvent).toHaveBeenCalledTimes(1);

    svc.shutdown();
    expect(unsub).toHaveBeenCalledTimes(1);
  });

  it('shutdown is safe when never initialized', () => {
    const svc = new IncidentService();
    expect(() => svc.shutdown()).not.toThrow();
  });
});

// ===========================================================================
// event subscriptions
// ===========================================================================

describe('onIncidentEvent', () => {
  it('unsubscribes so the callback stops receiving events', async () => {
    vi.mocked(incidentRepository.create).mockResolvedValue(makeIncident());

    const svc = new IncidentService();
    const cb = vi.fn();
    const unsubscribe = svc.onIncidentEvent(cb);

    await svc.createIncident({ type: 'safety', title: 't', description: 'd' });
    expect(cb).toHaveBeenCalledTimes(1);

    unsubscribe();
    await svc.createIncident({ type: 'safety', title: 't2', description: 'd2' });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('isolates a throwing callback from other subscribers', async () => {
    vi.mocked(incidentRepository.create).mockResolvedValue(makeIncident());

    const svc = new IncidentService();
    const bad = vi.fn(() => {
      throw new Error('callback boom');
    });
    const good = vi.fn();
    svc.onIncidentEvent(bad);
    svc.onIncidentEvent(good);

    await expect(
      svc.createIncident({ type: 'safety', title: 't', description: 'd' })
    ).resolves.toBeDefined();
    expect(good).toHaveBeenCalled();
  });
});
