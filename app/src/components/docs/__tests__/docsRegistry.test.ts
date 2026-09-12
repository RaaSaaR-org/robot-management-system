/**
 * @file docsRegistry.test.ts
 * @description Tests for the docs registry — slugs, titles, categories and the loaded set
 * @feature docs
 */

import { describe, it, expect } from 'vitest';
import {
  categoryFromSlug,
  slugFromKey,
  titleFromSlug,
  DEFAULT_SLUG,
  DOC_CONTENT,
  DOC_ENTRIES,
  ORDERED_CATEGORIES,
} from '../docsRegistry';

describe('slugFromKey', () => {
  it('strips the glob prefix and the extension', () => {
    expect(slugFromKey('../../../../docs/architecture.md')).toBe('architecture');
  });

  it('keeps subdirectories', () => {
    expect(slugFromKey('../../../../docs/planning/prd.md')).toBe('planning/prd');
  });
});

describe('titleFromSlug', () => {
  it('title-cases a kebab filename', () => {
    expect(titleFromSlug('dev-workflow')).toBe('Dev Workflow');
  });

  it('upper-cases known acronyms', () => {
    expect(titleFromSlug('vla-integration-guide')).toBe('VLA Integration Guide');
    expect(titleFromSlug('vr-teleop-data-collection')).toBe('VR Teleop Data Collection');
  });

  it('uses the last path segment', () => {
    expect(titleFromSlug('planning/prd')).toBe('PRD');
  });
});

describe('categoryFromSlug', () => {
  it('maps root-level docs', () => {
    expect(categoryFromSlug('architecture')).toBe('Architecture');
    expect(categoryFromSlug('runbook')).toBe('Operations');
  });

  it('is case-sensitive on the real filename', () => {
    // The map keyed 'VLA-integration-guide' before, so the file landed in Other.
    expect(categoryFromSlug('vla-integration-guide')).toBe('Robot Integration');
  });

  it('files the product overview under Getting Started', () => {
    // The landing page links straight into docs/platform.md, so an unmapped
    // slug would strand the page a reader was sent to in Other.
    expect(categoryFromSlug('platform')).toBe('Getting Started');
  });

  it('derives a category from the subdirectory', () => {
    expect(categoryFromSlug('planning/prd')).toBe('Planning');
  });

  it('falls back to Other', () => {
    expect(categoryFromSlug('something-nobody-mapped')).toBe('Other');
  });
});

describe('the loaded registry', () => {
  it('holds the docs/ tree', () => {
    expect(DOC_ENTRIES.length).toBeGreaterThan(10);
    expect(DOC_CONTENT.get('README')).toContain('# NeoDEM');
    expect(DOC_CONTENT.get('platform')).toContain('## Readiness at a glance');
  });

  it('opens on the first entry, and README sorts ahead of the alphabetical list', () => {
    // Asserted as an ordering rule rather than a literal slug: demo mode floats
    // demo-intro to the front, and the test must hold in both builds.
    const readme = DOC_ENTRIES.findIndex((e) => e.slug === 'README');
    const api = DOC_ENTRIES.findIndex((e) => e.slug === 'api');
    expect(readme).toBeGreaterThanOrEqual(0);
    expect(readme).toBeLessThan(api);
    expect(DEFAULT_SLUG).toBe(DOC_ENTRIES[0]?.slug);
  });

  it('lists only categories that have entries', () => {
    for (const category of ORDERED_CATEGORIES) {
      expect(DOC_ENTRIES.some((e) => e.category === category)).toBe(true);
    }
  });

  it('leaves nothing stranded in Other', () => {
    // A new doc with no CATEGORY_MAP entry is easy to miss; it shows up here.
    const stranded = DOC_ENTRIES.filter((e) => e.category === 'Other').map((e) => e.slug);
    expect(stranded).toEqual([]);
  });
});
