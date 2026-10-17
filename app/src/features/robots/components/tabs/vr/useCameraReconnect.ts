/**
 * @file useCameraReconnect.ts
 * @description Arming, failure detection and backoff reconnects for the VR
 *              head-camera panel's `<img>` (TASK-401). Lives apart from the panel
 *              so it can be tested with fake timers and no WebGL.
 * @feature robots
 */

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { RobotCameraList } from '../../../api/cameraApi';
import {
  FIRST_FRAME_TIMEOUT_MS,
  NO_CAMERA_DETAIL,
  RETRY_CAP_S,
  isRealLoadFailure,
  nextRetryDelayS,
  type ReconnectPhase,
} from './vrCamera';

/**
 * Point `image` at a fresh stream for `robotId`. Resolves to whether `src` was
 * assigned. Must check `isCurrent()` after its own await and assign nothing
 * when it returns false — see `armStream` in `HeadCameraPanel.tsx`.
 */
export type ArmFn = (
  image: HTMLImageElement,
  robotId: string,
  isCurrent: () => boolean,
) => Promise<boolean>;

export interface CameraReconnectOptions {
  robotId: string;
  image: HTMLImageElement;
  arm: ArmFn;
  /** `GET /robots/:id/cameras`, asked before every retry (TASK-401, D2). */
  listCameras: (robotId: string) => Promise<RobotCameraList>;
  firstFrameTimeoutMs?: number;
}

export interface CameraReconnect {
  /** See `ReconnectPhase`. */
  phase: ReconnectPhase;
  /** Retries made since the last good frame. Zero on a fresh robot. */
  attempt: number;
  /** The agent's reason, or `NO_CAMERA_DETAIL`, from the last `/cameras` ask. */
  detail: string | null;
  /** Whole seconds to the next retry; null when none is scheduled. Ticks at 1 Hz. */
  retryInS: number | null;
  /**
   * Re-arm now. For the panel's stale path, which knows something this hook
   * cannot: a stream that is open and decoding but whose picture stopped
   * changing. A no-op while another arm is in flight.
   */
  rearm: () => void;
  /** A decoded frame is on the `<img>`. Cheap to call every frame; idempotent. */
  markFrame: () => void;
  /** Bumped on every arm, robot change and unmount. Exposed for tests. */
  armEpoch: MutableRefObject<number>;
}

/**
 * The panel's way back from every failure it can see.
 *
 * It used to have one way back, and only from one failure: a stream that went
 * STALE was re-armed every 5 s. Everything else latched. An `error` on the
 * `<img>` or a failed ticket fetch set `failed`, and `failed` was cleared only by
 * a robot change — so on the first real G1 day a single PC2 camera hiccup put up
 * CAMERA OFFLINE for the rest of the session. A stream that connected and never
 * sent its first frame was worse: no error, no frame, nothing to classify as
 * stale, and so no re-arm either.
 *
 * Now any of those three — load error, no ticket, no first frame within
 * `FIRST_FRAME_TIMEOUT_MS` — schedules a retry on the `nextRetryDelayS` backoff,
 * with no attempt limit. Each retry first asks the agent which cameras it can
 * serve, so the plate can say WHY (D2); an empty list holds the backoff at its
 * cap. The first decoded frame resets the counter.
 */
export function useCameraReconnect({
  robotId,
  image,
  arm,
  listCameras,
  firstFrameTimeoutMs = FIRST_FRAME_TIMEOUT_MS,
}: CameraReconnectOptions): CameraReconnect {
  /** The `<img>` errored, or an arm could not get a ticket. */
  const [failed, setFailed] = useState(false);
  /** Armed, and still no decoded frame after `firstFrameTimeoutMs`. */
  const [firstFrameMissing, setFirstFrameMissing] = useState(false);
  /** No frame since the last arm. */
  const [awaitingFrame, setAwaitingFrame] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [detail, setDetail] = useState<string | null>(null);
  const [retryAt, setRetryAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  /**
   * Bumped whenever a failed arm leaves `failed` already true — the retry effect
   * would otherwise see no dependency change and never schedule the next one.
   */
  const [retryGen, setRetryGen] = useState(0);

  const armEpoch = useRef(0);
  const arming = useRef(false);
  const attemptRef = useRef(0);
  const holdAtCap = useRef(false);
  const watchdog = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const awaitingRef = useRef(true);

  const clearWatchdog = useCallback(() => {
    if (watchdog.current !== undefined) clearTimeout(watchdog.current);
    watchdog.current = undefined;
  }, []);

  /** One arm. Supersedes any in flight; reports its own outcome as state. */
  const armOnce = useCallback(async (): Promise<void> => {
    armEpoch.current += 1;
    const epoch = armEpoch.current;
    const isCurrent = () => armEpoch.current === epoch;
    arming.current = true;
    clearWatchdog();
    awaitingRef.current = true;
    setAwaitingFrame(true);
    let armed = false;
    try {
      armed = await arm(image, robotId, isCurrent);
    } catch {
      armed = false;
    }
    if (!isCurrent()) return;
    arming.current = false;
    if (armed) {
      setFailed(false);
      setFirstFrameMissing(false);
      // `src` is assigned, which is not the same as a picture. An upstream that
      // accepts the connection and never sends a part fires neither event.
      watchdog.current = setTimeout(() => {
        watchdog.current = undefined;
        if (isCurrent() && awaitingRef.current && image.naturalWidth === 0) setFirstFrameMissing(true);
      }, firstFrameTimeoutMs);
    } else {
      // No ticket, no `src`, and an unassigned `<img>` fires no `onerror`.
      setFailed(true);
      setRetryGen((n) => n + 1);
    }
  }, [arm, image, robotId, firstFrameTimeoutMs, clearWatchdog]);

  const markFrame = useCallback(() => {
    if (!awaitingRef.current) return;
    awaitingRef.current = false;
    clearWatchdog();
    attemptRef.current = 0;
    holdAtCap.current = false;
    setAwaitingFrame(false);
    setFailed(false);
    setFirstFrameMissing(false);
    setAttempt(0);
    setDetail(null);
  }, [clearWatchdog]);

  // Per robot: reset everything, wire the `<img>`, arm.
  useEffect(() => {
    // Leaving `failed` set meant one robot's missing camera stuck the panel on
    // its plate for every robot selected afterwards; the attempt counter is the
    // same mistake one level down.
    setFailed(false);
    setFirstFrameMissing(false);
    setAttempt(0);
    setDetail(null);
    setRetryGen(0);
    attemptRef.current = 0;
    holdAtCap.current = false;
    arming.current = false;
    // Guarded on `src`: clearing it is how this drops a connection, and an empty
    // `src` is specified to fire `error`. Only a real load failure — one with a
    // `src` to fail at — is an offline camera. See `isRealLoadFailure`.
    image.onerror = () => {
      if (!isRealLoadFailure(image.getAttribute('src'))) return;
      clearWatchdog();
      setFailed(true);
    };
    // The first decoded part of an MJPEG stream fires `load`. The panel's render
    // loop also calls `markFrame` when it sees a frame, for browsers that do not.
    image.onload = () => markFrame();
    void armOnce();
    return () => {
      // Retire the in-flight attempt, or its `src` assignment lands after the
      // line below and reopens the connection this is closing.
      armEpoch.current += 1;
      arming.current = false;
      clearWatchdog();
      image.onerror = null;
      image.onload = null;
      // Drop the MJPEG connection: the sim renders a frame for every one sent.
      image.src = '';
    };
    // `armOnce` and `markFrame` change exactly when `robotId`/`image` do.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image, robotId]);

  const needsRetry = failed || firstFrameMissing;

  // The backoff. One timer at a time; a new failure re-schedules it.
  useEffect(() => {
    if (!needsRetry) {
      setRetryAt(null);
      return;
    }
    let cancelled = false;
    const delayS = holdAtCap.current ? RETRY_CAP_S : nextRetryDelayS(attemptRef.current);
    const start = Date.now();
    setNow(start);
    setRetryAt(start + delayS * 1000);
    const timer = setTimeout(async () => {
      setRetryAt(null);
      // Ask first (D2). One cheap GET, and it turns a bare OFFLINE into a reason.
      try {
        const list = await listCameras(robotId);
        if (cancelled) return;
        const empty = list.cameras.length === 0;
        holdAtCap.current = empty;
        setDetail(list.detail ?? (empty ? NO_CAMERA_DETAIL : null));
      } catch {
        if (cancelled) return;
        holdAtCap.current = false;
        setDetail(null);
      }
      // Arm even on an empty list: the list is the sidecar's opinion, and a
      // stream that answers anyway is worth more than being right about it.
      attemptRef.current += 1;
      setAttempt(attemptRef.current);
      void armOnce();
    }, delayS * 1000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsRetry, retryGen, robotId]);

  // The countdown the plate shows, once a second while a retry is pending.
  useEffect(() => {
    if (retryAt === null) return;
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [retryAt]);

  const rearm = useCallback(() => {
    if (arming.current) return;
    void armOnce();
  }, [armOnce]);

  const phase: ReconnectPhase = needsRetry ? 'offline' : awaitingFrame ? 'connecting' : 'up';
  const retryInS = retryAt === null ? null : Math.max(0, Math.ceil((retryAt - now) / 1000));

  return { phase, attempt, detail, retryInS, rearm, markFrame, armEpoch };
}
