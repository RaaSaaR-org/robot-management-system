/**
 * @file motionPlayback.test.ts
 * @description Tests for the module-level motion playback clock (TASK-193).
 */

import * as THREE from 'three';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

import {
  getMotionTransport,
  loadClip,
  pauseMotion,
  playMotion,
  resetMotion,
  sampleClip,
  seekMotion,
  setMotionLoop,
  setMotionSpeed,
  stepMotion,
  tickMotion,
} from '../motionPlayback';
import type { MotionClip, MotionFrame } from '../../types/motion.types';

function makeClip(frames: MotionFrame[], fps = 10, overrides: Partial<MotionClip> = {}): MotionClip {
  return {
    id: 'clip-1',
    name: 'test clip',
    source: 'synthetic',
    robotType: 'g1',
    fps,
    frameCount: frames.length,
    durationSec: frames.length / fps,
    jointNames: ['j0', 'j1'],
    rootRotOrder: 'xyzw',
    upAxis: 'z',
    warnings: [],
    createdAt: '2026-07-18T00:00:00.000Z',
    frames,
    ...overrides,
  };
}

/** Rotation of `deg` about Y, xyzw. Far enough from identity that a component-wise lerp is short. */
function quatY(deg: number): [number, number, number, number] {
  const half = (deg * Math.PI) / 360;
  return [0, Math.sin(half), 0, Math.cos(half)];
}

function norm(q: [number, number, number, number]): number {
  return Math.hypot(q[0], q[1], q[2], q[3]);
}

const twoFrameClip = makeClip([
  { rootPos: [0, 0, 0], rootRot: quatY(0), dofPos: [0, 10] },
  { rootPos: [2, 4, 6], rootRot: quatY(170), dofPos: [1, 20] },
]);

afterEach(() => {
  resetMotion();
  vi.restoreAllMocks();
});

describe('sampleClip', () => {
  it('interpolates joints linearly at a half-frame time', () => {
    // fps 10, t=0.05 s => exactly between frame 0 and frame 1
    const sample = sampleClip(twoFrameClip, 0.05);

    expect(sample).not.toBeNull();
    expect(sample!.frameIndex).toBe(0);
    expect(sample!.jointStates).toEqual([
      { name: 'j0', position: 0.5 },
      { name: 'j1', position: 15 },
    ]);
    expect(sample!.rootPos).toEqual([1, 2, 3]);
  });

  it('slerps rootRot and keeps the result unit norm', () => {
    const sample = sampleClip(twoFrameClip, 0.05)!;

    expect(norm(sample.rootRot)).toBeCloseTo(1, 10);

    // The bug this guards against: component-wise lerp of the same pair is measurably short,
    // so a passing unit-norm assertion is genuinely distinguishing slerp from lerp here.
    const a = twoFrameClip.frames[0].rootRot;
    const b = twoFrameClip.frames[1].rootRot;
    const lerped: [number, number, number, number] = [
      (a[0] + b[0]) / 2,
      (a[1] + b[1]) / 2,
      (a[2] + b[2]) / 2,
      (a[3] + b[3]) / 2,
    ];
    expect(norm(lerped)).toBeLessThan(0.99);

    // Half of 170 deg about Y => y = sin(85/2 deg).
    expect(sample.rootRot[1]).toBeCloseTo(Math.sin((42.5 * Math.PI) / 180), 6);
  });

  it('clamps past the end instead of indexing out of bounds', () => {
    const sample = sampleClip(twoFrameClip, 999)!;

    expect(sample.frameIndex).toBe(1);
    expect(sample.jointStates.map((j) => j.position)).toEqual([1, 20]);
    expect(sample.rootPos).toEqual([2, 4, 6]);
  });

  it('clamps before the start instead of extrapolating', () => {
    const sample = sampleClip(twoFrameClip, -5)!;

    expect(sample.frameIndex).toBe(0);
    expect(sample.jointStates.map((j) => j.position)).toEqual([0, 10]);
  });

  it('returns null for a clip with no frames', () => {
    expect(sampleClip(makeClip([]), 0)).toBeNull();
  });
});

// ============================================================
// FRAME CONVENTIONS
// ============================================================
// `rootRotOrder` and `upAxis` were validated, persisted and round-tripped by every layer while
// being read by nobody: sampling hardcoded xyzw and the renderer hardcodes Z-up. A wxyz clip
// therefore rendered with its scalar component in X — a unit quaternion, a plausible-looking
// pose, no error anywhere. These tests pin the normalisation that makes the declared fields real.

/** Y-up -> Z-up, +90 deg about X. Must match the constant inside motionPlayback. */
const Y_TO_Z = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);

/** Compare orientations, tolerating the q/-q double cover that slerp is free to pick either of. */
function expectSameRotation(
  actual: [number, number, number, number],
  expected: [number, number, number, number],
): void {
  const dot = actual[0] * expected[0] + actual[1] * expected[1] + actual[2] * expected[2] + actual[3] * expected[3];
  const s = dot < 0 ? -1 : 1;
  for (let i = 0; i < 4; i++) expect(actual[i] * s).toBeCloseTo(expected[i], 10);
}

/** Same pose, expressed in a Y-up frame: the exact inverse of what sampleClip must undo. */
function toYUp(frame: MotionFrame): MotionFrame {
  const [x, y, z] = frame.rootPos;
  const q = new THREE.Quaternion(...frame.rootRot).premultiply(Y_TO_Z.clone().invert());
  return { rootPos: [x, z, -y], rootRot: [q.x, q.y, q.z, q.w], dofPos: frame.dofPos };
}

/** Same quaternion, scalar-first. */
function toWxyz(q: [number, number, number, number]): [number, number, number, number] {
  return [q[3], q[0], q[1], q[2]];
}

describe('sampleClip frame conventions', () => {
  // Deliberately not a rotation about the up axis: a Y-up conversion done as a conjugation
  // (C q C^-1) instead of a left-multiply (C q) can look right on axis-aligned test data.
  const tilted = (deg: number): [number, number, number, number] => {
    const q = new THREE.Quaternion().setFromEuler(
      new THREE.Euler((deg * Math.PI) / 180, (deg * 0.6 * Math.PI) / 180, (deg * 0.3 * Math.PI) / 180, 'XYZ'),
    );
    return [q.x, q.y, q.z, q.w];
  };

  const zUpFrames: MotionFrame[] = [
    { rootPos: [1, 2, 3], rootRot: tilted(20), dofPos: [0, 10] },
    { rootPos: [2, 4, 6], rootRot: tilted(100), dofPos: [1, 20] },
  ];

  it('is unchanged for the default xyzw / z-up clip', () => {
    // The only path with real GMR data behind it — normalisation must be a strict no-op here.
    const sample = sampleClip(makeClip(zUpFrames), 0.05)!;
    const a = new THREE.Quaternion(...zUpFrames[0].rootRot);
    const b = new THREE.Quaternion(...zUpFrames[1].rootRot);
    const slerped = a.clone().slerp(b, 0.5);

    expect(sample.rootPos[0]).toBeCloseTo(0.5, 10);
    expect(sample.rootPos[1]).toBeCloseTo(1, 10);
    expect(sample.rootPos[2]).toBeCloseTo(1.5, 10);
    expectSameRotation(sample.rootRot, [slerped.x, slerped.y, slerped.z, slerped.w]);
  });

  it('reads a wxyz clip identically to the equivalent xyzw clip', () => {
    // THE regression test: before the fix the wxyz clip's scalar was read as X, producing a
    // perfectly unit quaternion describing an arbitrarily different torso orientation.
    const xyzw = sampleClip(makeClip(zUpFrames), 0.05)!;
    const wxyz = sampleClip(
      makeClip(
        zUpFrames.map((f) => ({ ...f, rootRot: toWxyz(f.rootRot) })),
        10,
        { rootRotOrder: 'wxyz' },
      ),
      0.05,
    )!;

    expectSameRotation(wxyz.rootRot, xyzw.rootRot);
    expect(wxyz.rootPos).toEqual(xyzw.rootPos);
    expect(norm(wxyz.rootRot)).toBeCloseTo(1, 10);
  });

  it('reads a y-up clip identically to the equivalent z-up clip', () => {
    const zUp = sampleClip(makeClip(zUpFrames), 0.05)!;
    const yUp = sampleClip(makeClip(zUpFrames.map(toYUp), 10, { upAxis: 'y' }), 0.05)!;

    for (let i = 0; i < 3; i++) expect(yUp.rootPos[i]).toBeCloseTo(zUp.rootPos[i], 10);
    expectSameRotation(yUp.rootRot, zUp.rootRot);
    expect(norm(yUp.rootRot)).toBeCloseTo(1, 10);
  });

  it('converts a y-up clip so the renderer group maps it back to the source orientation', () => {
    // RobotModel wraps the robot in rotation={[-PI/2, 0, 0]} and applies the sample raw inside.
    // three.js is already Y-up, so for a Y-up clip that round trip must be the identity: this
    // asserts the conversion is a left-multiply, not a conjugation, and that it is not skipped.
    const yUpFrames = zUpFrames.map(toYUp);
    const sample = sampleClip(makeClip(yUpFrames, 10, { upAxis: 'y' }), 0.05)!;
    const group = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);

    // Orientation: back to the clip's own Y-up orientation, untouched.
    const qa = new THREE.Quaternion(...yUpFrames[0].rootRot);
    const qb = new THREE.Quaternion(...yUpFrames[1].rootRot);
    const expectedRot = qa.clone().slerp(qb, 0.5);
    const rendered = new THREE.Quaternion(...sample.rootRot).premultiply(group);
    expectSameRotation(
      [rendered.x, rendered.y, rendered.z, rendered.w],
      [expectedRot.x, expectedRot.y, expectedRot.z, expectedRot.w],
    );

    // Translation: likewise back to the clip's own Y-up displacement from frame 0.
    const p = new THREE.Vector3(...sample.rootPos).applyQuaternion(group);
    for (let i = 0; i < 3; i++) {
      const expected = (yUpFrames[0].rootPos[i] + yUpFrames[1].rootPos[i]) / 2 - yUpFrames[0].rootPos[i];
      expect(p.getComponent(i)).toBeCloseTo(expected, 10);
    }
  });

  it('keeps the sampled quaternion unit-norm for every order/up-axis combination', () => {
    const combos: Array<Partial<MotionClip>> = [
      { rootRotOrder: 'xyzw', upAxis: 'z' },
      { rootRotOrder: 'wxyz', upAxis: 'z' },
      { rootRotOrder: 'xyzw', upAxis: 'y' },
      { rootRotOrder: 'wxyz', upAxis: 'y' },
    ];

    for (const overrides of combos) {
      const frames = zUpFrames.map((f) => ({
        ...f,
        rootRot: overrides.rootRotOrder === 'wxyz' ? toWxyz(f.rootRot) : f.rootRot,
      }));
      for (const t of [0, 0.03, 0.05, 0.09, 5]) {
        expect(norm(sampleClip(makeClip(frames, 10, overrides), t)!.rootRot)).toBeCloseTo(1, 10);
      }
    }
  });
});

describe('transport', () => {
  it('clamps seek to [0, duration]', () => {
    loadClip(twoFrameClip);

    seekMotion(-3);
    expect(getMotionTransport().time).toBe(0);

    seekMotion(99);
    expect(getMotionTransport().time).toBe(twoFrameClip.durationSec);
  });

  it('steps exactly one frame and pauses', () => {
    loadClip(twoFrameClip);
    playMotion();

    stepMotion(1);

    const t = getMotionTransport();
    expect(t.time).toBeCloseTo(0.1, 10); // one frame at 10 fps
    expect(t.frameIndex).toBe(1);
    expect(t.playing).toBe(false);
  });

  it('steps backwards without going negative', () => {
    loadClip(twoFrameClip);
    stepMotion(-1);

    expect(getMotionTransport().time).toBe(0);
  });

  it('ignores transport commands with no clip loaded', () => {
    seekMotion(5);
    stepMotion(1);
    playMotion();

    const t = getMotionTransport();
    expect(t.time).toBe(0);
    expect(t.playing).toBe(false);
  });
});

describe('stepMotion', () => {
  // 20 frames at 10 fps = 2 s, long enough to pause mid-clip at a mid-frame time.
  const clip = makeClip(
    Array.from({ length: 20 }, (_, i) => ({
      rootPos: [i, 0, 0] as [number, number, number],
      rootRot: quatY(0),
      dofPos: [i, i],
    })),
  );

  it('moves exactly one displayed frame from a mid-frame pause', () => {
    // Paused at 12.6 frames the transport readout shows frame 12 (floor). A round()-based step
    // would compute from 13, so "+1" lands on 14 (skips a frame) and "−1" lands on 12 (looks
    // dead). Both directions must move exactly one frame away from what the user SEES.
    loadClip(clip);
    playMotion();
    seekMotion(1.26); // 12.6 frames at 10 fps
    expect(getMotionTransport().frameIndex).toBe(12);

    stepMotion(1);
    let t = getMotionTransport();
    expect(t.frameIndex).toBe(13);
    expect(t.time).toBeCloseTo(1.3, 10);
    expect(t.playing).toBe(false);

    seekMotion(1.26);
    stepMotion(-1);
    t = getMotionTransport();
    expect(t.frameIndex).toBe(11);
    expect(t.time).toBeCloseTo(1.1, 10);
  });
});

describe('stepMotion at fractional fps (NTSC 29.97)', () => {
  // 90 frames at 29.97 fps ≈ 3.003 s — room to step past frame 62 without clamping.
  const ntsc = makeClip(
    Array.from({ length: 90 }, (_, i) => ({
      rootPos: [i, 0, 0] as [number, number, number],
      rootRot: quatY(0),
      dofPos: [i, i],
    })),
    29.97,
  );

  it('lands exactly on frame 29 after 29 single steps', () => {
    // Each step re-derives its index from the playhead, so error must not accumulate.
    loadClip(ntsc);
    for (let i = 0; i < 29; i++) stepMotion(1);

    expect(getMotionTransport().frameIndex).toBe(29);
  });

  it('buckets the exact frame time 61/29.97 as frame 61, not 60', () => {
    // The double-precision hazard the epsilon in frameIndexAt exists for:
    // (61/29.97) * 29.97 === 60.999999999999993 in doubles, so a plain floor() shows frame 60
    // for a playhead sitting EXACTLY on frame 61 — and the next "+1" step re-lands on 61.
    expect(Math.floor((61 / 29.97) * 29.97)).toBe(60);

    loadClip(ntsc);
    seekMotion(61 / 29.97);
    expect(getMotionTransport().frameIndex).toBe(61);

    stepMotion(1);
    expect(getMotionTransport().frameIndex).toBe(62);
  });
});

describe('tickMotion', () => {
  // 20 frames at 10 fps = 2 s, long enough that the 0.25 s per-tick clamp is not in play.
  const clip = makeClip(
    Array.from({ length: 20 }, (_, i) => ({
      rootPos: [i, 0, 0] as [number, number, number],
      rootRot: quatY(0),
      dofPos: [i, i],
    })),
  );

  let now = 0;

  beforeEach(() => {
    now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
  });

  /** Advance wall clock in <=0.2 s slices so the backgrounded-tab clamp never truncates. */
  function advance(seconds: number): void {
    tickMotion(); // seeds lastTickMs on the first call after play/seek
    const steps = Math.ceil(seconds / 0.2);
    for (let i = 0; i < steps; i++) {
      now += (seconds / steps) * 1000;
      tickMotion();
    }
  }

  it('advances the playhead in real time', () => {
    loadClip(clip);
    playMotion();

    advance(0.6);

    expect(getMotionTransport().time).toBeCloseTo(0.6, 6);
  });

  it('wraps the playhead when looping', () => {
    loadClip(clip);
    setMotionLoop(true);
    playMotion();

    advance(2.4); // duration is 2 s

    const t = getMotionTransport();
    expect(t.time).toBeCloseTo(0.4, 6);
    expect(t.playing).toBe(true);
  });

  it('stops at the end and clears playing when not looping', () => {
    loadClip(clip);
    setMotionLoop(false);
    playMotion();

    advance(2.4);

    const t = getMotionTransport();
    expect(t.time).toBe(clip.durationSec);
    expect(t.playing).toBe(false);
  });

  it('restarts from the beginning when play is pressed at the end of a non-looping clip', () => {
    loadClip(clip);
    setMotionLoop(false);
    seekMotion(clip.durationSec);

    playMotion();

    expect(getMotionTransport().time).toBe(0);
  });

  it('does not advance while paused', () => {
    loadClip(clip);
    playMotion();
    advance(0.4);
    pauseMotion();

    now += 5000;
    tickMotion();

    expect(getMotionTransport().time).toBeCloseTo(0.4, 6);
  });

  it('applies a speed change from the moment it is set, without jumping the playhead', () => {
    loadClip(clip);
    playMotion();
    advance(0.2);

    setMotionSpeed(2);
    // The speed change itself must not move the playhead — only subsequent wall-clock does.
    expect(getMotionTransport().time).toBeCloseTo(0.2, 6);
    expect(getMotionTransport().speed).toBe(2);

    advance(0.2); // 0.2 s of wall clock at 2x => 0.4 s of clip
    expect(getMotionTransport().time).toBeCloseTo(0.6, 6);
  });

  it('does not apply a stale delta when resuming after a long pause', () => {
    // pauseMotion clears lastTickMs; playMotion must not inherit the 5 s gap. If it did, the
    // first tick would add the full 0.25 s clamp on top of the real ~16 ms step.
    loadClip(clip);
    playMotion();
    advance(0.4);
    pauseMotion();

    now += 5000;
    playMotion();
    tickMotion(); // reseeds lastTickMs without advancing
    now += 16;
    tickMotion();

    expect(getMotionTransport().time).toBeCloseTo(0.4 + 0.016, 6);
  });

  it('does not apply a stale delta after seeking while playing', () => {
    // Same hazard mid-play: the seek re-anchors the clock, so the 5 s of wall time between the
    // last tick and the seek must vanish rather than arrive clamped to 0.25 s.
    loadClip(clip);
    playMotion();
    advance(0.4);

    now += 5000; // no tick in between
    seekMotion(1.0);
    tickMotion(); // reseeds lastTickMs without advancing
    now += 16;
    tickMotion();

    expect(getMotionTransport().time).toBeCloseTo(1.0 + 0.016, 6);
  });

  it('returns the sample for the playhead time it just advanced to', () => {
    loadClip(clip);
    playMotion();
    advance(0.5);

    now += 100;
    const sample = tickMotion();

    expect(sample).not.toBeNull();
    expect(sample).toEqual(sampleClip(clip, getMotionTransport().time));
  });

  it('returns the wrapped sample on the tick that crosses the loop seam', () => {
    // The tick that carries the playhead past the end must sample the WRAPPED time, not the
    // pre-wrap time clamped to the final frame — otherwise every loop pass ends on a held pose.
    loadClip(clip);
    setMotionLoop(true);
    playMotion();
    seekMotion(1.9);
    tickMotion(); // seeds lastTickMs
    now += 200; // 1.9 + 0.2 => 2.1 s, wraps to ~0.1 s (duration is 2 s)
    const sample = tickMotion();

    const t = getMotionTransport();
    expect(t.time).toBeCloseTo(0.1, 6);
    expect(sample).not.toBeNull();
    expect(sample!.frameIndex).toBe(1); // wrapped near the start, not clamped to frame 19
    expect(sample).toEqual(sampleClip(clip, t.time));
  });

  it('returns null with no clip loaded', () => {
    expect(tickMotion()).toBeNull();
  });
});

describe('resetMotion', () => {
  it('restores defaults', () => {
    loadClip(twoFrameClip);
    setMotionLoop(false);
    seekMotion(0.1);
    playMotion();

    resetMotion();

    expect(getMotionTransport()).toEqual({
      clipId: null,
      clipName: null,
      playing: false,
      time: 0,
      duration: 0,
      frameIndex: 0,
      frameCount: 0,
      speed: 1,
      loop: true,
      followRoot: true,
    });
  });
});
