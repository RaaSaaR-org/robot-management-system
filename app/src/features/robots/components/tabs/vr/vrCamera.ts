/**
 * @file vrCamera.ts
 * @description Freshness tracking for the robot's head-camera panel. Pure — no
 *              React, no three.js, no DOM. The caller supplies the sampler that
 *              turns the current frame into a number; this file decides what a
 *              sequence of those numbers means.
 * @feature robots
 */

/**
 * A cheap fingerprint of the frame currently decoded in the panel's `<img>`,
 * or `undefined` when it could not be read.
 *
 * Injected rather than implemented here because reading it means touching a
 * canvas, and the whole value of this module is that the DECISION is testable
 * without one.
 */
export type FrameSampler = () => number | undefined;

export type FrameState = 'live' | 'stale';

/**
 * How long a picture may stay identical before it is called stale, in ms.
 *
 * The MJPEG stream runs at ~14 fps (71 ms/frame), so this is roughly 14
 * consecutive frames that never arrived — far outside ordinary jitter, and fast
 * enough that an operator notices before they have driven a 43-DOF humanoid
 * anywhere on the strength of it.
 *
 * WHY THIS MODULE EXISTS AT ALL: an `<img>` bound to a
 * `multipart/x-mixed-replace` stream does NOT fire `error` when the upstream
 * stops producing frames — the connection stays open and the last frame stays
 * decoded. A frozen picture is pixel-for-pixel indistinguishable from a live
 * picture of a stationary scene, and an operator driving off one is the worst
 * outcome this feature can produce. Nothing in the panel could tell them apart,
 * so nothing did: it re-uploaded the same pixels to the GPU forever and drew
 * them as if they were news.
 *
 * The fingerprint this file consumes is now also what gates the panel's texture
 * upload, so an unchanged picture costs neither an upload nor a lie.
 */
export const CAMERA_STALE_AFTER_MS = 1000;

export interface FrameLivenessInput {
  /** This sample's fingerprint, or undefined if it could not be read. */
  checksum: number | undefined;
  /** The previous sample's fingerprint. */
  prev: number | undefined;
  /** Now, in ms. */
  now: number;
  /** When the picture last actually changed, in ms. */
  lastChangeAt: number;
  staleAfterMs?: number;
}

export interface FrameLivenessResult {
  state: FrameState;
  /** Feed back as `prev` next tick. */
  checksum: number | undefined;
  /** Feed back as `lastChangeAt` next tick. */
  lastChangeAt: number;
  /** How long the picture has been identical, in ms. */
  staleForMs: number;
}

/**
 * Classify one sample.
 *
 * An UNREADABLE sample (`checksum === undefined`: zero-size image, a decode in
 * flight, a canvas the browser refused) counts as "no new frame" and lets the
 * clock keep running toward stale. That is the fail-safe direction: the failure
 * this exists to catch is a picture that has stopped updating, so ambiguity has
 * to resolve toward warning the operator, never toward reassuring them.
 */
export function frameLiveness(input: FrameLivenessInput): FrameLivenessResult {
  const staleAfterMs = input.staleAfterMs ?? CAMERA_STALE_AFTER_MS;
  const now = Number.isFinite(input.now) ? input.now : 0;
  // No usable history (first tick, or a clock that jumped backwards): start the
  // stale clock here rather than reporting an age nobody measured.
  const base =
    Number.isFinite(input.lastChangeAt) && input.lastChangeAt <= now ? input.lastChangeAt : now;

  const readable = input.checksum !== undefined && Number.isFinite(input.checksum);
  const changed = readable && input.checksum !== input.prev;
  if (changed) {
    return { state: 'live', checksum: input.checksum, lastChangeAt: now, staleForMs: 0 };
  }

  const staleForMs = now - base;
  return {
    state: staleForMs >= staleAfterMs ? 'stale' : 'live',
    // An unreadable sample must not overwrite the last GOOD fingerprint —
    // otherwise the next readable frame compares against `undefined`, looks
    // like a change, and resets the stale clock on a picture that never moved.
    checksum: readable ? input.checksum : input.prev,
    lastChangeAt: base,
    staleForMs,
  };
}

export interface LivenessState {
  checksum: number | undefined;
  lastChangeAt: number;
  state: FrameState;
  staleForMs: number;
}

export function initialLiveness(now: number): LivenessState {
  return {
    checksum: undefined,
    lastChangeAt: Number.isFinite(now) ? now : 0,
    state: 'live',
    staleForMs: 0,
  };
}

/**
 * One poll: take a sample and fold it into the state.
 *
 * A sampler that THROWS is treated exactly like one that returns undefined —
 * this runs inside the render loop, and a tainted canvas or a torn-down image
 * must not take the frame with it.
 */
export function pollLiveness(
  state: LivenessState,
  sample: FrameSampler,
  now: number,
  staleAfterMs?: number,
): LivenessState {
  let checksum: number | undefined;
  try {
    checksum = sample();
  } catch {
    checksum = undefined;
  }
  const r = frameLiveness({
    checksum,
    prev: state.checksum,
    now,
    lastChangeAt: state.lastChangeAt,
    staleAfterMs,
  });
  return {
    checksum: r.checksum,
    lastChangeAt: r.lastChangeAt,
    state: r.state,
    staleForMs: r.staleForMs,
  };
}

/**
 * Does an `error` event from the panel's `<img>` mean the camera is offline?
 *
 * Only if there was a `src` to fail at. Clearing `src` is how the panel drops an
 * MJPEG connection — on unmount, and before a re-arm — and an empty `src` is
 * specified to queue an `error` task of its own ("update the image data": the
 * request goes to broken and fires `error`). Assigning a real URL in the SAME
 * task beats that task to the queue and no error is seen, which is why this was
 * invisible while arming was synchronous.
 *
 * It stopped being synchronous when the stream started needing a ticket
 * (TASK-214): a `fetch` now sits between clearing `src` and reassigning it, so
 * the empty-`src` error lands. Treated as a load failure it latches the panel to
 * CAMERA OFFLINE — and `failed` is also what gates the re-arm, so the latch is
 * permanent and takes the panel's only recovery from a sim restart with it.
 *
 * @param src The `<img>`'s `src` attribute as it reads NOW, at handler time —
 *            `image.getAttribute('src')`, which is `''` after a clear.
 */
export function isRealLoadFailure(src: string | null): boolean {
  return Boolean(src);
}
