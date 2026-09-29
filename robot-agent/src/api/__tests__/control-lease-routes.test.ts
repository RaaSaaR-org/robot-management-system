/**
 * @file control-lease-routes.test.ts
 * @description `/api/v1/robots/:id/control-lease…` over real HTTP (TASK-314):
 *              install/renew/release/observe, body validation, the 409/503
 *              refusals, and the personal-data gate in front of all of them.
 * @feature robot
 * @status test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'http';
import type { AddressInfo } from 'net';

vi.mock('../../agent-mode/agent-mode-controller.js', () => ({
  agentModeController: {},
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

import { createRestRoutes, MEMORY_TOKEN_ENV } from '../rest-routes.js';
import { ControlLeaseRegistry, hashLeaseId } from '../../control-lease/control-lease.js';
import type { RobotStateManager } from '../../robot/state.js';

const HASH = hashLeaseId('raw-secret');

function installBody(generation: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    generation,
    leaseIdHash: HASH,
    sessionId: 'session-1',
    userId: 'user-1',
    displayName: 'Ada',
    tenantId: 'tenant-1',
    ttlMs: 5_000,
    ...overrides,
  };
}

describe('Control lease REST contract', () => {
  let server: Server;
  let base: string;
  let dir: string;
  let registry: ControlLeaseRegistry;

  const start = async (r: ControlLeaseRegistry): Promise<void> => {
    registry = r;
    const app = express();
    app.use(cors());
    app.use(express.json());
    app.use(
      '/api/v1',
      createRestRoutes(
        {
          getRobotInterface: () => ({ id: 'robot-1', status: 'idle' }),
          updateServerHeartbeat: (): void => {},
        } as unknown as RobotStateManager,
        undefined,
        undefined,
        registry,
      ),
    );
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve());
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/robots`;
  };

  beforeEach(async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'control-lease-routes-'));
    await start(new ControlLeaseRegistry({ robotId: 'robot-1', filePath: path.join(dir, 'hw.json') }));
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    registry.dispose();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const post = (p: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}${p}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });

  it('installs, refuses a stale generation with 409, and fences on a higher one', async () => {
    const first = await post('/robot-1/control-lease/install', installBody(1));
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ installed: true, generation: 1, fencedGeneration: null });

    const stale = await post('/robot-1/control-lease/install', installBody(1));
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ code: 'stale_generation', highWater: 1 });

    const next = await post('/robot-1/control-lease/install', installBody(2, { userId: 'user-2' }));
    expect(await next.json()).toEqual({ installed: true, generation: 2, fencedGeneration: 1 });

    const observed = await fetch(`${base}/robot-1/control-lease`);
    expect(observed.status).toBe(200);
    expect(await observed.json()).toMatchObject({
      enforced: false,
      state: 'held',
      generation: 2,
      userId: 'user-2',
      displayName: 'Ada',
      sessionId: 'session-1',
      bound: 0,
    });
  });

  it('GET never contains the hash', async () => {
    await post('/robot-1/control-lease/install', installBody(1));
    const text = await (await fetch(`${base}/robot-1/control-lease`)).text();
    expect(text).not.toContain(HASH);
    expect(text).not.toContain('leaseIdHash');
  });

  it('validates the install body', async () => {
    const bad: Array<Record<string, unknown>> = [
      installBody(0),
      installBody(1.5),
      installBody(Number.MAX_SAFE_INTEGER + 1),
      installBody(1, { leaseIdHash: 'abc' }),
      installBody(1, { leaseIdHash: 'z'.repeat(64) }),
      installBody(1, { ttlMs: 499 }),
      installBody(1, { ttlMs: 60_001 }),
      installBody(1, { ttlMs: 1_000.5 }),
      installBody(1, { userId: '' }),
      installBody(1, { displayName: 'x'.repeat(201) }),
      installBody(1, { sessionId: 7 }),
      installBody(1, { tenantId: 42 }),
    ];
    for (const body of bad) {
      const res = await post('/robot-1/control-lease/install', body);
      expect(res.status, JSON.stringify(body).slice(0, 80)).toBe(400);
    }
    expect((await post('/robot-1/control-lease/install', installBody(1, { tenantId: null }))).status).toBe(200);
    expect((await post('/robot-1/control-lease/install', installBody(2, { ttlMs: 60_000 }))).status).toBe(200);
  });

  it('renews the installed generation and refuses others with 409', async () => {
    await post('/robot-1/control-lease/install', installBody(1));
    registry.setBoundCount(1, 1);
    const ok = await post('/robot-1/control-lease/renew', { generation: 1, ttlMs: 5_000 });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ renewed: true, bound: 1 });

    const wrong = await post('/robot-1/control-lease/renew', { generation: 2, ttlMs: 5_000 });
    expect(wrong.status).toBe(409);
    expect(await wrong.json()).toEqual({ code: 'not_installed' });

    expect((await post('/robot-1/control-lease/renew', { generation: 1 })).status).toBe(400);
  });

  it('renew after the deadline is 409 expired', async () => {
    let clock = 0;
    registry.dispose();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await start(
      new ControlLeaseRegistry({ robotId: 'robot-1', filePath: path.join(dir, 'hw.json'), now: () => clock }),
    );
    await post('/robot-1/control-lease/install', installBody(1, { ttlMs: 500 }));
    clock = 500;
    const late = await post('/robot-1/control-lease/renew', { generation: 1, ttlMs: 5_000 });
    expect(late.status).toBe(409);
    expect(await late.json()).toEqual({ code: 'expired' });
    expect(await (await fetch(`${base}/robot-1/control-lease`)).json()).toMatchObject({ state: 'expired' });
  });

  it('release is idempotent and ignores a stale generation', async () => {
    await post('/robot-1/control-lease/install', installBody(1));
    await post('/robot-1/control-lease/install', installBody(2));
    expect(await (await post('/robot-1/control-lease/release', { generation: 1 })).json()).toEqual({ released: false });
    expect(await (await fetch(`${base}/robot-1/control-lease`)).json()).toMatchObject({ state: 'held', generation: 2 });
    expect(await (await post('/robot-1/control-lease/release', { generation: 2 })).json()).toEqual({ released: true });
    expect(await (await post('/robot-1/control-lease/release', { generation: 2 })).json()).toEqual({ released: false });
    expect((await post('/robot-1/control-lease/release', {})).status).toBe(400);
  });

  it('answers 503 high_water_unreadable when the persisted file is corrupt', async () => {
    const file = path.join(dir, 'corrupt.json');
    fs.writeFileSync(file, 'garbage');
    registry.dispose();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await start(new ControlLeaseRegistry({ robotId: 'robot-1', filePath: file }));
    const res = await post('/robot-1/control-lease/install', installBody(5));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ code: 'high_water_unreadable' });
    expect(await (await fetch(`${base}/robot-1/control-lease`)).json()).toMatchObject({
      state: 'none',
      error: 'high_water_unreadable',
    });
  });

  it('404s for another robot id', async () => {
    expect((await fetch(`${base}/other/control-lease`)).status).toBe(404);
    expect((await post('/other/control-lease/install', installBody(1))).status).toBe(404);
  });

  it('sits behind the personal-data gate: cross-origin refused, wrong bearer refused, right bearer honoured', async () => {
    const cross = await post('/robot-1/control-lease/install', installBody(1), { Origin: 'http://evil.example' });
    expect(cross.status).toBe(403);
    expect(cross.headers.get('access-control-allow-origin')).toBeNull();
    expect((await fetch(`${base}/robot-1/control-lease`, { headers: { Origin: 'http://evil.example' } })).status).toBe(403);
    expect(registry.observe().state).toBe('none');

    vi.stubEnv(MEMORY_TOKEN_ENV, 'secret');
    expect((await post('/robot-1/control-lease/install', installBody(1))).status).toBe(401);
    expect(
      (await post('/robot-1/control-lease/install', installBody(1), { Authorization: 'Bearer nope' })).status,
    ).toBe(401);
    expect((await fetch(`${base}/robot-1/control-lease`)).status).toBe(401);
    expect(registry.observe().state).toBe('none');

    const ok = await post('/robot-1/control-lease/install', installBody(1), { Authorization: 'Bearer secret' });
    expect(ok.status).toBe(200);
  });
});
