/**
 * @file docsLanding.test.ts
 * @description Help opens docs/README.md. It used to describe "a fleet
 *              management platform" whose "current deployment runs a single
 *              SO-101 robot arm on a Raspberry Pi 5" — the opposite of what
 *              docs/platform.md says the platform is (TASK-489). The landing
 *              page is now an index, so what is guarded here is that it stays
 *              one: every link lands, and no document is left out of it.
 * @feature docs
 */

import { describe, it, expect } from 'vitest';
import { DOC_CONTENT, DOC_ENTRIES } from '../docsRegistry';
import { extractHeadings, resolveDocLink } from '../docsMarkdown';

const README = DOC_CONTENT.get('README') ?? '';

/** Every `[label](target)` in the page, images excluded. */
const LINKS = [...README.matchAll(/(?<!!)\[[^\]]+\]\(([^)\s]+)\)/g)].map((m) => resolveDocLink(m[1], 'README'));

/** Routes the page sends a reader to, checked against the router's own table. */
const APP_SOURCE = Object.values(
  import.meta.glob<string>('/src/App.tsx', { query: '?raw', import: 'default', eager: true }),
)[0] ?? '';

describe('the docs landing page', () => {
  it('says what the platform is, in the words of docs/platform.md', () => {
    expect(README).toMatch(/open platform for Physical AI/);
    for (const stage of ['Collect', 'Train', 'Deploy', 'Evaluate', 'Operate', 'Comply']) {
      expect(README).toContain(`| ${stage} |`);
    }
    expect(README).toMatch(/Unitree G1/);
  });

  it('makes no claim about one deployment, which would go stale', () => {
    expect(README).not.toMatch(/fleet management platform/i);
    expect(README).not.toMatch(/current deployment/i);
    expect(README).not.toMatch(/Raspberry Pi 5/);
  });

  it('links only to documents and headings that exist', () => {
    const broken: string[] = [];
    for (const link of LINKS) {
      if (link.kind !== 'doc') continue;
      const target = DOC_CONTENT.get(link.slug);
      if (target === undefined) {
        broken.push(link.slug);
      } else if (link.hash && !extractHeadings(target).some((h) => h.id === link.hash)) {
        broken.push(`${link.slug}#${link.hash}`);
      }
    }
    expect(LINKS.filter((l) => l.kind === 'doc').length).toBeGreaterThan(20);
    expect(broken).toEqual([]);
  });

  it('links only to pages the app has', () => {
    const routes = LINKS.flatMap((l) => (l.kind === 'route' ? [l.to] : []));
    expect(routes).toContain('/datasets');
    expect(APP_SOURCE).not.toBe('');
    expect(routes.filter((to) => !APP_SOURCE.includes(`path="${to}"`))).toEqual([]);
  });

  it('indexes every top-level document', () => {
    // demo-intro is the demo build's own front page, not a chapter of the docs.
    const linked = new Set(LINKS.flatMap((l) => (l.kind === 'doc' ? [l.slug] : [])));
    const missing = DOC_ENTRIES.map((e) => e.slug).filter(
      (slug) => !slug.includes('/') && slug !== 'README' && slug !== 'demo-intro' && !linked.has(slug),
    );
    expect(missing).toEqual([]);
    expect(linked.has('dataset-upload')).toBe(true);
  });
});
