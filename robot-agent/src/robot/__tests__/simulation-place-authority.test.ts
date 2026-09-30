/**
 * @file simulation-place-authority.test.ts
 * @description The simulation names the place it arrived at only while nothing
 *              else owns the robot's position (TASK-195, TASK-333), and never
 *              writes a `zone` — `location.place` is the only answer to where
 *              the robot is.
 * @feature robot
 * @status test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SimulationEngine } from '../SimulationEngine.js';
import type { SimulatedRobotState } from '../types.js';

function makeState(): SimulatedRobotState {
  return {
    id: 'robot-1',
    // 5 cm short of the target: one tick arrives.
    location: { x: 3, y: 3.95, floor: '1', place: 'STAGING' },
    targetLocation: { x: 3, y: 4, floor: '1', place: 'DOCK-1' },
    status: 'busy',
    batteryLevel: 90,
    robotType: 'g1_edu',
    errors: [],
    warnings: [],
  } as unknown as SimulatedRobotState;
}

function makeEngine(state: SimulatedRobotState) {
  return new SimulationEngine(
    () => state,
    (update) => update(state),
    () => {},
    // Fast tick so one advanceTimersByTime is one tick.
    { tickIntervalMs: 10 },
  );
}

describe('SimulationEngine — who owns location.place', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Nothing here should reach the network; this keeps the run offline.
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('names the arrival place when nothing else owns the position, and writes no zone', async () => {
    const state = makeState();
    const engine = makeEngine(state);
    engine.start();
    await vi.advanceTimersByTimeAsync(15);
    engine.stop();

    expect(state.location).toMatchObject({ x: 3, y: 4, place: 'DOCK-1' });
    expect(state.location).not.toHaveProperty('zone');
    expect(state.targetLocation).toBeUndefined();
  });

  it('leaves the place to the resolver while a real pose owns the position', async () => {
    const state = makeState();
    const engine = makeEngine(state);
    engine.setPoseAuthority(() => true);
    engine.start();
    await vi.advanceTimersByTimeAsync(15);
    engine.stop();

    expect(state.location.place).toBe('STAGING');
  });

  it('falls back to the simulation when the authority probe throws', async () => {
    const state = makeState();
    const engine = makeEngine(state);
    engine.setPoseAuthority(() => {
      throw new Error('probe broke');
    });
    engine.start();
    await vi.advanceTimersByTimeAsync(15);
    engine.stop();

    expect(state.location.place).toBe('DOCK-1');
  });

  it('clears the place when arriving at bare coordinates', async () => {
    const state = makeState();
    state.targetLocation = { x: 3, y: 4, floor: '1' };
    const engine = makeEngine(state);
    engine.start();
    await vi.advanceTimersByTimeAsync(15);
    engine.stop();

    expect(state.location.place).toBeNull();
  });
});
