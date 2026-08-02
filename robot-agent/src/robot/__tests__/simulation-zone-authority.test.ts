/**
 * @file simulation-zone-authority.test.ts
 * @description The competing-writer resolution (TASK-195): the simulation's
 *              10 Hz `location.zone` writer stands down once something else
 *              owns the robot's position, and keeps working when nothing does.
 * @feature robot
 * @status test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SimulationEngine } from '../SimulationEngine.js';
import type { SimulatedRobotState, Zone } from '../types.js';

const ZONES: Zone[] = [
  {
    id: 'zone-a',
    name: 'Warehouse A',
    type: 'work',
    floor: '1',
    bounds: { x: -10, y: -10, width: 20, height: 20 },
  } as unknown as Zone,
];

function makeState(): SimulatedRobotState {
  return {
    id: 'robot-1',
    location: { x: 0, y: 0, floor: '1', zone: '' },
    status: 'online',
    batteryLevel: 90,
    robotType: 'g1_edu',
    errors: [],
    warnings: [],
  } as unknown as SimulatedRobotState;
}

function makeEngine(state: SimulatedRobotState) {
  const engine = new SimulationEngine(
    () => state,
    (update) => update(state),
    () => {},
    // Fast tick so one advanceTimersByTime is one tick.
    { tickIntervalMs: 10 },
  );
  engine.setZoneCache(ZONES);
  return engine;
}

describe('SimulationEngine — who owns location.zone', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // `prefetchChargingStation` talks to the server on start(); it is already
    // wrapped in a try/catch, this only keeps the run quiet and offline.
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('writes the zone from the simulated position when nothing else owns it', async () => {
    const state = makeState();
    const engine = makeEngine(state);
    engine.start();
    await vi.advanceTimersByTimeAsync(20);

    expect(state.location.zone).toBe('Warehouse A');
    engine.stop();
  });

  it('stands down while a real pose drives the location', async () => {
    const state = makeState();
    const engine = makeEngine(state);
    engine.setPoseAuthority(() => true);
    engine.start();
    await vi.advanceTimersByTimeAsync(50);

    // The place resolver's answer is not clobbered ten times a second by a
    // zone derived from a frozen simulated position.
    expect(state.location.zone).toBe('');
    engine.stop();
  });

  it('hands zone tracking back when the authority is removed', async () => {
    const state = makeState();
    const engine = makeEngine(state);
    engine.setPoseAuthority(() => true);
    engine.start();
    await vi.advanceTimersByTimeAsync(20);
    expect(state.location.zone).toBe('');

    engine.setPoseAuthority(null);
    await vi.advanceTimersByTimeAsync(20);

    expect(state.location.zone).toBe('Warehouse A');
    engine.stop();
  });

  it('a throwing authority probe does not take the tick down', async () => {
    const state = makeState();
    const engine = makeEngine(state);
    engine.setPoseAuthority(() => {
      throw new Error('probe exploded');
    });
    engine.start();
    await vi.advanceTimersByTimeAsync(20);

    // Falls back to the pre-TASK-195 behaviour rather than stopping the loop.
    expect(state.location.zone).toBe('Warehouse A');
    engine.stop();
  });
});
