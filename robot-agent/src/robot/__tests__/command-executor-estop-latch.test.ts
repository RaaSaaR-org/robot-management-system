/**
 * @file command-executor-estop-latch.test.ts
 * @description TASK-382: while the E-stop is latched the executor refuses every
 *              command that is not a stop — through `execute()` and through the
 *              direct methods tools, A2A and the task queue call — without
 *              touching state or starting a walk. Stopping is never refused.
 * @feature robot
 * @status test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommandExecutor, ESTOP_LATCHED_MESSAGE } from '../CommandExecutor.js';
import type { CommandType, SimulatedRobotState } from '../types.js';

function makeState(): SimulatedRobotState {
  return {
    id: 'robot-1',
    status: 'protective_stop',
    batteryLevel: 90,
    location: { x: 12, y: 14, floor: '1', place: null },
    speed: 0,
    warnings: [],
    updatedAt: new Date().toISOString(),
  } as unknown as SimulatedRobotState;
}

function rig(latched: () => boolean, engaged = false) {
  const state = makeState();
  const locomotion = {
    engaged: vi.fn(() => engaged),
    walkTo: vi.fn(async () => ({ ok: false as const, message: 'must not be called' })),
    stop: vi.fn(() => false),
  };
  const agentEstop = vi.fn(async () => ({ stopped: false }));
  const executor = new CommandExecutor(
    { speedUnitsPerSecond: 2, agentEstop, locomotion, isEStopTriggered: latched },
    () => state,
    (updater) => updater(state),
  );
  return { state, locomotion, agentEstop, executor };
}

const MOTION: Array<[CommandType, Record<string, unknown>]> = [
  ['move', { destination: { x: 3, y: 3 } }],
  ['charge', {}],
  ['return_home', {}],
  ['pickup', { objectId: 'box-1' }],
  ['drop', {}],
];

describe('CommandExecutor — a latched E-stop refuses motion (TASK-382)', () => {
  let h: ReturnType<typeof rig>;
  beforeEach(() => {
    h = rig(() => true);
  });

  it.each(MOTION)('execute(%s) fails with the latch message and changes nothing', async (type, payload) => {
    const before = JSON.stringify(h.state);
    const command = await h.executor.execute(type, payload);

    expect(command.status).toBe('failed');
    expect(command.errorMessage).toBe(ESTOP_LATCHED_MESSAGE);
    expect(command.result).toMatchObject({ estopLatched: true });
    expect(JSON.stringify(h.state)).toBe(before);
    expect(h.state.status).toBe('protective_stop');
    expect(h.state.targetLocation).toBeUndefined();
  });

  it('refuses the direct methods tools, A2A and the task queue call', async () => {
    h.state.heldObject = 'box-0';
    const results = await Promise.all([
      h.executor.moveTo({ x: 3, y: 3 }),
      h.executor.goToCharge(),
      h.executor.returnHome(),
      h.executor.pickup('box-1'),
      h.executor.drop(),
    ]);
    for (const r of results) {
      expect(r.success).toBe(false);
      expect(r.message).toBe(ESTOP_LATCHED_MESSAGE);
    }
    expect(h.state.location).toMatchObject({ x: 12, y: 14 });
    expect(h.state.heldObject).toBe('box-0');
    expect(h.state.status).toBe('protective_stop');
  });

  it('starts no real walk on a sidecar-backed robot', async () => {
    const s = rig(() => true, true);
    const command = await s.executor.execute('move', { destination: { x: 3, y: 3 } });
    expect(command.status).toBe('failed');
    expect(s.locomotion.walkTo).not.toHaveBeenCalled();
  });

  it('refuses a VLA action', async () => {
    const result = await h.executor.executeVLAAction({
      jointCommands: [1, 0],
      gripperCommand: 0,
      timestamp: Date.now() / 1000,
    } as never);
    expect(result.success).toBe(false);
    expect(result.error).toBe(ESTOP_LATCHED_MESSAGE);
    expect(h.state.location).toMatchObject({ x: 12, y: 14 });
  });

  it('still runs stop and emergency_stop', async () => {
    const stop = await h.executor.execute('stop');
    expect(stop.status).toBe('completed');

    await h.executor.execute('emergency_stop');
    expect(h.agentEstop).toHaveBeenCalledOnce();
  });

  it('treats a latch that cannot be read as latched', async () => {
    const s = rig(() => {
      throw new Error('monitor not ready');
    });
    const command = await s.executor.execute('move', { destination: { x: 3, y: 3 } });
    expect(command.status).toBe('failed');
    expect(command.errorMessage).toBe(ESTOP_LATCHED_MESSAGE);
  });

  it('moves again once the latch is reset', async () => {
    let latched = true;
    const s = rig(() => latched);
    s.state.status = 'online';
    expect((await s.executor.execute('move', { destination: { x: 3, y: 3 } })).status).toBe('failed');

    latched = false;
    const command = await s.executor.execute('move', { destination: { x: 3, y: 3 } });
    expect(command.status).toBe('completed');
    expect(s.state.targetLocation).toMatchObject({ x: 3, y: 3 });
  });
});
