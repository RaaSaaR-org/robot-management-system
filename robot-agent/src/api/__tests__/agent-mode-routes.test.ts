/**
 * @file agent-mode-routes.test.ts
 * @description Drives the `/api/v1/robots/:id/agent-mode/...` contract surface
 *              over real HTTP on an ephemeral port, with the Agent Mode
 *              controller singleton mocked, and checks that a VLA start is
 *              refused while Agent Mode owns control.
 * @feature agentmode
 * @status test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import type { AgentModeState, SceneMemory } from '../../agent-mode/types.js';

const STATE: AgentModeState = {
  robotId: 'robot-1',
  enabled: true,
  controlOwner: 'idle',
  plan: null,
  scene: null,
  estopActive: false,
};

const SCENE: SceneMemory = {
  robotId: 'robot-1',
  currentView: 'a table',
  entities: [
    {
      label: 'table',
      bearingDeg: 30,
      distanceEstM: 2,
      // A measured range, so the fixture exercises the provenance the routes
      // now have to carry through untouched.
      distanceSource: 'lidar',
      confidence: 0.9,
      observedSeq: 1,
      lastSeen: '2026-07-25T10:00:00.000Z',
    },
  ],
  personVisible: false,
  forwardClearanceM: 1.8,
  updatedAt: '2026-07-25T10:00:00.000Z',
};

const mocks = vi.hoisted(() => ({
  getState: vi.fn(),
  setEnabled: vi.fn(),
  submitCommand: vi.fn(),
  estop: vi.fn(),
  resetEstop: vi.fn(),
  getScene: vi.fn(),
  sceneMarkdown: vi.fn(),
}));

vi.mock('../../agent-mode/agent-mode-controller.js', () => ({
  agentModeController: mocks,
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
import { controlOwnerLock } from '../../agent-mode/control-owner.js';
import { ControlBusyError } from '../../robot/state.js';
import type { RobotStateManager } from '../../robot/state.js';

const ESTOP_STATE = { status: 'triggered', triggeredBy: 'remote', reason: 'Remote E-stop triggered' };

/**
 * Mirrors the real RobotStateManager's VLA lock lifecycle (claim inside
 * startVLAControl, release inside stopVLAControl / on run completion) so the
 * route tests exercise the routes, not a lock policy of their own. The
 * lifecycle itself is covered against the real manager in
 * `robot/__tests__/state-vla-control.test.ts`.
 */
function makeStateStub(): RobotStateManager & {
  triggerEmergencyStop: ReturnType<typeof vi.fn>;
  finishVlaRun: () => void;
} {
  let vlaActive = false;
  return {
    getRobotInterface: () => ({ id: 'robot-1', status: 'idle' }),
    updateServerHeartbeat: (): void => {},
    startVLAControl: async (): Promise<void> => {
      if (vlaActive) throw new Error('VLA control is already active');
      const claim = controlOwnerLock.claim('vla');
      if (!claim.ok) throw new ControlBusyError(claim.reason ?? 'control is busy.');
      vlaActive = true;
    },
    stopVLAControl: async (): Promise<void> => {
      vlaActive = false;
      controlOwnerLock.release('vla');
    },
    /** Simulates a rollout that ends on its own (max steps / timeout / no server). */
    finishVlaRun: (): void => {
      vlaActive = false;
      controlOwnerLock.release('vla');
    },
    isVLAActive: () => vlaActive,
    getVLAStatus: () => ({}),
    triggerEmergencyStop: vi.fn(),
    getEStopState: () => ESTOP_STATE,
  } as unknown as RobotStateManager & {
    triggerEmergencyStop: ReturnType<typeof vi.fn>;
    finishVlaRun: () => void;
  };
}

describe('Agent Mode REST contract', () => {
  let server: Server;
  let base: string;
  let state: ReturnType<typeof makeStateStub>;

  beforeEach(async () => {
    for (const fn of Object.values(mocks)) fn.mockReset();
    mocks.getState.mockReturnValue(STATE);
    mocks.setEnabled.mockReturnValue({ ...STATE, enabled: false });
    mocks.submitCommand.mockResolvedValue({
      accepted: true,
      planId: 'plan-1',
      message: 'Planning…',
    });
    mocks.estop.mockResolvedValue({ ok: true, stopped: true, delivered: true });
    mocks.resetEstop.mockReturnValue(STATE);
    mocks.getScene.mockReturnValue(SCENE);
    mocks.sceneMarkdown.mockReturnValue('# Current view\n\n- **Robot**: robot-1\n');
    controlOwnerLock.reset();

    state = makeStateStub();
    const app = express();
    app.use(express.json());
    app.use('/api/v1', createRestRoutes(state));
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  });

  afterEach(async () => {
    controlOwnerLock.reset();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it('GET /robots/:id/agent-mode returns the AgentModeState', async () => {
    const res = await fetch(`${base}/robots/robot-1/agent-mode`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(STATE);
  });

  it('404s for a robot this agent does not serve', async () => {
    const res = await fetch(`${base}/robots/other/agent-mode`);

    expect(res.status).toBe(404);
    expect(mocks.getState).not.toHaveBeenCalled();
  });

  it('POST /toggle requires a boolean and forwards it', async () => {
    const bad = await fetch(`${base}/robots/robot-1/agent-mode/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: 'yes' }),
    });
    expect(bad.status).toBe(400);
    expect(mocks.setEnabled).not.toHaveBeenCalled();

    const ok = await fetch(`${base}/robots/robot-1/agent-mode/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });
    expect(ok.status).toBe(200);
    expect(mocks.setEnabled).toHaveBeenCalledWith(false);
  });

  it('POST /command forwards text + contextId and returns the command result', async () => {
    const res = await fetch(`${base}/robots/robot-1/agent-mode/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'geh zum Tisch', contextId: 'ctx-9' }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accepted: true, planId: 'plan-1', message: 'Planning…' });
    expect(mocks.submitCommand).toHaveBeenCalledWith({ text: 'geh zum Tisch', contextId: 'ctx-9' });
  });

  it('POST /command rejects an empty body with 400', async () => {
    const res = await fetch(`${base}/robots/robot-1/agent-mode/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '   ' }),
    });

    expect(res.status).toBe(400);
    expect(mocks.submitCommand).not.toHaveBeenCalled();
  });

  it('answers 200 with accepted:false when the controller refuses', async () => {
    mocks.submitCommand.mockResolvedValue({ accepted: false, message: 'Agent Mode is off' });

    const res = await fetch(`${base}/robots/robot-1/agent-mode/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'lauf' }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accepted: false, message: 'Agent Mode is off' });
  });

  it('POST /estop uses the given reason and defaults sensibly', async () => {
    const res = await fetch(`${base}/robots/robot-1/agent-mode/estop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'operator hit STOPP' }),
    });
    expect(await res.json()).toEqual({ ok: true, stopped: true, delivered: true });
    expect(mocks.estop).toHaveBeenCalledWith('operator hit STOPP');

    await fetch(`${base}/robots/robot-1/agent-mode/estop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(mocks.estop).toHaveBeenLastCalledWith('Manual E-Stop from the operator UI');
  });

  it('POST /estop/reset returns the fresh state', async () => {
    const res = await fetch(`${base}/robots/robot-1/agent-mode/estop/reset`, { method: 'POST' });

    expect(res.status).toBe(200);
    expect(mocks.resetEstop).toHaveBeenCalled();
  });

  it('GET /scene and /scene.md serve the two scene representations', async () => {
    const json = await fetch(`${base}/robots/robot-1/agent-mode/scene`);
    expect(await json.json()).toEqual(SCENE);

    const md = await fetch(`${base}/robots/robot-1/agent-mode/scene.md`);
    expect(md.headers.get('content-type')).toMatch(/text\/markdown/);
    expect(await md.text()).toContain('# Current view');
  });

  it('GET /scene returns null before the first observation', async () => {
    mocks.getScene.mockReturnValue(null);

    const res = await fetch(`${base}/robots/robot-1/agent-mode/scene`);

    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
  });

  // ── the platform E-Stop must reach Agent Mode (TASK-194 finding 15) ────────

  it('POST /safety/estop stops the running Agent Mode plan, not just the sim speed', async () => {
    const res = await fetch(`${base}/robots/robot-1/safety/estop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'operator hit the fleet E-Stop', triggeredBy: 'remote' }),
    });

    expect(res.status).toBe(200);
    // Without this the block executor keeps posting /loco/move and the robot
    // keeps walking while the product reports it as e-stopped.
    expect(mocks.estop).toHaveBeenCalledOnce();
    expect(mocks.estop.mock.calls[0][0]).toContain('operator hit the fleet E-Stop');
    // The existing safety path still latches, with the true trigger source.
    expect(state.triggerEmergencyStop).toHaveBeenCalledWith('remote', 'operator hit the fleet E-Stop');
    expect(await res.json()).toMatchObject({ agentModeStopped: true, ...ESTOP_STATE });
  });

  it('POST /safety/estop still latches when the Agent Mode stop fails, and says so', async () => {
    mocks.estop.mockRejectedValue(new Error('sidecar unreachable'));

    const res = await fetch(`${base}/robots/robot-1/safety/estop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
    expect(state.triggerEmergencyStop).toHaveBeenCalledWith('remote', 'Remote E-stop triggered');
    // HONESTY: never claim a stop we could not deliver.
    expect(await res.json()).toMatchObject({
      agentModeStopped: false,
      agentModeError: 'sidecar unreachable',
    });
  });
});

describe('VLA start arbitration', () => {
  let server: Server;
  let base: string;
  let state: ReturnType<typeof makeStateStub>;

  beforeEach(async () => {
    controlOwnerLock.reset();
    state = makeStateStub();
    const app = express();
    app.use(express.json());
    app.use('/api/v1', createRestRoutes(state));
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  });

  afterEach(async () => {
    controlOwnerLock.reset();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  const startVla = () =>
    fetch(`${base}/robots/robot-1/vla/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instruction: 'pick the cube' }),
    });

  it('refuses to start a VLA rollout while Agent Mode owns control', async () => {
    controlOwnerLock.claim('agent');

    const res = await startVla();

    expect(res.status).toBe(409);
    const json = (await res.json()) as { code: string; message: string; controlOwner: string };
    expect(json.code).toBe('CONTROL_BUSY');
    expect(json.message).toMatch(/Agent Mode/);
    expect(json.controlOwner).toBe('agent');
  });

  it('starts normally when nothing owns control, and takes the lock', async () => {
    const res = await startVla();

    expect(res.status).toBe(200);
    expect(controlOwnerLock.get()).toBe('vla');
  });

  it('hands the lock back on stop', async () => {
    await startVla();
    expect(controlOwnerLock.get()).toBe('vla');

    const res = await fetch(`${base}/robots/robot-1/vla/stop`, { method: 'POST' });

    expect(res.status).toBe(200);
    expect(controlOwnerLock.get()).toBe('idle');
  });

  it('a self-terminating rollout frees the lock without any /vla/stop call', async () => {
    await startVla();
    expect(controlOwnerLock.get()).toBe('vla');

    // Max steps / 10-minute timeout / no VLA server reachable: the loop ends on
    // its own and the operator UI never even shows a Stop button.
    state.finishVlaRun();

    expect(controlOwnerLock.get()).toBe('idle');
    // …and Agent Mode can take control again.
    expect(controlOwnerLock.claim('agent').ok).toBe(true);
  });

  it('a refused second start does not release the live rollout’s lock', async () => {
    await startVla();

    const res = await startVla();

    expect(res.status).toBe(500);
    expect(((await res.json()) as { message: string }).message).toMatch(/already active/);
    // The route must not hand back a lock it never claimed — the first rollout
    // is still driving the robot.
    expect(controlOwnerLock.get()).toBe('vla');
  });
});
