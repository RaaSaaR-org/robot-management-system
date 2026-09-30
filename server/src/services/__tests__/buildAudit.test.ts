/**
 * @file buildAudit.test.ts
 * @description The Build-page audit helper (TASK-272) writes one access-audit
 *   entry per act and never throws when the compliance log is down.
 * @feature compliance
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCompliance } = vi.hoisted(() => ({
  mockCompliance: {
    getOrCreateSession: vi.fn(() => ({ sessionId: 'sess-1' })),
    logAccess: vi.fn(),
  },
}));

vi.mock('../ComplianceLogService.js', () => ({ complianceLogService: mockCompliance }));

import { auditBuildAct, BUILD_AUDIT_ROBOT } from '../buildAudit.js';

beforeEach(() => vi.clearAllMocks());

describe('auditBuildAct', () => {
  it('records the act as an access-audit entry', async () => {
    await auditBuildAct({
      resourceType: 'deployment',
      resourceId: 'dep-1',
      action: 'delete',
      actorId: 'user-1',
      metadata: { status: 'cancelled' },
    });

    expect(mockCompliance.getOrCreateSession).toHaveBeenCalledWith(BUILD_AUDIT_ROBOT);
    expect(mockCompliance.logAccess).toHaveBeenCalledWith({
      sessionId: 'sess-1',
      robotId: BUILD_AUDIT_ROBOT,
      operatorId: 'user-1',
      payload: {
        description: 'deployment delete',
        resourceType: 'deployment',
        resourceId: 'dep-1',
        action: 'delete',
        result: 'allowed',
        metadata: { status: 'cancelled' },
      },
    });
  });

  it('swallows a failed write — the act already happened', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockCompliance.logAccess.mockRejectedValueOnce(new Error('db down'));

    await expect(
      auditBuildAct({ resourceType: 'model_version', resourceId: 'mv-1', action: 'archive' })
    ).resolves.toBeUndefined();
    spy.mockRestore();
  });
});
