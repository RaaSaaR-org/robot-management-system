/**
 * @file reengage.test.ts
 * @description The clutch rising-edge latch a real robot's arms need before
 *              they arm (TASK-393).
 * @feature teleop
 * @status test
 */

import { describe, it, expect } from 'vitest';
import { ReengageLatch, parseClutch } from '../reengage.js';

const OPEN = { left: false, right: false };
const BOTH = { left: true, right: true };

describe('parseClutch', () => {
  it('reads the rig\'s two grips and the keyboard\'s one clutch', () => {
    expect(parseClutch({ left: true, right: false })).toEqual({ left: true, right: false });
    expect(parseClutch(true)).toEqual({ left: true, right: true });
    expect(parseClutch(false)).toEqual(OPEN);
  });

  it('treats anything else as not reported', () => {
    expect(parseClutch(undefined)).toBeNull();
    expect(parseClutch(null)).toBeNull();
    expect(parseClutch(1)).toBeNull();
    expect(parseClutch({ left: true })).toBeNull();
    expect(parseClutch({ left: 'yes', right: true })).toBeNull();
  });
});

describe('ReengageLatch', () => {
  it('starts needing a release, so the first arm needs a rising edge too', () => {
    const latch = new ReengageLatch();
    expect(latch.state).toBe('need_release');
    latch.report(BOTH);
    latch.update(false, false);
    expect(latch.mayArm()).toBe(false);
    latch.report(OPEN);
    latch.update(false, false);
    expect(latch.state).toBe('need_press');
    latch.report(BOTH);
    latch.update(false, false);
    expect(latch.state).toBe('ready');
    expect(latch.mayArm()).toBe(true);
  });

  it('never leaves need_release for a client that reports no clutch', () => {
    const latch = new ReengageLatch();
    for (let i = 0; i < 3; i++) latch.update(false, false);
    expect(latch.state).toBe('need_release');
    expect(latch.mayArm()).toBe(false);
  });

  it('throws away an edge made while arming is blocked', () => {
    const latch = new ReengageLatch();
    latch.report(OPEN);
    latch.update(true, false);
    latch.report(BOTH);
    latch.update(true, false);
    expect(latch.state).toBe('need_release');
    // Unblocked with the grip still held: still needs a release.
    latch.update(false, false);
    expect(latch.mayArm()).toBe(false);
  });

  it('a ready latch whose clutch opens again needs the squeeze again', () => {
    const latch = new ReengageLatch();
    latch.report(OPEN);
    latch.update(false, false);
    latch.report(BOTH);
    latch.update(false, false);
    latch.report(OPEN);
    latch.update(false, false);
    expect(latch.state).toBe('need_press');
    expect(latch.mayArm()).toBe(false);
  });

  it('holding ignores the clutch — letting go is not a disarm', () => {
    const latch = new ReengageLatch();
    latch.report(OPEN);
    latch.update(false, false);
    latch.report(BOTH);
    latch.update(false, false);
    latch.held();
    latch.report(OPEN);
    expect(latch.update(false, true)).toBeNull();
    expect(latch.state).toBe('holding');
  });

  it('holding drops to need_release when the arms go away or something blocks', () => {
    const latch = new ReengageLatch();
    latch.held();
    expect(latch.update(false, false)).toBe('holding');
    expect(latch.state).toBe('need_release');
    latch.held();
    expect(latch.update(true, true)).toBe('holding');
    expect(latch.state).toBe('need_release');
  });

  it('latch() reports the state it left, once', () => {
    const latch = new ReengageLatch();
    latch.held();
    expect(latch.latch()).toBe('holding');
    expect(latch.latch()).toBeNull();
  });

  it('answers per side for the wrist gate', () => {
    const latch = new ReengageLatch();
    expect(latch.sideEngaged('left')).toBe(false);
    latch.report({ left: true, right: false });
    expect(latch.sideEngaged('left')).toBe(true);
    expect(latch.sideEngaged('right')).toBe(false);
    expect(latch.engaged).toBe(true);
  });

  it('report() says whether the clutch changed', () => {
    const latch = new ReengageLatch();
    expect(latch.report(OPEN)).toBe(true);
    expect(latch.report(OPEN)).toBe(false);
    expect(latch.report({ left: true, right: false })).toBe(true);
  });
});
