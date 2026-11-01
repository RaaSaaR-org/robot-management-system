/**
 * @file robotStop.test.ts
 * @description What holds the robot stopped (TASK-431): a latch decides, the
 *              status counts only without one, and the agent's stop warning
 *              names the cause and the reason.
 * @feature datacollection
 */

import { describe, it, expect } from 'vitest';
import { resetText, robotStop, stopWarning } from '../robotStop';

const ESTOP = 'Emergency stop activated: Platform E-Stop: Emergency stop triggered for G1-EDU-4 (real)';

describe('robotStop', () => {
  it('nothing latched and the robot online: no stop', () => {
    expect(robotStop({ agentLatched: false, sidecarLatched: false, status: 'online', warnings: [] })).toBeNull();
  });

  it("the agent's latch is an E-stop, with the agent's reason", () => {
    const stop = robotStop({ agentLatched: true, sidecarLatched: false, status: 'protective_stop', warnings: ['battery low', ESTOP] })!;
    expect(stop).toMatchObject({
      kind: 'latched', title: 'E-stop is latched.', short: 'E-stop latched', code: 'estop_latched',
      cause: 'emergency', reason: 'Platform E-Stop: Emergency stop triggered for G1-EDU-4 (real)',
    });
  });

  it('a latch decides even when the status the page has is stale (online)', () => {
    expect(robotStop({ agentLatched: false, sidecarLatched: true, status: 'online' })?.kind).toBe('latched');
  });

  it("a latched protective stop says so, with the monitor's reason", () => {
    const stop = robotStop({ agentLatched: true, sidecarLatched: false, status: 'protective_stop', warnings: ['Protective stop: Fall risk: body tilt 31.0° exceeds 28.6° limit.'] })!;
    expect(stop).toMatchObject({ kind: 'latched', title: 'Protective stop is latched.', code: 'protective_stop', reason: 'Fall risk: body tilt 31.0° exceeds 28.6° limit' });
  });

  it('protective_stop with no latch is its own kind: "Protective stop."', () => {
    const stop = robotStop({ agentLatched: false, sidecarLatched: false, status: 'protective_stop', warnings: [] })!;
    expect(stop).toMatchObject({ kind: 'status', title: 'Protective stop.', short: 'Protective stop', code: 'protective_stop', reason: null });
  });

  it('an error status is not a stop', () => {
    expect(robotStop({ agentLatched: false, sidecarLatched: false, status: 'error' })).toBeNull();
  });
});

describe('stopWarning', () => {
  it('prefers the emergency warning, and reads the plain one too', () => {
    expect(stopWarning(['Protective stop: x', ESTOP])?.cause).toBe('emergency');
    expect(stopWarning(['Emergency stop was activated'])).toEqual({ cause: 'emergency', reason: null });
    expect(stopWarning(undefined)).toBeNull();
  });
});

describe('resetText', () => {
  it('says what the button does, never "at the robot"', () => {
    const latched = robotStop({ agentLatched: true, sidecarLatched: true, status: 'protective_stop', warnings: [ESTOP] })!;
    const unlatched = robotStop({ agentLatched: false, sidecarLatched: false, status: 'protective_stop' })!;
    expect(resetText(latched, true)).toBe(
      'Reset E-stop clears the latch in the robot agent and in the sidecar. It does not move the robot. The operator can also reset it in the headset.',
    );
    expect(resetText(unlatched, true)).toContain('no latch holds it');
    expect(resetText(unlatched, true)).not.toContain('headset');
    expect(resetText(latched, false)).not.toContain('at the robot');
  });
});
