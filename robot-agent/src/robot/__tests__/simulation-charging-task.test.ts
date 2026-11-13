/**
 * @file simulation-charging-task.test.ts
 * @description The 'Charging' task name belongs to the charging state. A robot
 *              that reached 100 % went back to `online` and kept reporting
 *              "Current task: Charging" while its battery drained (TASK-497,
 *              seen on the demo instance on 2026-11-13).
 * @feature simulation
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SimulationEngine } from '../SimulationEngine.js';
import type { SimulatedRobotState } from '../types.js';

function makeState(over: Partial<SimulatedRobotState>): SimulatedRobotState {
  return {
    id: 'robot-1',
    location: { x: 0, y: 0, floor: '1', zone: '' },
    status: 'online',
    batteryLevel: 62,
    robotType: 'g1',
    errors: [],
    warnings: [],
    ...over,
  } as unknown as SimulatedRobotState;
}

function run(state: SimulatedRobotState, ticks = 1) {
  const engine = new SimulationEngine(() => state, (u) => u(state), () => {}, { tickIntervalMs: 10 });
  engine.start();
  vi.advanceTimersByTime(10 * ticks);
  engine.stop();
}

describe('SimulationEngine — the Charging task ends with the charge', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('keeps the task name while the robot is charging', () => {
    const state = makeState({ status: 'charging', batteryLevel: 50, currentTaskName: 'Charging' });
    run(state);
    expect(state.status).toBe('charging');
    expect(state.currentTaskName).toBe('Charging');
  });

  it('clears it when the battery is full and the robot goes back online', () => {
    const state = makeState({ status: 'charging', batteryLevel: 99.999, currentTaskName: 'Charging' });
    run(state);
    expect(state.status).toBe('online');
    expect(state.currentTaskName).toBeUndefined();
  });

  it('clears a stale one restored on a robot that is not charging', () => {
    const state = makeState({ status: 'online', batteryLevel: 80, currentTaskName: 'Charging' });
    run(state);
    expect(state.currentTaskName).toBeUndefined();
  });

  it('leaves any other task name alone', () => {
    const state = makeState({ status: 'busy', batteryLevel: 80, currentTaskName: 'Holding: box-1' });
    run(state);
    expect(state.currentTaskName).toBe('Holding: box-1');
  });
});
