/**
 * @file simulation-battery-flags.test.ts
 * @description 'Critical battery level' / 'Low battery' must not outlive their cause.
 *              The SafetyMonitor latches a protective stop on any error containing
 *              'Critical' — a stale flag restored from disk at 62 % battery kept
 *              re-latching after every reset (found live on 2026-08-16).
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
    robotType: 'g1_edu',
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

describe('SimulationEngine — battery flags recover with the battery', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('drops a stale Critical battery level error once the battery is clearly above critical', () => {
    const state = makeState({ errors: ['Critical battery level'], warnings: ['Low battery'] });
    run(state);
    expect(state.errors).not.toContain('Critical battery level');
    expect(state.warnings).not.toContain('Low battery');
  });

  it('keeps the flags while the battery is still low (hysteresis: 10 % / 25 %)', () => {
    const state = makeState({ batteryLevel: 8, errors: ['Critical battery level'], warnings: ['Low battery'] });
    run(state);
    expect(state.errors).toContain('Critical battery level');
    expect(state.warnings).toContain('Low battery');
    const low = makeState({ batteryLevel: 22, errors: ['Critical battery level'], warnings: ['Low battery'] });
    run(low);
    expect(low.errors).not.toContain('Critical battery level');
    expect(low.warnings).toContain('Low battery');
  });

  it('clears them while charging too, long before 100 %', () => {
    const state = makeState({ status: 'charging', batteryLevel: 30, errors: ['Critical battery level'], warnings: ['Low battery'] });
    run(state);
    expect(state.errors).toEqual([]);
    expect(state.warnings).toEqual([]);
    expect(state.status).toBe('charging');
  });
});
