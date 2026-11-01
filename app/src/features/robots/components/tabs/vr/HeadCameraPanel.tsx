/**
 * @file HeadCameraPanel.tsx
 * @description The robot's own head-camera view, drawn as a panel inside the VR
 *              scene: an MJPEG stream uploaded to a texture at a bounded rate and
 *              only when the picture has actually changed, plus the two failure
 *              states the panel used to hide — a stream that never loaded, and a
 *              stream that stopped moving without ever saying so — and, since
 *              TASK-401, a way back from every failure rather than only one.
 *              TASK-418: a strip along its top edge carries the take state —
 *              REC, the latched E-stop, the verdict after a stop, the session's
 *              end — and the frame turns red while recording or latched.
 * @feature robots
 */

import { useEffect, useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { useXRInputSourceState } from '@react-three/xr';
import * as THREE from 'three';
import { readCssColor } from '../../common/readCssColor';
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
import { useCameraReconnect } from './useCameraReconnect';
import { useVrCameraStatus } from './vrCameraStatus';
import { HAPTICS, pulsePreset, type HapticSource } from './vrHaptics';
import { HUD_COLORS } from './vrHud';
import { useTextPlate } from './VrTextPlate';
import { VR_UI_MATERIAL, VR_UI_RENDER_ORDER } from './VrPanel';
import { vrUiDebug } from './vrUiRegistry';
import type { VrRigTelemetry } from './VrTeleopRig';
import {
  composeCameraStrip,
  initialCameraStrip,
  stepCameraStrip,
  type CameraStrip,
  type CameraStripMemory,
  type CameraStripTone,
  type VrSessionBridge,
} from './vrSessionBridge';
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
 * @returns whether the stream was armed. `false` means no ticket, which the
 *          caller must surface: an `<img>` whose `src` was never assigned fires
 *          no `onerror`, so nothing else would ever say so. It also means
 *          "superseded", which needs no surfacing — whatever superseded it will
 *          report for itself.
 */
export async function armStream(
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
 * Offline plate texture. 1024 wide so the agent's own reason ("cannot reach the
 * hardware sidecar") fits on a line at a size readable in a headset;
 * `offlinePlateLines` wraps anything longer onto a second one.
 */
const PLATE_PX_WIDTH = 1024;
const PLATE_PX_HEIGHT = 768;
const PLATE_LINE_PX = 72;

/**
 * The take strip (TASK-418): just above the screen's top edge, outside the
 * picture, the screen's full width. Recomposed a few times a second.
 */
const STRIP_HEIGHT_M = 0.075;
const STRIP_PX_WIDTH = 1024;
const STRIP_PX_HEIGHT = 96;
const STRIP_HZ = 8;
const STRIP_LOOK: Record<CameraStripTone, { bg: string; text: string }> = {
  rec: { bg: 'rgba(150,20,20,0.94)', text: 'white' },
  estop: { bg: 'rgba(150,20,20,0.96)', text: 'white' },
  ok: { bg: 'rgba(9,11,17,0.9)', text: 'palegreen' },
  warn: { bg: 'rgba(9,11,17,0.9)', text: 'khaki' },
  dim: { bg: 'rgba(9,11,17,0.9)', text: 'gainsboro' },
  ended: { bg: 'rgba(9,11,17,0.94)', text: 'khaki' },
};

const TONE_COLOR: Record<PlateTone, string> = {
  bad: HUD_COLORS.bad,
  dim: HUD_COLORS.dim,
  text: HUD_COLORS.text,
};

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
export interface HeadCameraPanelProps {
  robotId: string;
  /**
   * The recording session (TASK-418), read from the frame loop like the board
   * does — no subscription of its own. Absent on the robot page: the strip then
   * shows only the latched E-stop.
   */
  vrSession?: VrSessionBridge;
  /** The rig's telemetry, for the latched E-stop. */
  telemetryRef?: { current: VrRigTelemetry };
}

export function HeadCameraPanel({ robotId, vrSession, telemetryRef }: HeadCameraPanelProps) {
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
  const stripRef = useRef<THREE.Mesh>(null);
  /** The strip's memory of the session, and what it last showed (TASK-418). */
  const stripMemory = useRef<CameraStripMemory | null>(null);
  const stripNow = useRef<CameraStrip | null>(null);
  const lastStrip = useRef(-Infinity);
  const badgeRef = useRef<THREE.Mesh>(null);
  const left = useXRInputSourceState('controller', 'left');
  const right = useXRInputSourceState('controller', 'right');

  const offlinePlate = useTextPlate({
    pxWidth: PLATE_PX_WIDTH,
    pxHeight: PLATE_PX_HEIGHT,
    linePx: PLATE_LINE_PX,
    align: 'center',
  });
  const stripPlate = useTextPlate({
    pxWidth: STRIP_PX_WIDTH,
    pxHeight: STRIP_PX_HEIGHT,
    linePx: 80,
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

  /** R3F clock time of the last stale re-arm, for its rate limit below. */
  const lastRearm = useRef(0);
  /** Distinct frames uploaded since `fpsWindowStart`, for the published fps. */
  const fpsFrames = useRef(0);
  const fpsWindowStart = useRef(0);
  /** Whether the last liveness poll called the picture stale. */
  const staleNow = useRef(false);

  // Arming, the failure latches that used to be permanent, and the backoff that
  // replaces them — all in `useCameraReconnect`, so they are testable without
  // a WebGL context. This component keeps the liveness side: it is the only
  // one that can see whether a decoding picture is still moving.
  const reconnect = useCameraReconnect({
    robotId,
    image,
    arm: armStream,
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

  const publish = useVrCameraStatus((s) => s.publish);
  const resetStatus = useVrCameraStatus((s) => s.reset);
  useEffect(() => () => resetStatus(), [resetStatus]);

  // Everything but `stale` and `fps` changes as React state; those two are
  // render-loop facts and are published from `useFrame` below.
  useEffect(() => {
    publish({
      robotId,
      state: cameraPanelState(reconnect.phase, staleNow.current),
      detail: reconnect.phase === 'up' ? null : reconnect.detail,
      retryInS: reconnect.retryInS,
      ...(reconnect.phase === 'up' ? {} : { fps: null }),
    });
  }, [publish, robotId, reconnect.phase, reconnect.detail, reconnect.retryInS]);

  useFrame((state) => {
    const now = state.clock.elapsedTime;

    // TASK-418: the take strip, before any early return below — it must speak
    // even while the picture is offline or connecting.
    if (now - lastStrip.current >= 1 / STRIP_HZ) {
      lastStrip.current = now;
      const view = vrSession?.getState() ?? null;
      const nowMs = Date.now();
      if (view) {
        stripMemory.current = stripMemory.current
          ? stepCameraStrip(stripMemory.current, view, nowMs)
          : initialCameraStrip(view);
      }
      const strip = composeCameraStrip(view, telemetryRef?.current.estopLatched === true, stripMemory.current, nowMs);
      stripNow.current = strip;
      if (import.meta.env.DEV) vrUiDebug.strip = strip?.text ?? '';
      if (stripRef.current) stripRef.current.visible = strip !== null;
      if (strip) {
        const look = STRIP_LOOK[strip.tone];
        stripPlate.draw([{ id: 'strip', text: strip.text, color: look.text, bold: true }], { background: look.bg });
      }
      const surround = surroundRef.current;
      if (surround) {
        (surround.material as THREE.MeshBasicMaterial).color.set(
          strip?.redFrame || staleNow.current ? HUD_COLORS.bad : readCssColor('--color-primary', 'white'),
        );
      }
    }

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

    if (!offline && image.naturalWidth > 0 && now - lastUpload.current >= 1 / PANEL_TEXTURE_HZ) {
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
      // The stale badge and red surround describe a picture; with no picture
      // (the plate, or a blank re-arm) they would be talking about nothing.
      if (badgeRef.current) badgeRef.current.visible = false;
      return;
    }

    // Once a second: distinct frames seen, i.e. what the operator is actually
    // getting (capped by the upload rate), not what the stream claims.
    if (now - fpsWindowStart.current >= 1) {
      const elapsed = now - fpsWindowStart.current;
      if (fpsWindowStart.current > 0) publish({ fps: Math.round(fpsFrames.current / elapsed) });
      fpsFrames.current = 0;
      fpsWindowStart.current = now;
    }

    if (now - lastPoll.current < 1 / LIVENESS_HZ) return;
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
        isStale || stripNow.current?.redFrame ? HUD_COLORS.bad : readCssColor('--color-primary', 'white'),
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
    if (isStale && now - lastRearm.current >= REARM_INTERVAL_S) {
      // Stamped BEFORE the arm, not after. `useFrame` is synchronous and runs
      // at display rate, so a rate limit that only advanced on success would let
      // a slow or failing ticket endpoint turn this into a ~72 Hz POST storm.
      // `rearm` itself refuses while another arm is in flight.
      lastRearm.current = now;
      lastUploaded.current = undefined;
      liveness.current = null;
      staleNow.current = false;
      // NOT `image.src = ''` here. `armStream` clears and reassigns in one task,
      // which is what keeps the empty-`src` `error` event from firing. Once it
      // is armed the picture is gone until the first new frame, and a stream
      // that never sends one is the reconnect hook's first-frame watchdog.
      reconnect.rearm();
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
      { id: 'camera', text: PANEL_CAMERA, color: HUD_COLORS.dim },
    ]);
  }, [showPlate, reconnect.phase, reconnect.detail, reconnect.retryInS, reconnect.attempt, offlinePlate]);

  return (
    <group position={[PANEL_DISTANCE_M, PANEL_HEIGHT_M, 0]} rotation={[0, -Math.PI / 2, 0]}>
      <mesh>
        <planeGeometry args={[PANEL_WIDTH_M, PANEL_TALL_M]} />
        {/* toneMapped: this is a camera image, not lit geometry — leave its
            values alone or the render pipeline crushes the highlights. The
            offline plate takes the SAME geometry in the SAME place, so a stream
            that dies mid-session leaves the screen where the operator last saw
            it instead of leaving a hole in the scene. */}
        <meshBasicMaterial map={showPlate ? offlinePlate.texture : texture} toneMapped={false} />
      </mesh>
      {/* A thin surround, so the panel reads as a screen and not a hole. Turns
          red while the picture is frozen — the one state that otherwise looks
          exactly like a working camera. */}
      <mesh ref={surroundRef} position={[0, 0, -0.005]}>
        <planeGeometry args={[PANEL_WIDTH_M + 0.03, PANEL_TALL_M + 0.03]} />
        <meshBasicMaterial color={readCssColor('--color-primary', 'white')} />
      </mesh>
      {stripPlate.texture && (
        <mesh
          ref={stripRef}
          visible={false}
          position={[0, PANEL_TALL_M / 2 + 0.015 + STRIP_HEIGHT_M / 2 + 0.006, 0.002]}
          renderOrder={VR_UI_RENDER_ORDER.strip}
          name="vr-camera-strip"
        >
          <planeGeometry args={[PANEL_WIDTH_M + 0.03, STRIP_HEIGHT_M]} />
          <meshBasicMaterial map={stripPlate.texture} {...VR_UI_MATERIAL} />
        </mesh>
      )}
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
