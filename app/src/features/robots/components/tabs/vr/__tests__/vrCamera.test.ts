/**
 * @file vrCamera.test.ts
 * @description Tests for head-camera frame liveness — the frozen-picture
 *              detection an MJPEG <img> cannot give us.
 * @feature robots
 */

import { describe, it, expect, vi } from 'vitest';
import {
  frameLiveness,
  pollLiveness,
  initialLiveness,
  CAMERA_STALE_AFTER_MS,
  type LivenessState,
} from '../vrCamera';

describe('frameLiveness', () => {
  it('a changed frame is live and restarts the clock', () => {
    const r = frameLiveness({ checksum: 2, prev: 1, now: 5000, lastChangeAt: 1000 });
    expect(r.state).toBe('live');
    expect(r.lastChangeAt).toBe(5000);
    expect(r.staleForMs).toBe(0);
    expect(r.checksum).toBe(2);
  });

  it('an identical frame is still live inside the window', () => {
    const r = frameLiveness({ checksum: 1, prev: 1, now: 1500, lastChangeAt: 1000 });
    expect(r.state).toBe('live');
    expect(r.staleForMs).toBe(500);
    expect(r.lastChangeAt).toBe(1000);
  });

  it('goes stale once the picture has been identical for the whole window', () => {
    const r = frameLiveness({ checksum: 1, prev: 1, now: 1000 + CAMERA_STALE_AFTER_MS, lastChangeAt: 1000 });
    expect(r.state).toBe('stale');
    expect(r.staleForMs).toBe(CAMERA_STALE_AFTER_MS);
  });

  it('honours a caller-supplied window', () => {
    expect(
      frameLiveness({ checksum: 1, prev: 1, now: 1200, lastChangeAt: 1000, staleAfterMs: 100 }).state,
    ).toBe('stale');
  });

  it('an UNREADABLE sample lets the clock run — ambiguity resolves toward warning', () => {
    const r = frameLiveness({ checksum: undefined, prev: 7, now: 3000, lastChangeAt: 1000 });
    expect(r.state).toBe('stale');
    // and it must not clobber the last good fingerprint, or the next real frame
    // would look like a change and reset the clock on a picture that never moved
    expect(r.checksum).toBe(7);
  });

  it('a NaN checksum is treated as unreadable, not as a new frame', () => {
    const r = frameLiveness({ checksum: Number.NaN, prev: 7, now: 3000, lastChangeAt: 1000 });
    expect(r.state).toBe('stale');
    expect(r.checksum).toBe(7);
  });

  it('a genuinely repeating checksum still counts as no change', () => {
    // A checksum collision on two different frames is indistinguishable from a
    // frozen one; the tradeoff is deliberate and biased toward warning.
    expect(frameLiveness({ checksum: 5, prev: 5, now: 9999, lastChangeAt: 0 }).state).toBe('stale');
  });

  it('starts the clock here when there is no usable history', () => {
    const r = frameLiveness({ checksum: 1, prev: 1, now: 1000, lastChangeAt: Number.NaN });
    expect(r.lastChangeAt).toBe(1000);
    expect(r.staleForMs).toBe(0);
    expect(r.state).toBe('live');
  });

  it('recovers from a clock that jumped backwards instead of reporting a negative age', () => {
    const r = frameLiveness({ checksum: 1, prev: 1, now: 500, lastChangeAt: 9000 });
    expect(r.lastChangeAt).toBe(500);
    expect(r.staleForMs).toBe(0);
    expect(r.state).toBe('live');
  });

  it('never reports a non-finite now as an age', () => {
    const r = frameLiveness({ checksum: 1, prev: 1, now: Number.NaN, lastChangeAt: 1000 });
    expect(Number.isFinite(r.staleForMs)).toBe(true);
    expect(Number.isFinite(r.lastChangeAt)).toBe(true);
  });

  it('the first sample of a stream is live', () => {
    const r = frameLiveness({ checksum: 42, prev: undefined, now: 0, lastChangeAt: 0 });
    expect(r.state).toBe('live');
    expect(r.checksum).toBe(42);
  });
});

describe('pollLiveness', () => {
  it('stays live while the injected sampler keeps producing new frames', () => {
    let s: LivenessState = initialLiveness(0);
    let frame = 0;
    for (let t = 0; t <= 5000; t += 50) {
      s = pollLiveness(s, () => (frame += 1), t);
      expect(s.state).toBe('live');
    }
  });

  it('goes stale a second after the upstream freezes', () => {
    // This is the case an <img> on multipart/x-mixed-replace never reports: the
    // connection stays open, `error` never fires, and the last frame stays
    // decoded forever.
    let s: LivenessState = initialLiveness(0);
    s = pollLiveness(s, () => 1, 0);
    s = pollLiveness(s, () => 1, 999);
    expect(s.state).toBe('live');
    s = pollLiveness(s, () => 1, 1000);
    expect(s.state).toBe('stale');
    expect(s.staleForMs).toBe(1000);
  });

  it('recovers the moment a new frame arrives', () => {
    let s: LivenessState = initialLiveness(0);
    s = pollLiveness(s, () => 1, 0);
    s = pollLiveness(s, () => 1, 5000);
    expect(s.state).toBe('stale');
    s = pollLiveness(s, () => 2, 5050);
    expect(s.state).toBe('live');
    expect(s.staleForMs).toBe(0);
  });

  it('treats a THROWING sampler exactly like an unreadable frame', () => {
    // A tainted canvas or a torn-down image must not take the render frame with it.
    const sample = vi.fn(() => {
      throw new Error('tainted canvas');
    });
    let s: LivenessState = initialLiveness(0);
    expect(() => {
      s = pollLiveness(s, sample, 5000);
    }).not.toThrow();
    expect(s.state).toBe('stale');
  });

  it('honours a caller-supplied window', () => {
    let s: LivenessState = initialLiveness(0);
    s = pollLiveness(s, () => 1, 0);
    s = pollLiveness(s, () => 1, 150, 100);
    expect(s.state).toBe('stale');
  });

  it('initialLiveness starts live with no fingerprint', () => {
    expect(initialLiveness(123)).toEqual({
      checksum: undefined,
      lastChangeAt: 123,
      state: 'live',
      staleForMs: 0,
    });
    expect(initialLiveness(Number.NaN).lastChangeAt).toBe(0);
  });
});
