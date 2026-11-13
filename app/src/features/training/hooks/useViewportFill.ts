/**
 * @file useViewportFill.ts
 * @description The height that takes an element from where it starts to the
 *              bottom of the window — for a workspace that should end exactly
 *              at the fold, whatever sits above it.
 * @feature training
 */

import { useEffect, useState } from 'react';

export interface ViewportFillOptions {
  /** Never smaller than this; a short window then scrolls instead of crushing the content. */
  min: number;
  /** Never taller than this; past it more height only adds emptiness. */
  max: number;
  /** Space kept free under the element. */
  gap: number;
}

export interface ViewportFill<T extends HTMLElement> {
  /** Callback ref for the element to size. */
  ref: (el: T | null) => void;
  /** Its height in px; null until it has been measured. */
  height: number | null;
  /** The window's width at that measurement, for layouts that also depend on it. */
  viewportWidth: number;
}

/**
 * Measure, and keep measuring: the window resizes, and whatever is above the
 * element (a title that arrives and wraps, a banner) changes where it starts.
 * The element's own height is not part of the sum, so applying the result
 * cannot feed back into it.
 */
export function useViewportFill<T extends HTMLElement>({ min, max, gap }: ViewportFillOptions): ViewportFill<T> {
  const [el, setEl] = useState<T | null>(null);
  const [height, setHeight] = useState<number | null>(null);
  const [viewportWidth, setViewportWidth] = useState(0);

  useEffect(() => {
    if (!el) return;
    const measure = () => {
      const top = el.getBoundingClientRect().top + window.scrollY;
      setHeight(Math.round(Math.min(max, Math.max(min, window.innerHeight - top - gap))));
      setViewportWidth(window.innerWidth);
    };
    measure();
    window.addEventListener('resize', measure);
    // The page column: it changes size whenever anything above the element does.
    const observer = typeof ResizeObserver === 'undefined' || !el.parentElement ? null : new ResizeObserver(measure);
    if (observer && el.parentElement) observer.observe(el.parentElement);
    return () => {
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, [el, min, max, gap]);

  return { ref: setEl, height, viewportWidth };
}
