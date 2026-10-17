/**
 * @file hardware-base-mode.test.ts
 * @description TASK-398: the HardwareClient side of robot-mode control. The
 *              sidecar's `loco` capability and measured `base` block are parsed
 *              honestly, a sidecar that only changes modes gets NO HTTP call
 *              for a velocity, gesture or raw FSM id, `/loco/mode` comes back
 *              verbatim, and `/estop` reports whether the robot was damped.
 * @feature hardware
 * @status test
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { HardwareClient } from '../HardwareClient.js';
import {
  isFreshBaseState,
  parseBaseState,
  parseEstopReply,
  parseLocoCapability,
} from '../base-mode.js';

type Route = (body: unknown) => { status: number; body: unknown };

async function client(health: Record<string, unknown>, routes: Record<string, Route> = {}) {
  const calls: Array<{ path: string; method: string; body: unknown }> = [];
  const fetchMock = vi.fn(async (url: string, init?: { body?: string; method?: string }) => {
    const path = new URL(String(url)).pathname;
    const body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({ path, method: init?.method ?? 'GET', body });
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

const FSM_HEALTH = {
  loco: {
    gate: 'fsm', modes: ['limp', 'stand', 'balance'],
    ids: { limp: 1, stand: 4, balance: 500, balance_reported: [500] },
    ids_verified: false, move_enabled: false,
  },
  base: { fsm_id: 1, mode: 'limp', age_s: 0.3, fsm_mode: 1, odom_mode: null, source: 'rpc', error: null },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('parsers', () => {
  it('reads the capability block', () => {
    expect(parseLocoCapability(FSM_HEALTH)).toEqual({
      gate: 'fsm', moveEnabled: false, idsVerified: false,
      ids: { limp: 1, stand: 4, balance: 500, balanceReported: [500] },
    });
  });

  it('calls a sidecar without the block unknown, with moves left as they were', () => {
    expect(parseLocoCapability({ status: 'ok' })).toEqual({
      gate: 'unknown', moveEnabled: null, idsVerified: false, ids: null,
    });
  });

  it('never guesses a gate', () => {
    expect(parseLocoCapability({ loco: { gate: 'yes' } }).gate).toBe('unknown');
  });

  it('reads the base block and drops the id of an unknown mode', () => {
    expect(parseBaseState(FSM_HEALTH.base, 1000)).toEqual({
      fsmId: 1, mode: 'limp', ageS: 0.3, error: null, receivedAtMs: 1000,
    });
    expect(parseBaseState({ fsm_id: 4, mode: 'unknown', age_s: 9, error: 'stale' }, 0)?.fsmId).toBeNull();
    expect(parseBaseState({ mode: 'flying' }, 0)?.mode).toBe('unknown');
    expect(parseBaseState(undefined)).toBeNull();
  });

  it('ages a reading by the time since it arrived', () => {
    const s = parseBaseState({ fsm_id: 500, mode: 'balance', age_s: 0.5 }, 10_000)!;
    expect(isFreshBaseState(s, 12_000)).toBe(true);    // 2.5 s
    expect(isFreshBaseState(s, 14_000)).toBe(false);   // 4.5 s
  });

  it('says why a sidecar did not damp', () => {
    expect(parseEstopReply({ ok: true, damped: true, damp_confirmed: true, disarmed: true }, true))
      .toEqual({ reached: true, disarmed: true, damped: true, dampConfirmed: true, dampError: null });
    expect(parseEstopReply({ ok: true }, true).dampError).toMatch(/does not damp/);
    expect(parseEstopReply({ damped: false, damp_error: 'rpc 3104' }, true).dampError).toBe('rpc 3104');
  });
});

describe('HardwareClient against a mode-control sidecar (G1_LOCO_ENABLED=fsm)', () => {
  it('reads the capability and the measured mode from /health', async () => {
    const { c } = await client(FSM_HEALTH);
    expect(c.getLocoCapability().gate).toBe('fsm');
    expect(c.mayMoveBase()).toBe(false);
    expect(c.getBaseState()).toMatchObject({ fsmId: 1, mode: 'limp', error: null });
    expect(c.getMeasuredFsmId()).toBe(1);
  });

  it('makes NO HTTP call for a move, a stop, a gesture, a stand height or a raw FSM id', async () => {
    const { c, calls } = await client(FSM_HEALTH);
    const before = calls.length;
    for (const res of [
      await c.locoMove(0, 0, 0.4, 1),
      await c.locoStop(),
      await c.locoAction('wave'),
      await c.locoStandHeight('high'),
      await c.locoFsm(500),
    ]) {
      expect(res.ok).toBe(false);
      expect(res.locoDisabled).toBe(true);
    }
    expect(calls.length).toBe(before);
  });

  it('posts /loco/mode and passes the sidecar answer through', async () => {
    const { c, calls } = await client(FSM_HEALTH, {
      '/loco/mode': () => ({
        status: 409,
        body: { ok: false, code: 'bad_transition', from: 'limp', allowed_from: ['stand'],
          base: { fsm_id: 1, mode: 'limp', age_s: 0.1 } },
      }),
    });
    const r = await c.locoMode('balance');
    expect(r).toMatchObject({ ok: false, status: 409, code: 'bad_transition' });
    expect(r.body.allowed_from).toEqual(['stand']);
    expect(calls.at(-1)).toEqual({ path: '/loco/mode', method: 'POST', body: { mode: 'balance' } });
  });

  it('reports a damped E-stop', async () => {
    const { c } = await client(FSM_HEALTH, {
      '/estop': () => ({ status: 200, body: {
        ok: true, latched: true, was_armed: true, disarmed: true, damped: true, damp_confirmed: true, damp_error: null,
      } }),
    });
    expect(await c.sendEstop()).toEqual({
      reached: true, disarmed: true, damped: true, dampConfirmed: true, dampError: null,
    });
  });

  it('asks the sidecar not to damp when told so (a protective stop)', async () => {
    const { c, calls } = await client(FSM_HEALTH, {
      '/estop': () => ({ status: 200, body: {
        ok: true, latched: true, was_armed: false, disarmed: true, damped: false,
        damp_confirmed: false, damp_requested: false, damp_error: 'not requested (protective stop)',
      } }),
    });
    const r = await c.sendEstop({ damp: false });
    expect(calls.at(-1)).toEqual({ path: '/estop', method: 'POST', body: { damp: false } });
    expect(r.damped).toBe(false);
    await c.sendEstop();
    expect(calls.at(-1)).toEqual({ path: '/estop', method: 'POST', body: {} });
  });

  it('reports an unreachable sidecar as not damped, without throwing', async () => {
    const { c } = await client(FSM_HEALTH);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    const r = await c.sendEstop();
    expect(r.reached).toBe(false);
    expect(r.damped).toBe(false);
    expect(r.dampError).toMatch(/ECONNREFUSED/);
  });
});

describe('HardwareClient against a sidecar that reports no gate (the MuJoCo sim)', () => {
  it('still sends moves, exactly as before', async () => {
    const { c, calls } = await client({ sim: true });
    expect(c.mayMoveBase()).toBe(true);
    expect(c.getBaseState()).toBeNull();
    await c.locoMove(0.1, 0, 0, 1);
    expect(calls.at(-1)?.path).toBe('/loco/move');
  });
});
