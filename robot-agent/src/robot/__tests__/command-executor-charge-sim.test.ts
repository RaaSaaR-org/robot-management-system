/**
 * @file command-executor-charge-sim.test.ts
 * @description TASK-502: `charge` with no known charging place. A robot is
 *              refused — a made-up charger is a drive to nowhere — unless the
 *              agent is explicitly configured as a simulation AND no real
 *              locomotion is engaged; only then does it charge at the
 *              simulation's own charger, the frame origin.
 * @feature robot
 * @status test
 */

import { describe, it, expect, vi } from 'vitest';
import { CommandExecutor } from '../CommandExecutor.js';
import { simulatedChargerLocation } from '../../tools/navigation.js';
import type { SimulatedRobotState } from '../types.js';

const NO_GRAPH = 'no registered place graph';

function makeState(): SimulatedRobotState {
  return {
    id: 'robot-1',
    status: 'online',
    batteryLevel: 90,
    location: { x: 10, y: 10, floor: '1', place: null },
    speed: 0,
    warnings: [],
    updatedAt: new Date().toISOString(),
  } as unknown as SimulatedRobotState;
}

/** No state manager is registered in this file, so no place graph is known. */
function rig(options: { simulated?: boolean; engaged?: boolean; withLocomotion?: boolean }) {
  const state = makeState();
  const locomotion = {
    engaged: vi.fn(() => options.engaged === true),
    walkTo: vi.fn(async () => ({ ok: false as const, message: 'must not be called' })),
    stop: vi.fn(() => false),
  };
  const executor = new CommandExecutor(
    {
      speedUnitsPerSecond: 2,
      ...(options.simulated === undefined ? {} : { simulated: options.simulated }),
      ...(options.withLocomotion === false ? {} : { locomotion }),
    },
    () => state,
    (updater) => updater(state),
  );
  return { state, locomotion, executor };
}

describe('CommandExecutor — charge without a known charging place (TASK-502)', () => {
  it('a simulated robot with no real locomotion charges at the simulation charger', async () => {
    const h = rig({ simulated: true, engaged: false });

    const command = await h.executor.execute('charge', {});

    expect(command.status).toBe('completed');
    expect(command.errorMessage).toBeUndefined();
    expect(h.state.targetLocation).toEqual(simulatedChargerLocation());
    expect(h.state.targetLocation).toMatchObject({ x: 0, y: 0 });
    expect(h.state.status).toBe('busy');
    expect(h.locomotion.walkTo).not.toHaveBeenCalled();
  });

  it('the direct goToCharge path (tools, A2A, task queue) follows the same rule', async () => {
    const sim = rig({ simulated: true, withLocomotion: false });
    expect((await sim.executor.goToCharge()).success).toBe(true);

    const real = rig({ withLocomotion: false });
    const refused = await real.executor.goToCharge();
    expect(refused.success).toBe(false);
    expect(refused.message).toContain(NO_GRAPH);
  });

  it.each([
    ['not configured as a simulation', { simulated: undefined, engaged: false }],
    ['explicitly configured as real', { simulated: false, engaged: false }],
    ['a real robot with locomotion engaged', { simulated: false, engaged: true }],
    ['a simulation that walks through the sidecar', { simulated: true, engaged: true }],
  ])('%s is refused and does not move', async (_name, options) => {
    const h = rig(options);
    const before = JSON.stringify(h.state);

    const command = await h.executor.execute('charge', {});

    expect(command.status).toBe('failed');
    expect(command.errorMessage).toContain(NO_GRAPH);
    expect(JSON.stringify(h.state)).toBe(before);
    expect(h.state.targetLocation).toBeUndefined();
    expect(h.locomotion.walkTo).not.toHaveBeenCalled();
  });
});
