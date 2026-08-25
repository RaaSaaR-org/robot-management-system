/**
 * @file HeadCameraPanel.tsx
 * @description The robot's own head-camera view, drawn as a panel inside the VR
 *              scene: an MJPEG stream uploaded to a texture at a bounded rate and
 *              only when the picture has actually changed, plus the two failure
 *              states the panel used to hide — a stream that never loaded, and a
 *              stream that stopped moving without ever saying so.
 * @feature robots
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { useXRInputSourceState } from '@react-three/xr';
import * as THREE from 'three';
import { brandColors } from '@/brand';
import { cameraStreamUrl, fetchCameraTicket } from '../../../api/cameraApi';
import {
  initialLiveness,
  isRealLoadFailure,
  pollLiveness,
  type FrameSampler,
  type LivenessState,
} from './vrCamera';
import { HAPTICS, pulsePreset, type HapticSource } from './vrHaptics';
import { HUD_COLORS } from './vrHud';
import { useTextPlate } from './VrTextPlate';
import {
  PANEL_ASPECT,
  PANEL_CAMERA,
  PANEL_DISTANCE_M,
  PANEL_HEIGHT_M,
  PANEL_TEXTURE_HZ,
  PANEL_WIDTH_M,
} from './vrConstants';

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

const PANEL_TALL_M = PANEL_WIDTH_M * PANEL_ASPECT;

/**
 * Point the panel's `<img>` at a fresh stream, ticket and all.
 *
 * WHY A TICKET. `/api/robots/:id/camera/:name` sits behind the server's
 * `authMiddleware`, which reads the credential from `req.headers.authorization`
 * and from nowhere else — and an `<img>` cannot send a header. With auth enabled
 * every frame was a 401, `onerror` fired, and the operator got the CAMERA
 * OFFLINE plate with no hint that the cause was authentication rather than a
 * dead camera. It only ever looked fine because dev runs `AUTH_DISABLED=true`.
 *
 * So something must ride in the URL. It used to be the user's real access token
 * (PR #236, deliberately, as the smallest change that worked at all); it is now
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
 * @returns whether the stream was armed. `false` means no ticket, which the
 *          caller must surface: an `<img>` whose `src` was never assigned fires
 *          no `onerror`, so nothing else would ever say so. It also means
 *          "superseded", which needs no surfacing — whatever superseded it will
 *          report for itself.
 */
async function armStream(
  image: HTMLImageElement,
  robotId: string,
  isCurrent: () => boolean,
): Promise<boolean> {
  try {
    const { ticket } = await fetchCameraTicket(robotId, PANEL_CAMERA);
    if (!isCurrent()) return false;
    image.src = '';
    image.src = cameraStreamUrl(robotId, PANEL_CAMERA, ticket);
    return true;
  } catch {
    return false;
  }
}

/** Stale badge geometry, in metres, and its texture size. */
const BADGE_WIDTH_M = 0.3;
const BADGE_HEIGHT_M = 0.075;
const BADGE_PX_WIDTH = 256;
const BADGE_PX_HEIGHT = 64;

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

/**
 * The robot's own view, hanging in the scene in front of it.
 *
 * Deliberately a PANEL and not a full-screen backdrop. The head camera does not
 * turn when the wearer's head turns, and a full-screen image that ignores head
 * motion is textbook simulator sickness — made worse here by the stream's own
 * latency. As a panel it behaves like a monitor bolted in front of the robot:
 * look at it to see what the robot sees, look away and the room is still there.
 *
 * It lives inside the yaw group, so a recenter swings it around to face the
 * wearer along with the robot, and it stays put in the world in between.
 *
 * TWO FAILURES IT USED TO HIDE:
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
export function HeadCameraPanel({ robotId }: { robotId: string }) {
  const [failed, setFailed] = useState(false);
  const lastUpload = useRef(0);
  /** Fingerprint of the frame currently on the GPU — see the upload gate. */
  const lastUploaded = useRef<number | undefined>(undefined);
  const lastPoll = useRef(0);
  // Null until the FIRST decoded frame. The stale clock must start when the
  // stream starts, not when the component mounts: seeding it at mount made a
  // stream that took three seconds to connect report itself as frozen — and buzz
  // both controllers — on every single session start.
  const liveness = useRef<LivenessState | null>(null);
  const surroundRef = useRef<THREE.Mesh>(null);
  const badgeRef = useRef<THREE.Mesh>(null);
  const left = useXRInputSourceState('controller', 'left');
  const right = useXRInputSourceState('controller', 'right');

  const offlinePlate = useTextPlate({ pxWidth: 512, pxHeight: 384, linePx: 56, align: 'center' });
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

  /** R3F clock time of the last reconnect attempt, for the re-arm below. */
  const lastRearm = useRef(0);
  /** A ticket fetch is in flight; a second re-arm must not race it. */
  const arming = useRef(false);
  /**
   * Bumped whenever the in-flight arming attempt stops being the current one —
   * a robot change, an unmount, or a later re-arm. `arming` only stops two
   * fetches overlapping; this is what stops a slow one landing after it lost.
   */
  const armEpoch = useRef(0);

  useEffect(() => {
    // Also reset per-robot, and this is why: `failed` is what swaps in the
    // CAMERA OFFLINE plate, and leaving it set meant one robot's missing camera
    // stuck the panel on that plate for every robot selected afterwards.
    setFailed(false);
    // A new stream is a new picture: neither the upload gate's fingerprint nor
    // the stale clock may carry the previous robot's frame across.
    lastUploaded.current = undefined;
    liveness.current = null;
    lastRearm.current = 0;
    // Guarded on `src`, because clearing it is how this component drops a
    // connection — and an empty `src` is specified to fire `error`. That was
    // harmless while arming was synchronous (`src = ''` then `src = url` in one
    // task suppresses it); now that a ticket round trip sits between them, an
    // unguarded handler latches CAMERA OFFLINE on the very re-arm that is busy
    // fixing the stream, and `failed` gates the re-arm itself. Only a real load
    // failure — one with a `src` to fail at — is an offline camera.
    image.onerror = () => {
      if (isRealLoadFailure(image.getAttribute('src'))) setFailed(true);
    };
    // Arming is a round trip now (fetch a ticket, then assign `src`), so the
    // effect can outlive its own robot. `cancelled` is what keeps a slow ticket
    // for robot A from pointing the panel at A's camera after the operator
    // switched to B.
    let cancelled = false;
    armEpoch.current += 1;
    const epoch = armEpoch.current;
    void armStream(image, robotId, () => armEpoch.current === epoch).then((armed) => {
      if (cancelled) return;
      // No ticket, no `src`, and an unassigned `<img>` fires no `onerror` — the
      // panel would sit blank and claim nothing. Say it is offline instead.
      if (!armed) setFailed(true);
    });
    return () => {
      cancelled = true;
      // Retire the in-flight attempt too, or its `src` assignment lands after
      // the line below and reopens the connection this is closing.
      armEpoch.current += 1;
      // Drop the MJPEG connection. Leave it open and the sim keeps rendering
      // frames for a panel nobody is looking at — and every one of those frames
      // is a render on its physics thread.
      image.src = '';
    };
  }, [image, robotId]);

  useFrame((state) => {
    const now = state.clock.elapsedTime;

    // Rate-limited AND change-gated. The rate limit alone was the behaviour
    // `vrCamera.ts` names as the reason it exists: 20 uploads a second of a
    // ~14 fps stream re-pushed the same 1.2 MB of RGBA about six times a second
    // forever, including for a stream that had frozen completely. The 8x8
    // fingerprint that already answers "did this picture change" for the
    // staleness check answers it here too, for one 64-pixel read per upload
    // slot — four orders of magnitude under the upload it can now skip.
    if (!failed && image.naturalWidth > 0 && now - lastUpload.current >= 1 / PANEL_TEXTURE_HZ) {
      lastUpload.current = now;
      const fingerprint = sampler();
      if (fingerprint !== undefined && fingerprint !== lastUploaded.current) {
        lastUploaded.current = fingerprint;
        texture.needsUpdate = true;
      }
    }

    // Nothing has ever arrived is not the same failure as something stopped
    // arriving, and only the second one is what this classifies.
    if (failed || image.naturalWidth === 0) return;
    if (now - lastPoll.current < 1 / LIVENESS_HZ) return;
    lastPoll.current = now;
    // `pollLiveness` works in milliseconds; the R3F clock is in seconds.
    const nowMs = now * 1000;
    const prev = liveness.current ?? initialLiveness(nowMs);
    const was = prev.state;
    const next = pollLiveness(prev, sampler, nowMs);
    liveness.current = next;
    const isStale = next.state === 'stale';

    if (isStale && was !== 'stale') {
      // `linkLost` rather than a preset of its own: this IS a link loss from the
      // operator's point of view — the thing they were steering by has stopped
      // arriving — and it is long enough not to be mistaken for a saturation tap.
      const sources: Array<HapticSource | undefined> = [left?.inputSource, right?.inputSource];
      for (const source of sources) pulsePreset(source, HAPTICS.linkLost);
    }

    const surround = surroundRef.current;
    if (surround) {
      (surround.material as THREE.MeshBasicMaterial).color.set(
        isStale ? HUD_COLORS.bad : brandColors().accent,
      );
    }
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
    if (isStale && now - lastRearm.current >= REARM_INTERVAL_S && !arming.current) {
      // Stamped BEFORE the await, not after. `useFrame` is synchronous and runs
      // at display rate, so a rate limit that only advanced on success would let
      // a slow or failing ticket endpoint turn this into a ~72 Hz POST storm —
      // the reconnect storm this limit exists to prevent, moved one hop
      // upstream. `arming` covers the same window from the other side, so two
      // fetches can never both be assigning `src`.
      lastRearm.current = now;
      arming.current = true;
      lastUploaded.current = undefined;
      liveness.current = null;
      // NOT `image.src = ''` here. `armStream` clears and reassigns in one task,
      // which is what keeps the empty-`src` `error` event from firing; clearing
      // it here instead leaves the `<img>` empty across the whole ticket round
      // trip, which fires `error` (latching CAMERA OFFLINE) and drives
      // `naturalWidth` to 0 (which the guard above turns into "never re-arm
      // again"). Both latches are permanent — this is the panel's only way back
      // from a sim restart.
      armEpoch.current += 1;
      const rearmEpoch = armEpoch.current;
      void armStream(image, robotId, () => armEpoch.current === rearmEpoch).finally(() => {
        arming.current = false;
      });
    }
    if (isStale) {
      badgePlate.draw([
        // One decimal: the operator needs to know whether the number is climbing,
        // and a whole-second readout takes a second to answer that.
        { id: 'stale', text: `STALE ${(next.staleForMs / 1000).toFixed(1)}s`, color: HUD_COLORS.bad },
      ]);
    }
  });

  // In an effect, not in the render body: `draw` mutates a canvas and a GPU
  // texture, which is not something a render pass is allowed to do twice under
  // StrictMode and get away with.
  useEffect(() => {
    if (!failed) return;
    offlinePlate.draw([
      { id: 'title', text: 'CAMERA OFFLINE', color: HUD_COLORS.bad },
      { id: 'hint', text: PANEL_CAMERA, color: HUD_COLORS.dim },
    ]);
  }, [failed, offlinePlate]);

  return (
    <group position={[PANEL_DISTANCE_M, PANEL_HEIGHT_M, 0]} rotation={[0, -Math.PI / 2, 0]}>
      <mesh>
        <planeGeometry args={[PANEL_WIDTH_M, PANEL_TALL_M]} />
        {/* toneMapped: this is a camera image, not lit geometry — leave its
            values alone or the render pipeline crushes the highlights. The
            offline plate takes the SAME geometry in the SAME place, so a stream
            that dies mid-session leaves the screen where the operator last saw
            it instead of leaving a hole in the scene. */}
        <meshBasicMaterial map={failed ? offlinePlate.texture : texture} toneMapped={false} />
      </mesh>
      {/* A thin surround, so the panel reads as a screen and not a hole. Turns
          red while the picture is frozen — the one state that otherwise looks
          exactly like a working camera. */}
      <mesh ref={surroundRef} position={[0, 0, -0.005]}>
        <planeGeometry args={[PANEL_WIDTH_M + 0.03, PANEL_TALL_M + 0.03]} />
        <meshBasicMaterial color={brandColors().accent} />
      </mesh>
      {badgePlate.texture && (
        <mesh
          ref={badgeRef}
          visible={false}
          position={[0, PANEL_TALL_M / 2 - BADGE_HEIGHT_M, 0.01]}
          renderOrder={10}
        >
          <planeGeometry args={[BADGE_WIDTH_M, BADGE_HEIGHT_M]} />
          <meshBasicMaterial map={badgePlate.texture} transparent toneMapped={false} depthTest={false} />
        </mesh>
      )}
    </group>
  );
}
