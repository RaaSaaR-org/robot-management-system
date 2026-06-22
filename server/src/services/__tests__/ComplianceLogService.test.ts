/**
 * @file ComplianceLogService.test.ts
 * @description Unit tests for ComplianceLogService — session management, logging, retrieval,
 *              verification, metrics, and command-interpretation integration.
 * @feature compliance
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  ComplianceLog,
  ComplianceLogListResponse,
  HashChainVerificationResult,
  ComplianceMetricsSummary,
} from '../../types/compliance.types.js';

// ---------------------------------------------------------------------------
// Mocks for external boundaries — the repository is the only I/O boundary.
// ---------------------------------------------------------------------------

vi.mock('../../repositories/ComplianceLogRepository.js', () => ({
  complianceLogRepository: {
    create: vi.fn(),
    findById: vi.fn(),
    findAll: vi.fn(),
    findBySessionId: vi.fn(),
    findByDecisionId: vi.fn(),
    getAccessHistory: vi.fn(),
    verifyHashChain: vi.fn(),
    getEventTypeCounts: vi.fn(),
    getMetricsSummary: vi.fn(),
    count: vi.fn(),
  },
}));

import { ComplianceLogService } from '../ComplianceLogService.js';
import { complianceLogRepository as _repo } from '../../repositories/ComplianceLogRepository.js';

const repo = vi.mocked(_repo, true);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeLog(overrides: Partial<ComplianceLog> = {}): ComplianceLog {
  return {
    id: 'log-1',
    sessionId: 'sess-1',
    robotId: 'r1',
    operatorId: null,
    eventType: 'ai_decision',
    severity: 'info',
    payload: { description: 'd' },
    modelVersion: null,
    modelHash: null,
    inputHash: null,
    outputHash: null,
    previousHash: '',
    currentHash: 'h1',
    decisionId: null,
    timestamp: new Date('2026-01-01T00:00:00Z'),
    immutable: true,
    ...overrides,
  } as ComplianceLog;
}

// Fresh service per test so the module-level session maps do not leak between tests.
let service: ComplianceLogService;

beforeEach(() => {
  vi.clearAllMocks();
  repo.create.mockResolvedValue(makeLog());
  service = new ComplianceLogService();
});

// ===========================================================================
// Session management
// ===========================================================================

describe('startSession', () => {
  it('creates a new session with a generated id and zero log count', () => {
    const res = service.startSession('robotA');
    expect(res.robotId).toBe('robotA');
    expect(res.sessionId).toMatch(/^[0-9a-f-]+$/);
    expect(res.startedAt).toBeInstanceOf(Date);

    const session = service.getSession(res.sessionId);
    expect(session?.logCount).toBe(0);
  });

  it('returns the existing session if the robot already has one', () => {
    const first = service.startSession('robotA');
    const second = service.startSession('robotA');
    expect(second.sessionId).toBe(first.sessionId);
    expect(second.startedAt).toEqual(first.startedAt);
  });
});

describe('endSession', () => {
  it('ends an active session, sets endedAt, and removes it from lookups', () => {
    const { sessionId, robotId } = service.startSession('robotA');
    const ended = service.endSession(sessionId);

    expect(ended).not.toBeNull();
    expect(ended?.endedAt).toBeInstanceOf(Date);
    expect(service.getSession(sessionId)).toBeNull();
    expect(service.getSessionByRobotId(robotId)).toBeNull();
  });

  it('returns null for an unknown session id', () => {
    expect(service.endSession('does-not-exist')).toBeNull();
  });
});

describe('getOrCreateSession', () => {
  it('creates a session when none exists', () => {
    const res = service.getOrCreateSession('robotB');
    expect(res.robotId).toBe('robotB');
    expect(service.getSessionByRobotId('robotB')?.sessionId).toBe(res.sessionId);
  });

  it('reuses an existing session', () => {
    const created = service.startSession('robotB');
    const got = service.getOrCreateSession('robotB');
    expect(got.sessionId).toBe(created.sessionId);
  });
});

describe('getSession / getSessionByRobotId', () => {
  it('returns null when nothing is registered', () => {
    expect(service.getSession('nope')).toBeNull();
    expect(service.getSessionByRobotId('nope')).toBeNull();
  });

  it('returns the session for a known robot', () => {
    const { sessionId } = service.startSession('robotC');
    expect(service.getSessionByRobotId('robotC')?.sessionId).toBe(sessionId);
  });
});

// ===========================================================================
// Logging methods
// ===========================================================================

describe('logAIDecision', () => {
  it('creates an ai_decision log and increments the session count', async () => {
    const { sessionId } = service.startSession('r1');
    repo.create.mockResolvedValue(makeLog({ eventType: 'ai_decision' }));

    const result = await service.logAIDecision({
      sessionId,
      robotId: 'r1',
      payload: { description: 'decided to move' },
      input: 'go forward',
      output: 'move',
    });

    expect(result.eventType).toBe('ai_decision');
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId,
        robotId: 'r1',
        eventType: 'ai_decision',
        severity: 'info',
        inputHash: expect.any(String),
        outputHash: expect.any(String),
      }),
    );
    expect(service.getSession(sessionId)?.logCount).toBe(1);
  });

  it('omits input/output hashes when not provided', async () => {
    await service.logAIDecision({
      sessionId: 's',
      robotId: 'r1',
      payload: { description: 'd' },
    });
    const arg = repo.create.mock.calls[0][0];
    expect(arg.inputHash).toBeUndefined();
    expect(arg.outputHash).toBeUndefined();
  });

  it('propagates repository errors', async () => {
    repo.create.mockRejectedValue(new Error('db down'));
    await expect(
      service.logAIDecision({ sessionId: 's', robotId: 'r1', payload: { description: 'd' } }),
    ).rejects.toThrow('db down');
  });
});

describe('logSafetyAction', () => {
  it('uses critical severity when resolution is required', async () => {
    await service.logSafetyAction({
      sessionId: 's',
      robotId: 'r1',
      payload: {
        description: 'estop',
        actionType: 'emergency_stop',
        triggerReason: 'collision',
        resolutionRequired: true,
      },
    });
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'safety_action', severity: 'critical' }),
    );
  });

  it('uses warning severity when no resolution is required', async () => {
    await service.logSafetyAction({
      sessionId: 's',
      robotId: 'r1',
      payload: {
        description: 'slowdown',
        actionType: 'speed_limit',
        triggerReason: 'proximity',
        resolutionRequired: false,
      },
    });
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'warning' }),
    );
  });
});

describe('logCommandExecution', () => {
  it('maps failure status to error severity', async () => {
    await service.logCommandExecution({
      sessionId: 's',
      robotId: 'r1',
      payload: { description: 'cmd', commandType: 'move', executionStatus: 'failure' },
    });
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'command_execution', severity: 'error' }),
    );
  });

  it('maps partial status to warning severity', async () => {
    await service.logCommandExecution({
      sessionId: 's',
      robotId: 'r1',
      payload: { description: 'cmd', commandType: 'move', executionStatus: 'partial' },
    });
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ severity: 'warning' }));
  });

  it('maps success status to info severity', async () => {
    await service.logCommandExecution({
      sessionId: 's',
      robotId: 'r1',
      payload: { description: 'cmd', commandType: 'move', executionStatus: 'success' },
    });
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ severity: 'info' }));
  });

  it('respects an explicit severity override', async () => {
    await service.logCommandExecution({
      sessionId: 's',
      robotId: 'r1',
      payload: { description: 'cmd', commandType: 'move', executionStatus: 'failure' },
      severity: 'debug',
    });
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ severity: 'debug' }));
  });
});

describe('logSystemEvent', () => {
  it('defaults to info severity and system_event type', async () => {
    await service.logSystemEvent({
      sessionId: 's',
      robotId: 'r1',
      payload: { description: 'boot', eventName: 'startup' },
    });
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'system_event', severity: 'info' }),
    );
  });
});

describe('logAccess', () => {
  it('records an access_audit log with the operator id', async () => {
    await service.logAccess({
      sessionId: 's',
      robotId: 'r1',
      operatorId: 'op-9',
      payload: {
        description: 'viewed log',
        resourceType: 'compliance_log',
        resourceId: 'log-1',
        action: 'view',
        result: 'allowed',
      },
    });
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'access_audit',
        operatorId: 'op-9',
        severity: 'info',
      }),
    );
  });
});

// ===========================================================================
// Retrieval methods
// ===========================================================================

describe('getLog', () => {
  it('delegates to the repository with audit context', async () => {
    const log = makeLog({ id: 'abc' });
    repo.findById.mockResolvedValue(log);

    const result = await service.getLog('abc', 'user-1', '1.2.3.4', 'agent');
    expect(result).toBe(log);
    expect(repo.findById).toHaveBeenCalledWith('abc', 'user-1', '1.2.3.4', 'agent');
  });

  it('returns null when the log is not found', async () => {
    repo.findById.mockResolvedValue(null);
    expect(await service.getLog('missing')).toBeNull();
  });
});

describe('listLogs', () => {
  it('returns the paginated list from the repository', async () => {
    const response: ComplianceLogListResponse = {
      logs: [makeLog()],
      total: 1,
      page: 1,
      limit: 50,
      totalPages: 1,
    };
    repo.findAll.mockResolvedValue(response);

    const result = await service.listLogs({ robotId: 'r1' });
    expect(result).toBe(response);
    expect(repo.findAll).toHaveBeenCalledWith({ robotId: 'r1' });
  });
});

describe('getLogsBySession / getLogsByDecision / getLogAccessHistory', () => {
  it('returns logs for a session', async () => {
    const logs = [makeLog()];
    repo.findBySessionId.mockResolvedValue(logs);
    expect(await service.getLogsBySession('sess-1')).toBe(logs);
    expect(repo.findBySessionId).toHaveBeenCalledWith('sess-1');
  });

  it('returns logs for a decision', async () => {
    const logs = [makeLog({ decisionId: 'd-1' })];
    repo.findByDecisionId.mockResolvedValue(logs);
    expect(await service.getLogsByDecision('d-1')).toBe(logs);
    expect(repo.findByDecisionId).toHaveBeenCalledWith('d-1');
  });

  it('returns access history for a log', async () => {
    const history = [
      {
        id: 'a1',
        logId: 'log-1',
        userId: 'u1',
        accessType: 'view' as const,
        ipAddress: null,
        userAgent: null,
        timestamp: new Date(),
      },
    ];
    repo.getAccessHistory.mockResolvedValue(history);
    expect(await service.getLogAccessHistory('log-1')).toBe(history);
    expect(repo.getAccessHistory).toHaveBeenCalledWith('log-1');
  });
});

// ===========================================================================
// Verification
// ===========================================================================

describe('verifyIntegrity', () => {
  it('returns a valid result', async () => {
    const result: HashChainVerificationResult = {
      isValid: true,
      totalLogs: 3,
      verifiedLogs: 3,
      firstLogTimestamp: new Date(),
      lastLogTimestamp: new Date(),
      brokenLinks: [],
      verifiedAt: new Date(),
    };
    repo.verifyHashChain.mockResolvedValue(result);

    const start = new Date('2026-01-01');
    const end = new Date('2026-02-01');
    const res = await service.verifyIntegrity(start, end);

    expect(res.isValid).toBe(true);
    expect(repo.verifyHashChain).toHaveBeenCalledWith(start, end);
  });

  it('returns an invalid result with broken links', async () => {
    const result: HashChainVerificationResult = {
      isValid: false,
      totalLogs: 2,
      verifiedLogs: 1,
      firstLogTimestamp: new Date(),
      lastLogTimestamp: new Date(),
      brokenLinks: [
        {
          logId: 'bad',
          expectedHash: 'x',
          actualPreviousHash: 'y',
          timestamp: new Date(),
        },
      ],
      verifiedAt: new Date(),
    };
    repo.verifyHashChain.mockResolvedValue(result);

    const res = await service.verifyIntegrity();
    expect(res.isValid).toBe(false);
    expect(res.brokenLinks).toHaveLength(1);
  });
});

// ===========================================================================
// Metrics
// ===========================================================================

describe('metrics methods', () => {
  it('getEventTypeCounts delegates to the repository', async () => {
    const counts = [{ eventType: 'ai_decision' as const, count: 5, lastOccurrence: new Date() }];
    repo.getEventTypeCounts.mockResolvedValue(counts);
    const start = new Date('2026-01-01');
    expect(await service.getEventTypeCounts(start)).toBe(counts);
    expect(repo.getEventTypeCounts).toHaveBeenCalledWith(start, undefined);
  });

  it('getMetricsSummary delegates to the repository', async () => {
    const summary: ComplianceMetricsSummary = {
      totalLogs: 10,
      eventTypeCounts: [],
      severityCounts: { debug: 0, info: 8, warning: 1, error: 1, critical: 0 },
      uniqueSessions: 2,
      uniqueRobots: 1,
      dateRange: { start: new Date(), end: new Date() },
    };
    repo.getMetricsSummary.mockResolvedValue(summary);
    expect(await service.getMetricsSummary()).toBe(summary);
  });

  it('getLogCount delegates to the repository count', async () => {
    repo.count.mockResolvedValue(42);
    expect(await service.getLogCount({ robotId: 'r1' })).toBe(42);
    expect(repo.count).toHaveBeenCalledWith({ robotId: 'r1' });
  });
});

// ===========================================================================
// Command interpreter integration
// ===========================================================================

describe('logFromCommandInterpretation', () => {
  it('auto-creates a session and logs an ai_decision with model hash and warning severity', async () => {
    repo.create.mockResolvedValue(makeLog({ eventType: 'ai_decision' }));

    const result = await service.logFromCommandInterpretation({
      robotId: 'r99',
      originalText: 'move to dock',
      commandType: 'navigate',
      confidence: 0.9,
      safetyClassification: 'dangerous',
      warnings: ['near humans'],
      modelUsed: 'gemini-2.5-flash',
      decisionId: 'dec-1',
    });

    expect(result.eventType).toBe('ai_decision');
    // session was created for the robot
    expect(service.getSessionByRobotId('r99')).not.toBeNull();

    const arg = repo.create.mock.calls[0][0];
    expect(arg.eventType).toBe('ai_decision');
    expect(arg.severity).toBe('warning'); // dangerous -> warning
    expect(arg.modelVersion).toBe('gemini-2.5-flash');
    expect(arg.modelHash).toEqual(expect.any(String));
    expect(arg.decisionId).toBe('dec-1');
    const payload = arg.payload as { safetyClassification?: string; reasoning?: string[] };
    expect(payload.safetyClassification).toBe('dangerous');
    expect(payload.reasoning).toEqual(expect.arrayContaining([expect.stringContaining('navigate')]));
  });

  it('uses info severity for non-dangerous classifications', async () => {
    await service.logFromCommandInterpretation({
      robotId: 'r100',
      originalText: 'stop',
      commandType: 'halt',
      confidence: 0.99,
      safetyClassification: 'safe',
      warnings: [],
      modelUsed: 'model-x',
      decisionId: 'dec-2',
    });
    expect(repo.create.mock.calls[0][0].severity).toBe('info');
  });

  it('reuses an existing session for the robot', async () => {
    const existing = service.startSession('r101');
    await service.logFromCommandInterpretation({
      robotId: 'r101',
      originalText: 'go',
      commandType: 'move',
      confidence: 0.5,
      safetyClassification: 'caution',
      warnings: [],
      modelUsed: 'm',
      decisionId: 'd',
    });
    expect(repo.create.mock.calls[0][0].sessionId).toBe(existing.sessionId);
  });
});
