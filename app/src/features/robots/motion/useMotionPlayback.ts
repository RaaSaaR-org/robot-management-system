/**
 * @file useMotionPlayback.ts
 * @description React binding for the module-level playback clock — transport state for the UI
 *              without a render per animation frame.
 * @feature robots
 */

import { useEffect, useState } from 'react';

import {
  getMotionTransport,
  subscribeMotion,
  type MotionTransportState,
} from './motionPlayback';

/** ~10 Hz. Fast enough that a scrub bar looks continuous, slow enough to be free. */
const POLL_MS = 100;

/**
 * Two changes matter at very different rates, so they have two different sources:
 *
 *  - The playhead advances inside the r3f frame loop (tickMotion), which deliberately does NOT
 *    notify subscribers — notifying at display rate is the thing this whole module exists to
 *    avoid. So a slow poll reads it out.
 *  - Play/pause/seek/clip-load are discrete and must land immediately, not up to 100 ms later,
 *    or the buttons feel broken. Those come through subscribeMotion.
 *
 * Collapsing this into one source breaks one of the two. A poll alone makes the transport laggy;
 * a subscription alone freezes the scrub bar during playback.
 */
export function useMotionPlayback(): MotionTransportState {
  const [transport, setTransport] = useState<MotionTransportState>(getMotionTransport);

  useEffect(() => {
    let current = transport;

    const apply = (next: MotionTransportState): void => {
      if (!hasVisibleChange(current, next)) return;
      current = next;
      setTransport(next);
    };

    const read = (): void => apply(getMotionTransport());

    let timer: ReturnType<typeof setInterval> | null = null;

    const syncTimer = (): void => {
      // A paused tab polling forever is a battery leak; subscribeMotion still covers it.
      if (current.playing && timer === null) {
        timer = setInterval(read, POLL_MS);
      } else if (!current.playing && timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };

    const unsubscribe = subscribeMotion(() => {
      read();
      syncTimer();
    });

    read();
    syncTimer();

    return () => {
      unsubscribe();
      if (timer !== null) clearInterval(timer);
    };
    // Mount-only: `transport` is seeded once and tracked in the `current` closure thereafter, so
    // re-running on every state change would tear down and rebuild the subscription per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return transport;
}

/** Round the playhead so sub-perceptual drift doesn't re-render the tab tree ten times a second. */
function hasVisibleChange(a: MotionTransportState, b: MotionTransportState): boolean {
  return (
    a.clipId !== b.clipId ||
    a.clipName !== b.clipName ||
    a.playing !== b.playing ||
    a.frameIndex !== b.frameIndex ||
    a.frameCount !== b.frameCount ||
    a.duration !== b.duration ||
    a.speed !== b.speed ||
    a.loop !== b.loop ||
    a.followRoot !== b.followRoot ||
    Math.round(a.time * 100) !== Math.round(b.time * 100)
  );
}
