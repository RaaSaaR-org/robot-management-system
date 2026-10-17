/**
 * @file base-mode-route.test.ts
 * @description TASK-398 over real HTTP: `POST/GET /robots/:id/base/mode`
 *              (lease, the agent's own latch, Agent Mode, the sidecar's answer
 *              passed through verbatim) and `POST /robots/:id/safety/estop`
 *              running the sidecar `/estop` BEFORE Agent Mode's stop, in
 *              sequence rather than in parallel.
 * @feature robot
 * @status test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'http';
import type { AddressInfo } from 'net';

const agent = vi.hoisted(() => ({
  running: false,
  order: [] as string[],
}));

vi.mock('../../agent-mode/agent-mode-controller.js', () => ({
  agentModeController: {
    isRunning: () => agent.running,
    estop: async () => {
      agent.order.push('agentMode.estop');
      return { ok: true, stopped: false, delivered: true };
    },
    resetEstop: () => ({ estopActive: false }),
  },
}));
vi.mock('../../agent-mode/identity.js', () => ({
  getIdentityStore: () => ({ load: vi.fn() }),
}));
vi.mock('../../vla/skill-executor.js', () => ({
  SkillExecutor: class {
    run = vi.fn();
    abort(): void {}
    isAborted(): boolean {
      return false;
    }
  },
  skillExecutorRegistry: {
    register: (): void => {},
    unregister: (): void => {},
    abort: (): boolean => false,
    abortAll: (): number => 0,
  },
}));

import { createRestRoutes } from '../rest-routes.js';
import { ControlLeaseRegistry, hashLeaseId } from '../../control-lease/control-lease.js';
import { hardwareClient } from '../../hardware/HardwareClient.js';
import type { LocoCapability } from '../../hardware/base-mode.js';
import type { RobotStateManager } from '../../robot/state.js';

const FSM: LocoCapability = { gate: 'fsm', moveEnabled: false, idsVerified: false, ids: null };
const OFF: LocoCapability = { gate: 'off', moveEnabled: false, idsVerified: false, ids: null };

describe('robot mode route (TASK-398)', () => {
  let server: Server;
  let base: string;
  let dir: string;
  let registry: ControlLeaseRegistry;
  let latched = false;
  let locoMode: ReturnType<typeof vi.spyOn>;

  const rsm = {
    getRobotInterface: () => ({ id: 'robot-1', status: 'idle' }),
    updateServerHeartbeat: (): void => {},
    isEStopTriggered: () => latched,
    getEStopState: () => ({ status: latched ? 'triggered' : 'armed' }),
    getLastHardwareStop: () => null,
    triggerEmergencyStop: vi.fn(async () => {
      agent.order.push('trigger:start');
      await new Promise((r) => setTimeout(r, 30));   // the sidecar damps
      agent.order.push('trigger:done');
      return { reached: true, disarmed: true, damped: true, dampConfirmed: true, dampError: null };
    }),
  };

  beforeEach(async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    latched = false;
    agent.running = false;
    agent.order = [];
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'base-mode-route-'));
    registry = new ControlLeaseRegistry({
      robotId: 'robot-1', filePath: path.join(dir, 'hw.json'), enforced: () => true,
    });
    registry.install({
      generation: 7, leaseIdHash: hashLeaseId('secret'), sessionId: 's', userId: 'u',
      displayName: 'Ada', tenantId: 't', ttlMs: 60_000,
    });
    vi.spyOn(hardwareClient, 'getLocoCapability').mockReturnValue(FSM);
    vi.spyOn(hardwareClient, 'getBaseState').mockReturnValue({ fsmId: 1, mode: 'limp', ageS: 0.2, error: null });
    vi.spyOn(hardwareClient, 'fetchLocoMode').mockResolvedValue({ inFlight: null, estopLatched: false });
    locoMode = vi.spyOn(hardwareClient, 'locoMode').mockResolvedValue({
      ok: true, status: 200, body: { ok: true, mode: 'stand', fsm_id: 4, confirmed: true, took_ms: 400 },
    });
    const app = express();
    app.use(express.json());
    app.use('/api/v1', createRestRoutes(rsm as unknown as RobotStateManager, undefined, undefined, registry));
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve());
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/robots/robot-1`;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    registry.dispose();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const post = (p: string, body: unknown) => fetch(`${base}${p}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const LEASE = { leaseId: 'secret', generation: 7 };

  it('400s a mode outside the allowlist', async () => {
    const res = await post('/base/mode', { mode: 'walk', ...LEASE });
    expect(res.status).toBe(400);
    expect(locoMode).not.toHaveBeenCalled();
  });

  it('403s without a lease while leases are enforced, and with the wrong one', async () => {
    let res = await post('/base/mode', { mode: 'stand' });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('lease_required');
    res = await post('/base/mode', { mode: 'stand', leaseId: 'nope', generation: 7 });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('lease_invalid');
    res = await post('/base/mode', { mode: 'limp', leaseId: 'secret', generation: 6 });
    expect(res.status).toBe(403);
    expect(locoMode).not.toHaveBeenCalled();
  });

  it('409s when the sidecar has no mode control', async () => {
    vi.spyOn(hardwareClient, 'getLocoCapability').mockReturnValue(OFF);
    const res = await post('/base/mode', { mode: 'limp', ...LEASE });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('mode_control_unavailable');
  });

  it('409s stand and balance while the agent latch is set, but lets limp through', async () => {
    latched = true;
    for (const mode of ['stand', 'balance']) {
      const res = await post('/base/mode', { mode, ...LEASE });
      expect(res.status).toBe(409);
      expect(((await res.json()) as { code: string }).code).toBe('estop_latched');
    }
    expect((await post('/base/mode', { mode: 'limp', ...LEASE })).status).toBe(200);
    expect(locoMode).toHaveBeenCalledWith('limp');
  });

  it('409s while an Agent Mode plan runs (limp excepted)', async () => {
    agent.running = true;
    const res = await post('/base/mode', { mode: 'stand', ...LEASE });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('agent_mode_running');
    expect((await post('/base/mode', { mode: 'limp', ...LEASE })).status).toBe(200);
  });

  it('passes the sidecar status and body through', async () => {
    let res = await post('/base/mode', { mode: 'stand', ...LEASE });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, fsm_id: 4, confirmed: true, fromMode: 'limp' });
    locoMode.mockResolvedValue({
      ok: false, status: 409, code: 'not_settled', body: { ok: false, code: 'not_settled', settle_remaining_s: 1.2 },
    });
    res = await post('/base/mode', { mode: 'balance', ...LEASE });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'not_settled', settle_remaining_s: 1.2 });
    locoMode.mockResolvedValue({
      ok: false, status: 504, code: 'unconfirmed', body: { ok: false, code: 'unconfirmed', measured: { mode: 'limp' } },
    });
    res = await post('/base/mode', { mode: 'stand', ...LEASE });
    expect(res.status).toBe(504);
  });

  it('GET reports the capability, the measured mode and the latches', async () => {
    const res = await fetch(`${base}/base/mode`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      capability: { gate: 'fsm', moveEnabled: false },
      base: { fsmId: 1, mode: 'limp' },
      estopLatched: false,
      agentModeRunning: false,
    });
  });

  it('the platform E-stop awaits the sidecar /estop before it stops Agent Mode', async () => {
    const res = await post('/safety/estop', { reason: 'STOP pressed' });
    expect(res.status).toBe(200);
    expect(agent.order).toEqual(['trigger:start', 'trigger:done', 'agentMode.estop']);
    expect(((await res.json()) as { hardwareStop: unknown }).hardwareStop).toMatchObject({ damped: true });
  });
});
