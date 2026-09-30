/**
 * @file control-lease-ingress.test.ts
 * @description REST motion ingress under the control lease (TASK-316): with
 *              `CONTROL_LEASE_REQUIRED` on and a lease held, every start route
 *              answers 409 `control_lease_held` and starts nothing, while stop,
 *              abort and E-stop routes still go through. With no lease held, or
 *              the flag off, the routes behave as before.
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

const agentMode = vi.hoisted(() => ({
  submitCommand: vi.fn(async () => ({ accepted: true })),
  startTour: vi.fn(async () => ({ accepted: true })),
  startPatrol: vi.fn(async () => ({ accepted: true })),
  abortTour: vi.fn(() => ({ aborted: true })),
  abortPatrol: vi.fn(() => ({ aborted: true })),
  estop: vi.fn(async () => ({ stopped: true, delivered: true })),
}));
const skillAbort = vi.hoisted(() => vi.fn(() => true));

vi.mock('../../agent-mode/agent-mode-controller.js', () => ({
  agentModeController: agentMode,
}));
vi.mock('../../agent-mode/identity.js', () => ({
  getIdentityStore: () => ({ load: vi.fn() }),
}));
vi.mock('../../vla/skill-executor.js', () => ({
  SkillExecutor: class {
    run = vi.fn(async () => ({ status: "completed", steps: [] }));
    abort(): void {}
    isAborted(): boolean {
      return false;
    }
  },
  skillExecutorRegistry: {
    register: (): void => {},
    unregister: (): void => {},
    abort: skillAbort,
    abortAll: (): number => 0,
  },
}));

import { createRestRoutes } from '../rest-routes.js';
import { ControlLeaseRegistry, hashLeaseId } from '../../control-lease/control-lease.js';
import type { RobotStateManager } from '../../robot/state.js';

function makeState() {
  return {
    getRobotInterface: () => ({ id: 'robot-1', status: 'idle' }),
    updateServerHeartbeat: vi.fn(),
    executeCommand: vi.fn(async (type: string) => ({ id: 'cmd-1', type, status: 'completed' })),
    acceptTask: vi.fn(async () => true),
    getTaskQueueLength: vi.fn(() => 1),
    startVLAControl: vi.fn(async () => {}),
    stopVLAControl: vi.fn(async () => {}),
    pauseVLAControl: vi.fn(),
    resumeVLAControl: vi.fn(),
    isVLAActive: vi.fn(() => false),
    getVLAStatus: vi.fn(() => ({ active: false })),
    triggerEmergencyStop: vi.fn(),
    getEStopState: vi.fn(() => ({ active: true })),
  };
}

/** Every start route, with a body that would otherwise start motion. */
const START_ROUTES: Array<[string, unknown]> = [
  ['/command', { type: 'move', payload: { x: 1 } }],
  ['/skills/execute', { skillId: 'skill-1' }],
  ['/vla/start', { instruction: 'pick the cup' }],
  ['/vla/resume', {}],
  ['/evaluation/run', { skillId: 'skill-1' }],
  ['/tasks', { id: 'task-1', actionType: 'move', instruction: 'go' }],
  ['/agent-mode/command', { text: 'walk forward' }],
  ['/agent-mode/tour', { routeId: 'tour-1' }],
  ['/agent-mode/patrol', { routeId: 'patrol-1' }],
];

describe('Control lease REST motion ingress (TASK-316)', () => {
  let server: Server;
  let base: string;
  let dir: string;
  let registry: ControlLeaseRegistry;
  let state: ReturnType<typeof makeState>;
  let required: boolean;

  beforeEach(async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const fn of Object.values(agentMode)) fn.mockClear();
    skillAbort.mockClear();
    required = true;
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'control-lease-ingress-'));
    registry = new ControlLeaseRegistry({
      robotId: 'robot-1',
      filePath: path.join(dir, 'hw.json'),
      enforced: () => required,
    });
    state = makeState();
    const app = express();
    app.use(express.json());
    app.use('/api/v1', createRestRoutes(state as unknown as RobotStateManager, undefined, undefined, registry));
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve());
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/robots/robot-1`;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    registry.dispose();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const post = (p: string, body: unknown) =>
    fetch(`${base}${p}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  const hold = (generation = 1): void => {
    const result = registry.install({
      generation,
      leaseIdHash: hashLeaseId('secret'),
      sessionId: 'session-1',
      userId: 'user-ada',
      displayName: 'Ada',
      tenantId: null,
      ttlMs: 60_000,
    });
    expect(result.ok).toBe(true);
  };

  const nothingStarted = (): void => {
    expect(state.executeCommand).not.toHaveBeenCalled();
    expect(state.acceptTask).not.toHaveBeenCalled();
    expect(state.startVLAControl).not.toHaveBeenCalled();
    expect(state.resumeVLAControl).not.toHaveBeenCalled();
    expect(agentMode.submitCommand).not.toHaveBeenCalled();
    expect(agentMode.startTour).not.toHaveBeenCalled();
    expect(agentMode.startPatrol).not.toHaveBeenCalled();
  };

  it.each(START_ROUTES)('flag on + lease held: POST %s answers 409 naming the holder', async (route, body) => {
    hold();
    const res = await post(route, body);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      code: 'control_lease_held',
      holder: { displayName: 'Ada', userId: 'user-ada' },
      message: expect.stringContaining('Ada'),
    });
    nothingStarted();
  });

  it('flag on + lease held: stop, abort and E-stop routes still succeed', async () => {
    hold();
    const stops: Array<[string, unknown]> = [
      ['/command', { type: 'stop' }],
      ['/command', { type: 'emergency_stop' }],
      ['/vla/stop', {}],
      ['/vla/pause', {}],
      ['/skills/abort', { skillId: 'skill-1' }],
      ['/agent-mode/tour/abort', {}],
      ['/agent-mode/patrol/abort', {}],
      ['/agent-mode/estop', {}],
      ['/safety/estop', { reason: 'test' }],
    ];
    for (const [route, body] of stops) {
      const res = await post(route, body);
      expect(res.status, route).toBeLessThan(300);
    }
    expect(state.executeCommand).toHaveBeenCalledWith('stop', {});
    expect(state.executeCommand).toHaveBeenCalledWith('emergency_stop', {});
    expect(state.stopVLAControl).toHaveBeenCalled();
    expect(state.pauseVLAControl).toHaveBeenCalled();
    expect(skillAbort).toHaveBeenCalledWith('skill-1');
    expect(agentMode.abortTour).toHaveBeenCalled();
    expect(agentMode.abortPatrol).toHaveBeenCalled();
    expect(state.triggerEmergencyStop).toHaveBeenCalled();
  });

  it('flag on + no lease held: start routes are admitted as today', async () => {
    for (const [route, body] of START_ROUTES) {
      const res = await post(route, body);
      expect(res.status, route).not.toBe(409);
    }
    expect(state.executeCommand).toHaveBeenCalledWith('move', { x: 1 });
    expect(state.acceptTask).toHaveBeenCalled();
    expect(state.startVLAControl).toHaveBeenCalled();
    expect(state.resumeVLAControl).toHaveBeenCalled();
    expect(agentMode.submitCommand).toHaveBeenCalled();
    expect(agentMode.startTour).toHaveBeenCalled();
    expect(agentMode.startPatrol).toHaveBeenCalled();
  });

  it('flag on + released or expired lease: start routes are admitted again', async () => {
    hold(1);
    registry.release({ generation: 1 });
    const res = await post('/vla/start', { instruction: 'pick the cup' });
    expect(res.status).toBe(200);
    expect(state.startVLAControl).toHaveBeenCalled();
  });

  it('flag off + lease held: start routes are admitted as today', async () => {
    required = false;
    hold();
    for (const [route, body] of START_ROUTES) {
      const res = await post(route, body);
      expect(res.status, route).not.toBe(409);
    }
    expect(state.executeCommand).toHaveBeenCalledWith('move', { x: 1 });
    expect(agentMode.startPatrol).toHaveBeenCalled();
  });
});
