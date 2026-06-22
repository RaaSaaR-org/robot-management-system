/**
 * @file OversightService.test.ts
 * @description Unit tests for OversightService — manual control sessions, verification
 *   schedules, anomaly lifecycle, oversight logging, capabilities summaries, dashboard
 *   stats and event subscriptions (EU AI Act Art. 14).
 * @feature oversight
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Robot } from '../RobotManager.js';
import type {
  ManualControlSession,
  VerificationSchedule,
  VerificationCompletion,
  OversightLog,
  AnomalyRecord,
} from '../../types/oversight.types.js';

// ---------------------------------------------------------------------------
// Mocks for external boundaries
// ---------------------------------------------------------------------------

vi.mock('../../repositories/OversightRepository.js', () => ({
  manualControlSessionRepository: {
    create: vi.fn(),
    end: vi.fn(),
    findAllActive: vi.fn(),
    findActiveByRobotId: vi.fn(),
    findAll: vi.fn(),
    countActive: vi.fn(),
    countToday: vi.fn(),
  },
  verificationScheduleRepository: {
    create: vi.fn(),
    findAll: vi.fn(),
    findDue: vi.fn(),
    findById: vi.fn(),
    update: vi.fn(),
    deactivate: vi.fn(),
    countActive: vi.fn(),
  },
  verificationCompletionRepository: {
    create: vi.fn(),
    findByScheduleId: vi.fn(),
    countToday: vi.fn(),
    getComplianceRate: vi.fn(),
  },
  oversightLogRepository: {
    create: vi.fn(),
    findAll: vi.fn(),
    findRecent: vi.fn(),
  },
  anomalyRecordRepository: {
    create: vi.fn(),
    findActiveByRobotId: vi.fn(),
    findAllActive: vi.fn(),
    findAll: vi.fn(),
    findUnacknowledged: vi.fn(),
    acknowledge: vi.fn(),
    resolve: vi.fn(),
    countActive: vi.fn(),
    countUnacknowledged: vi.fn(),
    getCountsBySeverity: vi.fn(),
    getCountsByType: vi.fn(),
  },
}));

vi.mock('../RobotManager.js', () => ({
  robotManager: {
    getRobot: vi.fn(),
    listRobots: vi.fn(),
  },
}));

vi.mock('../AlertService.js', () => ({
  alertService: {
    createAlert: vi.fn(),
  },
}));

import { oversightService } from '../OversightService.js';
import {
  manualControlSessionRepository,
  verificationScheduleRepository,
  verificationCompletionRepository,
  oversightLogRepository,
  anomalyRecordRepository,
} from '../../repositories/OversightRepository.js';
import { robotManager } from '../RobotManager.js';
import { alertService } from '../AlertService.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRobot(overrides: Partial<Robot> = {}): Robot {
  return {
    id: 'r1',
    name: 'Robot One',
    model: 'so101',
    status: 'online',
    batteryLevel: 90,
    location: { zone: 'Zone A' } as Robot['location'],
    lastSeen: new Date().toISOString(),
    capabilities: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeSession(overrides: Partial<ManualControlSession> = {}): ManualControlSession {
  return {
    id: 's1',
    robotId: 'r1',
    operatorId: 'op1',
    reason: 'maintenance',
    startedAt: new Date(),
    endedAt: null,
    isActive: true,
    speedLimitMmPerSec: 250,
    forceLimitN: 140,
    ...overrides,
  };
}

function makeSchedule(overrides: Partial<VerificationSchedule> = {}): VerificationSchedule {
  return {
    id: 'sch1',
    name: 'Hourly safety check',
    description: null,
    intervalMinutes: 60,
    robotScope: 'all',
    scopeId: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastCompletedAt: null,
    nextDueAt: new Date(),
    isOverdue: false,
    ...overrides,
  };
}

function makeCompletion(
  overrides: Partial<VerificationCompletion> = {}
): VerificationCompletion {
  return {
    id: 'c1',
    scheduleId: 'sch1',
    operatorId: 'op1',
    robotId: 'r1',
    status: 'completed',
    notes: null,
    completedAt: new Date(),
    ...overrides,
  };
}

function makeAnomaly(overrides: Partial<AnomalyRecord> = {}): AnomalyRecord {
  return {
    id: 'a1',
    robotId: 'r1',
    anomalyType: 'confidence_drop',
    severity: 'low',
    description: 'Confidence dropped below threshold',
    detectedAt: new Date(),
    acknowledgedAt: null,
    acknowledgedBy: null,
    resolvedAt: null,
    resolution: null,
    isActive: true,
    ...overrides,
  };
}

function makeLog(overrides: Partial<OversightLog> = {}): OversightLog {
  return {
    id: 'log1',
    actionType: 'manual_mode_activated',
    operatorId: 'op1',
    robotId: 'r1',
    taskId: null,
    decisionId: null,
    reason: 'test',
    details: {},
    timestamp: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // logAction is called by many methods; give it a default resolved value
  vi.mocked(oversightLogRepository.create).mockResolvedValue(makeLog());
  vi.mocked(alertService.createAlert).mockResolvedValue({} as never);
});

// ===========================================================================
// activateManualMode
// ===========================================================================

describe('activateManualMode', () => {
  it('throws when the robot does not exist', async () => {
    vi.mocked(robotManager.getRobot).mockResolvedValue(undefined);
    await expect(
      oversightService.activateManualMode({ robotId: 'rX', operatorId: 'op1', reason: 'x' })
    ).rejects.toThrow('Robot rX not found');
    expect(manualControlSessionRepository.create).not.toHaveBeenCalled();
  });

  it('creates a session, logs the action, emits an event and creates an alert', async () => {
    const robot = makeRobot({ id: 'r1', name: 'Robot One' });
    vi.mocked(robotManager.getRobot).mockResolvedValue(robot);
    const session = makeSession({ id: 's1', speedLimitMmPerSec: 250 });
    vi.mocked(manualControlSessionRepository.create).mockResolvedValue(session);

    const events: unknown[] = [];
    const unsub = oversightService.onOversightEvent((e) => events.push(e));

    const result = await oversightService.activateManualMode({
      robotId: 'r1',
      operatorId: 'op1',
      reason: 'maintenance',
      mode: 'reduced_speed',
    });

    expect(result.session).toBe(session);
    expect(result.robot).toEqual({
      id: 'r1',
      name: 'Robot One',
      previousMode: 'automatic',
      newMode: 'manual_reduced_speed',
    });

    expect(manualControlSessionRepository.create).toHaveBeenCalledWith({
      robotId: 'r1',
      operatorId: 'op1',
      reason: 'maintenance',
      mode: 'reduced_speed',
    });
    expect(oversightLogRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: 'manual_mode_activated', robotId: 'r1' })
    );
    expect(alertService.createAlert).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'warning', title: 'Manual Control Activated' })
    );
    expect(events.some((e) => (e as { type: string }).type === 'manual_mode_changed')).toBe(true);

    unsub();
  });

  it('maps full_speed mode to manual_full_speed and reads previousMode from metadata', async () => {
    const robot = makeRobot({ metadata: { operatingMode: 'manual_reduced_speed' } });
    vi.mocked(robotManager.getRobot).mockResolvedValue(robot);
    vi.mocked(manualControlSessionRepository.create).mockResolvedValue(
      makeSession({ speedLimitMmPerSec: 1000 })
    );

    const result = await oversightService.activateManualMode({
      robotId: 'r1',
      operatorId: 'op1',
      reason: 'r',
      mode: 'full_speed',
    });

    expect(result.robot.previousMode).toBe('manual_reduced_speed');
    expect(result.robot.newMode).toBe('manual_full_speed');
  });
});

// ===========================================================================
// deactivateManualMode
// ===========================================================================

describe('deactivateManualMode', () => {
  it('returns null when the session is not found and does not log', async () => {
    vi.mocked(manualControlSessionRepository.end).mockResolvedValue(null);
    const result = await oversightService.deactivateManualMode('missing', 'op1');
    expect(result).toBeNull();
    expect(oversightLogRepository.create).not.toHaveBeenCalled();
  });

  it('ends the session, logs the deactivation and emits an event', async () => {
    const session = makeSession({ id: 's1', robotId: 'r1', isActive: false, endedAt: new Date() });
    vi.mocked(manualControlSessionRepository.end).mockResolvedValue(session);

    const cb = vi.fn();
    const unsub = oversightService.onOversightEvent(cb);

    const result = await oversightService.deactivateManualMode('s1', 'op1');

    expect(result).toBe(session);
    expect(oversightLogRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: 'manual_mode_deactivated', robotId: 'r1' })
    );
    expect(cb).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'manual_mode_changed', robotId: 'r1' })
    );
    unsub();
  });
});

// ===========================================================================
// Manual session reads (pass-through)
// ===========================================================================

describe('manual session reads', () => {
  it('getActiveManualSessions delegates to the repository', async () => {
    const sessions = [makeSession()];
    vi.mocked(manualControlSessionRepository.findAllActive).mockResolvedValue(sessions);
    await expect(oversightService.getActiveManualSessions()).resolves.toBe(sessions);
  });

  it('getRobotManualSession delegates with the robotId', async () => {
    vi.mocked(manualControlSessionRepository.findActiveByRobotId).mockResolvedValue(null);
    await expect(oversightService.getRobotManualSession('r1')).resolves.toBeNull();
    expect(manualControlSessionRepository.findActiveByRobotId).toHaveBeenCalledWith('r1');
  });

  it('getManualSessionHistory passes query params through', async () => {
    vi.mocked(manualControlSessionRepository.findAll).mockResolvedValue([]);
    await oversightService.getManualSessionHistory({ robotId: 'r1' });
    expect(manualControlSessionRepository.findAll).toHaveBeenCalledWith({ robotId: 'r1' });
  });
});

// ===========================================================================
// Verification schedules
// ===========================================================================

describe('verification schedules', () => {
  it('createVerificationSchedule delegates and returns the created schedule', async () => {
    const schedule = makeSchedule();
    vi.mocked(verificationScheduleRepository.create).mockResolvedValue(schedule);
    const input = { name: 'Hourly safety check', intervalMinutes: 60 };
    await expect(oversightService.createVerificationSchedule(input)).resolves.toBe(schedule);
    expect(verificationScheduleRepository.create).toHaveBeenCalledWith(input);
  });

  it('getVerificationSchedules passes params through', async () => {
    vi.mocked(verificationScheduleRepository.findAll).mockResolvedValue([]);
    await oversightService.getVerificationSchedules({ isActive: true });
    expect(verificationScheduleRepository.findAll).toHaveBeenCalledWith({ isActive: true });
  });

  it('updateVerificationSchedule returns null when nothing was updated', async () => {
    vi.mocked(verificationScheduleRepository.update).mockResolvedValue(null);
    await expect(
      oversightService.updateVerificationSchedule('x', { name: 'new' })
    ).resolves.toBeNull();
    expect(verificationScheduleRepository.update).toHaveBeenCalledWith('x', { name: 'new' });
  });

  it('deactivateVerificationSchedule delegates to the repository', async () => {
    const schedule = makeSchedule({ isActive: false });
    vi.mocked(verificationScheduleRepository.deactivate).mockResolvedValue(schedule);
    await expect(oversightService.deactivateVerificationSchedule('sch1')).resolves.toBe(schedule);
    expect(verificationScheduleRepository.deactivate).toHaveBeenCalledWith('sch1');
  });
});

// ===========================================================================
// getDueVerifications
// ===========================================================================

describe('getDueVerifications', () => {
  it('returns an empty array when nothing is due', async () => {
    vi.mocked(verificationScheduleRepository.findDue).mockResolvedValue([]);
    await expect(oversightService.getDueVerifications()).resolves.toEqual([]);
    expect(verificationCompletionRepository.findByScheduleId).not.toHaveBeenCalled();
  });

  it('computes overdue minutes and attaches the most recent completion', async () => {
    const dueAt = new Date(Date.now() - 10 * 60 * 1000); // 10 minutes ago
    const schedule = makeSchedule({ id: 'sch1', nextDueAt: dueAt });
    vi.mocked(verificationScheduleRepository.findDue).mockResolvedValue([schedule]);
    const completion = makeCompletion({ id: 'c1' });
    vi.mocked(verificationCompletionRepository.findByScheduleId).mockResolvedValue([completion]);

    const result = await oversightService.getDueVerifications();

    expect(result).toHaveLength(1);
    expect(result[0].schedule).toBe(schedule);
    expect(result[0].lastCompletion).toBe(completion);
    expect(result[0].dueAt).toBe(dueAt);
    expect(result[0].overdueSinceMinutes).toBeGreaterThanOrEqual(10);
    expect(verificationCompletionRepository.findByScheduleId).toHaveBeenCalledWith('sch1', 1);
  });

  it('uses null lastCompletion when there are no completions', async () => {
    const schedule = makeSchedule({ nextDueAt: new Date() });
    vi.mocked(verificationScheduleRepository.findDue).mockResolvedValue([schedule]);
    vi.mocked(verificationCompletionRepository.findByScheduleId).mockResolvedValue([]);

    const result = await oversightService.getDueVerifications();
    expect(result[0].lastCompletion).toBeNull();
  });
});

// ===========================================================================
// completeVerification
// ===========================================================================

describe('completeVerification', () => {
  it('creates the completion, logs the action and emits when the schedule exists', async () => {
    const completion = makeCompletion({ id: 'c1', status: 'completed' });
    vi.mocked(verificationCompletionRepository.create).mockResolvedValue(completion);
    const schedule = makeSchedule({ id: 'sch1' });
    vi.mocked(verificationScheduleRepository.findById).mockResolvedValue(schedule);

    const cb = vi.fn();
    const unsub = oversightService.onOversightEvent(cb);

    const result = await oversightService.completeVerification({
      scheduleId: 'sch1',
      operatorId: 'op1',
      status: 'completed',
    });

    expect(result).toBe(completion);
    expect(oversightLogRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: 'verification_completed' })
    );
    expect(cb).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'verification_completed', verification: schedule })
    );
    unsub();
  });

  it('still succeeds and logs when the schedule is gone (no verification_completed event)', async () => {
    const completion = makeCompletion();
    vi.mocked(verificationCompletionRepository.create).mockResolvedValue(completion);
    vi.mocked(verificationScheduleRepository.findById).mockResolvedValue(null);

    const cb = vi.fn();
    const unsub = oversightService.onOversightEvent(cb);

    await expect(
      oversightService.completeVerification({
        scheduleId: 'sch1',
        operatorId: 'op1',
        status: 'skipped',
      })
    ).resolves.toBe(completion);

    expect(oversightLogRepository.create).toHaveBeenCalled();
    expect(
      cb.mock.calls.some((c) => (c[0] as { type: string }).type === 'verification_completed')
    ).toBe(false);
    unsub();
  });
});

// ===========================================================================
// createAnomaly
// ===========================================================================

describe('createAnomaly', () => {
  it('creates the anomaly and emits an event without an alert for low severity', async () => {
    const anomaly = makeAnomaly({ severity: 'low' });
    vi.mocked(anomalyRecordRepository.create).mockResolvedValue(anomaly);

    const cb = vi.fn();
    const unsub = oversightService.onOversightEvent(cb);

    const result = await oversightService.createAnomaly({
      robotId: 'r1',
      anomalyType: 'confidence_drop',
      severity: 'low',
      description: 'desc',
    });

    expect(result).toBe(anomaly);
    expect(alertService.createAlert).not.toHaveBeenCalled();
    expect(cb).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'anomaly_detected', robotId: 'r1' })
    );
    unsub();
  });

  it('creates a critical alert for critical severity anomalies', async () => {
    const anomaly = makeAnomaly({ severity: 'critical', anomalyType: 'safety_warning' });
    vi.mocked(anomalyRecordRepository.create).mockResolvedValue(anomaly);

    await oversightService.createAnomaly({
      robotId: 'r1',
      anomalyType: 'safety_warning',
      severity: 'critical',
      description: 'collision risk',
    });

    expect(alertService.createAlert).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'critical', source: 'robot', sourceId: 'r1' })
    );
  });

  it('maps high severity anomalies to an error alert', async () => {
    vi.mocked(anomalyRecordRepository.create).mockResolvedValue(
      makeAnomaly({ severity: 'high' })
    );

    await oversightService.createAnomaly({
      robotId: 'r1',
      anomalyType: 'behavior_drift',
      severity: 'high',
      description: 'drift',
    });

    expect(alertService.createAlert).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'error' })
    );
  });
});

// ===========================================================================
// anomaly reads
// ===========================================================================

describe('anomaly reads', () => {
  it('getActiveAnomalies scopes to a robot when robotId is supplied', async () => {
    const list = [makeAnomaly()];
    vi.mocked(anomalyRecordRepository.findActiveByRobotId).mockResolvedValue(list);
    await expect(oversightService.getActiveAnomalies('r1')).resolves.toBe(list);
    expect(anomalyRecordRepository.findActiveByRobotId).toHaveBeenCalledWith('r1');
    expect(anomalyRecordRepository.findAllActive).not.toHaveBeenCalled();
  });

  it('getActiveAnomalies returns all active anomalies when no robotId', async () => {
    vi.mocked(anomalyRecordRepository.findAllActive).mockResolvedValue([]);
    await oversightService.getActiveAnomalies();
    expect(anomalyRecordRepository.findAllActive).toHaveBeenCalled();
    expect(anomalyRecordRepository.findActiveByRobotId).not.toHaveBeenCalled();
  });

  it('getAnomalies passes query params through', async () => {
    const resp = { anomalies: [], total: 0, page: 1, limit: 50, totalPages: 0 };
    vi.mocked(anomalyRecordRepository.findAll).mockResolvedValue(resp);
    await expect(oversightService.getAnomalies({ severity: 'high' })).resolves.toBe(resp);
    expect(anomalyRecordRepository.findAll).toHaveBeenCalledWith({ severity: 'high' });
  });

  it('getUnacknowledgedAnomalies delegates to the repository', async () => {
    vi.mocked(anomalyRecordRepository.findUnacknowledged).mockResolvedValue([]);
    await oversightService.getUnacknowledgedAnomalies();
    expect(anomalyRecordRepository.findUnacknowledged).toHaveBeenCalled();
  });
});

// ===========================================================================
// acknowledgeAnomaly
// ===========================================================================

describe('acknowledgeAnomaly', () => {
  it('returns null and does not log when the anomaly is missing', async () => {
    vi.mocked(anomalyRecordRepository.acknowledge).mockResolvedValue(null);
    await expect(oversightService.acknowledgeAnomaly('x', 'op1')).resolves.toBeNull();
    expect(oversightLogRepository.create).not.toHaveBeenCalled();
  });

  it('acknowledges, logs and emits an event', async () => {
    const anomaly = makeAnomaly({ id: 'a1', robotId: 'r1', acknowledgedBy: 'op1' });
    vi.mocked(anomalyRecordRepository.acknowledge).mockResolvedValue(anomaly);

    const cb = vi.fn();
    const unsub = oversightService.onOversightEvent(cb);

    const result = await oversightService.acknowledgeAnomaly('a1', 'op1');

    expect(result).toBe(anomaly);
    expect(anomalyRecordRepository.acknowledge).toHaveBeenCalledWith('a1', 'op1');
    expect(oversightLogRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: 'anomaly_acknowledged', operatorId: 'op1' })
    );
    expect(cb).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'anomaly_acknowledged' })
    );
    unsub();
  });
});

// ===========================================================================
// resolveAnomaly
// ===========================================================================

describe('resolveAnomaly', () => {
  it('returns null and does not log when the anomaly is missing', async () => {
    vi.mocked(anomalyRecordRepository.resolve).mockResolvedValue(null);
    await expect(oversightService.resolveAnomaly('x', 'fixed', 'op1')).resolves.toBeNull();
    expect(oversightLogRepository.create).not.toHaveBeenCalled();
  });

  it('resolves, logs and emits an event', async () => {
    const anomaly = makeAnomaly({ id: 'a1', isActive: false, resolution: 'fixed' });
    vi.mocked(anomalyRecordRepository.resolve).mockResolvedValue(anomaly);

    const cb = vi.fn();
    const unsub = oversightService.onOversightEvent(cb);

    const result = await oversightService.resolveAnomaly('a1', 'fixed', 'op1');

    expect(result).toBe(anomaly);
    expect(anomalyRecordRepository.resolve).toHaveBeenCalledWith('a1', 'fixed');
    expect(oversightLogRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: 'anomaly_resolved' })
    );
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ type: 'anomaly_resolved' }));
    unsub();
  });
});

// ===========================================================================
// logAction & log reads
// ===========================================================================

describe('logAction and log reads', () => {
  it('logAction persists the log and emits an oversight_action event', async () => {
    const log = makeLog({ id: 'log1' });
    vi.mocked(oversightLogRepository.create).mockResolvedValue(log);

    const cb = vi.fn();
    const unsub = oversightService.onOversightEvent(cb);

    const result = await oversightService.logAction({
      actionType: 'decision_overridden',
      operatorId: 'op1',
      reason: 'override',
    });

    expect(result).toBe(log);
    expect(cb).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'oversight_action', log })
    );
    unsub();
  });

  it('getOversightLogs passes params through', async () => {
    const resp = { logs: [], total: 0, page: 1, limit: 50, totalPages: 0 };
    vi.mocked(oversightLogRepository.findAll).mockResolvedValue(resp);
    await expect(oversightService.getOversightLogs({ robotId: 'r1' })).resolves.toBe(resp);
    expect(oversightLogRepository.findAll).toHaveBeenCalledWith({ robotId: 'r1' });
  });

  it('getRecentLogs uses the supplied limit', async () => {
    vi.mocked(oversightLogRepository.findRecent).mockResolvedValue([]);
    await oversightService.getRecentLogs(5);
    expect(oversightLogRepository.findRecent).toHaveBeenCalledWith(5);
  });
});

// ===========================================================================
// getRobotCapabilitiesSummary
// ===========================================================================

describe('getRobotCapabilitiesSummary', () => {
  it('returns null when the robot does not exist', async () => {
    vi.mocked(robotManager.getRobot).mockResolvedValue(undefined);
    await expect(oversightService.getRobotCapabilitiesSummary('rX')).resolves.toBeNull();
  });

  it('summarizes capabilities, limitations and anomaly-derived warnings/errors', async () => {
    const robot = makeRobot({
      id: 'r1',
      status: 'offline',
      batteryLevel: 10,
      capabilities: ['navigation', 'unknown_cap'],
      firmware: '1.2.3',
    });
    vi.mocked(robotManager.getRobot).mockResolvedValue(robot);
    vi.mocked(manualControlSessionRepository.findActiveByRobotId).mockResolvedValue(null);
    vi.mocked(anomalyRecordRepository.findActiveByRobotId).mockResolvedValue([
      makeAnomaly({ severity: 'high', description: 'critical issue' }),
      makeAnomaly({ severity: 'low', description: 'minor issue' }),
    ]);

    const result = await oversightService.getRobotCapabilitiesSummary('r1');

    expect(result).not.toBeNull();
    expect(result!.firmware).toBe('1.2.3');
    expect(result!.operatingMode).toBe('automatic');
    expect(result!.isInManualMode).toBe(false);
    // offline + low battery -> two limitations
    expect(result!.limitations).toContain('Robot is offline');
    expect(result!.limitations.some((l) => l.includes('Low battery'))).toBe(true);
    // capability descriptions: known mapped, unknown falls back to its name
    expect(result!.capabilities.find((c) => c.name === 'navigation')?.description).toBe(
      'Autonomous navigation and path planning'
    );
    expect(result!.capabilities.find((c) => c.name === 'unknown_cap')?.description).toBe(
      'unknown_cap'
    );
    // offline robot -> capabilities not available
    expect(result!.capabilities.every((c) => c.isAvailable === false)).toBe(true);
    // anomaly severity routing
    expect(result!.errors).toContain('critical issue');
    expect(result!.warnings).toContain('minor issue');
  });

  it('reports manual mode based on the active session speed limit', async () => {
    const robot = makeRobot({ id: 'r1', status: 'online', batteryLevel: 80 });
    vi.mocked(robotManager.getRobot).mockResolvedValue(robot);
    vi.mocked(manualControlSessionRepository.findActiveByRobotId).mockResolvedValue(
      makeSession({ speedLimitMmPerSec: 1000 })
    );
    vi.mocked(anomalyRecordRepository.findActiveByRobotId).mockResolvedValue([]);

    const result = await oversightService.getRobotCapabilitiesSummary('r1');

    expect(result!.isInManualMode).toBe(true);
    expect(result!.operatingMode).toBe('manual_full_speed');
    expect(result!.limitations.some((l) => l.includes('manual control mode'))).toBe(true);
  });
});

// ===========================================================================
// getFleetCapabilitiesOverview
// ===========================================================================

describe('getFleetCapabilitiesOverview', () => {
  it('aggregates robot, session, anomaly and verification data', async () => {
    const robots = [
      makeRobot({ id: 'r1', status: 'online', batteryLevel: 100 }),
      makeRobot({ id: 'r2', status: 'busy', batteryLevel: 50 }),
      makeRobot({ id: 'r3', status: 'offline', batteryLevel: null }),
    ];
    vi.mocked(robotManager.listRobots).mockResolvedValue(robots);
    vi.mocked(manualControlSessionRepository.findAllActive).mockResolvedValue([
      makeSession({ robotId: 'r1', speedLimitMmPerSec: 250 }),
    ]);
    vi.mocked(anomalyRecordRepository.findAllActive).mockResolvedValue([
      makeAnomaly({ robotId: 'r2' }),
    ]);
    const overdue = new Date(Date.now() - 1000);
    vi.mocked(verificationScheduleRepository.findDue).mockResolvedValue([
      makeSchedule({ isOverdue: true, nextDueAt: overdue }),
    ]);
    vi.mocked(anomalyRecordRepository.getCountsBySeverity).mockResolvedValue({
      low: 1,
      medium: 0,
      high: 0,
      critical: 0,
    });

    const result = await oversightService.getFleetCapabilitiesOverview();

    expect(result.totalRobots).toBe(3);
    expect(result.onlineRobots).toBe(2); // non-offline
    expect(result.robotsInManualMode).toBe(1);
    expect(result.robotsWithAnomalies).toBe(1);
    expect(result.totalActiveAnomalies).toBe(1);
    expect(result.statusBreakdown).toEqual({ online: 1, busy: 1, offline: 1 });
    expect(result.modeBreakdown.automatic).toBe(2);
    expect(result.modeBreakdown.manual_reduced_speed).toBe(1);
    expect(result.overdueVerifications).toBe(1);
    // averageBatteryLevel from robots with battery (100, 50) -> 75
    expect(result.averageBatteryLevel).toBe(75);
  });

  it('returns null averageBatteryLevel when no robot reports battery', async () => {
    vi.mocked(robotManager.listRobots).mockResolvedValue([
      makeRobot({ id: 'r1', batteryLevel: null }),
    ]);
    vi.mocked(manualControlSessionRepository.findAllActive).mockResolvedValue([]);
    vi.mocked(anomalyRecordRepository.findAllActive).mockResolvedValue([]);
    vi.mocked(verificationScheduleRepository.findDue).mockResolvedValue([]);
    vi.mocked(anomalyRecordRepository.getCountsBySeverity).mockResolvedValue({
      low: 0,
      medium: 0,
      high: 0,
      critical: 0,
    });

    const result = await oversightService.getFleetCapabilitiesOverview();
    expect(result.averageBatteryLevel).toBeNull();
  });
});

// ===========================================================================
// getDashboardStats
// ===========================================================================

describe('getDashboardStats', () => {
  it('aggregates counts and recent activity from all repositories', async () => {
    vi.mocked(manualControlSessionRepository.countActive).mockResolvedValue(2);
    vi.mocked(manualControlSessionRepository.countToday).mockResolvedValue(5);
    vi.mocked(anomalyRecordRepository.countActive).mockResolvedValue(3);
    vi.mocked(anomalyRecordRepository.countUnacknowledged).mockResolvedValue(1);
    vi.mocked(anomalyRecordRepository.getCountsBySeverity).mockResolvedValue({
      low: 1,
      medium: 1,
      high: 1,
      critical: 0,
    });
    vi.mocked(anomalyRecordRepository.getCountsByType).mockResolvedValue({
      confidence_drop: 1,
      behavior_drift: 0,
      performance_degradation: 0,
      safety_warning: 0,
      communication_loss: 0,
      sensor_malfunction: 0,
    });
    vi.mocked(verificationScheduleRepository.countActive).mockResolvedValue(4);
    vi.mocked(verificationScheduleRepository.findDue).mockResolvedValue([
      makeSchedule({ isOverdue: true }),
      makeSchedule({ isOverdue: false }),
    ]);
    vi.mocked(verificationCompletionRepository.countToday).mockResolvedValue(7);
    vi.mocked(verificationCompletionRepository.getComplianceRate).mockResolvedValue(88);
    const recentLogs = [makeLog()];
    vi.mocked(oversightLogRepository.findRecent).mockResolvedValue(recentLogs);
    const recentAnomalies = [makeAnomaly()];
    vi.mocked(anomalyRecordRepository.findAll).mockResolvedValue({
      anomalies: recentAnomalies,
      total: 1,
      page: 1,
      limit: 5,
      totalPages: 1,
    });

    const result = await oversightService.getDashboardStats();

    expect(result.activeManualSessions).toBe(2);
    expect(result.manualSessionsToday).toBe(5);
    expect(result.activeAnomalies).toBe(3);
    expect(result.unacknowledgedAnomalies).toBe(1);
    expect(result.totalVerificationSchedules).toBe(4);
    expect(result.overdueVerifications).toBe(1); // only the overdue one
    expect(result.completedVerificationsToday).toBe(7);
    expect(result.verificationComplianceRate).toBe(88);
    expect(result.recentLogs).toBe(recentLogs);
    expect(result.recentAnomalies).toBe(recentAnomalies);
  });
});

// ===========================================================================
// Event subscription handling
// ===========================================================================

describe('onOversightEvent', () => {
  it('unsubscribes so the callback stops receiving events', async () => {
    const cb = vi.fn();
    const unsub = oversightService.onOversightEvent(cb);

    await oversightService.logAction({
      actionType: 'robot_stopped',
      operatorId: 'op1',
      reason: 'one',
    });
    expect(cb).toHaveBeenCalledTimes(1);

    unsub();
    await oversightService.logAction({
      actionType: 'robot_stopped',
      operatorId: 'op1',
      reason: 'two',
    });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('isolates a throwing subscriber from the others', async () => {
    const bad = vi.fn(() => {
      throw new Error('callback boom');
    });
    const good = vi.fn();
    const u1 = oversightService.onOversightEvent(bad);
    const u2 = oversightService.onOversightEvent(good);

    await expect(
      oversightService.logAction({
        actionType: 'fleet_stopped',
        operatorId: 'op1',
        reason: 'isolation',
      })
    ).resolves.toBeDefined();
    expect(good).toHaveBeenCalled();

    u1();
    u2();
  });
});

// ===========================================================================
// lifecycle
// ===========================================================================

describe('lifecycle', () => {
  it('initialize and shutdown are idempotent and do not throw', () => {
    expect(() => oversightService.initialize()).not.toThrow();
    // second initialize is a no-op
    expect(() => oversightService.initialize()).not.toThrow();
    expect(() => oversightService.shutdown()).not.toThrow();
  });
});
