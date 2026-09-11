/**
 * @file cssColor.ts
 * @description Resolve a design-token CSS custom property (e.g. `--color-primary`)
 *   to a concrete colour string for renderers that cannot read `var(...)` —
 *   three.js materials and the zone editor's SVG attributes. UI colours in the
 *   3D viewer come from tokens this way; zone colours stay data from the server.
 * @feature digitaltwin
 */

import { useEffect, useState } from 'react';

/** Read a CSS custom property off the root element; `fallback` when unset or outside a browser. */
export function cssColor(name: string, fallback = 'white'): string {
  if (typeof window === 'undefined' || typeof document === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

/**
 * Same as `cssColor`, but re-read when the theme changes (the root's
 * `data-theme` / `class` attribute or the OS colour scheme), so a canvas
 * repaints with the light or dark token value.
 */
export function useCssColor(name: string, fallback = 'white'): string {
  const [value, setValue] = useState(() => cssColor(name, fallback));
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const update = () => setValue(cssColor(name, fallback));
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    media?.addEventListener?.('change', update);
    return () => {
      observer.disconnect();
      media?.removeEventListener?.('change', update);
    };
  }, [name, fallback]);
  return value;
}
