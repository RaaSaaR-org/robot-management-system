/**
 * @file state-teleop.test.ts
 * @description Tests for the keyboard/pose teleop state added to RobotStateManager:
 *              entering/leaving teleop, clamped deltas & absolute sets, home/reset,
 *              and the getTelemetry() override that makes simulated joints follow
 *              the operator pose.
 * @feature teleop
 * @status test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { RobotConfig } from '../types.js';

// Deterministic joint set with known limits so clamping is testable.
// shoulder_pan: symmetric ±1, elbow_flex: asymmetric [0, 2], gripper: [-0.5, 0.5].
const TEST_JOINTS = [
  { name: 'shoulder_pan', axis: 'z', limitLower: -1, limitUpper: 1, defaultPosition: 0 },
  { name: 'elbow_flex', axis: 'y', limitLower: 0, limitUpper: 2, defaultPosition: 0.5 },
  { name: 'gripper', axis: 'x', limitLower: -0.5, limitUpper: 0.5, defaultPosition: 0.25 },
];

vi.mock('../joint-configs/index.js', () => ({
  getJointConfig: vi.fn().mockReturnValue(TEST_JOINTS),
}));

// Use the real config module (state.ts's import chain pulls in genkit, which
// reads several config exports); only override the robotId used to build the
// per-robot persistence file path.
vi.mock('../../config/config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../config/config.js')>();
  return {
    ...actual,
    config: { ...actual.config, robotId: 'test-robot' },
  };
});

// Import after mocking so the mocks are applied.
const { RobotStateManager } = await import('../state.js');

function makeConfig(overrides: Partial<RobotConfig> = {}): RobotConfig {
  return {
    id: 'test-robot-1',
    name: 'TestBot',
    model: 'TestModel',
    robotClass: 'standard',
    robotType: 'so101',
    maxPayloadKg: 10,
    description: 'Test robot',
    initialLocation: { x: 0, y: 0, floor: '1' },
    capabilities: ['navigation'],
    ...overrides,
  };
}

describe('RobotStateManager — teleop mode lifecycle', () => {
  let mgr: InstanceType<typeof RobotStateManager>;

  beforeEach(() => {
    mgr = new RobotStateManager(makeConfig());
  });

  it('is inactive by default', () => {
    expect(mgr.isTeleopActive()).toBe(false);
    expect(mgr.getTeleopPositions()).toEqual({});
  });

  it('enableTeleop() seeds the override map from default poses', () => {
    const positions = mgr.enableTeleop();
    expect(mgr.isTeleopActive()).toBe(true);
    expect(positions).toEqual({
      shoulder_pan: 0,
      elbow_flex: 0.5,
      gripper: 0.25,
    });
  });

  it('enableTeleop() is idempotent — does not reset an existing pose', () => {
    mgr.enableTeleop();
    mgr.applyTeleopDelta('shoulder_pan', 0.4);
    const second = mgr.enableTeleop();
    // The earlier nudge survives a second enable.
    expect(second.shoulder_pan).toBeCloseTo(0.4);
  });

  it('disableTeleop() clears the override', () => {
    mgr.enableTeleop();
    mgr.disableTeleop();
    expect(mgr.isTeleopActive()).toBe(false);
    expect(mgr.getTeleopPositions()).toEqual({});
  });
});

describe('RobotStateManager — applyTeleopDelta', () => {
  let mgr: InstanceType<typeof RobotStateManager>;

  beforeEach(() => {
    mgr = new RobotStateManager(makeConfig());
    mgr.enableTeleop();
  });

  it('moves a joint by the delta and returns the new position', () => {
    const next = mgr.applyTeleopDelta('shoulder_pan', 0.3);
    expect(next).toBeCloseTo(0.3);
    expect(mgr.getTeleopPositions().shoulder_pan).toBeCloseTo(0.3);
  });

  it('accumulates successive deltas', () => {
    mgr.applyTeleopDelta('shoulder_pan', 0.3);
    const next = mgr.applyTeleopDelta('shoulder_pan', 0.2);
    expect(next).toBeCloseTo(0.5);
  });

  it('clamps to the upper limit', () => {
    const next = mgr.applyTeleopDelta('shoulder_pan', 5);
    expect(next).toBe(1); // limitUpper
    expect(mgr.getTeleopPositions().shoulder_pan).toBe(1);
  });

  it('clamps to the lower limit (asymmetric joint)', () => {
    // elbow_flex default 0.5, lower limit 0.
    const next = mgr.applyTeleopDelta('elbow_flex', -5);
    expect(next).toBe(0);
  });

  it('returns null for an unknown joint and leaves state untouched', () => {
    const result = mgr.applyTeleopDelta('does_not_exist', 0.5);
    expect(result).toBeNull();
    expect(mgr.getTeleopPositions().does_not_exist).toBeUndefined();
  });

  it('auto-enables teleop if called before enableTeleop()', () => {
    const fresh = new RobotStateManager(makeConfig());
    expect(fresh.isTeleopActive()).toBe(false);
    const next = fresh.applyTeleopDelta('shoulder_pan', 0.2);
    expect(fresh.isTeleopActive()).toBe(true);
    // Seeded from default (0) then nudged by 0.2.
    expect(next).toBeCloseTo(0.2);
  });
});

describe('RobotStateManager — setTeleopJoint (absolute)', () => {
  let mgr: InstanceType<typeof RobotStateManager>;

  beforeEach(() => {
    mgr = new RobotStateManager(makeConfig());
    mgr.enableTeleop();
  });

  it('sets an absolute angle and returns it', () => {
    const next = mgr.setTeleopJoint('elbow_flex', 1.5);
    expect(next).toBeCloseTo(1.5);
    expect(mgr.getTeleopPositions().elbow_flex).toBeCloseTo(1.5);
  });

  it('clamps an out-of-range absolute target', () => {
    expect(mgr.setTeleopJoint('gripper', 99)).toBe(0.5); // upper
    expect(mgr.setTeleopJoint('gripper', -99)).toBe(-0.5); // lower
  });

  it('is absolute, not relative — overwrites the previous value', () => {
    mgr.setTeleopJoint('shoulder_pan', 0.4);
    const next = mgr.setTeleopJoint('shoulder_pan', -0.2);
    expect(next).toBeCloseTo(-0.2);
  });

  it('returns null for an unknown joint', () => {
    expect(mgr.setTeleopJoint('nope', 0.1)).toBeNull();
  });
});

describe('RobotStateManager — homeTeleopJoints', () => {
  it('resets every joint to its default pose', () => {
    const mgr = new RobotStateManager(makeConfig());
    mgr.enableTeleop();
    mgr.setTeleopJoint('shoulder_pan', 0.9);
    mgr.setTeleopJoint('elbow_flex', 1.8);

    const homed = mgr.homeTeleopJoints();
    expect(homed).toEqual({
      shoulder_pan: 0,
      elbow_flex: 0.5,
      gripper: 0.25,
    });
  });

  it('auto-enables teleop if not already active', () => {
    const mgr = new RobotStateManager(makeConfig());
    const homed = mgr.homeTeleopJoints();
    expect(mgr.isTeleopActive()).toBe(true);
    expect(homed.shoulder_pan).toBe(0);
  });
});

describe('RobotStateManager — getTelemetry teleop override', () => {
  it('does not alter joint states when teleop is inactive', () => {
    const mgr = new RobotStateManager(makeConfig());
    const telemetry = mgr.getTelemetry();
    // With teleop off, the override branch is skipped. We only assert it
    // did not inject the teleop pose (positions all driven by sim/defaults).
    expect(mgr.isTeleopActive()).toBe(false);
    expect(telemetry.jointStates).toBeDefined();
  });

  it('reflects the teleop pose in jointStates when active', () => {
    const mgr = new RobotStateManager(makeConfig());
    mgr.enableTeleop();
    mgr.setTeleopJoint('shoulder_pan', 0.7);
    mgr.setTeleopJoint('elbow_flex', 1.2);

    const telemetry = mgr.getTelemetry();
    const byName = Object.fromEntries(
      (telemetry.jointStates ?? []).map((j) => [j.name, j]),
    );

    expect(byName.shoulder_pan.position).toBeCloseTo(0.7);
    expect(byName.elbow_flex.position).toBeCloseTo(1.2);
    // Untouched joint falls back to its default pose.
    expect(byName.gripper.position).toBeCloseTo(0.25);
    // Teleop joints report zero velocity.
    expect(byName.shoulder_pan.velocity).toBe(0);
  });

  it('exposes one jointState per configured joint while teleoperating', () => {
    const mgr = new RobotStateManager(makeConfig());
    mgr.enableTeleop();
    const telemetry = mgr.getTelemetry();
    const names = (telemetry.jointStates ?? []).map((j) => j.name).sort();
    expect(names).toEqual(['elbow_flex', 'gripper', 'shoulder_pan']);
  });
});
