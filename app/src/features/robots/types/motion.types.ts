/**
 * @file motion.types.ts
 * @description Retargeted motion clips — the contract between the offline GVHMR→GMR pipeline,
 *              the server, and the 3D viewer.
 * @feature robots
 */

/**
 * Hard cap on frames per clip — mirrors the server's MAX_CLIP_FRAMES
 * (server/src/services/MotionClipService.ts). A frame serialises to ~300 bytes, so
 * 30k frames ≈ 9 MB, just under the server's 10 MB JSON body limit; checking here
 * names the real constraint instead of surfacing a wire-level "request too large".
 */
export const MAX_CLIP_FRAMES = 30_000;

/**
 * One retargeted pose.
 *
 * Frames are stored as bare tuples rather than named fields because a clip is thousands of them
 * and the field names would be ~70% of the payload. The meaning of each slot is fixed by
 * `MotionClip.jointNames`, `rootRotOrder`, and `upAxis` — never inferred.
 */
export interface MotionFrame {
  /** Pelvis position in the clip's own frame, metres. Axis meaning depends on `upAxis`. */
  rootPos: [number, number, number];
  /** Pelvis orientation. Component order is given by `rootRotOrder`, NOT assumed. */
  rootRot: [number, number, number, number];
  /** One angle per entry of `jointNames`, radians, same order. */
  dofPos: number[];
}

export interface MotionClip extends MotionClipSummary {
  frames: MotionFrame[];
}

/**
 * A clip without its frames. This is what list endpoints return — the frame array is 100 KB+ and
 * the library view needs none of it.
 */
export interface MotionClipSummary {
  id: string;
  name: string;
  /** Where the motion came from: 'gmr' (retargeted from video), 'recorded', 'synthetic'. */
  source: string;
  /** Which robot the angles were retargeted onto. Playing a clip on a different body is wrong. */
  robotType: string;
  fps: number;
  frameCount: number;
  durationSec: number;
  /**
   * Joint names in `dofPos` order. The viewer matches by NAME into the URDF, so a reordering
   * cannot silently produce plausible-but-wrong motion — the classic retargeting failure.
   */
  jointNames: string[];
  /**
   * Quaternion component order of `rootRot`. GMR exports xyzw (scalar-last), which is also
   * three.js's convention, so it passes through untouched — but it is carried explicitly because
   * GMR's own reader flips it back to wxyz and a consumer copying that line would be wrong.
   *
   * Consumed by `sampleClip`, which reorders wxyz to xyzw. Read it there, not at the render site:
   * a wxyz clip misread as xyzw yields a unit quaternion describing a different orientation, so
   * there is no downstream check that can catch the mistake.
   */
  rootRotOrder: 'xyzw' | 'wxyz';
  /**
   * Up axis of the clip's coordinate frame. MuJoCo/GMR is 'z'; three.js is 'y'. The clip is
   * stored exactly as the pipeline produced it.
   *
   * Consumed by `sampleClip`, which rotates 'y' clips (position and orientation together) into
   * the Z-up frame the renderer expects. The renderer itself assumes Z-up unconditionally.
   */
  upAxis: 'y' | 'z';
  /** Non-fatal quality notes from the exporter (joints beyond range, frozen DoF). */
  warnings: string[];
  /** Free-form provenance: source video, pipeline variant, licence notes. */
  metadata?: Record<string, unknown>;
  createdAt: string;
}

/** Body of POST /api/motion-clips. Mirrors the exporter's JSON output. */
export interface CreateMotionClipInput {
  name: string;
  source?: string;
  robotType?: string;
  fps: number;
  jointNames: string[];
  rootRotOrder?: 'xyzw' | 'wxyz';
  upAxis?: 'y' | 'z';
  warnings?: string[];
  metadata?: Record<string, unknown>;
  frames: MotionFrame[];
}

/**
 * A pose sampled from a clip at an arbitrary time, ready for the viewer.
 *
 * One convention regardless of what the clip declared: sampling resolves `rootRotOrder` and
 * `upAxis` so that every sample is xyzw and Z-up. Nothing downstream needs the clip to interpret
 * a sample.
 */
export interface MotionSample {
  frameIndex: number;
  jointStates: Array<{ name: string; position: number }>;
  /** Metres, Z-up, relative to the clip's first frame — sampling normalises from `upAxis`. */
  rootPos: [number, number, number];
  /** Always xyzw and Z-up — sampling normalises from `rootRotOrder` and `upAxis`. */
  rootRot: [number, number, number, number];
}
