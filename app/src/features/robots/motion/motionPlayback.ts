/**
 * @file motionPlayback.ts
 * @description Module-level playback clock for retargeted motion clips. Deliberately outside
 *              React: the 3D viewer samples it imperatively inside useFrame.
 * @feature robots
 */

import * as THREE from 'three';

import type { MotionClip, MotionSample } from '../types/motion.types';

// ============================================================
// WHY THIS IS NOT A ZUSTAND STORE
// ============================================================
// A 30 fps clip sampled at display rate is 60+ state writes per second. TASK-191 already
// established that per-frame telemetry through React state is what makes the viewer stutter, and
// solved it with a plain module-level Map (store/telemetryLive.ts). This is the same problem with
// the same answer: the frame loop reads a mutable module value, and React only ever hears about
// the things a human can perceive -- play/pause, which clip, roughly where the playhead is.
//
// The transport UI subscribes at ~10 Hz via useMotionPlayback; the robot renders at display rate.

interface PlaybackState {
  clip: MotionClip | null;
  playing: boolean;
  /** Playhead in seconds from clip start. Authoritative; wall-clock only advances it. */
  time: number;
  speed: number;
  loop: boolean;
  /** Move the robot through space, or replay the pose in place over a fixed origin. */
  followRoot: boolean;
  /** performance.now() at the last advance; null while paused. */
  lastTickMs: number | null;
}

const state: PlaybackState = {
  clip: null,
  playing: false,
  time: 0,
  speed: 1,
  loop: true,
  followRoot: true,
  lastTickMs: null,
};

type Listener = () => void;
const listeners = new Set<Listener>();

/** Notify transport-UI subscribers. Never called per rendered frame -- only on discrete changes. */
function emit(): void {
  listeners.forEach((l) => l());
}

export function subscribeMotion(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// ============================================================
// SAMPLING
// ============================================================

const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();

/**
 * Y-up -> Z-up basis change, +90 deg about X: (x, y, z) -> (x, -z, y).
 *
 * This is exactly the inverse of the `rotation={[-Math.PI/2, 0, 0]}` that RobotModel puts on the
 * robot's parent group. That is the whole point: RobotModel's group converts Z-up data into
 * three.js's Y-up world, so a clip that was ALREADY Y-up must first be pushed into Z-up here or
 * the group's correction is applied to data that never needed it (walking forward reads as
 * walking upward). Converting then un-converting is a no-op on Y-up clips, which is the correct
 * outcome — three.js is Y-up.
 */
const _qUpYtoZ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);

/**
 * Write `rootRot` into `out` as xyzw, regardless of the clip's declared component order.
 *
 * The scalar component is the one that moves: wxyz stores it first, three.js wants it last. Read
 * with the wrong order the scalar lands in X, and the result is a perfectly unit quaternion
 * describing an entirely different orientation — which is why nothing downstream can detect it.
 */
function setFromRootRot(
  out: THREE.Quaternion,
  rot: readonly [number, number, number, number],
  order: 'xyzw' | 'wxyz',
): void {
  if (order === 'wxyz') out.set(rot[1], rot[2], rot[3], rot[0]);
  else out.set(rot[0], rot[1], rot[2], rot[3]);
}

/**
 * Sample the clip at time `t` (seconds), interpolating between the two bracketing frames.
 *
 * Joints are linearly interpolated; the root rotation is slerped. Lerping a quaternion
 * component-wise is the classic shortcut here and it is wrong -- it shortens the vector, which
 * shows up as the torso subtly shrinking and snapping through fast turns. Only visible in motion,
 * which is exactly why it is easy to ship.
 *
 * The returned sample is ALWAYS xyzw and ALWAYS Z-up, whatever the clip declared. `rootRotOrder`
 * and `upAxis` are consumed here and nowhere else — the renderer gets one frame convention.
 *
 * Returns null when there is no clip, or when the clip is malformed enough that rendering it would
 * be misleading rather than merely ugly.
 */
export function sampleClip(clip: MotionClip, t: number): MotionSample | null {
  const frames = clip.frames;
  if (!frames || frames.length === 0) return null;

  const fps = clip.fps > 0 ? clip.fps : 30;
  const exact = t * fps;
  const i0 = Math.max(0, Math.min(frames.length - 1, Math.floor(exact)));
  const i1 = Math.min(frames.length - 1, i0 + 1);
  const alpha = i1 === i0 ? 0 : Math.min(1, Math.max(0, exact - i0));

  const a = frames[i0];
  const b = frames[i1];
  if (!a || !b) return null;

  const jointStates = clip.jointNames.map((name, j) => ({
    name,
    position: a.dofPos[j] + (b.dofPos[j] - a.dofPos[j]) * alpha,
  }));

  const order = clip.rootRotOrder === 'wxyz' ? 'wxyz' : 'xyzw';
  setFromRootRot(_qa, a.rootRot, order);
  setFromRootRot(_qb, b.rootRot, order);
  _qa.slerp(_qb, alpha);

  // Root motion is reported RELATIVE to the clip's first frame.
  //
  // Absolute root position is not usable by the viewer: the clip's origin is wherever GVHMR
  // happened to put the subject, the pelvis height encodes GVHMR's ground-plane estimate (which
  // is set by a single global minimum and is ~9 cm high on the moonwalk clip), and drei's <Center>
  // re-centres the model anyway. Anchoring to frame 0 keeps the robot where <Center> placed it and
  // still shows every bit of real motion — the traverse and the crouch are both differences.
  const o = frames[0].rootPos;
  const px = a.rootPos[0] + (b.rootPos[0] - a.rootPos[0]) * alpha - o[0];
  const py = a.rootPos[1] + (b.rootPos[1] - a.rootPos[1]) * alpha - o[1];
  const pz = a.rootPos[2] + (b.rootPos[2] - a.rootPos[2]) * alpha - o[2];

  if (clip.upAxis === 'y') {
    // Translation AND orientation, or neither. Rotating the path while leaving the body's
    // orientation in the old basis is the failure mode that looks almost right: the robot
    // travels the correct route facing the wrong way, which reads as a retargeting artefact
    // rather than a frame bug and so never gets traced back to here.
    //
    // Both are the same basis change C = R_x(+90). For a point that is C·p. For orientation,
    // the robot's own local frame is fixed by the URDF and does not move with the clip's
    // convention, so the map is a plain left-multiply, NOT a conjugation C·q·C⁻¹: the sample
    // rotation must satisfy R_x(-90)·R_sample = R_clip once the group's correction is applied,
    // hence R_sample = C·R_clip.
    _qa.premultiply(_qUpYtoZ);
    return {
      frameIndex: i0,
      jointStates,
      rootPos: [px, -pz, py],
      rootRot: [_qa.x, _qa.y, _qa.z, _qa.w],
    };
  }

  return {
    frameIndex: i0,
    jointStates,
    rootPos: [px, py, pz],
    rootRot: [_qa.x, _qa.y, _qa.z, _qa.w],
  };
}

/**
 * Advance the clock and return the current pose. Called once per rendered frame by RobotModel.
 *
 * The clock lives here rather than being driven by useFrame's `delta` so that playback stays
 * correct when the viewer is unmounted, throttled by a background tab, or mounted twice.
 *
 * Mounted twice is the interesting one: two viewers both call this every frame. Because the step
 * is measured against wall-clock rather than accumulated from a fixed delta, the second call in a
 * frame simply sees a ~0.1 ms interval — N callers split one interval instead of each applying a
 * full one. Accumulating `delta` here would have run playback at N× speed.
 */
export function tickMotion(): MotionSample | null {
  const { clip } = state;
  if (!clip) return null;

  const now = performance.now();
  if (state.playing) {
    if (state.lastTickMs !== null) {
      // Clamp the step. A backgrounded tab resumes with a multi-second delta, which would
      // otherwise teleport the playhead — or, on a loop, skip whole passes of the clip.
      const dt = Math.min(0.25, (now - state.lastTickMs) / 1000) * state.speed;
      state.time += dt;
    }
    state.lastTickMs = now;

    const dur = clip.durationSec;
    if (state.time >= dur) {
      if (state.loop) {
        state.time = dur > 0 ? state.time % dur : 0;
      } else {
        state.time = dur;
        state.playing = false;
        state.lastTickMs = null;
        emit();
      }
    }
  }

  return sampleClip(clip, state.time);
}

// ============================================================
// TRANSPORT
// ============================================================

export function loadClip(clip: MotionClip | null): void {
  state.clip = clip;
  state.time = 0;
  state.playing = false;
  state.lastTickMs = null;
  emit();
}

export function playMotion(): void {
  if (!state.clip) return;
  // Restarting from the end is what a play button should do at the end of a non-looping clip;
  // otherwise it appears dead.
  if (!state.loop && state.time >= state.clip.durationSec) state.time = 0;
  state.playing = true;
  state.lastTickMs = null;
  emit();
}

export function pauseMotion(): void {
  state.playing = false;
  state.lastTickMs = null;
  emit();
}

export function toggleMotion(): void {
  if (state.playing) pauseMotion();
  else playMotion();
}

export function seekMotion(seconds: number): void {
  if (!state.clip) return;
  state.time = Math.min(state.clip.durationSec, Math.max(0, seconds));
  state.lastTickMs = null;
  emit();
}

/** Step exactly one frame. Used by the arrow keys — the way you check a single pose. */
export function stepMotion(frames: number): void {
  const { clip } = state;
  if (!clip) return;
  state.playing = false;
  state.lastTickMs = null;
  const fps = clip.fps > 0 ? clip.fps : 30;
  const idx = Math.round(state.time * fps) + frames;
  state.time = Math.min(clip.durationSec, Math.max(0, idx / fps));
  emit();
}

export function setMotionSpeed(speed: number): void {
  state.speed = speed;
  emit();
}

export function setMotionLoop(loop: boolean): void {
  state.loop = loop;
  emit();
}

export function setMotionFollowRoot(follow: boolean): void {
  state.followRoot = follow;
  emit();
}

export interface MotionTransportState {
  clipId: string | null;
  clipName: string | null;
  playing: boolean;
  time: number;
  duration: number;
  frameIndex: number;
  frameCount: number;
  speed: number;
  loop: boolean;
  followRoot: boolean;
}

export function getMotionTransport(): MotionTransportState {
  const { clip } = state;
  const fps = clip && clip.fps > 0 ? clip.fps : 30;
  return {
    clipId: clip?.id ?? null,
    clipName: clip?.name ?? null,
    playing: state.playing,
    time: state.time,
    duration: clip?.durationSec ?? 0,
    frameIndex: clip ? Math.min(clip.frameCount - 1, Math.floor(state.time * fps)) : 0,
    frameCount: clip?.frameCount ?? 0,
    speed: state.speed,
    loop: state.loop,
    followRoot: state.followRoot,
  };
}

/** True when a clip is loaded — the viewer uses this to decide playback outranks live telemetry. */
export function hasMotionClip(): boolean {
  return state.clip !== null;
}

export function isFollowingRoot(): boolean {
  return state.followRoot;
}

/** Test seam and unmount cleanup. */
export function resetMotion(): void {
  state.clip = null;
  state.playing = false;
  state.time = 0;
  state.speed = 1;
  state.loop = true;
  state.followRoot = true;
  state.lastTickMs = null;
  emit();
}
