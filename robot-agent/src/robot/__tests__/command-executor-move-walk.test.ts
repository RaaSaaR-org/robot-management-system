/**
 * @file command-executor-move-walk.test.ts
 * @description TASK-336: `move` on a sidecar-backed robot (MuJoCo G1, real G1)
 *              walks on real locomotion and completes only when the walk ends;
 *              a refused walk fails the command before any motion; a pure-sim
 *              robot keeps the kinematic SimulationEngine path unchanged.
 * @feature robot
 * @status test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommandExecutor, type MoveLocomotion } from '../CommandExecutor.js';
import type { SimulatedRobotState } from '../types.js';
import type { MoveWalkOutcome, MoveWalkStart } from '../../agent-mode/agent-mode-controller.js';

function makeState(): SimulatedRobotState {
  return {
    id: 'robot-1',
    status: 'online',
    batteryLevel: 90,
    location: { x: 0, y: 0, floor: '1', place: null },
    speed: 0,
    warnings: [],
    updatedAt: new Date().toISOString(),
  } as unknown as SimulatedRobotState;
}

/** A walk whose end the test decides. */
function deferredWalk(): { start: MoveWalkStart; finish: (o: MoveWalkOutcome) => void } {
  let finish!: (o: MoveWalkOutcome) => void;
  const done = new Promise<MoveWalkOutcome>((resolve) => {
    finish = resolve;
  });
  return { start: { ok: true, planId: 'plan-1', message: 'Walking to (4.00, -1.00)', done }, finish };
}

/** Let the `.then` chains on a settled walk run. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function rig(engaged: boolean, walkTo: MoveLocomotion['walkTo']) {
  const state = makeState();
  const locomotion = {
    engaged: vi.fn(() => engaged),
    walkTo: vi.fn(walkTo),
    stop: vi.fn(() => true),
  };
  const executor = new CommandExecutor(
    { speedUnitsPerSecond: 2, agentEstop: async () => ({ stopped: false }), locomotion },
    () => state,
    (updater) => updater(state),
  );
  return { state, locomotion, executor };
}

describe('CommandExecutor — move on a pure-sim robot (kinematic path unchanged)', () => {
  it('sets the kinematic target and completes at once, never touching locomotion', async () => {
    const h = rig(false, async () => ({ ok: false, message: 'must not be called' }));
    const command = await h.executor.execute('move', { destination: { x: 4, y: -1 } });

    expect(command.status).toBe('completed');
    expect(h.state.targetLocation).toMatchObject({ x: 4, y: -1 });
    expect(h.state.status).toBe('busy');
    expect(h.locomotion.walkTo).not.toHaveBeenCalled();
  });
});

describe('CommandExecutor — move on a sidecar-backed robot (TASK-336)', () => {
  let walk: ReturnType<typeof deferredWalk>;
  beforeEach(() => {
    walk = deferredWalk();
  });

  it('stays executing while the robot walks, and completes only on arrival', async () => {
    const h = rig(true, async () => walk.start);
    const command = await h.executor.execute('move', { destination: { x: 4, y: -1 } });

    expect(h.locomotion.walkTo).toHaveBeenCalledWith({ x: 4, y: -1, place: null });
    expect(command.status).toBe('executing');
    expect(command.completedAt).toBeUndefined();
    // The kinematic engine must not drag an odometry-owned pose around.
    expect(h.state.targetLocation).toBeUndefined();
    expect(h.state.status).toBe('busy');
    expect(h.state.currentTaskName).toBe('Walking to (4.0, -1.0)');

    walk.finish({ ok: true, message: 'Arrived in (4.00, -1.00) after 2 stages and 4.10 m' });
    await flush();

    expect(command.status).toBe('completed');
    expect(command.completedAt).toBeDefined();
    expect(command.result).toMatchObject({ message: expect.stringContaining('Arrived') });
    expect(h.state.status).toBe('online');
    expect(h.state.currentTaskName).toBeUndefined();
  });

  it('turns a walk that ends short into a failed command with the walk’s reason', async () => {
    const h = rig(true, async () => walk.start);
    const command = await h.executor.execute('move', { destination: { x: 4, y: -1 } });

    walk.finish({ ok: false, message: 'move to (4.00, -1.00) failed: no route' });
    await flush();

    expect(command.status).toBe('failed');
    expect(command.errorMessage).toBe('move to (4.00, -1.00) failed: no route');
    expect(h.state.status).toBe('online');
  });

  it('fails the command with the refusal, and no motion, when the walk is refused', async () => {
    const reason = "move refused: the robot's frame is not registered to its twin — twin frame";
    const h = rig(true, async () => ({ ok: false, message: reason }));
    const command = await h.executor.execute('move', { destination: { x: 4, y: -1 } });

    expect(command.status).toBe('failed');
    expect(command.errorMessage).toBe(reason);
    expect(h.state.status).toBe('online');
    expect(h.state.targetLocation).toBeUndefined();
  });

  it('never reports completed when the walk start throws', async () => {
    const h = rig(true, async () => {
      throw new Error('sidecar gone');
    });
    const command = await h.executor.execute('move', { destination: { x: 4, y: -1 } });

    expect(command.status).toBe('failed');
    expect(command.errorMessage).toMatch(/sidecar gone/);
  });

  it('routes return_home through the same walk', async () => {
    const h = rig(true, async () => walk.start);
    const command = await h.executor.execute('return_home');

    expect(h.locomotion.walkTo).toHaveBeenCalledWith({ x: 0, y: 0, place: null });
    expect(command.status).toBe('executing');
    walk.finish({ ok: true, message: 'Arrived' });
    await flush();
    expect(command.status).toBe('completed');
  });

  it('does not clobber a status something else set while the robot walked', async () => {
    const h = rig(true, async () => walk.start);
    await h.executor.execute('move', { destination: { x: 4, y: -1 } });
    h.state.status = 'error';

    walk.finish({ ok: false, message: 'aborted' });
    await flush();

    expect(h.state.status).toBe('error');
  });

  it('stop aborts the running walk', async () => {
    const h = rig(true, async () => walk.start);
    await h.executor.execute('move', { destination: { x: 4, y: -1 } });
    const result = await h.executor.stop();

    expect(h.locomotion.stop).toHaveBeenCalledOnce();
    expect(result.message).toMatch(/walk was aborted/);
  });
});
