/**
 * @file useViewportFill.ts
 * @description The Record console fills the viewport below its own top edge
 *              (TASK-428): it sets `--console-h` on the element to
 *              `innerHeight − its top in page coordinates − 24` (the shell's
 *              bottom padding), never below 520 px. It re-measures on resize
 *              and through a ResizeObserver on `document.body` and the
 *              console's ancestors, so anything that pushes the console down —
 *              the shell's E-stop alarm banner appearing — shrinks the console
 *              instead of scrolling the page, and it grows back when the
 *              banner goes.
 *              Below `minWidth` the console stacks and the page scrolls, so the
 *              variable is removed.
 * @feature datacollection
 */

import { useCallback, useLayoutEffect, useState } from 'react';

/** The shell's padding under the page, kept free below the console. */
export const CONSOLE_BOTTOM_GAP = 24;
/** The console never gets shorter than this; a shorter window scrolls. */
export const CONSOLE_MIN_H = 520;

/** The console height for a viewport and the console's top in page coordinates. */
export function consoleHeight(innerHeight: number, topInPage: number): number {
  return Math.max(CONSOLE_MIN_H, Math.floor(innerHeight - topInPage - CONSOLE_BOTTOM_GAP));
}

export interface ViewportFillOptions {
  /** Off: the variable is removed. */
  enabled?: boolean;
  /** Below this window width the console stacks and does not fill. */
  minWidth?: number;
}

/** Returns a callback ref for the console element. */
export function useViewportFill({ enabled = true, minWidth = 1024 }: ViewportFillOptions = {}) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const ref = useCallback((node: HTMLElement | null) => setEl(node), []);

  useLayoutEffect(() => {
    if (!el) return;
    const measure = () => {
      if (!enabled || window.innerWidth < minWidth) {
        el.style.removeProperty('--console-h');
        return;
      }
      const top = el.getBoundingClientRect().top + window.scrollY;
      const next = `${consoleHeight(window.innerHeight, top)}px`;
      if (el.style.getPropertyValue('--console-h') !== next) el.style.setProperty('--console-h', next);
    };
    measure();
    window.addEventListener('resize', measure);
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => measure());
      observer.observe(document.body);
      // The body alone misses a banner going away: the shell's min-h-screen
      // keeps the body's size while the content above the console shrinks.
      // An ancestor that wraps that content changes size either way.
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) observer.observe(p);
    }
    return () => {
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, [el, enabled, minWidth]);

  return ref;
}
