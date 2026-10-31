/**
 * @file useStreamImageRef.ts
 * @description A ref for an `<img>` that shows an MJPEG stream and closes the
 *              stream when the `<img>` leaves the page (TASK-448).
 * @feature robots
 */

import { useCallback, type RefCallback, type RefObject } from 'react';

/** Stream `<img>`s this module emptied. Their `error` events are not failures. */
const released = new WeakSet<HTMLImageElement>();

/**
 * True when `image` is a stream `<img>` that was let go and its `src` emptied.
 * An emptied `src` fires `error`; a view must not count that as a failed stream,
 * mark its URL as failed or schedule a retry from it.
 */
export function isReleasedStreamImage(image: HTMLImageElement): boolean {
  return released.has(image);
}

/**
 * A callback ref for a stream `<img>`: when the element leaves the DOM, its `src`
 * is set to `''`.
 *
 * Chromium keeps downloading an MJPEG `<img>` that React removed until its `src`
 * is cleared. A plain HTTP page gets six connections per server, so a few leaked
 * streams leave every later API call queued with no answer. The VR panel's
 * `useCameraReconnect` does the same when it lets go of its image.
 *
 * The ref's identity is stable, so a re-render never runs the cleanup — a new
 * function every render would empty the live stream on every render. The release
 * is checked a microtask after the cleanup and happens only when the element is
 * no longer in the document: StrictMode detaches and re-attaches every ref once
 * on mount, with the element still in place, and that must not end the stream.
 *
 * @param target An object ref that should also hold the element (for code that
 *               reads the `<img>`, e.g. to copy its frame). Pass a stable ref.
 */
export function useStreamImageRef(
  target?: RefObject<HTMLImageElement | null>,
): RefCallback<HTMLImageElement> {
  return useCallback(
    (image: HTMLImageElement | null) => {
      if (!image) return;
      released.delete(image);
      if (target) target.current = image;
      return () => {
        if (target && target.current === image) target.current = null;
        queueMicrotask(() => {
          if (image.isConnected) return;
          released.add(image);
          image.src = '';
        });
      };
    },
    // `target` is a ref object: stable for the life of the component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
}
