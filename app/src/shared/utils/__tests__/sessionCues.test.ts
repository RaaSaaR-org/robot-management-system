/**
 * @file sessionCues.test.ts
 * @description The synthesized session cues (TASK-410 D4): each cue schedules
 *              its tones on a WebAudio context, mute is per viewer and
 *              remembered, nothing throws without WebAudio, and the auto-stop
 *              warning ticks 3 s before the stop.
 * @feature datacollection
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  AUTO_STOP_WARNING_S,
  CUE_TONES,
  isCueMuted,
  playCue,
  resetSessionCuesForTests,
  scheduleAutoStopWarning,
  setCueMuted,
  subscribeCueMuted,
} from '../sessionCues';

interface FakeOsc { type: string; freq: number; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }
let oscillators: FakeOsc[] = [];
let created = 0;
let lastCtx: FakeAudioContext | null = null;

class FakeAudioContext {
  currentTime = 10;
  state = 'running';
  destination = {};
  constructor() { created += 1; lastCtx = this; }
  resume = vi.fn().mockResolvedValue(undefined);
  createOscillator() {
    const osc: FakeOsc & Record<string, unknown> = {
      type: 'sine', freq: 0, start: vi.fn(), stop: vi.fn(),
      frequency: { setValueAtTime: (v: number) => { osc.freq = v; } },
      connect: vi.fn(),
    };
    oscillators.push(osc);
    return osc;
  }
  createGain() {
    return { gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn() };
  }
}

beforeEach(() => {
  oscillators = [];
  created = 0;
  localStorage.clear();
  vi.stubGlobal('AudioContext', FakeAudioContext);
  resetSessionCuesForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('playCue', () => {
  it('rises when a take starts and falls when it stops', () => {
    expect(playCue('started')).toBe(true);
    const [a, b] = oscillators.map((o) => o.freq);
    expect(b).toBeGreaterThan(a);
    oscillators = [];
    playCue('stopped');
    const [c, d] = oscillators.map((o) => o.freq);
    expect(d).toBeLessThan(c);
  });

  it('schedules every tone of a cue at its offset, on one shared context', () => {
    playCue('problem');
    playCue('discarded');
    expect(created).toBe(1);
    expect(oscillators).toHaveLength(CUE_TONES.problem.length + CUE_TONES.discarded.length);
    // The second low tone of "problem" starts 0.22 s after the first.
    const starts = oscillators.slice(0, 2).map((o) => o.start.mock.calls[0][0] as number);
    expect(starts[1] - starts[0]).toBeCloseTo(0.22, 5);
    expect(oscillators[0].freq).toBe(oscillators[1].freq);
  });

  it('plays nothing when muted, and the mute is remembered for this viewer', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeCueMuted(listener);
    setCueMuted(true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(playCue('started')).toBe(false);
    expect(oscillators).toHaveLength(0);
    resetSessionCuesForTests(); // a reload
    expect(isCueMuted()).toBe(true);
    setCueMuted(false);
    expect(localStorage.getItem('neodem.sessionCues.muted')).toBeNull();
    unsubscribe();
  });

  it('survives storage that throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(() => setCueMuted(true)).not.toThrow();
    expect(isCueMuted()).toBe(true);
    setCueMuted(false);
    vi.restoreAllMocks();
  });

  it('does nothing, and does not throw, without WebAudio', () => {
    vi.unstubAllGlobals();
    vi.stubGlobal('AudioContext', undefined);
    resetSessionCuesForTests();
    expect(playCue('started')).toBe(false);
  });

  it('resumes a context the browser suspended until the first gesture', () => {
    playCue('tick');
    lastCtx!.state = 'suspended';
    playCue('tick');
    expect(lastCtx!.resume).toHaveBeenCalledTimes(1);
  });
});

describe('scheduleAutoStopWarning', () => {
  it('ticks 3 s before the auto-stop', () => {
    vi.useFakeTimers();
    scheduleAutoStopWarning(10);
    vi.advanceTimersByTime((10 - AUTO_STOP_WARNING_S) * 1000 - 1);
    expect(oscillators).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(oscillators).toHaveLength(CUE_TONES.tick.length);
  });

  it('can be cancelled when the take stops first', () => {
    vi.useFakeTimers();
    const cancel = scheduleAutoStopWarning(10);
    cancel();
    vi.advanceTimersByTime(20_000);
    expect(oscillators).toHaveLength(0);
  });

  it('schedules nothing once the warning point has passed', () => {
    vi.useFakeTimers();
    scheduleAutoStopWarning(2);
    vi.advanceTimersByTime(10_000);
    expect(oscillators).toHaveLength(0);
  });
});
