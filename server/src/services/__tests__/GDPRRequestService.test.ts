/**
 * @file GDPRRequestService.test.ts
 * @description Unit tests for GDPRRequestService — GDPR data subject requests (Art. 15-22):
 *   request creation, status transitions, queries, data export, erasure eligibility/execution, metrics, SLA.
 * @feature gdpr
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks for external boundaries.
//   GDPRRequestService imports:
//     - { prisma } from '../database/index.js'   (the DB client)
//     - { legalHoldService } from './LegalHoldService.js'
//     - { v4 as uuidv4 } from 'uuid'
// All are mocked so no real DB / FS / network is touched.
// ---------------------------------------------------------------------------

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    gDPRRequest: {
      create: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      deleteMany: vi.fn(),
      groupBy: vi.fn(),
    },
    gDPRRequestStatusHistory: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    decision: {
      findUnique: vi.fn(),
    },
    aDMReviewQueue: {
      create: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    complianceLog: {
      findMany: vi.fn(),
      count: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    robotCommand: {
      findMany: vi.fn(),
    },
    alert: {
      findMany: vi.fn(),
    },
    userConsent: {
      findMany: vi.fn(),
      count: vi.fn(),
      deleteMany: vi.fn(),
    },
    dataRestriction: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

vi.mock('../../database/index.js', () => ({
  prisma: prismaMock,
}));

const { legalHoldServiceMock } = vi.hoisted(() => ({
  legalHoldServiceMock: {
    getLogsUnderHold: vi.fn(),
  },
}));

vi.mock('../LegalHoldService.js', () => ({
  legalHoldService: legalHoldServiceMock,
}));

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'fixed-uuid-token'),
}));

// TASK-197: erasure reaches the fleet. Mocked here so the DB-side assertions
// stay about the DB — the fleet pass has its own test file.
const { robotMemoryErasureMock } = vi.hoisted(() => ({
  robotMemoryErasureMock: {
    eraseFleetMemory: vi.fn(),
  },
}));

vi.mock('../RobotMemoryErasureService.js', () => ({
  robotMemoryErasureService: robotMemoryErasureMock,
  RobotMemoryErasureService: class {},
}));

import {
  GDPRRequestService,
  gdprRequestService,
  ROBOT_MEMORY_BLOCKED_BY_FLEET_HOLD,
  ROBOT_MEMORY_BLOCKED_BY_LEGAL_HOLD,
  ROBOT_MEMORY_FLEET_UNKNOWN,
  ROBOT_MEMORY_HOLD_CHECK_FAILED,
  ROBOT_MEMORY_REQUIRES_OPT_IN,
} from '../GDPRRequestService.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOW = new Date('2026-06-22T00:00:00.000Z');

/** A row shaped like prisma's GDPRRequest record (requestData is a JSON string). */
function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'req-1',
    userId: 'user-1',
    requestType: 'access',
    status: 'pending',
    submittedAt: NOW,
    acknowledgedAt: null,
    slaDeadline: new Date('2026-07-22T00:00:00.000Z'),
    completedAt: null,
    requestData: JSON.stringify({ format: 'json' }),
    responseData: null,
    verificationToken: null,
    verificationExpires: null,
    verifiedAt: null,
    assignedTo: null,
    internalNotes: null,
    rejectionReason: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // status-history writes happen on most paths; make them succeed by default
  prismaMock.gDPRRequestStatusHistory.create.mockResolvedValue({});
  // Default: a fleet with nothing to erase.
  robotMemoryErasureMock.eraseFleetMemory.mockResolvedValue({
    attempted: 0,
    succeeded: 0,
    failed: 0,
    removed: 0,
    outcomes: [],
  });
});

// ===========================================================================
// createAccessRequest (and the shared createRequest path)
// ===========================================================================

describe('createAccessRequest', () => {
  it('creates a pending access request with an SLA deadline and seeds status history', async () => {
    const row = makeRow({ requestType: 'access' });
    prismaMock.gDPRRequest.create.mockResolvedValue(row);

    const result = await gdprRequestService.createAccessRequest('user-1', { format: 'json' });

    expect(result.id).toBe('req-1');
    expect(result.requestType).toBe('access');
    expect(result.status).toBe('pending');
    // requestData is parsed back into an object on the mapped result
    expect(result.requestData).toEqual({ format: 'json' });

    // create was called with serialized requestData and status pending
    const createArg = prismaMock.gDPRRequest.create.mock.calls[0][0];
    expect(createArg.data.userId).toBe('user-1');
    expect(createArg.data.requestType).toBe('access');
    expect(createArg.data.status).toBe('pending');
    expect(createArg.data.slaDeadline).toBeInstanceOf(Date);
    expect(typeof createArg.data.requestData).toBe('string');

    // initial history entry: null -> pending
    expect(prismaMock.gDPRRequestStatusHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ fromStatus: null, toStatus: 'pending' }),
      }),
    );
  });

  it('works with no input (defaults to empty request data)', async () => {
    prismaMock.gDPRRequest.create.mockResolvedValue(makeRow({ requestData: '{}' }));
    const result = await gdprRequestService.createAccessRequest('user-1');
    expect(result.requestData).toEqual({});
  });

  it('propagates a DB failure from create', async () => {
    prismaMock.gDPRRequest.create.mockRejectedValue(new Error('db down'));
    await expect(gdprRequestService.createAccessRequest('user-1')).rejects.toThrow('db down');
  });
});

// ===========================================================================
// createRectificationRequest / createRestrictionRequest / createPortabilityRequest /
// createObjectionRequest  (thin wrappers over createRequest)
// ===========================================================================

describe('typed request wrappers', () => {
  it('createRectificationRequest sets requestType=rectification', async () => {
    prismaMock.gDPRRequest.create.mockResolvedValue(makeRow({ requestType: 'rectification' }));
    const result = await gdprRequestService.createRectificationRequest('user-1', {
      fields: [{ field: 'name', currentValue: 'a', newValue: 'b', reason: 'typo' }],
    });
    expect(result.requestType).toBe('rectification');
    expect(prismaMock.gDPRRequest.create.mock.calls[0][0].data.requestType).toBe('rectification');
  });

  it('createRestrictionRequest sets requestType=restriction', async () => {
    prismaMock.gDPRRequest.create.mockResolvedValue(makeRow({ requestType: 'restriction' }));
    const result = await gdprRequestService.createRestrictionRequest('user-1', {
      scope: 'all',
      reason: 'accuracy_disputed',
    });
    expect(result.requestType).toBe('restriction');
  });

  it('createPortabilityRequest sets requestType=portability', async () => {
    prismaMock.gDPRRequest.create.mockResolvedValue(makeRow({ requestType: 'portability' }));
    const result = await gdprRequestService.createPortabilityRequest('user-1', { format: 'json' });
    expect(result.requestType).toBe('portability');
  });

  it('createObjectionRequest sets requestType=objection', async () => {
    prismaMock.gDPRRequest.create.mockResolvedValue(makeRow({ requestType: 'objection' }));
    const result = await gdprRequestService.createObjectionRequest('user-1', {
      processingActivity: 'profiling',
      reason: 'no consent',
    });
    expect(result.requestType).toBe('objection');
  });
});

// ===========================================================================
// createErasureRequest
// ===========================================================================

describe('createErasureRequest', () => {
  function stubEligible() {
    // checkErasureEligibility internals: no held logs, no active retention
    legalHoldServiceMock.getLogsUnderHold.mockResolvedValue([]);
    prismaMock.complianceLog.findMany.mockResolvedValue([]); // user logs
    prismaMock.complianceLog.count.mockResolvedValue(0); // active retention + total logs
    prismaMock.user.count.mockResolvedValue(1);
    prismaMock.userConsent.count.mockResolvedValue(0);
  }

  it('throws when erasure is not eligible (logs under legal hold)', async () => {
    legalHoldServiceMock.getLogsUnderHold.mockResolvedValue(['log-1']);
    prismaMock.complianceLog.findMany.mockResolvedValue([{ id: 'log-1' }]);
    prismaMock.complianceLog.count.mockResolvedValue(0);
    prismaMock.user.count.mockResolvedValue(1);
    prismaMock.userConsent.count.mockResolvedValue(0);

    await expect(gdprRequestService.createErasureRequest('user-1')).rejects.toThrow(
      /Erasure not possible/,
    );
    // no request created when ineligible
    expect(prismaMock.gDPRRequest.create).not.toHaveBeenCalled();
  });

  it('creates the request, sets a verification token, and returns awaiting_verification', async () => {
    stubEligible();
    prismaMock.gDPRRequest.create.mockResolvedValue(makeRow({ requestType: 'erasure' }));
    prismaMock.gDPRRequest.update.mockResolvedValue(makeRow({ status: 'awaiting_verification' }));

    const result = await gdprRequestService.createErasureRequest('user-1', { reason: 'leaving' });

    expect(result.status).toBe('awaiting_verification');

    // verification fields written via update (token from mocked uuid)
    const updateArg = prismaMock.gDPRRequest.update.mock.calls[0][0];
    expect(updateArg.where).toEqual({ id: 'req-1' });
    expect(updateArg.data.verificationToken).toBe('fixed-uuid-token');
    expect(updateArg.data.status).toBe('awaiting_verification');
    expect(updateArg.data.verificationExpires).toBeInstanceOf(Date);
  });
});

// ===========================================================================
// createADMReviewRequest
// ===========================================================================

describe('createADMReviewRequest', () => {
  it('throws when the contested decision does not exist', async () => {
    prismaMock.decision.findUnique.mockResolvedValue(null);
    await expect(
      gdprRequestService.createADMReviewRequest('user-1', {
        decisionId: 'd-missing',
        contestReason: 'unfair',
      }),
    ).rejects.toThrow('Decision not found');
    expect(prismaMock.gDPRRequest.create).not.toHaveBeenCalled();
  });

  it('creates the request and enqueues an ADM review entry', async () => {
    prismaMock.decision.findUnique.mockResolvedValue({ id: 'd-1' });
    prismaMock.gDPRRequest.create.mockResolvedValue(makeRow({ requestType: 'adm_review' }));
    prismaMock.aDMReviewQueue.create.mockResolvedValue({});

    const result = await gdprRequestService.createADMReviewRequest('user-1', {
      decisionId: 'd-1',
      contestReason: 'unfair',
      evidence: 'screenshot',
    });

    expect(result.requestType).toBe('adm_review');
    expect(prismaMock.aDMReviewQueue.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          gdprRequestId: 'req-1',
          decisionId: 'd-1',
          userId: 'user-1',
          contestReason: 'unfair',
          userEvidence: 'screenshot',
          status: 'queued',
          priority: 'normal',
        }),
      }),
    );
  });
});

// ===========================================================================
// acknowledgeRequest / startProcessing
// ===========================================================================

describe('acknowledgeRequest', () => {
  it('sets status=acknowledged, assigns admin, and records history', async () => {
    prismaMock.gDPRRequest.update.mockResolvedValue(
      makeRow({ status: 'acknowledged', assignedTo: 'admin-1' }),
    );

    const result = await gdprRequestService.acknowledgeRequest('req-1', 'admin-1');

    expect(result.status).toBe('acknowledged');
    const arg = prismaMock.gDPRRequest.update.mock.calls[0][0];
    expect(arg.data.status).toBe('acknowledged');
    expect(arg.data.assignedTo).toBe('admin-1');
    expect(arg.data.acknowledgedAt).toBeInstanceOf(Date);
    expect(prismaMock.gDPRRequestStatusHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ fromStatus: 'pending', toStatus: 'acknowledged', changedBy: 'admin-1' }),
      }),
    );
  });

  it('propagates errors when the request id does not exist', async () => {
    prismaMock.gDPRRequest.update.mockRejectedValue(new Error('Record not found'));
    await expect(gdprRequestService.acknowledgeRequest('missing', 'admin-1')).rejects.toThrow(
      'Record not found',
    );
  });
});

describe('startProcessing', () => {
  it('sets status=in_progress and records acknowledged->in_progress history', async () => {
    prismaMock.gDPRRequest.update.mockResolvedValue(makeRow({ status: 'in_progress' }));
    const result = await gdprRequestService.startProcessing('req-1', 'admin-1');
    expect(result.status).toBe('in_progress');
    expect(prismaMock.gDPRRequestStatusHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ fromStatus: 'acknowledged', toStatus: 'in_progress' }),
      }),
    );
  });
});

// ===========================================================================
// completeRequest
// ===========================================================================

describe('completeRequest', () => {
  it('throws when the request is not found', async () => {
    prismaMock.gDPRRequest.findUnique.mockResolvedValue(null);
    await expect(gdprRequestService.completeRequest('missing', 'admin-1', {})).rejects.toThrow(
      'Request not found',
    );
    expect(prismaMock.gDPRRequest.update).not.toHaveBeenCalled();
  });

  it('completes the request, stores response data, and records history from prior status', async () => {
    prismaMock.gDPRRequest.findUnique.mockResolvedValue(makeRow({ status: 'in_progress' }));
    prismaMock.gDPRRequest.update.mockResolvedValue(
      makeRow({ status: 'completed', responseData: JSON.stringify({ exported: true }) }),
    );

    const result = await gdprRequestService.completeRequest('req-1', 'admin-1', { exported: true });

    expect(result.status).toBe('completed');
    expect(result.responseData).toEqual({ exported: true });
    const arg = prismaMock.gDPRRequest.update.mock.calls[0][0];
    expect(arg.data.status).toBe('completed');
    expect(arg.data.completedAt).toBeInstanceOf(Date);
    expect(typeof arg.data.responseData).toBe('string');
    expect(prismaMock.gDPRRequestStatusHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ fromStatus: 'in_progress', toStatus: 'completed' }),
      }),
    );
  });
});

// ===========================================================================
// rejectRequest
// ===========================================================================

describe('rejectRequest', () => {
  it('throws when the request is not found', async () => {
    prismaMock.gDPRRequest.findUnique.mockResolvedValue(null);
    await expect(gdprRequestService.rejectRequest('missing', 'admin-1', 'no reason')).rejects.toThrow(
      'Request not found',
    );
  });

  it('rejects the request with a reason and records history', async () => {
    prismaMock.gDPRRequest.findUnique.mockResolvedValue(makeRow({ status: 'pending' }));
    prismaMock.gDPRRequest.update.mockResolvedValue(
      makeRow({ status: 'rejected', rejectionReason: 'invalid identity' }),
    );

    const result = await gdprRequestService.rejectRequest('req-1', 'admin-1', 'invalid identity');

    expect(result.status).toBe('rejected');
    expect(result.rejectionReason).toBe('invalid identity');
    expect(prismaMock.gDPRRequest.update.mock.calls[0][0].data.rejectionReason).toBe('invalid identity');
    expect(prismaMock.gDPRRequestStatusHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ toStatus: 'rejected', reason: 'invalid identity' }),
      }),
    );
  });
});

// ===========================================================================
// cancelRequest
// ===========================================================================

describe('cancelRequest', () => {
  it('throws when the request is not found', async () => {
    prismaMock.gDPRRequest.findUnique.mockResolvedValue(null);
    await expect(gdprRequestService.cancelRequest('missing', 'user-1')).rejects.toThrow(
      'Request not found',
    );
  });

  it('throws when the requesting user is not the owner', async () => {
    prismaMock.gDPRRequest.findUnique.mockResolvedValue(makeRow({ userId: 'someone-else' }));
    await expect(gdprRequestService.cancelRequest('req-1', 'user-1')).rejects.toThrow(
      'Not authorized',
    );
  });

  it('throws when trying to cancel a completed request', async () => {
    prismaMock.gDPRRequest.findUnique.mockResolvedValue(
      makeRow({ userId: 'user-1', status: 'completed' }),
    );
    await expect(gdprRequestService.cancelRequest('req-1', 'user-1')).rejects.toThrow(
      'Cannot cancel completed or rejected request',
    );
    expect(prismaMock.gDPRRequest.update).not.toHaveBeenCalled();
  });

  it('cancels a pending request owned by the user', async () => {
    prismaMock.gDPRRequest.findUnique.mockResolvedValue(makeRow({ userId: 'user-1', status: 'pending' }));
    prismaMock.gDPRRequest.update.mockResolvedValue(makeRow({ status: 'cancelled' }));

    const result = await gdprRequestService.cancelRequest('req-1', 'user-1');

    expect(result.status).toBe('cancelled');
    expect(prismaMock.gDPRRequestStatusHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ toStatus: 'cancelled', changedBy: 'user-1' }),
      }),
    );
  });
});

// ===========================================================================
// verifyRequest
// ===========================================================================

describe('verifyRequest', () => {
  it('throws on an invalid or expired token', async () => {
    prismaMock.gDPRRequest.findFirst.mockResolvedValue(null);
    await expect(gdprRequestService.verifyRequest('bad-token')).rejects.toThrow(
      'Invalid or expired verification token',
    );
  });

  it('verifies the request, clears the token, and moves it to pending', async () => {
    prismaMock.gDPRRequest.findFirst.mockResolvedValue(
      makeRow({ id: 'req-9', status: 'awaiting_verification' }),
    );
    prismaMock.gDPRRequest.update.mockResolvedValue(makeRow({ id: 'req-9', status: 'pending' }));

    const result = await gdprRequestService.verifyRequest('good-token');

    expect(result.status).toBe('pending');
    const arg = prismaMock.gDPRRequest.update.mock.calls[0][0];
    expect(arg.where).toEqual({ id: 'req-9' });
    expect(arg.data.status).toBe('pending');
    expect(arg.data.verificationToken).toBeNull();
    expect(arg.data.verifiedAt).toBeInstanceOf(Date);
    expect(prismaMock.gDPRRequestStatusHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ fromStatus: 'awaiting_verification', toStatus: 'pending' }),
      }),
    );
  });
});

// ===========================================================================
// getRequest / getUserRequests
// ===========================================================================

describe('getRequest', () => {
  it('returns null when no request exists', async () => {
    prismaMock.gDPRRequest.findUnique.mockResolvedValue(null);
    expect(await gdprRequestService.getRequest('missing')).toBeNull();
  });

  it('maps the row into a GDPRRequest', async () => {
    prismaMock.gDPRRequest.findUnique.mockResolvedValue(makeRow());
    const result = await gdprRequestService.getRequest('req-1');
    expect(result?.id).toBe('req-1');
    expect(result?.requestData).toEqual({ format: 'json' });
  });
});

describe('getUserRequests', () => {
  it('returns mapped requests ordered for the user', async () => {
    prismaMock.gDPRRequest.findMany.mockResolvedValue([makeRow({ id: 'a' }), makeRow({ id: 'b' })]);
    const result = await gdprRequestService.getUserRequests('user-1');
    expect(result.map((r) => r.id)).toEqual(['a', 'b']);
    expect(prismaMock.gDPRRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1' } }),
    );
  });

  it('returns an empty array when the user has no requests', async () => {
    prismaMock.gDPRRequest.findMany.mockResolvedValue([]);
    expect(await gdprRequestService.getUserRequests('user-1')).toEqual([]);
  });
});

// ===========================================================================
// getAllRequests (filters + pagination)
// ===========================================================================

describe('getAllRequests', () => {
  it('builds the where clause from filters and paginates', async () => {
    prismaMock.gDPRRequest.findMany.mockResolvedValue([makeRow()]);
    prismaMock.gDPRRequest.count.mockResolvedValue(1);

    const result = await gdprRequestService.getAllRequests(
      { status: 'pending', requestType: ['access', 'erasure'], userId: 'user-1' },
      2,
      10,
    );

    expect(result.total).toBe(1);
    expect(result.page).toBe(2);
    expect(result.limit).toBe(10);

    const arg = prismaMock.gDPRRequest.findMany.mock.calls[0][0];
    expect(arg.where.status).toBe('pending');
    expect(arg.where.requestType).toEqual({ in: ['access', 'erasure'] });
    expect(arg.where.userId).toBe('user-1');
    expect(arg.skip).toBe(10); // (2-1)*10
    expect(arg.take).toBe(10);
  });

  it('translates the overdue filter into deadline + active-status constraints', async () => {
    prismaMock.gDPRRequest.findMany.mockResolvedValue([]);
    prismaMock.gDPRRequest.count.mockResolvedValue(0);

    await gdprRequestService.getAllRequests({ overdue: true });

    const arg = prismaMock.gDPRRequest.findMany.mock.calls[0][0];
    expect(arg.where.slaDeadline).toHaveProperty('lt');
    expect(arg.where.status).toEqual({ in: ['pending', 'acknowledged', 'in_progress'] });
  });

  it('defaults to page 1 / limit 20 with an empty filter', async () => {
    prismaMock.gDPRRequest.findMany.mockResolvedValue([]);
    prismaMock.gDPRRequest.count.mockResolvedValue(0);
    const result = await gdprRequestService.getAllRequests();
    expect(result.page).toBe(1);
    expect(result.limit).toBe(20);
    expect(prismaMock.gDPRRequest.findMany.mock.calls[0][0].skip).toBe(0);
  });
});

// ===========================================================================
// getOverdueRequests / getRequestsNearingSLA / getStatusHistory
// ===========================================================================

describe('getOverdueRequests', () => {
  it('queries overdue active requests and maps them', async () => {
    prismaMock.gDPRRequest.findMany.mockResolvedValue([makeRow()]);
    const result = await gdprRequestService.getOverdueRequests();
    expect(result).toHaveLength(1);
    const arg = prismaMock.gDPRRequest.findMany.mock.calls[0][0];
    expect(arg.where.status).toEqual({ in: ['pending', 'acknowledged', 'in_progress'] });
    expect(arg.where.slaDeadline).toHaveProperty('lt');
  });
});

describe('getRequestsNearingSLA', () => {
  it('queries requests whose deadline falls within the window', async () => {
    prismaMock.gDPRRequest.findMany.mockResolvedValue([]);
    await gdprRequestService.getRequestsNearingSLA(48);
    const arg = prismaMock.gDPRRequest.findMany.mock.calls[0][0];
    expect(arg.where.slaDeadline).toHaveProperty('gt');
    expect(arg.where.slaDeadline).toHaveProperty('lt');
  });
});

describe('getStatusHistory', () => {
  it('returns the history entries for a request', async () => {
    const history = [{ id: 'h1', requestId: 'req-1', fromStatus: null, toStatus: 'pending' }];
    prismaMock.gDPRRequestStatusHistory.findMany.mockResolvedValue(history);
    const result = await gdprRequestService.getStatusHistory('req-1');
    expect(result).toBe(history);
    expect(prismaMock.gDPRRequestStatusHistory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { requestId: 'req-1' } }),
    );
  });
});

// ===========================================================================
// generateDataExport
// ===========================================================================

describe('generateDataExport', () => {
  function stubExportData() {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'u@x.com', name: 'U' });
    prismaMock.complianceLog.findMany.mockResolvedValue([
      { id: 'l1', eventType: 'login', severity: 'info', timestamp: NOW },
      { id: 'l2', eventType: 'logout', severity: 'info', timestamp: NOW },
    ]);
    prismaMock.robotCommand.findMany.mockResolvedValue([]);
    prismaMock.alert.findMany.mockResolvedValue([{ id: 'a1' }]);
    prismaMock.userConsent.findMany.mockResolvedValue([{ id: 'c1' }]);
    prismaMock.dataRestriction.findMany.mockResolvedValue([]);
  }

  it('returns a base64 JSON export with an aggregated record count', async () => {
    stubExportData();
    const result = await gdprRequestService.generateDataExport('user-1', 'json');

    expect(result.format).toBe('json');
    // recordCount = logs(2) + alerts(1) + consents(1)
    expect(result.recordCount).toBe(4);
    expect(result.categories).toContain('profile');
    expect(result.generatedAt).toBeInstanceOf(Date);
    expect(result.expiresAt).toBeInstanceOf(Date);

    // data is base64 — decode and confirm it parses as JSON containing the user
    const decoded = Buffer.from(result.data, 'base64').toString('utf-8');
    const parsed = JSON.parse(decoded);
    expect(parsed.user.id).toBe('user-1');
    expect(parsed.activityLogs).toHaveLength(2);
  });

  it('produces CSV when requested', async () => {
    stubExportData();
    const result = await gdprRequestService.generateDataExport('user-1', 'csv');
    expect(result.format).toBe('csv');
    const decoded = Buffer.from(result.data, 'base64').toString('utf-8');
    expect(decoded.startsWith('Category,Field,Value')).toBe(true);
  });
});

// ===========================================================================
// checkErasureEligibility
// ===========================================================================

describe('checkErasureEligibility', () => {
  it('is eligible when nothing blocks the erasure', async () => {
    legalHoldServiceMock.getLogsUnderHold.mockResolvedValue([]);
    prismaMock.complianceLog.findMany.mockResolvedValue([{ id: 'log-1' }]);
    prismaMock.complianceLog.count.mockResolvedValue(0); // active retention + total logs
    prismaMock.user.count.mockResolvedValue(1);
    prismaMock.userConsent.count.mockResolvedValue(3);

    const result = await gdprRequestService.checkErasureEligibility('user-1');

    expect(result.eligible).toBe(true);
    expect(result.blockedReasons).toEqual([]);
    // estimatedRecordsAffected = userCount(1) + logCount(0) + consentCount(3)
    expect(result.estimatedRecordsAffected).toBe(4);
  });

  it('blocks when logs are under legal hold', async () => {
    legalHoldServiceMock.getLogsUnderHold.mockResolvedValue(['log-1', 'log-x']);
    prismaMock.complianceLog.findMany.mockResolvedValue([{ id: 'log-1' }]);
    prismaMock.complianceLog.count.mockResolvedValue(0);
    prismaMock.user.count.mockResolvedValue(1);
    prismaMock.userConsent.count.mockResolvedValue(0);

    const result = await gdprRequestService.checkErasureEligibility('user-1');

    expect(result.eligible).toBe(false);
    expect(result.blockedReasons.join(' ')).toMatch(/legal hold/);
    expect(result.retainedDataCategories).toContain('compliance_logs_under_legal_hold');
  });

  it('blocks when logs are within mandatory retention', async () => {
    legalHoldServiceMock.getLogsUnderHold.mockResolvedValue([]);
    prismaMock.complianceLog.findMany.mockResolvedValue([]);
    prismaMock.complianceLog.count
      .mockResolvedValueOnce(5) // activeRetentionLogs
      .mockResolvedValueOnce(5); // total logCount in Promise.all
    prismaMock.user.count.mockResolvedValue(1);
    prismaMock.userConsent.count.mockResolvedValue(0);

    const result = await gdprRequestService.checkErasureEligibility('user-1');

    expect(result.eligible).toBe(false);
    expect(result.retainedDataCategories).toContain('compliance_logs_mandatory_retention');
  });
});

// ===========================================================================
// executeErasure
// ===========================================================================

describe('executeErasure', () => {
  it('deletes, pseudonymizes, soft-deletes the user, and returns a summary', async () => {
    // eligibility (called internally first)
    legalHoldServiceMock.getLogsUnderHold.mockResolvedValue([]);
    prismaMock.complianceLog.findMany.mockResolvedValue([]);
    prismaMock.complianceLog.count.mockResolvedValue(0);
    prismaMock.user.count.mockResolvedValue(1);
    prismaMock.userConsent.count.mockResolvedValue(2);

    // erasure mutations
    prismaMock.userConsent.deleteMany.mockResolvedValue({ count: 2 });
    prismaMock.gDPRRequest.deleteMany.mockResolvedValue({ count: 1 });
    prismaMock.complianceLog.updateMany.mockResolvedValue({ count: 3 }); // pseudonymized
    prismaMock.complianceLog.deleteMany.mockResolvedValue({ count: 4 }); // deletable
    prismaMock.dataRestriction.deleteMany.mockResolvedValue({ count: 0 });
    prismaMock.user.update.mockResolvedValue({});

    const result = await gdprRequestService.executeErasure('user-1');

    // deletedRecords = consents(2) + requests(1) + deletableLogs(4) + restrictions(0) = 7
    expect(result.deletedRecords).toBe(7);
    expect(result.pseudonymizedRecords).toBe(3);
    expect(result.completedAt).toBeInstanceOf(Date);

    // user soft-deleted with anonymized identity
    const userArg = prismaMock.user.update.mock.calls[0][0];
    expect(userArg.where).toEqual({ id: 'user-1' });
    expect(userArg.data.isActive).toBe(false);
    expect(userArg.data.passwordHash).toBe('ERASED');
    expect(userArg.data.email).toContain('gdpr-erased.local');
  });

  /** Nothing blocks, nothing to delete — the DB half of a clean erasure. */
  function mockCleanDatabaseErasure(): void {
    legalHoldServiceMock.getLogsUnderHold.mockResolvedValue([]);
    prismaMock.complianceLog.findMany.mockResolvedValue([]);
    prismaMock.complianceLog.count.mockResolvedValue(0);
    prismaMock.user.count.mockResolvedValue(1);
    prismaMock.userConsent.count.mockResolvedValue(0);
    prismaMock.userConsent.deleteMany.mockResolvedValue({ count: 0 });
    prismaMock.gDPRRequest.deleteMany.mockResolvedValue({ count: 0 });
    prismaMock.complianceLog.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.complianceLog.deleteMany.mockResolvedValue({ count: 0 });
    prismaMock.dataRestriction.deleteMany.mockResolvedValue({ count: 0 });
    prismaMock.user.update.mockResolvedValue({});
  }

  it('reaches the robot fleet on an explicit opt-in — a place note is personal data no row delete touches', async () => {
    mockCleanDatabaseErasure();
    robotMemoryErasureMock.eraseFleetMemory.mockResolvedValue({
      attempted: 1,
      succeeded: 1,
      failed: 0,
      removed: 4,
      outcomes: [{ robotId: 'g1-edu-4', ok: true, removed: 4 }],
    });

    const result = await gdprRequestService.executeErasure('user-1', { eraseRobotMemory: true });

    expect(robotMemoryErasureMock.eraseFleetMemory).toHaveBeenCalledOnce();
    // FILES are counted as files. Folding them into `deletedRecords` reported a
    // robot file count to the data subject as if it were database rows.
    expect(result.robotFilesRemoved).toBe(4);
    expect(result.robotsAttempted).toBe(1);
    expect(result.deletedRecords).toBe(0);
    expect(result.blockedReasons).toEqual([]);
  });

  it('does NOT wipe the fleet without an explicit opt-in, and says so', async () => {
    // One subject's Art. 17 request must not destroy 20 robots' memory —
    // including place notes authored by other operators, i.e. other data
    // subjects' personal data erased without their request.
    mockCleanDatabaseErasure();

    const result = await gdprRequestService.executeErasure('user-1');

    expect(robotMemoryErasureMock.eraseFleetMemory).not.toHaveBeenCalled();
    expect(result.robotFilesRemoved).toBe(0);
    expect(result.robotsAttempted).toBe(0);
    expect(result.blockedReasons).toEqual([ROBOT_MEMORY_REQUIRES_OPT_IN]);
  });

  it('suppresses the robot wipe while a legal hold is active, even with the opt-in', async () => {
    // The robots' journal is a second copy of the held data category — the
    // robot's own `Journal.prune()` refuses to delete it under a hold, and this
    // path used to delete every `journal/*.jsonl` anyway while still reporting
    // the hold as a blocked reason, as if nothing had been deleted.
    legalHoldServiceMock.getLogsUnderHold.mockResolvedValue(['log-1']);
    prismaMock.complianceLog.findMany.mockResolvedValue([{ id: 'log-1' }]);
    prismaMock.complianceLog.count.mockResolvedValue(0);
    prismaMock.user.count.mockResolvedValue(1);
    prismaMock.userConsent.count.mockResolvedValue(0);
    prismaMock.userConsent.deleteMany.mockResolvedValue({ count: 0 });
    prismaMock.gDPRRequest.deleteMany.mockResolvedValue({ count: 0 });
    prismaMock.complianceLog.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.complianceLog.deleteMany.mockResolvedValue({ count: 0 });
    prismaMock.dataRestriction.deleteMany.mockResolvedValue({ count: 0 });
    prismaMock.user.update.mockResolvedValue({});

    const result = await gdprRequestService.executeErasure('user-1', { eraseRobotMemory: true });

    expect(robotMemoryErasureMock.eraseFleetMemory).not.toHaveBeenCalled();
    expect(result.robotFilesRemoved).toBe(0);
    expect(result.blockedReasons).toContain('1 logs under legal hold');
    expect(result.blockedReasons).toContain(ROBOT_MEMORY_BLOCKED_BY_LEGAL_HOLD);
  });

  it('reports an unreachable robot as blocked instead of rolling the erasure back', async () => {
    mockCleanDatabaseErasure();
    robotMemoryErasureMock.eraseFleetMemory.mockResolvedValue({
      attempted: 1,
      succeeded: 0,
      failed: 1,
      removed: 0,
      outcomes: [{ robotId: 'g1-edu-4', ok: false, removed: 0, error: 'ECONNREFUSED' }],
    });

    const result = await gdprRequestService.executeErasure('user-1', { eraseRobotMemory: true });

    // The DB erasure already happened; a robot that is switched off cannot undo
    // it, and must not be silently counted as erased either.
    expect(prismaMock.user.update).toHaveBeenCalledOnce();
    expect(result.blockedReasons).toEqual([
      expect.stringContaining('Robot g1-edu-4: memory workspace not erased (ECONNREFUSED)'),
    ]);
  });

  /**
   * `complianceLog.count` is asked two different questions during an erasure:
   * the subject's mandatory-retention count (`where.operatorId`) and the
   * fleet-wide hold check over the categories the wipe destroys
   * (`where.eventType`). Dispatch on the where clause so a test can answer them
   * independently.
   */
  function mockComplianceCounts(opts: {
    subjectRetention?: number;
    subjectTotal?: number;
    heldJournalLogs?: number;
  }): void {
    prismaMock.complianceLog.count.mockImplementation(
      async (args?: { where?: { eventType?: string; retentionExpiresAt?: unknown } }) => {
        if (args?.where?.eventType !== undefined) return opts.heldJournalLogs ?? 0;
        if (args?.where?.retentionExpiresAt !== undefined) return opts.subjectRetention ?? 0;
        return opts.subjectTotal ?? 0;
      },
    );
  }

  /** The DB mutations of an erasure, all no-ops. */
  function mockDatabaseMutations(): void {
    prismaMock.userConsent.deleteMany.mockResolvedValue({ count: 0 });
    prismaMock.gDPRRequest.deleteMany.mockResolvedValue({ count: 0 });
    prismaMock.complianceLog.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.complianceLog.deleteMany.mockResolvedValue({ count: 0 });
    prismaMock.dataRestriction.deleteMany.mockResolvedValue({ count: 0 });
    prismaMock.user.update.mockResolvedValue({});
    prismaMock.user.count.mockResolvedValue(1);
    prismaMock.userConsent.count.mockResolvedValue(0);
  }

  it('suppresses the fleet wipe for a hold on ANOTHER operator’s logs', async () => {
    // THE PROBE. An active hold pins `log-held-other-operator`; the requester
    // owns only `log-mine`. The subject-scoped gate intersects the two sets,
    // finds nothing, and stays silent — but `eraseFleetMemory()` DELETEs
    // `/robots/:id/memory` on EVERY robot, destroying the journal copy of the
    // very `command_execution` records the hold pins. Same for the
    // system/robot-authored logs (`operatorId: null`) that are the bulk of the
    // compliance table. A fleet-wide effect needs a fleet-wide gate.
    legalHoldServiceMock.getLogsUnderHold.mockResolvedValue(['log-held-other-operator']);
    prismaMock.complianceLog.findMany.mockResolvedValue([{ id: 'log-mine' }]);
    mockComplianceCounts({ heldJournalLogs: 1 });
    mockDatabaseMutations();

    const result = await gdprRequestService.executeErasure('user-1', { eraseRobotMemory: true });

    expect(robotMemoryErasureMock.eraseFleetMemory).not.toHaveBeenCalled();
    expect(result.robotFilesRemoved).toBe(0);
    expect(result.robotsAttempted).toBe(0);
    expect(result.blockedReasons).toContain(ROBOT_MEMORY_BLOCKED_BY_FLEET_HOLD);
    // The subject-scoped gate is genuinely silent here — this is not the
    // round-2 test passing by accident because the hold sits on the
    // requester's own log.
    expect(result.blockedReasons.join(' ')).not.toContain('logs under legal hold');
    // The DB half still ran: a hold on the robots' journal does not postpone
    // the erasure of rows that are not held.
    expect(prismaMock.user.update).toHaveBeenCalledOnce();
    // The fleet-wide check must not be subject-scoped.
    const holdCountArgs = prismaMock.complianceLog.count.mock.calls
      .map((c) => c[0] as { where?: Record<string, unknown> } | undefined)
      .find((a) => a?.where?.eventType !== undefined);
    expect(holdCountArgs?.where).toMatchObject({
      id: { in: ['log-held-other-operator'] },
      eventType: { in: expect.arrayContaining(['command_execution']) },
    });
    expect(holdCountArgs?.where?.operatorId).toBeUndefined();
  });

  it('covers every category the wipe destroys, not just the journal’s', async () => {
    // THE CONTROL RUN for the round-4 asymmetry. `checkFleetWipeHold` counted
    // held `command_execution` logs only, while `Workspace.erase()` destroys
    // `MEMORY.md`, every place note, `intents.jsonl` AND `incarnations.jsonl`
    // — so a hold pinning a NON-journal category the wipe still destroys let
    // the fleet-wide wipe proceed (observed: robotFilesRemoved 12,
    // blockedReasons []). The gate has to be at least as wide as the erase.
    legalHoldServiceMock.getLogsUnderHold.mockResolvedValue(['log-boot-lineage']);
    prismaMock.complianceLog.findMany.mockResolvedValue([]);
    mockDatabaseMutations();

    // Only a `system_event` hold — the category `incarnations.jsonl` (up to 200
    // boots of "this robot was HERE at THIS time") duplicates.
    prismaMock.complianceLog.count.mockImplementation(
      async (args?: { where?: { eventType?: { in?: string[] }; retentionExpiresAt?: unknown } }) => {
        const categories = args?.where?.eventType?.in;
        if (categories) return categories.includes('system_event') ? 1 : 0;
        return 0;
      },
    );

    const result = await gdprRequestService.executeErasure('user-1', { eraseRobotMemory: true });

    expect(robotMemoryErasureMock.eraseFleetMemory).not.toHaveBeenCalled();
    expect(result.robotFilesRemoved).toBe(0);
    expect(result.blockedReasons).toContain(ROBOT_MEMORY_BLOCKED_BY_FLEET_HOLD);
    // Not the subject-scoped gate passing by accident.
    expect(result.blockedReasons.join(' ')).not.toContain('logs under legal hold');
    // Every category the wipe touches is asked about, in one query.
    const holdCountArgs = prismaMock.complianceLog.count.mock.calls
      .map((c) => c[0] as { where?: { eventType?: { in?: string[] } } } | undefined)
      .find((a) => a?.where?.eventType !== undefined);
    expect(holdCountArgs?.where?.eventType?.in).toEqual(
      expect.arrayContaining(['command_execution', 'ai_decision', 'safety_action', 'system_event']),
    );
  });

  it('still wipes when the only active hold covers a category no robot holds', async () => {
    // The gate must not degenerate into "any hold anywhere blocks forever":
    // an `access_audit` hold records reads of PLATFORM data and pins nothing
    // that lives on a robot, so it must not suppress the wipe.
    legalHoldServiceMock.getLogsUnderHold.mockResolvedValue(['log-access-audit']);
    prismaMock.complianceLog.findMany.mockResolvedValue([]);
    mockComplianceCounts({ heldJournalLogs: 0 });
    mockDatabaseMutations();
    robotMemoryErasureMock.eraseFleetMemory.mockResolvedValue({
      attempted: 1,
      succeeded: 1,
      failed: 0,
      removed: 3,
      outcomes: [{ robotId: 'g1-edu-4', ok: true, removed: 3 }],
    });

    const result = await gdprRequestService.executeErasure('user-1', { eraseRobotMemory: true });

    expect(robotMemoryErasureMock.eraseFleetMemory).toHaveBeenCalledOnce();
    expect(result.robotFilesRemoved).toBe(3);
    expect(result.blockedReasons).toEqual([]);
    // `access_audit` was never in the queried set — the widening is scoped, not
    // a blanket "any hold".
    const holdCountArgs = prismaMock.complianceLog.count.mock.calls
      .map((c) => c[0] as { where?: { eventType?: { in?: string[] } } } | undefined)
      .find((a) => a?.where?.eventType !== undefined);
    expect(holdCountArgs?.where?.eventType?.in).not.toContain('access_audit');
  });

  it('suppresses the fleet wipe when the hold check itself cannot be answered', async () => {
    // Not knowing whether a hold covers the robots' journals is not permission
    // to delete them.
    legalHoldServiceMock.getLogsUnderHold
      .mockResolvedValueOnce([]) // eligibility (DB half) succeeds
      .mockRejectedValueOnce(new Error('legal hold table unreachable'));
    prismaMock.complianceLog.findMany.mockResolvedValue([]);
    mockComplianceCounts({});
    mockDatabaseMutations();

    const result = await gdprRequestService.executeErasure('user-1', { eraseRobotMemory: true });

    expect(robotMemoryErasureMock.eraseFleetMemory).not.toHaveBeenCalled();
    expect(result.blockedReasons).toContain(ROBOT_MEMORY_HOLD_CHECK_FAILED);
    expect(prismaMock.user.update).toHaveBeenCalledOnce();
  });

  it('reports a fleet that could not be enumerated as blocked, not as an empty fleet', async () => {
    // Probe: `prisma.robot.findMany` rejects inside the erasure service. The
    // result then looks exactly like "no robot has an agent URL", and the Art.
    // 17 answer claimed a complete erasure while the code never found out which
    // robots exist.
    mockCleanDatabaseErasure();
    robotMemoryErasureMock.eraseFleetMemory.mockResolvedValue({
      attempted: 0,
      succeeded: 0,
      failed: 1,
      removed: 0,
      outcomes: [],
      listError: 'db down',
    });

    const result = await gdprRequestService.executeErasure('user-1', { eraseRobotMemory: true });

    expect(result.robotsAttempted).toBe(0);
    expect(result.robotFilesRemoved).toBe(0);
    expect(result.blockedReasons).toEqual([
      expect.stringContaining(ROBOT_MEMORY_FLEET_UNKNOWN),
    ]);
    expect(result.blockedReasons[0]).toContain('db down');
  });

  it('reports a genuinely empty fleet as a clean erasure', async () => {
    // The other half of the distinction: enumerated, nothing to erase.
    mockCleanDatabaseErasure();
    robotMemoryErasureMock.eraseFleetMemory.mockResolvedValue({
      attempted: 0,
      succeeded: 0,
      failed: 0,
      removed: 0,
      outcomes: [],
    });

    const result = await gdprRequestService.executeErasure('user-1', { eraseRobotMemory: true });

    expect(result.blockedReasons).toEqual([]);
    expect(result.robotsAttempted).toBe(0);
  });

  it('propagates a failure from the user soft-delete step', async () => {
    legalHoldServiceMock.getLogsUnderHold.mockResolvedValue([]);
    prismaMock.complianceLog.findMany.mockResolvedValue([]);
    prismaMock.complianceLog.count.mockResolvedValue(0);
    prismaMock.user.count.mockResolvedValue(1);
    prismaMock.userConsent.count.mockResolvedValue(0);

    prismaMock.userConsent.deleteMany.mockResolvedValue({ count: 0 });
    prismaMock.gDPRRequest.deleteMany.mockResolvedValue({ count: 0 });
    prismaMock.complianceLog.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.complianceLog.deleteMany.mockResolvedValue({ count: 0 });
    prismaMock.dataRestriction.deleteMany.mockResolvedValue({ count: 0 });
    prismaMock.user.update.mockRejectedValue(new Error('user locked'));

    await expect(gdprRequestService.executeErasure('user-1')).rejects.toThrow('user locked');
  });
});

// ===========================================================================
// getMetrics
// ===========================================================================

describe('getMetrics', () => {
  it('aggregates counts and computes average response time + SLA compliance', async () => {
    // counts: total, pending, overdue, completedLast30Days
    prismaMock.gDPRRequest.count
      .mockResolvedValueOnce(10) // total
      .mockResolvedValueOnce(4) // pending/active
      .mockResolvedValueOnce(1) // overdue
      .mockResolvedValueOnce(3); // completed last 30d

    prismaMock.gDPRRequest.groupBy
      .mockResolvedValueOnce([{ requestType: 'access', _count: 6 }]) // by type
      .mockResolvedValueOnce([{ status: 'completed', _count: 3 }]); // by status

    // completedRequests for response-time math: one completed 24h after submission
    const submitted = new Date('2026-06-01T00:00:00.000Z');
    const completed = new Date('2026-06-02T00:00:00.000Z');
    prismaMock.gDPRRequest.findMany.mockResolvedValue([
      { submittedAt: submitted, completedAt: completed },
    ]);

    const result = await gdprRequestService.getMetrics();

    expect(result.totalRequests).toBe(10);
    expect(result.pendingRequests).toBe(4);
    expect(result.overdueRequests).toBe(1);
    expect(result.completedLast30Days).toBe(3);
    expect(result.averageResponseTimeHours).toBe(24);
    expect(result.requestsByType).toEqual({ access: 6 });
    expect(result.requestsByStatus).toEqual({ completed: 3 });
    // completed well within 30 days -> 100%
    expect(result.slaComplianceRate).toBe(100);
  });

  it('returns 0 avg response time and 100% compliance when nothing is completed', async () => {
    prismaMock.gDPRRequest.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);
    prismaMock.gDPRRequest.groupBy.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    prismaMock.gDPRRequest.findMany.mockResolvedValue([]);

    const result = await gdprRequestService.getMetrics();
    expect(result.averageResponseTimeHours).toBe(0);
    expect(result.slaComplianceRate).toBe(100);
  });
});

// ===========================================================================
// getSLAReport
// ===========================================================================

describe('getSLAReport', () => {
  function stubMetricsCalls() {
    prismaMock.gDPRRequest.count
      .mockResolvedValueOnce(10) // total
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2); // completedLast30Days
    prismaMock.gDPRRequest.groupBy.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    prismaMock.gDPRRequest.findMany.mockResolvedValue([]); // completedRequests (metrics)
  }

  it('combines metrics, nearing-deadline count, and longest-open request', async () => {
    stubMetricsCalls();
    // getRequestsNearingSLA (separate findMany call) -> 2 nearing
    prismaMock.gDPRRequest.findMany
      .mockResolvedValueOnce([]) // metrics completedRequests
      .mockResolvedValueOnce([makeRow(), makeRow()]); // nearing SLA
    // longest open
    const oldSubmit = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    prismaMock.gDPRRequest.findFirst.mockResolvedValue(
      makeRow({ id: 'oldest', submittedAt: oldSubmit, requestType: 'erasure' }),
    );

    const result = await gdprRequestService.getSLAReport();

    expect(result.totalRequests).toBe(10);
    expect(result.overdueRequests).toBe(1);
    expect(result.nearingDeadline).toBe(2);
    expect(result.longestOpenRequest?.id).toBe('oldest');
    expect(result.longestOpenRequest?.requestType).toBe('erasure');
    expect(result.longestOpenRequest?.daysOpen).toBeGreaterThanOrEqual(4);
  });

  it('returns null longestOpenRequest when there are no open requests', async () => {
    stubMetricsCalls();
    prismaMock.gDPRRequest.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    prismaMock.gDPRRequest.findFirst.mockResolvedValue(null);

    const result = await gdprRequestService.getSLAReport();
    expect(result.longestOpenRequest).toBeNull();
    expect(result.nearingDeadline).toBe(0);
  });
});

// ===========================================================================
// class export sanity
// ===========================================================================

describe('GDPRRequestService export', () => {
  it('exposes both the class and a singleton instance', () => {
    expect(typeof GDPRRequestService).toBe('function');
    expect(gdprRequestService).toBeInstanceOf(GDPRRequestService);
  });
});
