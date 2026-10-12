/**
 * @file simulation-estop-latch.test.ts
 * @description TASK-382: the simulation's own battery drives to the charger
 *              never start while the E-stop is latched — they bypass the
 *              CommandExecutor, so they need their own gate.
 * @feature simulation
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SimulationEngine } from '../SimulationEngine.js';
import type { SimulatedRobotState } from '../types.js';

function makeState(over: Partial<SimulatedRobotState>): SimulatedRobotState {
  return {
    id: 'robot-1',
    location: { x: 7, y: 9, floor: '1', zone: '' },
    status: 'online',
    batteryLevel: 50,
    robotType: 'g1_edu',
    speed: 0,
    errors: [],
    warnings: ['Low battery'],
    ...over,
  } as unknown as SimulatedRobotState;
}

function run(state: SimulatedRobotState, latch: (() => boolean) | null, ticks = 3) {
  const engine = new SimulationEngine(() => state, (u) => u(state), () => {}, { tickIntervalMs: 10 });
  engine.setEStopLatch(latch);
  engine.start();
  vi.advanceTimersByTime(10 * ticks);
  engine.stop();
}

describe('SimulationEngine — a latched E-stop holds the robot (TASK-382)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('does not start a critical-battery drive from protective_stop', () => {
    const state = makeState({ status: 'protective_stop' as SimulatedRobotState['status'], batteryLevel: 3 });
    run(state, () => true);
    expect(state.status).toBe('protective_stop');
    expect(state.targetLocation).toBeUndefined();
    expect(state.location).toMatchObject({ x: 7, y: 9 });
  });

  it('does not start a low-battery drive even if the status reads online', () => {
    const state = makeState({ batteryLevel: 15 });
    run(state, () => true);
    expect(state.status).toBe('online');
    expect(state.targetLocation).toBeUndefined();
  });

  it('treats a latch that cannot be read as latched', () => {
    const state = makeState({ batteryLevel: 3 });
    run(state, () => { throw new Error('monitor not ready'); });
    expect(state.targetLocation).toBeUndefined();
  });

  it('still docks on low battery when nothing is latched', () => {
    const state = makeState({ batteryLevel: 15 });
    run(state, () => false, 1);
    expect(state.status).toBe('busy');
    expect(state.targetLocation).toBeDefined();
  });
});
