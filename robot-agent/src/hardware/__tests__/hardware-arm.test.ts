/**
 * @file hardware-arm.test.ts
 * @description TASK-393: the HardwareClient side of the arm-only sidecar
 *              contract (TASK-391). The arm fields are parsed honestly, `/arm`
 *              carries the lease generation, the forwarder is gated until the
 *              sidecar is armed, ending teleop on an arm-only sidecar DISARMS
 *              rather than posting the latching `/estop`, and the E-stop reset
 *              reaches the sidecar's own latch.
 * @feature hardware
 * @status test
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { HardwareClient } from '../HardwareClient.js';
import { parseArmStatus, teleopModeFromHands } from '../arm-status.js';

type Route = (body: unknown) => { status: number; body: unknown };

/** A client connected to a fake sidecar whose `/health` says `health`. */
async function client(health: Record<string, unknown>, routes: Record<string, Route> = {}) {
  const calls: Array<{ path: string; body: unknown }> = [];
  const fetchMock = vi.fn(async (url: string, init?: { body?: string }) => {
    const path = new URL(String(url)).pathname;
    const body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({ path, body });
    if (path === '/health') return { ok: true, status: 200, json: async () => ({ status: 'ok', connected: true, ...health }) };
    const route = routes[path];
    if (route) {
      const r = route(body);
      return { ok: r.status < 400, status: r.status, json: async () => r.body };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  });
  vi.stubGlobal('fetch', fetchMock);
  const c = new HardwareClient();
  await c.init();
  c.stopPolling();
  return { c, calls };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('parseArmStatus', () => {
  it('reads the contract fields', () => {
    expect(parseArmStatus({
      write_mode: 'arm_sdk', armed: true, arm_weight: 0.4, estop_latched: false,
      hands: { left: true, right: false }, teleop_mode: 'arms+left_hand',
    })).toEqual({
      writeMode: 'arm_sdk', armed: true, armWeight: 0.4, estopLatched: false,
      hands: { left: true, right: false }, teleopMode: 'arms+left_hand', sim: false, readOnly: false,
    });
  });

  it('never guesses an unknown write mode into arm_sdk', () => {
    expect(parseArmStatus({ write_mode: 'lowcmd' }).writeMode).toBeNull();
  });

  it('treats the old read_only flag as read-only only when no write mode is given', () => {
    expect(parseArmStatus({ read_only: true }).readOnly).toBe(true);
    expect(parseArmStatus({ read_only: true, write_mode: 'arm_sdk' }).readOnly).toBe(false);
  });

  it('derives the teleop mode from the hands when the sidecar omits it', () => {
    expect(parseArmStatus({ hands: { left: false, right: false } }).teleopMode).toBe('arms_only');
    expect(teleopModeFromHands({ left: false, right: true })).toBe('arms+right_hand');
  });

  it('clamps the weight', () => {
    expect(parseArmStatus({ arm_weight: 3 }).armWeight).toBe(1);
    expect(parseArmStatus({ arm_weight: -1 }).armWeight).toBe(0);
  });
});

describe('HardwareClient on an arm-only sidecar', () => {
  it('requires arming, and gates the forwarder until /arm succeeds', async () => {
    const { c, calls } = await client({ write_mode: 'arm_sdk' });
    expect(c.requiresArming()).toBe(true);
    expect(c.mayStreamAction()).toBe(false);
    expect((await c.arm(7)).ok).toBe(true);
    expect(calls.find((x) => x.path === '/arm')?.body).toEqual({ lease_generation: 7 });
    expect(c.mayStreamAction()).toBe(true);
  });

  it('a refused /arm leaves the forwarder gated and says why', async () => {
    const { c } = await client({ write_mode: 'arm_sdk' }, {
      '/arm': () => ({ status: 409, body: { ok: false, error: 'estop_latched' } }),
    });
    const res = await c.arm(1);
    expect(res).toMatchObject({ ok: false, error: 'estop_latched', status: 409 });
    expect(c.mayStreamAction()).toBe(false);
  });

  it('ending teleop disarms — it never posts the latching /estop', async () => {
    const { c, calls } = await client({ write_mode: 'arm_sdk' });
    await c.arm(1);
    await c.releaseAction();
    expect(calls.map((x) => x.path)).toContain('/disarm');
    expect(calls.map((x) => x.path)).not.toContain('/estop');
    expect(c.mayStreamAction()).toBe(false);
  });

  it('a 409 not_armed from /action stops the stream until the next arm', async () => {
    const { c } = await client({ write_mode: 'arm_sdk' }, {
      '/action': () => ({ status: 409, body: { ok: false, error: 'not_armed' } }),
    });
    await c.arm(1);
    await expect(c.sendAction({ left_elbow_joint: 0.1 })).rejects.toThrow('not_armed');
    expect(c.mayStreamAction()).toBe(false);
  });

  it('an E-stop drops the local armed flag before the request', async () => {
    const { c } = await client({ write_mode: 'arm_sdk' });
    await c.arm(1);
    const pending = c.sendEstop();
    expect(c.mayStreamAction()).toBe(false);
    await pending;
  });

  it('resets the sidecar latch, and a sidecar without the route is not an error', async () => {
    const withRoute = await client({ write_mode: 'arm_sdk' });
    expect((await withRoute.c.resetEstop()).ok).toBe(true);
    expect(withRoute.calls.map((x) => x.path)).toContain('/estop/reset');
    vi.unstubAllGlobals();
    const without = await client({}, { '/estop/reset': () => ({ status: 404, body: {} }) });
    expect((await without.c.resetEstop()).ok).toBe(true);
  });

  it('describeSidecar carries the arm status for the recorder', async () => {
    const { c } = await client({ write_mode: 'read_only', scene: null });
    const d = await c.describeSidecar();
    expect(d.arm.readOnly).toBe(true);
  });
});

describe('HardwareClient on the sim or an older sidecar', () => {
  it('needs no arming and releases with /estop as before', async () => {
    const { c, calls } = await client({ sim: true });
    expect(c.requiresArming()).toBe(false);
    expect(c.mayStreamAction()).toBe(true);
    await c.releaseAction();
    expect(calls.map((x) => x.path)).toContain('/estop');
  });
});
