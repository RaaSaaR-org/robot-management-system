/**
 * @file SafetyMonitor.estop-latch.test.ts
 * @description Latch semantics of the E-stop record: who owns `triggeredBy`/`reason`
 *   through a cascading stop, and what a refused reset leaves behind.
 * @feature safety
 *
 * Agent Mode is manual-E-Stop-only (TASK-194), which makes these two questions
 * load-bearing rather than cosmetic: the operator's only recovery path reads the
 * latch, so the latch has to say who really stopped the robot and must never
 * report "not stopped" while the robot is in fact still latched.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SafetyMonitor } from '../SafetyMonitor.js';
import type { SimulatedRobotState } from '../../robot/types.js';

function makeMonitor() {
  const state = {
    speed: 0,
    status: 'online',
    warnings: [] as string[],
    // executeStop() logs the stop location, so this has to be present.
    location: { x: 0, y: 0, zone: 'Warehouse A' },
    updatedAt: new Date().toISOString(),
  } as unknown as SimulatedRobotState;

  const monitor = new SafetyMonitor(
    () => state,
    (updater) => updater(state),
    () => undefined
  );

  return { monitor, state };
}

describe('SafetyMonitor E-stop latch', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  it('keeps the FIRST emergency stop as the record when the stop cascades', () => {
    const { monitor } = makeMonitor();

    monitor.triggerEmergencyStop('remote', 'operator hit the fleet E-Stop');
    // Agent Mode latches a moment later as a consequence of the same stop.
    monitor.triggerEmergencyStop('local', 'Agent Mode E-Stop');

    const estop = monitor.getEStopState();
    expect(estop.triggeredBy).toBe('remote');
    expect(estop.reason).toBe('operator hit the fleet E-Stop');
  });

  it('does not let an auto-resetting protective stop take over an E-Stop record', () => {
    const { monitor } = makeMonitor();

    monitor.triggerEmergencyStop('remote', 'operator hit the fleet E-Stop');
    monitor.triggerProtectiveStop('communication_timeout', 'Server communication lost');

    const estop = monitor.getEStopState();
    expect(estop.triggeredBy).toBe('remote');
    expect(estop.reason).toBe('operator hit the fleet E-Stop');
    // The dangerous part: a protective record would auto-clear on heartbeat.
    expect(estop.requiresManualReset).toBe(true);
  });

  it('lets a real E-Stop replace a latched protective stop', () => {
    const { monitor } = makeMonitor();

    monitor.triggerProtectiveStop('communication_timeout', 'Server communication lost');
    monitor.triggerEmergencyStop('remote', 'operator hit the fleet E-Stop');

    const estop = monitor.getEStopState();
    expect(estop.triggeredBy).toBe('remote');
    expect(estop.reason).toBe('operator hit the fleet E-Stop');
    expect(estop.requiresManualReset).toBe(true);
  });

  it('stays triggered when the reset is refused', () => {
    const { monitor } = makeMonitor();
    monitor.triggerEmergencyStop('remote', 'operator hit the fleet E-Stop');

    // Fresh monitor: no server heartbeat yet, so canReset() refuses.
    expect(monitor.resetEmergencyStop()).toBe(false);

    // The bug this covers: the refused reset left status on 'resetting', which
    // made isEStopTriggered() answer false about a robot that was still latched.
    expect(monitor.isEStopTriggered()).toBe(true);
    expect(monitor.getEStopState().status).toBe('triggered');
    expect(monitor.getEStopState().triggeredBy).toBe('remote');
  });

  it('clears the latch on an accepted reset, and re-arms for the next trigger', () => {
    const { monitor } = makeMonitor();
    monitor.triggerEmergencyStop('remote', 'operator hit the fleet E-Stop');
    monitor.updateServerHeartbeat();

    expect(monitor.resetEmergencyStop()).toBe(true);
    expect(monitor.isEStopTriggered()).toBe(false);

    // A later stop must own the record — the first-wins rule is scoped to one latch.
    monitor.triggerEmergencyStop('zone', 'entered a no-go zone');
    expect(monitor.getEStopState().reason).toBe('entered a no-go zone');
  });
});
