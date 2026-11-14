/**
 * @file simulation-charger-home.test.ts
 * @description TASK-504: a simulated robot without a place graph charges at its
 *              own point, a few metres from home. With both at the frame origin,
 *              Charge drove nowhere and Home "arrived at the charger", leaving
 *              the robot in `charging` and its controls locked.
 * @feature simulation
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SimulationEngine } from '../SimulationEngine.js';
import { getHomeLocation, simulatedChargerLocation } from '../../tools/navigation.js';
import type { SimulatedRobotState } from '../types.js';

function makeState(over: Partial<SimulatedRobotState>): SimulatedRobotState {
  return {
    id: 'robot-1',
    location: { x: 0, y: 0, floor: '1', place: null },
    status: 'online',
    batteryLevel: 62,
    robotType: 'g1',
    errors: [],
    warnings: [],
    ...over,
  } as unknown as SimulatedRobotState;
}

/** Run the engine at its default 2 m/s for `seconds`, in 100 ms ticks. */
function run(state: SimulatedRobotState, seconds: number) {
  const engine = new SimulationEngine(() => state, (u) => u(state), () => {}, { tickIntervalMs: 100 });
  engine.start();
  vi.advanceTimersByTime(seconds * 1000);
  engine.stop();
}

describe('SimulationEngine — the simulated charger is not home (TASK-504)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('lies outside the 1 m arrival radius around home', async () => {
    const home = await getHomeLocation();
    const charger = simulatedChargerLocation();
    expect(Math.abs(charger.x - home.x)).toBeGreaterThan(1);
    expect(Math.abs(charger.y - home.y)).toBeGreaterThan(1);
  });

  it('a charge from home drives to the charger and then charges', () => {
    const charger = simulatedChargerLocation();
    const state = makeState({ status: 'busy', targetLocation: { ...charger } });

    run(state, 1);
    // Still on the way: it moved, and it is not charging yet.
    expect(state.status).toBe('busy');
    expect(state.location.x).toBeGreaterThan(0);

    run(state, 5);
    expect(state.location).toMatchObject({ x: charger.x, y: charger.y });
    expect(state.status).toBe('charging');
    expect(state.currentTaskName).toBe('Charging');
  });

  it('going home from the charger ends online, not charging', async () => {
    const charger = simulatedChargerLocation();
    const home = await getHomeLocation();
    const state = makeState({
      status: 'busy',
      batteryLevel: 100,
      location: { ...charger },
      targetLocation: { ...home },
    });

    run(state, 6);
    expect(state.location).toMatchObject({ x: home.x, y: home.y });
    expect(state.status).toBe('online');
    expect(state.currentTaskName).toBeUndefined();
  });
});
