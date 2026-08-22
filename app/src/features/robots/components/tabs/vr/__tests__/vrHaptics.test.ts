/**
 * @file vrHaptics.test.ts
 * @description Tests for controller vibration: actuator preference, the
 *              per-hand rate limit, and the promise rejections it has to eat.
 * @feature robots
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { pulse, pulsePreset, resetHaptics, HAPTICS, HAPTIC_MIN_GAP_MS } from '../vrHaptics';

function withPulse(handedness: string) {
  const spy = vi.fn(() => Promise.resolve(true));
  return { source: { handedness, gamepad: { hapticActuators: [{ pulse: spy }] } }, spy };
}

function withPlayEffect(handedness: string) {
  const spy = vi.fn(() => Promise.resolve('complete'));
  return { source: { handedness, gamepad: { vibrationActuator: { playEffect: spy } } }, spy };
}

beforeEach(() => resetHaptics());

describe('pulse', () => {
  it('prefers hapticActuators[0].pulse() — the path the Quest implements', () => {
    const { source, spy } = withPulse('left');
    expect(pulse(source, 0.6, 40, 0)).toBe(true);
    expect(spy).toHaveBeenCalledWith(0.6, 40);
  });

  it('falls back to vibrationActuator.playEffect("dual-rumble", ...)', () => {
    const { source, spy } = withPlayEffect('left');
    expect(pulse(source, 0.5, 30, 0)).toBe(true);
    expect(spy).toHaveBeenCalledWith('dual-rumble', {
      duration: 30,
      strongMagnitude: 0.5,
      weakMagnitude: 0.5,
    });
  });

  it('uses playEffect when hapticActuators exists but is empty', () => {
    const spy = vi.fn(() => Promise.resolve('complete'));
    const source = {
      handedness: 'right',
      gamepad: { hapticActuators: [], vibrationActuator: { playEffect: spy } },
    };
    expect(pulse(source, 1, 10, 0)).toBe(true);
    expect(spy).toHaveBeenCalledOnce();
  });

  it('falls through to playEffect when pulse() throws synchronously', () => {
    const play = vi.fn(() => Promise.resolve('complete'));
    const source = {
      handedness: 'left',
      gamepad: {
        hapticActuators: [{ pulse: () => { throw new Error('no actuator'); } }],
        vibrationActuator: { playEffect: play },
      },
    };
    expect(pulse(source, 1, 10, 0)).toBe(true);
    expect(play).toHaveBeenCalledOnce();
  });

  it('swallows a rejected promise instead of taking the render loop with it', async () => {
    const source = {
      handedness: 'left',
      gamepad: { hapticActuators: [{ pulse: () => Promise.reject(new Error('session ended')) }] },
    };
    expect(pulse(source, 1, 10, 0)).toBe(true);
    // If the rejection were unhandled this would surface as an unhandled
    // rejection on the next tick.
    await new Promise((r) => setTimeout(r, 0));
  });

  it('rate-limits to one pulse per hand per 120 ms', () => {
    const { source, spy } = withPulse('left');
    expect(pulse(source, 1, 10, 1000)).toBe(true);
    expect(pulse(source, 1, 10, 1000 + HAPTIC_MIN_GAP_MS - 1)).toBe(false);
    expect(pulse(source, 1, 10, 1000 + HAPTIC_MIN_GAP_MS)).toBe(true);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('rate-limits each hand independently', () => {
    const left = withPulse('left');
    const right = withPulse('right');
    expect(pulse(left.source, 1, 10, 0)).toBe(true);
    expect(pulse(right.source, 1, 10, 0)).toBe(true);
    expect(pulse(left.source, 1, 10, 10)).toBe(false);
  });

  it('does not consume the rate limit when there is no actuator to fire', () => {
    const none = { handedness: 'left', gamepad: {} };
    expect(pulse(none, 1, 10, 0)).toBe(false);
    const { source, spy } = withPulse('left');
    expect(pulse(source, 1, 10, 1)).toBe(true);
    expect(spy).toHaveBeenCalledOnce();
  });

  it('returns false for a missing or unusable source', () => {
    expect(pulse(null, 1, 10, 0)).toBe(false);
    expect(pulse(undefined, 1, 10, 0)).toBe(false);
    expect(pulse({ handedness: 'left' }, 1, 10, 0)).toBe(false);
    expect(pulse({ handedness: 'left', gamepad: null }, 1, 10, 0)).toBe(false);
    expect(pulse({ handedness: 'left', gamepad: 'nonsense' }, 1, 10, 0)).toBe(false);
  });

  it('refuses a pulse with no intensity or no duration', () => {
    const { source, spy } = withPulse('left');
    expect(pulse(source, 0, 40, 0)).toBe(false);
    expect(pulse(source, 0.5, 0, 0)).toBe(false);
    expect(pulse(source, Number.NaN, 40, 0)).toBe(false);
    expect(pulse(source, 0.5, Number.NaN, 0)).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it('clamps intensity into 0..1', () => {
    const { source, spy } = withPulse('left');
    pulse(source, 99, 10, 0);
    expect(spy).toHaveBeenCalledWith(1, 10);
  });

  it('treats a source with no handedness as one hand', () => {
    const spy = vi.fn(() => Promise.resolve(true));
    const source = { gamepad: { hapticActuators: [{ pulse: spy }] } };
    expect(pulse(source, 1, 10, 0)).toBe(true);
    expect(pulse(source, 1, 10, 10)).toBe(false);
  });
});

describe('HAPTICS presets', () => {
  it('covers every event the rig signals', () => {
    expect(Object.keys(HAPTICS).sort()).toEqual([
      'clutchEngage',
      'clutchRelease',
      'episodeMark',
      'estop',
      'linkLost',
      'saturation',
    ]);
  });

  it('are all valid pulses', () => {
    for (const preset of Object.values(HAPTICS)) {
      expect(preset.intensity).toBeGreaterThan(0);
      expect(preset.intensity).toBeLessThanOrEqual(1);
      expect(preset.ms).toBeGreaterThan(0);
    }
  });

  it('makes the E-Stop the strongest and longest thing the file can produce', () => {
    for (const [name, preset] of Object.entries(HAPTICS)) {
      if (name === 'estop') continue;
      expect(preset.intensity).toBeLessThanOrEqual(HAPTICS.estop.intensity);
      expect(preset.ms).toBeLessThan(HAPTICS.estop.ms);
    }
  });

  it('keeps the repeating saturation buzz gentler than the one-shot events', () => {
    expect(HAPTICS.saturation.intensity).toBeLessThan(HAPTICS.clutchEngage.intensity);
    expect(HAPTICS.saturation.ms).toBeLessThan(HAPTICS.linkLost.ms / 5);
  });

  it('makes releasing the clutch weaker than engaging it', () => {
    expect(HAPTICS.clutchRelease.intensity).toBeLessThan(HAPTICS.clutchEngage.intensity);
    expect(HAPTICS.clutchRelease.ms).toBeLessThan(HAPTICS.clutchEngage.ms);
  });

  it('keeps the episode mark clear of the clutch taps and of the alarms', () => {
    // The hand can only tell two buzzes apart if they differ in more than one
    // dimension, and this one has to survive being felt mid-task: it is the ONLY
    // confirmation that a left stick click actually took an episode boundary.
    // Several times the length of a clutch tap, so it is not a grip; well short
    // of `linkLost` and much softer than `estop`, because nothing is wrong.
    expect(HAPTICS.episodeMark.ms).toBeGreaterThan(HAPTICS.clutchEngage.ms * 2);
    expect(HAPTICS.episodeMark.ms).toBeLessThan(HAPTICS.linkLost.ms);
    expect(HAPTICS.episodeMark.intensity).toBeLessThan(HAPTICS.linkLost.intensity);
    expect(HAPTICS.episodeMark.intensity).toBeGreaterThan(HAPTICS.saturation.intensity);
  });

  it('pulsePreset fires the named preset', () => {
    const { source, spy } = withPulse('left');
    expect(pulsePreset(source, HAPTICS.estop, 0)).toBe(true);
    expect(spy).toHaveBeenCalledWith(HAPTICS.estop.intensity, HAPTICS.estop.ms);
  });
});
