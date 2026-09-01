/**
 * @file walk-profile.test.ts
 * @description The commanded forward velocity and the speed a distance is
 *              divided by are two different numbers (TASK-227 follow-up) — the
 *              same split `turn-profile.test.ts` pins for a turn. Above all it
 *              pins that with no env var set, every case reproduces the old
 *              coupled arithmetic exactly.
 * @feature agentmode
 * @status test
 */

import { describe, it, expect, afterEach } from 'vitest';
import { walkToCommand, type WalkCommand } from '../block-executor.js';
import type { WalkDirection } from '../types.js';
import { config } from '../../config/config.js';

/**
 * MEASURED on the live Isaac factory rig, 2026-08-30, against the sim's true
 * root pose (`rt/sim_state`) rather than odometry — odometry dead-reckoned the
 * command back until TASK-231, so it could not have seen this.
 *
 * Two properties the table encodes: a STEPPING THRESHOLD below which the base
 * never initiates a gait, and a response above it that saturates at roughly a
 * quarter of whatever is commanded. Both are why one number cannot serve as
 * the commanded velocity AND the speed a duration is derived from.
 */
const MEASURED: Array<[commandedVx: number, achievedMps: number]> = [
  [0.3, 0.001],
  [0.5, 0.083],
  [1.0, 0.276],
  [1.5, 0.341],
];

/** What the sim clamps `vx` to — `sim_g1_dds/loco_state.py`. */
const MAX_VX = 1.5;

const TUNABLE = ['walkSpeedMps', 'walkCommandMps', 'walkAchievedMps'] as const;

const SAVED = Object.fromEntries(TUNABLE.map((k) => [k, config.agentMode[k]])) as Record<
  (typeof TUNABLE)[number],
  number
>;

afterEach(() => {
  for (const key of TUNABLE) config.agentMode[key] = SAVED[key];
});

const DIRECTIONS: WalkDirection[] = ['forward', 'backward', 'left', 'right'];
const DISTANCES = [0, 0.01, 0.1, 0.3, 1, 2, 8, 100, -1, -0.5];

describe('walk conversion — the untuned default is the OLD arithmetic, exactly', () => {
  const LEGACY_MIN_S = 0.2;
  const LEGACY_MAX_S = 60;
  const AXES: Record<WalkDirection, { fx: number; fy: number }> = {
    forward: { fx: 1, fy: 0 },
    backward: { fx: -1, fy: 0 },
    left: { fx: 0, fy: 1 },
    right: { fx: 0, fy: -1 },
  };

  /** `walkToCommand` as it stood before the commanded/achieved split. */
  function legacy(distanceM: number, direction: WalkDirection, speedMps: number): WalkCommand {
    const speed = Math.abs(speedMps) > 1e-6 ? Math.abs(speedMps) : 0.4;
    const distance = Math.abs(distanceM);
    const axes = AXES[direction];
    return {
      vx: axes.fx * speed,
      vy: axes.fy * speed,
      omega: 0,
      durationS: Math.min(LEGACY_MAX_S, Math.max(LEGACY_MIN_S, distance / speed)),
    };
  }

  it('reproduces the old (velocity, duration) for every direction and distance', () => {
    for (const direction of DIRECTIONS) {
      for (const distance of DISTANCES) {
        expect(walkToCommand(distance, direction)).toEqual(
          legacy(distance, direction, config.agentMode.walkSpeedMps)
        );
      }
    }
  });

  it('reproduces it for a NON-default AGENT_WALK_SPEED_MPS too', () => {
    for (const speed of [0, 0.1, 0.4, 1.0, 2.5]) {
      config.agentMode.walkSpeedMps = speed;
      for (const direction of DIRECTIONS) {
        for (const distance of DISTANCES) {
          expect(walkToCommand(distance, direction)).toEqual(legacy(distance, direction, speed));
        }
      }
    }
  });

  it('still honours an explicit speed argument as BOTH velocity and duration', () => {
    // The overrides are for a rig; a caller that passes a speed is asking for
    // the coupled behaviour on purpose, and untuned it still gets it.
    expect(walkToCommand(2, 'forward', 1.0)).toEqual(legacy(2, 'forward', 1.0));
    expect(walkToCommand(1, 'left', 0.25)).toEqual(legacy(1, 'left', 0.25));
  });

  it('leaves the untuned profile coupled — one number in both roles', () => {
    const cmd = walkToCommand(2, 'forward');
    expect(cmd.vx * cmd.durationS).toBeCloseTo(2, 6);
  });
});

describe('walk conversion — the commanded velocity clears the stepping threshold', () => {
  it('commands the configured m/s, not the speed the duration came from', () => {
    config.agentMode.walkSpeedMps = 0.4;
    config.agentMode.walkCommandMps = MAX_VX;

    const cmd = walkToCommand(1, 'forward');
    expect(cmd.vx).toBe(MAX_VX);
    // Untouched by the commanded override: 1 m / 0.4 m/s.
    expect(cmd.durationS).toBeCloseTo(2.5, 6);
  });

  it('applies to the strafing axes too, and never leaks into omega', () => {
    config.agentMode.walkCommandMps = 1.2;
    expect(walkToCommand(1, 'left')).toMatchObject({ vx: 0, vy: 1.2, omega: 0 });
    expect(walkToCommand(1, 'right')).toMatchObject({ vx: 0, vy: -1.2, omega: 0 });
    expect(walkToCommand(1, 'backward')).toMatchObject({ vx: -1.2, vy: 0, omega: 0 });
  });

  it('takes a negative override as a magnitude, never as a reversed axis', () => {
    config.agentMode.walkCommandMps = -1.5;
    expect(walkToCommand(1, 'forward').vx).toBe(1.5);
    expect(walkToCommand(1, 'backward').vx).toBe(-1.5);
  });
});

describe('walk conversion — the duration comes from the ACHIEVED speed', () => {
  it('sizes the hold from what comes back, not from what goes out', () => {
    config.agentMode.walkCommandMps = MAX_VX;
    config.agentMode.walkAchievedMps = 0.341;

    const cmd = walkToCommand(1, 'forward');
    expect(cmd.vx).toBe(MAX_VX);
    expect(cmd.durationS).toBeCloseTo(1 / 0.341, 6);
    // The bug this whole split exists to prevent: coupled, a 1 m walk at the
    // clamp becomes a 0.67 s command — shorter than the base's own gait
    // initiation — and the robot does not move at all.
    expect(cmd.durationS).toBeGreaterThan(1 / MAX_VX);
  });

  it('leaves the commanded velocity alone when only the achieved speed is tuned', () => {
    config.agentMode.walkSpeedMps = 0.4;
    config.agentMode.walkAchievedMps = 0.1;

    const cmd = walkToCommand(1, 'forward');
    expect(cmd.vx).toBe(0.4);
    expect(cmd.durationS).toBeCloseTo(10, 6);
  });

  it('holds long enough to cover the distance at every measured rate', () => {
    config.agentMode.walkAchievedMps = 0.341;
    for (const [commandedVx, achieved] of MEASURED) {
      config.agentMode.walkCommandMps = commandedVx;
      config.agentMode.walkAchievedMps = achieved > 1e-6 ? achieved : 1e-6;
      const cmd = walkToCommand(2, 'forward');
      expect(cmd.vx).toBe(commandedVx);
      expect(cmd.durationS * config.agentMode.walkAchievedMps).toBeCloseTo(
        Math.min(2, 60 * config.agentMode.walkAchievedMps),
        6
      );
    }
  });

  it('still floors and caps the hold', () => {
    config.agentMode.walkCommandMps = MAX_VX;
    config.agentMode.walkAchievedMps = 0.341;
    expect(walkToCommand(0.001, 'forward').durationS).toBe(0.2);
    expect(walkToCommand(1000, 'forward').durationS).toBe(60);
  });

  it('takes a negative override as a magnitude', () => {
    config.agentMode.walkAchievedMps = -0.5;
    expect(walkToCommand(1, 'forward').durationS).toBeCloseTo(2, 6);
  });
});
