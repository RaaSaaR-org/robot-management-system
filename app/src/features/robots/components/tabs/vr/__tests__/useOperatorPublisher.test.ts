/**
 * @file useOperatorPublisher.test.ts
 * @description The operator state the headset relays (TASK-414): built from
 *              the rig telemetry with the robot panel's why line, rounded,
 *              grip clamped, a stale `held` dropped — and small enough for the
 *              server's 2 KB cap with both hands and the head.
 * @feature robots
 */

import { describe, it, expect } from 'vitest';
import { buildOperatorState, wirePose } from '../useOperatorPublisher';
import { createRigTelemetry } from '../VrTeleopRig';
import { robotPanelTitle } from '../VrRobotPanel';

describe('buildOperatorState', () => {
  it('relays link, grip, clutch, held and the local why line', () => {
    const t = createRigTelemetry();
    const now = 1_000_000;
    t.socketOpen = true;
    t.link = 'live';
    t.rttMs = 37.6;
    t.controllers = { left: true, right: true };
    t.clutch = { left: false, right: true };
    t.left.squeeze = -0.2;
    t.right.squeeze = 0.876;
    t.armHeld = { side: 'right', reason: 'arm_gate', at: now - 100 };
    const s = buildOperatorState(t, now, null, true);
    expect(s).toMatchObject({
      inVr: true, link: 'live', rttMs: 38,
      clutch: { left: false, right: true }, grip: { left: 0, right: 0.88 },
      held: { side: 'right', reason: 'arm_gate' },
    });
    expect(s.why).toEqual({ code: 'arm_refused', severity: 'block', text: "Arm refused by the robot's arm gate. Check the desktop window." });
  });

  it('says the E-stop is latched, and drops a held answer older than 1 s', () => {
    const t = createRigTelemetry();
    t.estopLatched = true;
    t.armHeld = { side: 'left', reason: 'estop', at: 0 };
    const s = buildOperatorState(t, 5_000, null, true);
    expect(s.held).toBeNull();
    expect(s.why.severity).toBe('block');
    expect(s.why.text).toMatch(/^E-stop latched — hold Reset/);
  });

  it('takes the server reason when it blocks, with its code', () => {
    const t = createRigTelemetry();
    t.socketOpen = true;
    t.link = 'live';
    t.controllers = { left: true, right: true };
    const s = buildOperatorState(t, 0, { code: 'sidecar_down', severity: 'block', text: 'The sidecar is not running.', source: 'server' }, true);
    expect(s.why).toEqual({ code: 'sidecar_down', severity: 'block', text: 'The sidecar is not running.' });
  });

  it('rounds poses, drops the grip, refuses non-finite ones, and fits in 2 KB', () => {
    expect(wirePose({ p: [0.123456, -0.2, 0.3], q: [0.123456, 0, 0, 0.99], grip: 1 })).toEqual({
      p: [0.123, -0.2, 0.3], q: [0.1235, 0, 0, 0.99],
    });
    expect(wirePose({ p: [NaN, 0, 0], q: [0, 0, 0, 1] })).toBeNull();
    const t = createRigTelemetry();
    t.head = { p: [0.0000001, 0, 0], q: [0.11111111, 0.2222222, 0.3333333, 0.9] };
    t.targets.left = { p: [0.3333333, 0.2222222, -0.311111], q: [0.1111111, 0.2222222, 0.3333333, 0.9] };
    t.targets.right = { p: [0.3333333, -0.2222222, -0.311111], q: [0.1111111, 0.2222222, 0.3333333, 0.9] };
    t.armRefusal = { code: 'x'.repeat(80), message: 'y'.repeat(300), at: 0 };
    const s = buildOperatorState(t, 0, null, true);
    expect(new TextEncoder().encode(JSON.stringify(s)).length).toBeLessThan(2048);
    expect(s.why.text.length).toBeLessThanOrEqual(160);
  });
});

describe('robotPanelTitle', () => {
  it('names who watches from a desktop', () => {
    expect(robotPanelTitle(null)).toBe('ROBOT');
    expect(robotPanelTitle('Ben (desktop)')).toBe('ROBOT · WATCHING Ben (desktop)');
  });
});
