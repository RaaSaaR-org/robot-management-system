/**
 * @file AlertService.test.ts
 * @description Unit tests for AlertService — alert query/mutation operations,
 *   convenience creators, event subscription/broadcasting. All repository access
 *   is mocked; no real DB/network/filesystem.
 * @feature alerts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  Alert,
  CreateAlertInput,
  AlertSeverity,
  PaginatedResult,
} from '../../repositories/index.js';

// ---------------------------------------------------------------------------
// Mocks for external boundaries — the only dependency is alertRepository
// ---------------------------------------------------------------------------

vi.mock('../../repositories/index.js', () => ({
  alertRepository: {
    findById: vi.fn(),
    findAll: vi.fn(),
    findActive: vi.fn(),
    getCountsBySeverity: vi.fn(),
    create: vi.fn(),
    acknowledge: vi.fn(),
    acknowledgeMany: vi.fn().mockResolvedValue(0),
    expireAutoDismissed: vi.fn().mockResolvedValue(0),
    delete: vi.fn(),
    deleteAcknowledged: vi.fn(),
    deleteAll: vi.fn(),
  },
  robotRepository: {
    findAll: vi.fn().mockResolvedValue([]),
  },
}));

import { alertRepository as _alertRepository } from '../../repositories/index.js';
import { AlertService } from '../AlertService.js';

const alertRepository = vi.mocked(_alertRepository, true);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAlert(overrides: Partial<Alert> = {}): Alert {
  return {
    id: 'alert-1',
    severity: 'warning',
    title: 'Test Alert',
    message: 'Something happened',
    source: 'system',
    acknowledged: false,
    dismissable: true,
    timestamp: '2026-06-22T00:00:00.000Z',
    ...overrides,
  };
}

function makePaginated(data: Alert[]): PaginatedResult<Alert> {
  return {
    data,
    pagination: { page: 1, pageSize: 20, total: data.length, totalPages: 1 },
  } as PaginatedResult<Alert>;
}

let service: AlertService;

beforeEach(() => {
  vi.clearAllMocks();
  service = new AlertService();
});

// ---------------------------------------------------------------------------
// Query operations
// ---------------------------------------------------------------------------

describe('AlertService — query operations', () => {
  it('getAlert returns the alert from the repository', async () => {
    const alert = makeAlert();
    alertRepository.findById.mockResolvedValue(alert);

    const result = await service.getAlert('alert-1');

    expect(result).toEqual(alert);
    expect(alertRepository.findById).toHaveBeenCalledWith('alert-1');
  });

  it('getAlert returns null when the alert does not exist', async () => {
    alertRepository.findById.mockResolvedValue(null);

    const result = await service.getAlert('missing');

    expect(result).toBeNull();
  });

  it('getAlerts forwards filters and pagination', async () => {
    const page = makePaginated([makeAlert()]);
    alertRepository.findAll.mockResolvedValue(page);

    const result = await service.getAlerts({ severity: 'warning' }, { page: 1 });

    expect(result).toBe(page);
    expect(alertRepository.findAll).toHaveBeenCalledWith({ severity: 'warning' }, { page: 1 });
  });

  it('getActiveAlerts returns active alerts', async () => {
    const alerts = [makeAlert(), makeAlert({ id: 'alert-2' })];
    alertRepository.findActive.mockResolvedValue(alerts);

    const result = await service.getActiveAlerts({ source: 'robot' });

    expect(result).toEqual(alerts);
    expect(alertRepository.findActive).toHaveBeenCalledWith({ source: 'robot' });
  });

  it('getAlertHistory delegates to findAll', async () => {
    const page = makePaginated([]);
    alertRepository.findAll.mockResolvedValue(page);

    const result = await service.getAlertHistory();

    expect(result).toBe(page);
    expect(alertRepository.findAll).toHaveBeenCalledWith(undefined, undefined);
  });

  it('getAlertCounts returns counts by severity', async () => {
    const counts: Record<AlertSeverity, number> = {
      critical: 1,
      error: 2,
      warning: 3,
      info: 4,
    };
    alertRepository.getCountsBySeverity.mockResolvedValue(counts);

    const result = await service.getAlertCounts();

    expect(result).toEqual(counts);
  });

  it('getAlert propagates repository errors', async () => {
    alertRepository.findById.mockRejectedValue(new Error('db down'));

    await expect(service.getAlert('x')).rejects.toThrow('db down');
  });
});

// ---------------------------------------------------------------------------
// Mutation operations + event broadcasting
// ---------------------------------------------------------------------------

describe('AlertService — createAlert', () => {
  it('creates an alert and emits an alert_created event', async () => {
    const alert = makeAlert();
    alertRepository.create.mockResolvedValue(alert);
    const callback = vi.fn();
    service.onAlertEvent(callback);

    const input: CreateAlertInput = {
      severity: 'warning',
      title: 'Test Alert',
      message: 'Something happened',
      source: 'system',
    };
    const result = await service.createAlert(input);

    expect(result).toBe(alert);
    expect(alertRepository.create).toHaveBeenCalledWith(input);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0][0]).toMatchObject({ type: 'alert_created', alert });
    expect(callback.mock.calls[0][0].timestamp).toEqual(expect.any(String));
  });

  it('propagates repository create errors and does not emit', async () => {
    alertRepository.create.mockRejectedValue(new Error('insert failed'));
    const callback = vi.fn();
    service.onAlertEvent(callback);

    await expect(
      service.createAlert({
        severity: 'info',
        title: 't',
        message: 'm',
        source: 'system',
      })
    ).rejects.toThrow('insert failed');
    expect(callback).not.toHaveBeenCalled();
  });
});

describe('AlertService — acknowledgeAlert', () => {
  it('acknowledges and emits an alert_acknowledged event', async () => {
    const alert = makeAlert({ acknowledged: true });
    alertRepository.acknowledge.mockResolvedValue(alert);
    const callback = vi.fn();
    service.onAlertEvent(callback);

    const result = await service.acknowledgeAlert('alert-1', 'user-9');

    expect(result).toBe(alert);
    expect(alertRepository.acknowledge).toHaveBeenCalledWith('alert-1', 'user-9');
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0][0].type).toBe('alert_acknowledged');
  });

  it('returns null and emits nothing when alert not found', async () => {
    alertRepository.acknowledge.mockResolvedValue(null);
    const callback = vi.fn();
    service.onAlertEvent(callback);

    const result = await service.acknowledgeAlert('missing');

    expect(result).toBeNull();
    expect(callback).not.toHaveBeenCalled();
  });
});

describe('AlertService — deleteAlert', () => {
  it('deletes an existing alert and emits alert_deleted', async () => {
    const alert = makeAlert();
    alertRepository.findById.mockResolvedValue(alert);
    alertRepository.delete.mockResolvedValue(true);
    const callback = vi.fn();
    service.onAlertEvent(callback);

    const result = await service.deleteAlert('alert-1');

    expect(result).toBe(true);
    expect(alertRepository.delete).toHaveBeenCalledWith('alert-1');
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0][0].type).toBe('alert_deleted');
  });

  it('returns false without deleting when alert does not exist', async () => {
    alertRepository.findById.mockResolvedValue(null);
    const callback = vi.fn();
    service.onAlertEvent(callback);

    const result = await service.deleteAlert('missing');

    expect(result).toBe(false);
    expect(alertRepository.delete).not.toHaveBeenCalled();
    expect(callback).not.toHaveBeenCalled();
  });

  it('does not emit when repository delete returns false', async () => {
    alertRepository.findById.mockResolvedValue(makeAlert());
    alertRepository.delete.mockResolvedValue(false);
    const callback = vi.fn();
    service.onAlertEvent(callback);

    const result = await service.deleteAlert('alert-1');

    expect(result).toBe(false);
    expect(callback).not.toHaveBeenCalled();
  });
});

describe('AlertService — bulk clear operations', () => {
  it('clearAcknowledgedAlerts returns the deleted count', async () => {
    alertRepository.deleteAcknowledged.mockResolvedValue(5);

    const result = await service.clearAcknowledgedAlerts();

    expect(result).toBe(5);
    expect(alertRepository.deleteAcknowledged).toHaveBeenCalledOnce();
  });

  it('clearAllAlerts returns the deleted count', async () => {
    alertRepository.deleteAll.mockResolvedValue(12);

    const result = await service.clearAllAlerts();

    expect(result).toBe(12);
    expect(alertRepository.deleteAll).toHaveBeenCalledOnce();
  });

  it('clearAllAlerts propagates repository errors', async () => {
    alertRepository.deleteAll.mockRejectedValue(new Error('truncate failed'));

    await expect(service.clearAllAlerts()).rejects.toThrow('truncate failed');
  });
});

// ---------------------------------------------------------------------------
// Convenience creators
// ---------------------------------------------------------------------------

describe('AlertService — convenience creators', () => {
  it('createRobotAlert builds a robot-sourced input (critical => not dismissable, no auto-dismiss)', async () => {
    const alert = makeAlert({ severity: 'critical', source: 'robot' });
    alertRepository.create.mockResolvedValue(alert);

    await service.createRobotAlert('robot-7', 'critical', 'Down', 'Robot offline');

    expect(alertRepository.create).toHaveBeenCalledWith({
      severity: 'critical',
      title: 'Down',
      message: 'Robot offline',
      source: 'robot',
      sourceId: 'robot-7',
      dismissable: false,
      autoDismissMs: undefined,
    });
  });

  it('createRobotAlert sets autoDismissMs for info severity', async () => {
    alertRepository.create.mockResolvedValue(makeAlert({ severity: 'info', source: 'robot' }));

    await service.createRobotAlert('robot-7', 'info', 'FYI', 'All good');

    expect(alertRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ dismissable: true, autoDismissMs: 10000, source: 'robot' })
    );
  });

  it('createSystemAlert builds a system-sourced input', async () => {
    alertRepository.create.mockResolvedValue(makeAlert({ source: 'system' }));

    await service.createSystemAlert('warning', 'Disk', 'Low space');

    expect(alertRepository.create).toHaveBeenCalledWith({
      severity: 'warning',
      title: 'Disk',
      message: 'Low space',
      source: 'system',
      dismissable: true,
      autoDismissMs: undefined,
    });
  });

  it('createTaskAlert builds a task-sourced input', async () => {
    alertRepository.create.mockResolvedValue(makeAlert({ source: 'task' }));

    await service.createTaskAlert('task-3', 'error', 'Failed', 'Task crashed');

    expect(alertRepository.create).toHaveBeenCalledWith({
      severity: 'error',
      title: 'Failed',
      message: 'Task crashed',
      source: 'task',
      sourceId: 'task-3',
      dismissable: true,
      autoDismissMs: undefined,
    });
  });
});

// ---------------------------------------------------------------------------
// Event subscription
// ---------------------------------------------------------------------------

describe('AlertService — event subscription', () => {
  it('onAlertEvent returns an unsubscribe function that stops further events', async () => {
    alertRepository.create.mockResolvedValue(makeAlert());
    const callback = vi.fn();
    const unsubscribe = service.onAlertEvent(callback);

    unsubscribe();
    await service.createAlert({ severity: 'info', title: 't', message: 'm', source: 'system' });

    expect(callback).not.toHaveBeenCalled();
  });

  it('a throwing callback does not break broadcasting to other subscribers', async () => {
    alertRepository.create.mockResolvedValue(makeAlert());
    const bad = vi.fn(() => {
      throw new Error('boom');
    });
    const good = vi.fn();
    service.onAlertEvent(bad);
    service.onAlertEvent(good);

    await expect(
      service.createAlert({ severity: 'info', title: 't', message: 'm', source: 'system' })
    ).resolves.toBeDefined();
    expect(bad).toHaveBeenCalledTimes(1);
    expect(good).toHaveBeenCalledTimes(1);
  });
});
