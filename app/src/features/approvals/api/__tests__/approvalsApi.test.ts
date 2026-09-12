/**
 * @file approvalsApi.test.ts
 * @description The approvals client never names the decision actor (TASK-289).
 * @feature approvals
 *
 * The server takes the actor of an EU AI Act Art. 14 decision from the
 * authenticated session and answers 400 to a body that carries one, so a
 * request body with `decidedBy` / `cancelledBy` / `escalatedBy` in it is now a
 * broken client, not a stale one. These tests assert the exact posted bodies.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/api/client', () => ({
  apiClient: { post: vi.fn(), get: vi.fn() },
}));

import { apiClient } from '@/api/client';
import { approvalsApi } from '../approvalsApi';

const post = apiClient.post as unknown as ReturnType<typeof vi.fn>;

describe('approvalsApi decision actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    post.mockResolvedValue({ data: { id: 'appr-001' } });
  });

  it('cancels with exactly { reason } — no cancelledBy', async () => {
    await approvalsApi.cancelApprovalRequest('appr-001', 'no longer needed');

    expect(post).toHaveBeenCalledWith('/approvals/appr-001/cancel', {
      reason: 'no longer needed',
    });
    const [, body] = post.mock.calls[0];
    expect(body).not.toHaveProperty('cancelledBy');
  });

  it('escalates with exactly { reason } — no escalatedBy', async () => {
    await approvalsApi.escalateApprovalRequest('appr-001', 'urgent');

    expect(post).toHaveBeenCalledWith('/approvals/appr-001/escalate', { reason: 'urgent' });
    const [, body] = post.mock.calls[0];
    expect(body).not.toHaveProperty('escalatedBy');
  });

  it('escalates without a reason and still sends no actor', async () => {
    await approvalsApi.escalateApprovalRequest('appr-001');

    expect(post).toHaveBeenCalledWith('/approvals/appr-001/escalate', { reason: undefined });
    const [, body] = post.mock.calls[0];
    expect(body).not.toHaveProperty('escalatedBy');
  });

  it('posts the decision payload through untouched, and it carries no decidedBy', async () => {
    await approvalsApi.processApproval('appr-001', 'step-1', {
      decision: 'approve',
      reviewDurationSec: 12,
      competenceVerified: true,
    });

    expect(post).toHaveBeenCalledWith('/approvals/appr-001/steps/step-1/decide', {
      decision: 'approve',
      reviewDurationSec: 12,
      competenceVerified: true,
    });
    const [, body] = post.mock.calls[0];
    expect(body).not.toHaveProperty('decidedBy');
  });
});
