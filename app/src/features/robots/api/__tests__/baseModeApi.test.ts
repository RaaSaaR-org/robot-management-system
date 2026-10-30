/**
 * @file baseModeApi.test.ts
 * @description An unconfirmed mode change keeps the sidecar's hint (TASK-422):
 *   SetFsmId(500) ignored on a 3-DoF-waist G1 must reach the Robot mode panel,
 *   not only the sidecar log.
 * @feature robots
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { post } = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('@/api/client', () => ({ apiClient: { post, get: vi.fn() } }));

import { setBaseMode } from '../baseModeApi';

const LEASE = { leaseId: 'secret', generation: 1 };

describe('setBaseMode', () => {
  beforeEach(() => post.mockReset());

  it('passes the sidecar hint through on an unconfirmed change', async () => {
    post.mockResolvedValue({
      status: 504,
      data: {
        ok: false,
        code: 'unconfirmed',
        error: 'balance not reported; the robot still reports FSM 4 — …',
        hint: 'the robot still reports FSM 4 — if this G1 has the 3-DoF waist, it balances in FSM 501',
        measured: { fsm_id: 4, mode: 'stand', age_s: 0.1 },
      },
    });
    const result = await setBaseMode('r1', 'balance', LEASE);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.hint).toMatch(/3-DoF waist, it balances in FSM 501/);
    expect(result.measured?.fsmId).toBe(4);
  });

  it('leaves the hint out when the body has none', async () => {
    post.mockResolvedValue({ status: 504, data: { ok: false, code: 'unconfirmed', error: 'not reported', hint: ' ' } });
    const result = await setBaseMode('r1', 'stand', LEASE);
    expect(result).not.toHaveProperty('hint');
  });
});
