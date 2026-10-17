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

/**
 * The reconnect schedule, in seconds: 1, 2, 4, 8, then 15 for as long as it
 * takes (TASK-401, D1).
 *
 * NO ATTEMPT LIMIT, on purpose. A teleop session lasts hours, and the camera
 * service on the G1's PC2 drops every client whenever its USB camera
 * re-enumerates. A panel that gave up after N tries would recreate exactly the
 * latch this replaced: one bad minute, and CAMERA OFFLINE until the operator
 * takes the headset off. The cap is what keeps a camera that is genuinely gone
 * from becoming a reconnect storm against the robot.
 *
 * @param attempt Retries already made since the last good frame, from 0.
 */
export const RETRY_SCHEDULE_S = [1, 2, 4, 8] as const;
export const RETRY_CAP_S = 15;

export function nextRetryDelayS(attempt: number): number {
  if (!Number.isFinite(attempt) || attempt < 0) return RETRY_SCHEDULE_S[0];
  const i = Math.floor(attempt);
  return i < RETRY_SCHEDULE_S.length ? RETRY_SCHEDULE_S[i] : RETRY_CAP_S;
}

/**
 * How long an armed stream may go without its first decoded frame before it is
 * treated as failed and re-armed, in ms.
 *
 * An MJPEG `<img>` whose upstream accepts the connection and then never sends a
 * part fires neither `load` nor `error` — it just sits there empty. Without
 * this the panel waited on it forever.
 */
export const FIRST_FRAME_TIMEOUT_MS = 4000;

/** The plate text for a robot that answers `/cameras` with an empty list. */
export const NO_CAMERA_DETAIL = 'no camera on this robot';

export type CameraPanelState = 'live' | 'stale' | 'offline' | 'connecting';

/**
 * Where the stream stands as far as connecting to it goes. `offline`: the last
 * attempt failed and a retry is scheduled. `connecting`: armed (or arming) and no
 * frame yet. `up`: a frame has arrived — whether it is still MOVING is the
 * panel's liveness check.
 */
export type ReconnectPhase = 'connecting' | 'offline' | 'up';

/**
 * The one state the panel publishes (`vrCameraStatus`). Connection trouble
 * outranks staleness: a picture that is not there cannot be stale.
 */
export function cameraPanelState(phase: ReconnectPhase, stale: boolean): CameraPanelState {
  if (phase !== 'up') return phase;
  return stale ? 'stale' : 'live';
}

export interface OfflinePlateInput {
  state: CameraPanelState;
  /** Why it is offline, in the agent's words, or null when nobody said. */
  detail: string | null;
  /** Whole seconds to the next retry, or null when none is scheduled. */
  retryInS: number | null;
  /** Retries already made since the last good frame. */
  attempt: number;
}

export type PlateTone = 'bad' | 'dim' | 'text';

export interface PlateLine {
  id: string;
  text: string;
  tone: PlateTone;
}

/** Longest line the 1024 px plate holds at its glyph size, in characters. */
const PLATE_LINE_CHARS = 36;

/** Break a reason into at most two plate lines, on a space where it can. */
function wrapDetail(text: string): string[] {
  const clean = text.trim().replace(/\s+/g, ' ');
  if (clean.length <= PLATE_LINE_CHARS) return [clean];
  let cut = clean.lastIndexOf(' ', PLATE_LINE_CHARS);
  if (cut <= 0) cut = PLATE_LINE_CHARS;
  const first = clean.slice(0, cut).trim();
  let rest = clean.slice(cut).trim();
  if (rest.length > PLATE_LINE_CHARS) rest = `${rest.slice(0, PLATE_LINE_CHARS - 1).trimEnd()}…`;
  return [first, rest];
}

/**
 * What the head-camera panel's plate says, when it shows one.
 *
 * Three things an operator with a headset on needs and could not get before:
 * THAT the camera is offline, WHY (the agent's own `detail`, e.g. "cannot reach
 * the hardware sidecar"), and that it is not giving up — a counting-down retry
 * and the attempt number, so a stuck plate and a recovering one look different.
 *
 * Returns no lines for `live` and `stale`: those show the picture itself (stale
 * has its own badge). `connecting` with no retry yet behind it is the ordinary
 * start of a session and shows no plate either.
 */
export function offlinePlateLines(input: OfflinePlateInput): PlateLine[] {
  const nextAttempt = Math.max(0, Math.floor(input.attempt)) + 1;
  const detailLines = (text: string): PlateLine[] =>
    wrapDetail(text).map((t, i) => ({ id: `detail${i}`, text: t, tone: 'dim' as const }));

  if (input.state === 'offline') {
    const retry =
      input.retryInS === null
        ? `retrying now · attempt ${nextAttempt}`
        : `retrying in ${Math.max(0, Math.ceil(input.retryInS))}s · attempt ${nextAttempt}`;
    return [
      { id: 'title', text: 'CAMERA OFFLINE', tone: 'bad' },
      ...detailLines(input.detail ?? 'stream failed'),
      { id: 'retry', text: retry, tone: 'text' },
    ];
  }
  if (input.state === 'connecting' && input.attempt > 0) {
    return [
      { id: 'title', text: 'RECONNECTING…', tone: 'text' },
      ...(input.detail ? detailLines(input.detail) : []),
      { id: 'retry', text: `attempt ${input.attempt}`, tone: 'dim' },
    ];
  }
  return [];
}
