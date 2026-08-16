/**
 * @file svgButton.ts
 * @description Keyboard activation helper for SVG elements that act as buttons
 *              (`role="button" tabIndex={0}`). SVG has no native button, so
 *              Enter/Space have to be wired up by hand or the control is
 *              mouse-only.
 * @feature fleet
 */

import type { KeyboardEvent, KeyboardEventHandler } from 'react';

/** Keys that activate a native button. `Spacebar` is the legacy IE/Edge name. */
const ACTIVATION_KEYS = new Set(['Enter', ' ', 'Spacebar']);

/**
 * Builds an `onKeyDown` handler that makes an SVG `role="button"` element
 * keyboard-operable: Enter and Space run `handler`, Space is prevented from
 * scrolling the page, and the event does not bubble to parent controls.
 *
 * @example
 * ```tsx
 * <g role="button" tabIndex={0} onClick={onClose} onKeyDown={activateOnKey(onClose)}>
 * ```
 */
export function activateOnKey<T extends Element = SVGGElement>(
  handler: () => void
): KeyboardEventHandler<T> {
  return (event: KeyboardEvent<T>) => {
    if (!ACTIVATION_KEYS.has(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    handler();
  };
}
