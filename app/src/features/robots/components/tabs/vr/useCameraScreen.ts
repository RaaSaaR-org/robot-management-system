/**
 * @file useCameraScreen.ts
 * @description One camera stream on a screen inside the VR scene, minus the
 *              screen's own furniture: the `<img>` and its texture, the
 *              change-gated upload, the liveness check and its stale badge,
 *              the reconnects and the offline plate (TASK-443). The head-camera
 *              panel and the wrist panels both draw through it; each keeps what
 *              is its alone — the head its take strip, its haptics and the
 *              shared status store, a wrist its L/R plate and a keyed store.
 * @feature robots
 */

import { useEffect, useMemo, useRef, type MutableRefObject, type RefObject } from 'react';
import * as THREE from 'three';
import { cameraStreamUrl, fetchCameraTicket, fetchRobotCameras } from '../../../api/cameraApi';
import {
  cameraPanelState,
  initialLiveness,
  offlinePlateLines,
  pollLiveness,
  type FrameSampler,
  type LivenessState,
  type PlateTone,
} from './vrCamera';
import { useCameraReconnect, type ArmFn, type CameraReconnect } from './useCameraReconnect';
import type { VrCameraStatus } from './vrCameraStatus';
import { HUD_COLORS } from './vrHud';
import { useTextPlate, type TextPlate } from './VrTextPlate';

/** Freshness checks per second. See `SAMPLE_PX` for why this is nearly free. */
const LIVENESS_HZ = 2;

/**
 * Seconds between reconnect attempts once the stream has gone stale.
 *
 * Long enough that a camera which is genuinely gone does not become a reconnect
 * storm against the robot, short enough that a sim restart recovers on its own
 * before the operator gives up and takes the headset off.
 */
const REARM_INTERVAL_S = 5;
/**
 * Edge of the square the frame is downscaled into before it is checksummed.
 *
 * 8x8 is 64 pixels per read, and it is read at most once per upload slot (20 Hz)
 * plus twice a second for the staleness poll — ~1.4 k texels/s against the 1.2 MB
 * of RGBA one upload costs, i.e. four orders of magnitude below the price of the
 * thing it is watching, and it now SAVES most of those uploads rather than just
 * observing them. It is a fingerprint, not a comparison: two DIFFERENT frames
 * colliding on it would need the whole picture to average out identically in all
 * 64 cells, and the failure it is looking for is the opposite one — a frame that
 * is byte-identical because it is the same frame.
 */
const SAMPLE_PX = 8;

/** Stale badge texture size; each screen sizes the badge's plane itself. */
const BADGE_PX_WIDTH = 256;
const BADGE_PX_HEIGHT = 64;

/**
 * Offline plate texture, by default. 1024 wide so the agent's own reason
 * ("cannot reach the hardware sidecar") fits on a line at a size readable in a
 * headset on the head screen; `offlinePlateLines` wraps anything longer onto a
 * second one.
 */
const PLATE_PX_WIDTH = 1024;
const PLATE_PX_HEIGHT = 768;
const PLATE_LINE_PX = 72;

const TONE_COLOR: Record<PlateTone, string> = {
  bad: HUD_COLORS.bad,
  dim: HUD_COLORS.dim,
  text: HUD_COLORS.text,
};

/**
 * Point a screen's `<img>` at a fresh stream of `camera`, ticket and all.
 *
 * WHY A TICKET. `/api/robots/:id/camera/:name` sits behind the server's
 * `authMiddleware`, which reads the credential from `req.headers.authorization`
 * and from nowhere else — and an `<img>` cannot send a header. With auth enabled
 * every frame was a 401, `onerror` fired, and the operator got the CAMERA
 * OFFLINE plate with no hint that the cause was authentication rather than a
 * dead camera. It only ever looked fine because dev runs `AUTH_DISABLED=true`.
 *
 * So something must ride in the URL. It used to be the user's real access token
 * (PR 236, deliberately, as the smallest change that worked at all); it is now
 * a ticket good for this one camera for about two minutes and nothing else
 * (TASK-214). Every re-arm fetches a new one — a cached ticket would expire long
 * before a panel that has been stale for an hour stops trying.
 *
 * The URL stays RELATIVE: this rides the app's own origin (Vite proxies /api),
 * and WebGL refuses to sample a cross-origin image without CORS. It is also what
 * makes the 8x8 fingerprint read legal — a cross-origin draw would taint the
 * scratch canvas and `getImageData` would throw.
 *
 * `isCurrent` is checked AFTER the await and before anything is assigned. The
 * `<img>` is a single `useMemo(..., [])` element shared by every arming path, so
 * a ticket that arrives late would otherwise write over whatever armed after it
 * — pointing the panel at the previous robot's camera, or reopening a stream the
 * cleanup had just dropped.
 *
 * The `''`-then-URL pair stays in ONE task on purpose. An empty `src` queues an
 * `error` task; only a reassignment in the same task beats it to the queue.
 * Split them across an await and every re-arm fires `onerror`.
 *
 * The returned function resolves to whether the stream was armed. `false`
 * means no ticket, which the caller must surface: an `<img>` whose `src` was
 * never assigned fires no `onerror`, so nothing else would ever say so. It also
 * means "superseded", which needs no surfacing — whatever superseded it will
 * report for itself.
 */
export function armCameraStream(camera: string): ArmFn {
  return async (image, robotId, isCurrent) => {
    try {
      const { ticket } = await fetchCameraTicket(robotId, camera);
      if (!isCurrent()) return false;
      image.src = '';
      image.src = cameraStreamUrl(robotId, camera, ticket);
      return true;
    } catch {
      return false;
    }
  };
}

/**
 * FNV-1a over the downscaled frame. Chosen because it is eight lines, has no
 * dependency, and avalanches well enough that a one-pixel change moves the whole
 * word — which is all "did this picture change" needs.
 */
function fnv1a(bytes: Uint8ClampedArray): number {
  let hash = 2166136261;
  for (let i = 0; i < bytes.length; i += 1) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export interface CameraScreenOptions {
  robotId: string;
  /** The camera shown — named on the offline plate's last line. */
  camera: string;
  /** How the `<img>` is pointed at a stream. Must be referentially stable. */
  arm: ArmFn;
  /** Texture uploads per second, at most. */
  textureHz: number;
  /**
   * Where this screen's status goes. Must be referentially stable. The head
   * screen's goes to `useVrCameraStatus`, a wrist's to its own keyed store.
   */
  publish: (next: Partial<VrCameraStatus>) => void;
  /** The offline plate's texture size; the head screen's by default. */
  plate?: { pxWidth: number; pxHeight: number; linePx: number };
  /** The frame fingerprint. The 8x8 canvas by default; replaced in tests only. */
  sampleFrame?: (image: HTMLImageElement) => number | undefined;
}

/** What one liveness poll found. */
export interface CameraScreenPoll {
  isStale: boolean;
  /** Stale now, and was not at the previous poll. */
  becameStale: boolean;
}

export interface CameraScreen {
  /** The stream's texture; sample it while `showPlate` is false. */
  texture: THREE.Texture;
  /** The plate shown in the picture's place while there is no picture. */
  offlinePlate: TextPlate;
  showPlate: boolean;
  /** `STALE 1.4s`, drawn while the picture is frozen. */
  badgePlate: TextPlate;
  /** The badge's mesh, whose visibility the frame step sets. */
  badgeRef: RefObject<THREE.Mesh | null>;
  reconnect: CameraReconnect;
  /** Whether the last liveness poll called the picture stale. */
  staleNow: MutableRefObject<boolean>;
  /**
   * The per-frame work, for the screen's `useFrame`: the upload gate, the fps,
   * the liveness poll, the badge and the stale re-arm. Returns the poll's
   * result on the frames that poll, else null.
   */
  step: (now: number) => CameraScreenPoll | null;
}

/**
 * The stream side of a camera screen. The caller draws the meshes — it owns
 * the geometry — and calls `step` from its own `useFrame`, so whatever it does
 * per frame besides (the head's strip) keeps its place around it.
 *
 * TWO FAILURES IT USED TO HIDE (when it was the head panel alone):
 *  - On a load error it returned `null`, so mid-session the screen the operator
 *    was looking at simply vanished — indistinguishable from having turned away
 *    from it, and leaving no clue that there had ever been a camera. It now
 *    renders a plate of the same size in the same place saying so.
 *  - An `<img>` bound to `multipart/x-mixed-replace` does NOT fire `error` when
 *    the upstream stops producing frames: the connection stays open and the last
 *    frame stays decoded, so a frozen picture was pixel-for-pixel identical to a
 *    live picture of a stationary scene. `vrCamera.ts` classifies that; this
 *    file supplies the sample and shows the result.
 */
export function useCameraScreen({
  robotId,
  camera,
  arm,
  textureHz,
  publish,
  plate = { pxWidth: PLATE_PX_WIDTH, pxHeight: PLATE_PX_HEIGHT, linePx: PLATE_LINE_PX },
  sampleFrame,
}: CameraScreenOptions): CameraScreen {
  const lastUpload = useRef(0);
  /** Fingerprint of the frame currently on the GPU — see the upload gate. */
  const lastUploaded = useRef<number | undefined>(undefined);
  const lastPoll = useRef(0);
  // Null until the FIRST decoded frame. The stale clock must start when the
  // stream starts, not when the component mounts: seeding it at mount made a
  // stream that took three seconds to connect report itself as frozen — and buzz
  // both controllers — on every single session start.
  const liveness = useRef<LivenessState | null>(null);
  const badgeRef = useRef<THREE.Mesh>(null);

  const offlinePlate = useTextPlate({
    pxWidth: plate.pxWidth,
    pxHeight: plate.pxHeight,
    linePx: plate.linePx,
    align: 'center',
  });
  const badgePlate = useTextPlate({
    pxWidth: BADGE_PX_WIDTH,
    pxHeight: BADGE_PX_HEIGHT,
    linePx: 46,
    align: 'center',
    background: 'rgba(40,8,8,0.9)',
  });

  const { texture, image } = useMemo(() => {
    const img = document.createElement('img');
    const tex = new THREE.Texture(img);
    tex.colorSpace = THREE.SRGBColorSpace;
    return { texture: tex, image: img };
  }, []);

  /** The 8x8 scratch canvas the frame is fingerprinted through. */
  const sampler = useMemo<FrameSampler>(() => {
    if (sampleFrame) return () => sampleFrame(image);
    const canvas = document.createElement('canvas');
    canvas.width = SAMPLE_PX;
    canvas.height = SAMPLE_PX;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    return () => {
      // No decoded frame yet is "not readable", which `frameLiveness` treats as
      // "no new frame" — the fail-safe direction.
      if (!ctx || image.naturalWidth === 0) return undefined;
      ctx.drawImage(image, 0, 0, SAMPLE_PX, SAMPLE_PX);
      return fnv1a(ctx.getImageData(0, 0, SAMPLE_PX, SAMPLE_PX).data);
    };
    // `sampleFrame` is a test seam, fixed for the screen's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image]);

  /**
   * The texture's lifetime is the COMPONENT's, so its dispose belongs in an
   * effect that runs once.
   *
   * It used to be disposed from the cleanup of the stream effect below, which is
   * keyed on `robotId` — but the texture is built in a `useMemo` with no
   * dependencies, so switching robots disposed an instance that would never be
   * rebuilt and left the panel material sampling a disposed texture while
   * `useFrame` went on setting `needsUpdate` on it.
   */
  useEffect(() => () => texture.dispose(), [texture]);

  /** R3F clock time of the last stale re-arm, for its rate limit below. */
  const lastRearm = useRef(0);
  /** Distinct frames uploaded since `fpsWindowStart`, for the published fps. */
  const fpsFrames = useRef(0);
  const fpsWindowStart = useRef(0);
  /** Whether the last liveness poll called the picture stale. */
  const staleNow = useRef(false);

  // Arming, the failure latches that used to be permanent, and the backoff that
  // replaces them — all in `useCameraReconnect`, so they are testable without
  // a WebGL context. This hook keeps the liveness side: it is the only place
  // that can see whether a decoding picture is still moving.
  const reconnect = useCameraReconnect({
    robotId,
    image,
    arm,
    listCameras: fetchRobotCameras,
  });
  const showPlate = reconnect.phase === 'offline' || (reconnect.phase === 'connecting' && reconnect.attempt > 0);

  useEffect(() => {
    // A new stream is a new picture: neither the upload gate's fingerprint nor
    // the stale clock may carry the previous robot's frame across.
    lastUploaded.current = undefined;
    liveness.current = null;
    lastRearm.current = 0;
    staleNow.current = false;
    fpsFrames.current = 0;
    fpsWindowStart.current = 0;
  }, [robotId]);

  // Everything but `stale` and `fps` changes as React state; those two are
  // render-loop facts and are published from `step` below.
  useEffect(() => {
    publish({
      robotId,
      state: cameraPanelState(reconnect.phase, staleNow.current),
      detail: reconnect.phase === 'up' ? null : reconnect.detail,
      retryInS: reconnect.retryInS,
      ...(reconnect.phase === 'up' ? {} : { fps: null }),
    });
  }, [publish, robotId, reconnect.phase, reconnect.detail, reconnect.retryInS]);

  const step = (now: number): CameraScreenPoll | null => {
    // Rate-limited AND change-gated. The rate limit alone was the behaviour
    // `vrCamera.ts` names as the reason it exists: 20 uploads a second of a
    // ~14 fps stream re-pushed the same 1.2 MB of RGBA about six times a second
    // forever, including for a stream that had frozen completely. The 8x8
    // fingerprint that already answers "did this picture change" for the
    // staleness check answers it here too, for one 64-pixel read per upload
    // slot — four orders of magnitude under the upload it can now skip.
    const offline = reconnect.phase === 'offline';
    // A decoded frame ends `connecting` even where the browser fires no `load`
    // for a multipart part. Idempotent, so calling it per frame costs a compare.
    if (!offline && reconnect.phase === 'connecting' && image.naturalWidth > 0) reconnect.markFrame();

    if (!offline && image.naturalWidth > 0 && now - lastUpload.current >= 1 / textureHz) {
      lastUpload.current = now;
      const fingerprint = sampler();
      if (fingerprint !== undefined && fingerprint !== lastUploaded.current) {
        lastUploaded.current = fingerprint;
        texture.needsUpdate = true;
        fpsFrames.current += 1;
      }
    }

    // Nothing has ever arrived is not the same failure as something stopped
    // arriving, and only the second one is what this classifies. The first is
    // `useCameraReconnect`'s first-frame watchdog.
    if (reconnect.phase !== 'up' || image.naturalWidth === 0) {
      // The stale badge describes a picture; with no picture (the plate, or a
      // blank re-arm) it would be talking about nothing.
      if (badgeRef.current) badgeRef.current.visible = false;
      return null;
    }

    // Once a second: distinct frames seen, i.e. what the operator is actually
    // getting (capped by the upload rate), not what the stream claims.
    if (now - fpsWindowStart.current >= 1) {
      const elapsed = now - fpsWindowStart.current;
      if (fpsWindowStart.current > 0) publish({ fps: Math.round(fpsFrames.current / elapsed) });
      fpsFrames.current = 0;
      fpsWindowStart.current = now;
    }

    if (now - lastPoll.current < 1 / LIVENESS_HZ) return null;
    lastPoll.current = now;
    // `pollLiveness` works in milliseconds; the R3F clock is in seconds.
    const nowMs = now * 1000;
    const prev = liveness.current ?? initialLiveness(nowMs);
    const was = prev.state;
    const next = pollLiveness(prev, sampler, nowMs);
    liveness.current = next;
    const isStale = next.state === 'stale';
    if (isStale !== staleNow.current) {
      staleNow.current = isStale;
      publish({ state: cameraPanelState('up', isStale) });
    }
    const becameStale = isStale && was !== 'stale';

    const badge = badgeRef.current;
    if (badge) badge.visible = isStale;

    // RE-ARM. A dead upstream does not reach an `<img>` on a
    // `multipart/x-mixed-replace` as an error — the connection simply stops
    // producing parts — so `onerror` never fires and the panel had no way back:
    // it latched to STALE and stayed there until the operator closed and
    // reopened the modal. Restarting the sim mid-session, which is routine, cost
    // a headset removal.
    //
    // Reassigning `src` drops the old connection and opens a new one. Rate
    // limited, because a camera that is genuinely gone must not become a
    // reconnect storm, and only while stale — a live stream is never touched.
    if (isStale && now - lastRearm.current >= REARM_INTERVAL_S) {
      // Stamped BEFORE the arm, not after. `useFrame` is synchronous and runs
      // at display rate, so a rate limit that only advanced on success would let
      // a slow or failing ticket endpoint turn this into a ~72 Hz POST storm.
      // `rearm` itself refuses while another arm is in flight.
      lastRearm.current = now;
      lastUploaded.current = undefined;
      liveness.current = null;
      staleNow.current = false;
      // NOT `image.src = ''` here. `armCameraStream` clears and reassigns in one
      // task, which is what keeps the empty-`src` `error` event from firing.
      // Once it is armed the picture is gone until the first new frame, and a
      // stream that never sends one is the reconnect hook's first-frame watchdog.
      reconnect.rearm();
    }
    if (isStale) {
      badgePlate.draw([
        // One decimal: the operator needs to know whether the number is climbing,
        // and a whole-second readout takes a second to answer that.
        { id: 'stale', text: `STALE ${(next.staleForMs / 1000).toFixed(1)}s`, color: HUD_COLORS.bad },
      ]);
    }
    return { isStale, becameStale };
  };

  // In an effect, not in the render body: `draw` mutates a canvas and a GPU
  // texture, which is not something a render pass is allowed to do twice under
  // StrictMode and get away with.
  // Redrawn whenever the countdown ticks (1 Hz) — `draw` is a no-op when the
  // text is unchanged, so the other re-renders cost one string compare.
  useEffect(() => {
    if (!showPlate) return;
    const lines = offlinePlateLines({
      state: reconnect.phase === 'offline' ? 'offline' : 'connecting',
      detail: reconnect.detail,
      retryInS: reconnect.retryInS,
      attempt: reconnect.attempt,
    });
    offlinePlate.draw([
      ...lines.map((line) => ({ id: line.id, text: line.text, color: TONE_COLOR[line.tone] })),
      { id: 'camera', text: camera, color: HUD_COLORS.dim },
    ]);
  }, [showPlate, reconnect.phase, reconnect.detail, reconnect.retryInS, reconnect.attempt, offlinePlate, camera]);

  return { texture, offlinePlate, showPlate, badgePlate, badgeRef, reconnect, staleNow, step };
}
