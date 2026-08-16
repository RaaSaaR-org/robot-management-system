/**
 * @file patrol-routes.test.ts
 * @description Smoke test of the `/api/v1/robots/:id/agent-mode/patrol…` and
 *              `/robots/:id/places` contract surface (TASK-212) over real HTTP,
 *              with the Agent Mode controller singleton mocked: bodies are
 *              validated, refusals are 200 with `accepted:false`, photos sit
 *              behind the personal-data gate.
 * @feature agentmode
 * @status test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import cors from 'cors';
import type { Server } from 'http';
import type { AddressInfo } from 'net';

const mocks = vi.hoisted(() => ({
  startPatrol: vi.fn(),
  abortPatrol: vi.fn(),
  patrolStatus: vi.fn(),
  patrolRuns: vi.fn(),
  patrolRun: vi.fn(),
  patrolPhoto: vi.fn(),
  patrolBaselinePhoto: vi.fn(),
  patrolMarkNormal: vi.fn(),
  patrolPromote: vi.fn(),
  placesForApi: vi.fn(),
}));

vi.mock('../../agent-mode/agent-mode-controller.js', () => ({
  agentModeController: mocks,
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
import type { RobotStateManager } from '../../robot/state.js';

const RUN = {
  runId: 'run-1',
  routeId: 'house-night',
  routeName: 'House night round',
  robotId: 'robot-1',
  mode: 'patrol',
  origin: 'scheduled',
  window: 'night',
  status: 'done',
  startedAt: '2026-08-16T22:00:00.000Z',
  finishedAt: '2026-08-16T22:12:00.000Z',
  legs: [],
  findingCount: 1,
};

describe('Patrol REST contract', () => {
  let server: Server;
  let base: string;

  beforeEach(async () => {
    for (const fn of Object.values(mocks)) fn.mockReset();
    mocks.startPatrol.mockResolvedValue({ accepted: true, runId: 'run-1', message: 'started' });
    mocks.abortPatrol.mockReturnValue({ ok: true, runId: 'run-1' });
    mocks.patrolStatus.mockReturnValue({ enabled: true, active: null, lastRun: RUN });
    mocks.patrolRuns.mockReturnValue([RUN]);
    mocks.patrolRun.mockImplementation((id: string) => (id === 'run-1' ? { ...RUN, findings: [] } : null));
    mocks.patrolPhoto.mockImplementation((runId: string, cp: string) => (runId === 'run-1' && cp === 'cp-hall' ? Buffer.from('JPEG') : null));
    mocks.patrolBaselinePhoto.mockReturnValue(Buffer.from('BASE'));
    mocks.patrolMarkNormal.mockReturnValue({ ok: true, message: 'baseline updated' });
    mocks.patrolPromote.mockReturnValue({ ok: true, message: 'promoted' });
    mocks.placesForApi.mockReturnValue([{ id: 'HALLWAY', name: 'Hallway', placeType: 'cell', keepout: false }]);
    const app = express();
    app.use(cors());
    app.use(express.json());
    app.use(
      '/api/v1',
      createRestRoutes({
        getRobotInterface: () => ({ id: 'robot-1', status: 'idle' }),
        updateServerHeartbeat: (): void => {},
      } as unknown as RobotStateManager),
    );
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  const post = (p: string, body: unknown) =>
    fetch(`${base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  it('POST /agent-mode/patrol starts a run with the route inline, defaults mode/origin, and passes a refusal through as 200', async () => {
    const res = await post('/robots/robot-1/agent-mode/patrol', { routeId: 'house-night', route: { id: 'house-night' } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accepted: true, runId: 'run-1', message: 'started' });
    expect(mocks.startPatrol).toHaveBeenCalledWith({ routeId: 'house-night', mode: 'patrol', origin: 'operator', route: { id: 'house-night' } });

    mocks.startPatrol.mockResolvedValue({ accepted: false, reason: 'battery', message: 'low' });
    const refused = await post('/robots/robot-1/agent-mode/patrol', { routeId: 'house-night', mode: 'baseline', origin: 'scheduled' });
    expect(refused.status).toBe(200);
    expect(await refused.json()).toMatchObject({ accepted: false, reason: 'battery' });
    expect(mocks.startPatrol).toHaveBeenLastCalledWith({ routeId: 'house-night', mode: 'baseline', origin: 'scheduled' });

    expect((await post('/robots/robot-1/agent-mode/patrol', {})).status).toBe(400);
    expect((await post('/robots/other/agent-mode/patrol', { routeId: 'x' })).status).toBe(404);
  });

  it('abort, status, runs, run detail', async () => {
    expect(await (await post('/robots/robot-1/agent-mode/patrol/abort', { reason: 'test' })).json()).toEqual({ ok: true, runId: 'run-1' });
    expect(mocks.abortPatrol).toHaveBeenCalledWith('test');
    expect(await (await fetch(`${base}/robots/robot-1/agent-mode/patrol`)).json()).toEqual({ enabled: true, active: null, lastRun: RUN });
    const runs = await fetch(`${base}/robots/robot-1/agent-mode/patrol/runs?limit=5`);
    expect(await runs.json()).toEqual({ runs: [RUN] });
    expect(mocks.patrolRuns).toHaveBeenCalledWith(5);
    expect((await fetch(`${base}/robots/robot-1/agent-mode/patrol/runs/run-1`)).status).toBe(200);
    expect((await fetch(`${base}/robots/robot-1/agent-mode/patrol/runs/nope`)).status).toBe(404);
  });

  it('photos are image/jpeg behind the personal-data gate (loopback ok, cross-origin refused, token honoured)', async () => {
    const ok = await fetch(`${base}/robots/robot-1/agent-mode/patrol/runs/run-1/photos/cp-hall.jpg`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toMatch(/image\/jpeg/);
    expect(Buffer.from(await ok.arrayBuffer()).toString()).toBe('JPEG');
    expect(mocks.patrolPhoto).toHaveBeenCalledWith('run-1', 'cp-hall');
    expect((await fetch(`${base}/robots/robot-1/agent-mode/patrol/runs/run-1/photos/cp-none.jpg`)).status).toBe(404);
    expect((await fetch(`${base}/robots/robot-1/agent-mode/patrol/runs/run-1/photos/cp-hall.png`)).status).toBe(400);
    const cross = await fetch(`${base}/robots/robot-1/agent-mode/patrol/runs/run-1/photos/cp-hall.jpg`, { headers: { Origin: 'http://evil.example' } });
    expect(cross.status).toBe(403);
    const baseline = await fetch(`${base}/robots/robot-1/agent-mode/patrol/baseline/house-night/night/cp-hall.jpg`);
    expect(baseline.status).toBe(200);
    expect(mocks.patrolBaselinePhoto).toHaveBeenCalledWith('house-night', 'night', 'cp-hall');
    vi.stubEnv(MEMORY_TOKEN_ENV, 'secret');
    expect((await fetch(`${base}/robots/robot-1/agent-mode/patrol/runs/run-1/photos/cp-hall.jpg`)).status).toBe(401);
    expect((await fetch(`${base}/robots/robot-1/agent-mode/patrol/runs/run-1/photos/cp-hall.jpg`, { headers: { Authorization: 'Bearer secret' } })).status).toBe(200);
  });

  it('this-is-normal and promote, and the place graph for the route editor', async () => {
    const normal = await post('/robots/robot-1/agent-mode/patrol/findings/f-1/normal', { runId: 'run-1' });
    expect(normal.status).toBe(200);
    expect(await normal.json()).toEqual({ ok: true, message: 'baseline updated' });
    expect(mocks.patrolMarkNormal).toHaveBeenCalledWith('f-1', 'run-1');
    expect((await post('/robots/robot-1/agent-mode/patrol/findings/f-1/normal', {})).status).toBe(400);
    const promote = await post('/robots/robot-1/agent-mode/patrol/runs/run-1/promote', {});
    expect(promote.status).toBe(200);
    expect(mocks.patrolPromote).toHaveBeenCalledWith('run-1');
    const places = await fetch(`${base}/robots/robot-1/places`);
    expect(await places.json()).toEqual({ places: [{ id: 'HALLWAY', name: 'Hallway', placeType: 'cell', keepout: false }] });
  });
});
