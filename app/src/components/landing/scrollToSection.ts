/**
 * @file scrollToSection.ts
 * @description In-page anchor navigation for the landing page, safe under HashRouter.
 * @feature landing
 *
 * The demo build (VITE_DEMO_MODE=true, what GitHub Pages serves) mounts a
 * HashRouter, so the whole app lives behind `#/`. A plain `href="#proof"` then
 * rewrites the location hash to `#proof`, which react-router parses as the
 * pathname `proof` — no route matches it, and the catch-all in App.tsx renders
 * NotFoundPage. Every nav item and footer link on the landing page would take a
 * visitor off the landing page instead of scrolling down it.
 *
 * So we scroll ourselves and never let the hash change. The href stays on the
 * element: it is the accessible name's context, it survives no-JS, and it is
 * what a BrowserRouter build resolves natively anyway.
 */

import type { MouseEvent } from 'react';

/**
 * Handles a click on an in-page `#section` link.
 *
 * Modified clicks (new tab, new window, download) are left alone — the browser
 * should do its normal thing, even though under HashRouter the resulting URL is
 * only useful in a BrowserRouter deployment.
 */
export function scrollToSection(event: MouseEvent<HTMLAnchorElement>, href: string): void {
  if (!href.startsWith('#') || href.length < 2) return;
  if (event.defaultPrevented) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
    return;
  }

  const target = document.getElementById(href.slice(1));
  if (!target) return;

  event.preventDefault();

  const prefersReduced =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  target.scrollIntoView({
    behavior: prefersReduced ? 'auto' : 'smooth',
    block: 'start',
  });

  // Move focus with the viewport, or a keyboard visitor keeps tabbing from the
  // nav while the page shows a section far below. tabindex="-1" is programmatic
  // focus only — it adds no tab stop.
  target.setAttribute('tabindex', '-1');
  target.focus({ preventScroll: true });
}
