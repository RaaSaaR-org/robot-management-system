/**
 * @file vrDrive.test.ts
 * @description Tests for thumbstick conditioning and the "either stick drives"
 *              choice the rig used to get wrong.
 * @feature robots
 */

import { describe, it, expect } from 'vitest';
import { stickAxis, pickDriveStick } from '../vrDrive';
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
