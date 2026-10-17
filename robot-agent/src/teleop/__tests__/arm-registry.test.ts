/**
 * @file arm-registry.test.ts
 * @description TASK-393: one arm claim per engaged socket — the first claim on
 *              an arm-only sidecar arms it, the last release disarms it, a
 *              release while `/arm` is still in flight is undone when it lands,
 *              and a refused arm is not retried in a tight loop.
 * @feature teleop
 * @status test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ArmRegistry, type ArmClient } from '../arm-registry.js';
import { UNKNOWN_ARM_STATUS, type SidecarArmStatus } from '../../hardware/arm-status.js';

function fakeClient(mode: SidecarArmStatus['writeMode'] = 'arm_sdk') {
  let armed = false;
  let resolveArm: ((v: { ok: boolean; error?: string }) => void) | null = null;
  const status: SidecarArmStatus = { ...UNKNOWN_ARM_STATUS, writeMode: mode };
  const client = {
    deferArm: false,
    armResult: { ok: true } as { ok: boolean; error?: string },
    requiresArming: () => status.writeMode === 'arm_sdk',
    isArmedLocally: () => armed,
    getArmStatus: () => status,
    arm: vi.fn(async (_g: number | null) => {
      const result = client.deferArm
        ? await new Promise<{ ok: boolean; error?: string }>((r) => { resolveArm = r; })
        : client.armResult;
      if (result.ok) armed = true;
      return result;
    }),
    disarm: vi.fn(async () => {
      armed = false;
      return { ok: true };
    }),
    refreshArmStatus: vi.fn(async () => status),
    finishArm: (r: { ok: boolean; error?: string }) => resolveArm?.(r),
  };
  return client;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('ArmRegistry', () => {
  it('needs nothing on a sidecar without an arm path', () => {
    const client = fakeClient(null);
    const reg = new ArmRegistry(client as ArmClient);
    expect(reg.claim('a', 1)).toEqual({ state: 'not_required' });
    expect(client.arm).not.toHaveBeenCalled();
  });

  it('arms on the first claim and disarms on the last release', async () => {
    const client = fakeClient();
    const reg = new ArmRegistry(client as ArmClient);
    expect(reg.claim('a', 3)).toEqual({ state: 'arming' });
    await vi.advanceTimersByTimeAsync(0);
    expect(client.arm).toHaveBeenCalledWith(3);
    expect(reg.claim('b', 3)).toEqual({ state: 'armed' });
    expect(client.arm).toHaveBeenCalledTimes(1);
    reg.release('a', 'test');
    expect(client.disarm).not.toHaveBeenCalled();
    reg.release('b', 'test');
    expect(client.disarm).toHaveBeenCalledTimes(1);
  });

  it('undoes an arm that lands after everybody let go', async () => {
    const client = fakeClient();
    client.deferArm = true;
    const reg = new ArmRegistry(client as ArmClient);
    reg.claim('a', 1);
    reg.release('a', 'gone');
    client.finishArm({ ok: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(client.disarm).toHaveBeenCalledTimes(1);
  });

  it('does not hammer a sidecar that refuses to arm', async () => {
    const client = fakeClient();
    client.armResult = { ok: false, error: 'nope' };
    const reg = new ArmRegistry(client as ArmClient, { retryCooldownMs: 1000 });
    reg.claim('a', 1);
    await vi.advanceTimersByTimeAsync(0);
    expect(reg.claim('a', 1)).toMatchObject({ state: 'refused', code: 'arm_failed' });
    expect(client.arm).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1100);
    client.armResult = { ok: true };
    expect(reg.claim('a', 1)).toEqual({ state: 'arming' });
    expect(client.arm).toHaveBeenCalledTimes(2);
  });

  it('a claim refused in the cooldown is not kept', async () => {
    const client = fakeClient();
    client.armResult = { ok: false, error: 'nope' };
    const reg = new ArmRegistry(client as ArmClient, { retryCooldownMs: 1000 });
    reg.claim('a', 1);
    await vi.advanceTimersByTimeAsync(0);
    reg.release('a', 'refused');
    expect(reg.claim('b', 1)).toMatchObject({ state: 'refused' });
    expect(reg.has('b')).toBe(false);
    expect(reg.view().claims).toBe(0);
  });

  it('a fresh arm drops the claims left from an arm that was lost', async () => {
    const client = fakeClient();
    const reg = new ArmRegistry(client as ArmClient);
    reg.claim('a', 1);
    await vi.advanceTimersByTimeAsync(0);
    expect(reg.isLive()).toBe(true);
    // The sidecar disarmed itself; 'a' has not noticed yet.
    await client.disarm();
    expect(reg.isLive()).toBe(false);
    expect(reg.claim('b', 1)).toEqual({ state: 'arming' });
    expect(reg.has('a')).toBe(false);
    expect(reg.has('b')).toBe(true);
    // Joining an arm that is up (or on its way) drops nobody.
    expect(reg.claim('c', 1)).toEqual({ state: 'arming' });
    expect(reg.has('b')).toBe(true);
  });

  it('releaseAll disarms whatever was held', async () => {
    const client = fakeClient();
    const reg = new ArmRegistry(client as ArmClient);
    reg.claim('a', 1);
    reg.claim('b', 1);
    await vi.advanceTimersByTimeAsync(0);
    reg.releaseAll('estop');
    expect(client.disarm).toHaveBeenCalledTimes(1);
    expect(reg.view().claims).toBe(0);
  });

  it('polls only while somebody listens, and only one chain at a time', async () => {
    const client = fakeClient();
    const reg = new ArmRegistry(client as ArmClient, { activePollMs: 100, idlePollMs: 1000 });
    await vi.advanceTimersByTimeAsync(2000);
    expect(client.refreshArmStatus).not.toHaveBeenCalled();
    const off = reg.subscribe(() => {});
    reg.subscribe(() => {});
    reg.claim('a', 1);
    await vi.advanceTimersByTimeAsync(1000);
    const n = client.refreshArmStatus.mock.calls.length;
    expect(n).toBeGreaterThan(5);
    expect(n).toBeLessThanOrEqual(12);
    off();
  });
});
