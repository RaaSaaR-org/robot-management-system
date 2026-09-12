/**
 * @file landingBudget.test.tsx
 * @description Guards the landing page's word budget — the only thing standing
 *              between a seven-section intro and a slow return to a 2,700-word
 *              brochure.
 * @feature landing
 *
 * The numbers are not magic constants. TASK-305 cut the page from roughly 2,700
 * always-visible words to an intro and set two criteria:
 *
 *   - the whole of <main> stays under 1,100 words
 *   - no single <section> goes over 300
 *
 * The per-section ceiling is what makes TASK-305's shape rule (one heading, a
 * lede of at most 40 words, one supporting block) checkable at all: a page total
 * alone is satisfied by gutting one section and leaving the next at 360.
 *
 * A failure prints every section's count, because a budget test that only says
 * "too long" leaves the next maintainer to do the counting by hand.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LandingPage } from '../../../pages/LandingPage';

/*
 * `vi.mock` resolves relative to this file, so '../HeroScene' is the same module
 * id HeroSection imports. Mocking it loses no prose — every string inside
 * HeroScene is aria-hidden decoration — and it keeps three.js out of jsdom:
 * HeroScene dynamically imports ./heroEngine, and the global matchMedia stub in
 * src/test/setup.ts reports `matches: false`, so the real component would try.
 */
vi.mock('../HeroScene', () => ({ HeroScene: () => null }));

/** Text a visitor never reads is not prose the budget should pay for. */
const SKIP = '[hidden], [aria-hidden="true"], .sr-only, svg, style, script';

function visibleWords(root: Element): number {
  const walker = root.ownerDocument.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) => {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        // closest() walks up past `root` as well, which is what we want: a hidden
        // ancestor outside the section still hides everything inside it.
        return parent.closest(SKIP)
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT;
      },
    },
  );

  let words = 0;
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    words += (node.textContent ?? '')
      .trim()
      .split(/\s+/)
      .filter(Boolean).length;
  }
  return words;
}

/** Section label a maintainer can act on: its id, or the heading it points at. */
function sectionLabel(section: Element, index: number): string {
  if (section.id) return `#${section.id}`;
  const headingId = section.getAttribute('aria-labelledby');
  const heading = headingId
    ? section.ownerDocument.getElementById(headingId)
    : null;
  return heading?.textContent?.trim() || `section ${index + 1}`;
}

describe('landing page word budget', () => {
  it('keeps the page an intro: under 1,100 words, no section over 300', () => {
    render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>,
    );

    /*
     * <main>, not the document: Header renders NAV_ITEMS twice (desktop and a
     * mobile menu that is `invisible`, not `hidden`), and chrome counted twice is
     * noise. The loop renders one stage panel at a time, so its five unopened
     * panels are outside the count by construction.
     */
    const main = screen.getByRole('main');
    // Direct children only: the Proof section nests BeliefReadout's own
    // <section>, and counting that twice would charge the page for it twice.
    const sections = Array.from(main.querySelectorAll(':scope > section'));
    const counts = sections.map((section, index) => ({
      label: sectionLabel(section, index),
      words: visibleWords(section),
    }));
    const total = visibleWords(main);

    const breakdown = [
      ...counts.map((entry) => `  ${entry.label}: ${entry.words}`),
      `  <main> total: ${total}`,
    ].join('\n');

    // Every section must be inside the shape rule on its own.
    const oversized = counts.filter((entry) => entry.words > 300);
    expect(
      oversized.map((entry) => entry.label),
      `section over 300 words\n${breakdown}`,
    ).toEqual([]);

    expect(total, `page over the 1,100-word budget\n${breakdown}`).toBeLessThan(
      1100,
    );
  });

  it('measures the seven sections the page is supposed to have', () => {
    render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>,
    );

    // A walk that silently found nothing would pass the budget assertions above.
    const sections = Array.from(
      screen.getByRole('main').querySelectorAll(':scope > section'),
    );
    expect(sections).toHaveLength(7);
    expect(visibleWords(screen.getByRole('main'))).toBeGreaterThan(200);
  });
});
