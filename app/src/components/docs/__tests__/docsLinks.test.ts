/**
 * @file docsLinks.test.ts
 * @description Every in-app link into the docs viewer names a document that is
 *              bundled. Three "Docs" buttons pointed at `VLA-integration-guide`
 *              while the file is `vla-integration-guide.md`, and opened "Doc
 *              not found" (TASK-486).
 * @feature docs
 */

import { describe, it, expect } from 'vitest';
import { DEFAULT_SLUG, DOC_CONTENT } from '../docsRegistry';

const SOURCES = Object.entries(
  import.meta.glob<string>('/src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }),
).filter(([path]) => !/\.test\.tsx?$/.test(path) && !path.includes('/__tests__/'));

/** `docsSlug="…"` on a placeholder, and a literal `/docs/<slug>` route in a `to` or `href`. */
const DOCS_SLUG_PROP = /docsSlug=["']([^"']+)["']/g;
const DOCS_ROUTE = /(?:to|href)[=:]\s*\{?["'`]\/docs\/([A-Za-z0-9_\-/]+)/g;

describe('links into the docs viewer', () => {
  it('bundles the documentation, so /docs has somewhere to open', () => {
    expect(DOC_CONTENT.size).toBeGreaterThan(10);
    expect(DEFAULT_SLUG).not.toBe('');
    expect(DOC_CONTENT.has(DEFAULT_SLUG)).toBe(true);
  });

  it('name a document that exists — slugs are case-sensitive', () => {
    const found: string[] = [];
    const broken: string[] = [];
    for (const [path, text] of SOURCES) {
      for (const pattern of [DOCS_SLUG_PROP, DOCS_ROUTE]) {
        for (const match of text.matchAll(pattern)) {
          found.push(match[1]);
          if (!DOC_CONTENT.has(match[1])) broken.push(`${path}: ${match[1]}`);
        }
      }
    }
    // The scan must actually see the links it is guarding.
    expect(found).toContain('vla-integration-guide');
    expect(found).toContain('platform');
    expect(broken).toEqual([]);
  });
});
