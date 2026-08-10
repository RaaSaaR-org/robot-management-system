/**
 * @file scrollToSection.test.ts
 * @description Guards the landing page's in-page anchors against the HashRouter
 *              demo build, where a real hash change navigates off the page.
 * @feature landing
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MouseEvent } from 'react';
import { scrollToSection } from '../scrollToSection';

/** Minimal stand-in for the React synthetic event fields the helper reads. */
function clickEvent(overrides: Partial<MouseEvent<HTMLAnchorElement>> = {}) {
  return {
    preventDefault: vi.fn(),
    defaultPrevented: false,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    button: 0,
    ...overrides,
  } as unknown as MouseEvent<HTMLAnchorElement> & { preventDefault: ReturnType<typeof vi.fn> };
}

function mountSection(id: string) {
  const section = document.createElement('section');
  section.id = id;
  section.scrollIntoView = vi.fn();
  section.focus = vi.fn();
  document.body.appendChild(section);
  return section;
}

describe('scrollToSection', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof matchMedia;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('scrolls to the target and suppresses the hash change', () => {
    const section = mountSection('proof');
    const event = clickEvent();

    scrollToSection(event, '#proof');

    // The suppressed default is the whole point: under HashRouter a real
    // `#proof` becomes the pathname `proof` and renders NotFoundPage.
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(section.scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'start',
    });
  });

  it('moves focus to the target without a second scroll', () => {
    const section = mountSection('install');

    scrollToSection(clickEvent(), '#install');

    expect(section.getAttribute('tabindex')).toBe('-1');
    expect(section.focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('jumps instantly when the visitor asks for reduced motion', () => {
    const section = mountSection('safety');
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof matchMedia;

    scrollToSection(clickEvent(), '#safety');

    expect(section.scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' });
  });

  it.each([
    ['meta-click', { metaKey: true }],
    ['ctrl-click', { ctrlKey: true }],
    ['shift-click', { shiftKey: true }],
    ['middle-click', { button: 1 }],
  ])('leaves %s to the browser', (_label, overrides) => {
    const section = mountSection('lifecycle');
    const event = clickEvent(overrides);

    scrollToSection(event, '#lifecycle');

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(section.scrollIntoView).not.toHaveBeenCalled();
  });

  it('ignores non-anchor and unresolvable hrefs', () => {
    const external = clickEvent();
    scrollToSection(external, 'https://example.com');
    expect(external.preventDefault).not.toHaveBeenCalled();

    // No element with this id — let the browser do whatever it would do rather
    // than swallow the click.
    const missing = clickEvent();
    scrollToSection(missing, '#does-not-exist');
    expect(missing.preventDefault).not.toHaveBeenCalled();
  });
});
