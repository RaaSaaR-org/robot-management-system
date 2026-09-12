/**
 * @file landingClaims.test.ts
 * @description Guards the landing page's rationed claims — the ones whose value
 *              comes from appearing once, so a later edit cannot quietly turn
 *              the page back into a compatibility table.
 * @feature landing
 */

import { describe, it, expect } from 'vitest';

/** Every landing component plus the page that assembles them, as raw source. */
const SOURCES = import.meta.glob<string>(['../*.tsx', '../../../pages/LandingPage.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

/**
 * Claims are counted in shipped copy, not in the comments that explain the rule
 * — a comment naming GR00T is exactly how the rule stays readable. `//` is only
 * treated as a comment when it is not preceded by a colon, so the GitHub URLs in
 * the header and footer survive the strip.
 */
function strippedSource(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function occurrences(pattern: RegExp): { file: string; count: number }[] {
  return Object.entries(SOURCES)
    .map(([file, source]) => ({
      file: file.split('/').pop() ?? file,
      count: strippedSource(source).match(pattern)?.length ?? 0,
    }))
    .filter((entry) => entry.count > 0);
}

describe('landing page claims', () => {
  it('reads the landing sources it is meant to guard', () => {
    const files = Object.keys(SOURCES).map((file) => file.split('/').pop());
    expect(files).toContain('FullCircleSection.tsx');
    expect(files).toContain('LandingPage.tsx');
  });

  it('mentions GR00T exactly once, in the loop stage that trains it', () => {
    // One sentence in the Train stage, and no table, card or panel: the model
    // matrix that named it five times moved to docs/platform.md.
    expect(occurrences(/GR00T/g)).toEqual([{ file: 'FullCircleSection.tsx', count: 1 }]);
  });

  it('does not call the platform all-in-one anywhere', () => {
    // The inference and training services are sibling repositories and NATS and
    // RustFS are optional, so "modular" is the claim the code supports.
    expect(occurrences(/all-in-one/gi)).toEqual([]);
  });
});
