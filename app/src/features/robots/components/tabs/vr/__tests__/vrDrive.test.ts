/**
 * @file vrDrive.test.ts
 * @description Tests for thumbstick conditioning and the "either stick drives"
 *              choice the rig used to get wrong.
 * @feature robots
 */

import { describe, it, expect } from 'vitest';
// The classifier that decides 'default' | 'touched' | 'pressed' for every named
// controller component. Reached through `@pmndrs/xr`'s published `/internals`
// subpath (it is what `@react-three/xr` runs under the hood, and the only place
// the rule actually lives) so the test below asserts the LIBRARY's behaviour
// rather than a restatement of it. If a version bump ever made a deflected stick
// report 'pressed', the left stick would start ending an episode every time the
// operator walked the robot — that is the regression this import exists to catch.
import { updateXRControllerGamepadState } from '@pmndrs/xr/internals';
import { stickAxis, pickDriveStick, isStickClick } from '../vrDrive';
import { STICK_DEADZONE } from '../vrConstants';

describe('stickAxis', () => {
  it('treats a resting (drifting) stick as zero', () => {
    expect(stickAxis(0)).toBe(0);
    expect(stickAxis(STICK_DEADZONE - 0.001)).toBe(0);
    expect(stickAxis(-STICK_DEADZONE + 0.001)).toBe(0);
  });

  it('starts from zero at the edge of the deadzone, not from 0.15', () => {
    expect(stickAxis(STICK_DEADZONE)).toBeCloseTo(0, 12);
  });

  it('still reaches full travel', () => {
    expect(stickAxis(1)).toBeCloseTo(1, 12);
    expect(stickAxis(-1)).toBeCloseTo(-1, 12);
  });

  it('rescales the remaining travel linearly', () => {
    const mid = (1 + STICK_DEADZONE) / 2;
    expect(stickAxis(mid)).toBeCloseTo(0.5, 12);
  });

  it('handles undefined and non-finite axes as rest', () => {
    expect(stickAxis(undefined)).toBe(0);
    expect(stickAxis(Number.NaN)).toBe(0);
    expect(stickAxis(Infinity)).toBe(0);
  });
});

describe('pickDriveStick', () => {
  it('returns null only when no hand can drive', () => {
    expect(pickDriveStick([null, null])).toBeNull();
    expect(pickDriveStick([])).toBeNull();
    expect(pickDriveStick([undefined, null])).toBeNull();
  });

  it('reads the RIGHT stick when the left is present but at rest', () => {
    // THE BUG: `driveStick(left) ?? driveStick(right)` stopped at the left
    // controller's perfectly truthy {fwd:0,left:0}, so a right-handed operator
    // pushing the right stick got nothing at all.
    const left = { fwd: 0, left: 0 };
    const right = { fwd: -0.8, left: 0.1 };
    expect(pickDriveStick([left, right])).toBe(right);
  });

  it('reads the left stick when that is the one being pushed', () => {
    const left = { fwd: 0.9, left: 0 };
    expect(pickDriveStick([left, { fwd: 0, left: 0 }])).toBe(left);
  });

  it('takes the larger push when both sticks are moving', () => {
    const small = { fwd: 0.3, left: 0.1 };
    const big = { fwd: 0, left: -0.7 };
    expect(pickDriveStick([small, big])).toBe(big);
    expect(pickDriveStick([big, small])).toBe(big);
  });

  it('still returns a zero vector when everything is at rest, so the stop frame can be sent', () => {
    const left = { fwd: 0, left: 0 };
    expect(pickDriveStick([left, { fwd: 0, left: 0 }])).toBe(left);
  });

  it('skips a gripped hand', () => {
    const right = { fwd: 0.2, left: 0 };
    expect(pickDriveStick([null, right])).toBe(right);
  });

  it('discards a non-finite candidate instead of letting it win by default', () => {
    const bad = { fwd: Number.NaN, left: 0 };
    const good = { fwd: 0.1, left: 0 };
    expect(pickDriveStick([bad, good])).toBe(good);
    expect(pickDriveStick([bad])).toBeNull();
    expect(pickDriveStick([{ fwd: 0, left: Infinity }])).toBeNull();
  });
});

describe('isStickClick', () => {
  it('accepts only a real click', () => {
    expect(isStickClick({ state: 'pressed' })).toBe(true);
    expect(isStickClick({ state: 'touched' })).toBe(false);
    expect(isStickClick({ state: 'default' })).toBe(false);
  });

  it('says no for a hand that is not tracked at all', () => {
    expect(isStickClick(undefined)).toBe(false);
    expect(isStickClick(null)).toBe(false);
    expect(isStickClick({})).toBe(false);
  });

  /**
   * A synthetic Quest thumbstick: axes 2/3 and the click on button 3, which is
   * the `xr-standard` layout `@pmndrs/xr` ships for the Meta controllers.
   */
  function readStick(axes: [number, number], clicked: boolean) {
    const target: Record<string, { state?: string }> = {};
    const buttons = [0, 1, 2, 3].map((i) => ({
      value: i === 3 && clicked ? 1 : 0,
      pressed: i === 3 && clicked,
      touched: false,
    }));
    updateXRControllerGamepadState(
      target as never,
      { gamepad: { buttons, axes: [0, 0, axes[0], axes[1]] } } as never,
      { components: { 'xr-standard-thumbstick': { gamepadIndices: { button: 3, xAxis: 2, yAxis: 3 } } } } as never,
    );
    return target['xr-standard-thumbstick'];
  }

  it('does not fire for a stick that is merely DEFLECTED — that is driving', () => {
    // The same component object serves the drive axes and the elbow axes, so a
    // click that fired on deflection would end an episode on every walk command.
    const walking = readStick([0.9, -0.7], false);
    expect(walking?.state).toBe('touched');
    expect(isStickClick(walking)).toBe(false);

    const fullTravel = readStick([1, 1], false);
    expect(fullTravel?.state).toBe('touched');
    expect(isStickClick(fullTravel)).toBe(false);
  });

  it('fires for the click under the stick, deflected or not', () => {
    expect(isStickClick(readStick([0, 0], true))).toBe(true);
    expect(isStickClick(readStick([0.9, -0.7], true))).toBe(true);
  });

  it('is quiet for a stick at rest', () => {
    const resting = readStick([0, 0], false);
    expect(resting?.state).toBe('default');
    expect(isStickClick(resting)).toBe(false);
  });
});
