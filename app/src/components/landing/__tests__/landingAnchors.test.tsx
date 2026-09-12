/**
 * @file landingAnchors.test.tsx
 * @description Guards every link the landing page offers — the three exported
 *              link models plus the anchors written inline in JSX: in-page
 *              anchors must resolve to a section the page actually renders, and
 *              every /docs/platform#… fragment must resolve to a heading the
 *              docs viewer will really produce.
 * @feature landing
 *
 * Nothing in the page itself prevents a link pointing at a section that no
 * longer exists, and the failure is quiet: scrollToSection returns without
 * preventDefault on a missing target, the browser follows the href, and the
 * demo build's HashRouter renders NotFoundPage.
 *
 * The docs half is not a tautology. The fragments are checked against
 * extractHeadings run over the real docs/platform.md — the same function DocsPage
 * uses to build those ids — so a renamed heading in the markdown fails here.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LandingPage } from '../../../pages/LandingPage';
import { NAV_ITEMS } from '../Header';
import { FOOTER_LINKS } from '../Footer';
import { STAGE_LINKS } from '../FullCircleSection';
import { extractHeadings } from '../../docs/docsMarkdown';
import platformDoc from '../../../../../docs/platform.md?raw';

// Same reasoning as landingBudget.test.tsx: HeroScene is aria-hidden decoration
// and would pull three.js into jsdom through its dynamic ./heroEngine import.
vi.mock('../HeroScene', () => ({ HeroScene: () => null }));

/** Ids the epic deleted. A link to any of them is a 404 in the demo build. */
const DELETED_ANCHORS = ['#data', '#models', '#safety', '#sovereignty'];

function renderPage(): HTMLElement {
  render(
    <MemoryRouter>
      <LandingPage />
    </MemoryRouter>,
  );
  return screen.getByRole('main');
}

/** Every id rendered inside <main> — anchor targets and heading ids alike. */
function pageIds(main: HTMLElement): Set<string> {
  return new Set(
    Array.from(main.querySelectorAll('[id]')).map((element) => element.id),
  );
}

/** Every href/to the page's link models carry, as flat `source → target` pairs. */
function linkTargets(): { source: string; target: string }[] {
  const targets: { source: string; target: string }[] = [];
  NAV_ITEMS.forEach((item) =>
    targets.push({ source: `NAV_ITEMS ${item.label}`, target: item.href }),
  );
  Object.entries(FOOTER_LINKS).forEach(([category, links]) =>
    links.forEach((link) => {
      if (link.external || link.internal) return;
      targets.push({
        source: `FOOTER_LINKS ${category} / ${link.name}`,
        target: link.href,
      });
    }),
  );
  Object.entries(STAGE_LINKS).forEach(([stage, link]) =>
    targets.push({
      source: `STAGE_LINKS ${stage}`,
      target: link.kind === 'anchor' ? link.href : link.to,
    }),
  );
  return targets;
}

const DOC_HEADING_IDS = new Set(
  extractHeadings(platformDoc).map((heading) => heading.id),
);

describe('landing page anchors', () => {
  it('resolves every in-page anchor to a section the page renders', () => {
    const main = renderPage();
    const ids = pageIds(main);

    // Partition, never filter. A modelled link that is neither a docs route nor
    // a `#…` anchor is precisely the defect this guard exists for, and
    // `filter(startsWith('#'))` would drop those entries instead of failing on
    // them: a nav href that lost its hash navigates to a relative path, which
    // the demo build's HashRouter renders as NotFoundPage.
    const inPage = linkTargets().filter(
      (entry) => !entry.target.startsWith('/docs/platform#'),
    );
    expect(
      inPage
        .filter((entry) => !entry.target.startsWith('#'))
        .map((entry) => `${entry.source} → ${entry.target}`),
    ).toEqual([]);

    // Spelled out rather than derived from the models, so emptying one of them
    // fails here instead of passing by iterating nothing: five nav rows, six
    // footer rows under "On this page", three stage links that stay on the page.
    expect(inPage.length).toBe(14);

    // The models are not the whole page — the hero and the platform lede write
    // their `#circle` hrefs inline in JSX, so read the rendered anchors too.
    const rendered = Array.from(main.querySelectorAll('a[href^="#"]')).map(
      (anchor) => {
        const href = anchor.getAttribute('href') ?? '';
        return { source: `rendered <a> ${href}`, target: href };
      },
    );
    expect(rendered.length).toBeGreaterThan(0);

    const broken = [...inPage, ...rendered].filter(
      (entry) => !ids.has(entry.target.slice(1)),
    );
    expect(broken.map((entry) => `${entry.source} → ${entry.target}`)).toEqual(
      [],
    );
  });

  it('resolves every /docs/platform fragment to a heading extractHeadings produces', () => {
    renderPage();
    const docLinks = linkTargets().filter((entry) =>
      entry.target.startsWith('/docs/platform#'),
    );

    // The page also carries docs links written inline in JSX rather than in a
    // link model — the Proof CTA and the Ownership link. Collect them from the
    // rendered anchors so a hand-written href is covered too.
    const rendered = Array.from(document.querySelectorAll('a[href]'))
      .map((anchor) => anchor.getAttribute('href') ?? '')
      .filter((href) => href.startsWith('/docs/platform#'))
      .map((href) => ({ source: `rendered <a> ${href}`, target: href }));

    const all = [...docLinks, ...rendered];
    expect(all.length).toBeGreaterThan(0);
    expect(DOC_HEADING_IDS.size).toBeGreaterThan(10);

    const broken = all.filter(
      (entry) =>
        !DOC_HEADING_IDS.has(entry.target.replace('/docs/platform#', '')),
    );
    expect(broken.map((entry) => `${entry.source} → ${entry.target}`)).toEqual(
      [],
    );
  });

  it('points nothing at the sections the cut deleted', () => {
    const main = renderPage();
    const hrefs = Array.from(main.querySelectorAll('a[href]')).map(
      (anchor) => anchor.getAttribute('href') ?? '',
    );
    const modelled = linkTargets().map((entry) => entry.target);

    // Only the bare in-page anchors are forbidden: `safety` and `models` are
    // live heading ids inside docs/platform.md, and the loop links to both.
    DELETED_ANCHORS.forEach((deleted) => {
      expect(modelled).not.toContain(deleted);
      expect(hrefs).not.toContain(deleted);
    });
  });
});
