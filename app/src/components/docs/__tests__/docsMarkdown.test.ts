/**
 * @file docsMarkdown.test.ts
 * @description Tests for the docs renderer's slug, TOC and link helpers
 * @feature docs
 */

import { describe, it, expect } from 'vitest';
import {
  extractHeadings,
  headingIdsByLine,
  normalizeCodeLanguage,
  resolveDocLink,
  slugifyHeading,
  stripInlineMarkdown,
} from '../docsMarkdown';

describe('slugifyHeading', () => {
  it('matches the anchors the docs already link to', () => {
    // These three targets are linked from deployment.md / multi-tenancy.md.
    expect(slugifyHeading('7. Current Limitations')).toBe('7-current-limitations');
    expect(slugifyHeading('TLS / HTTPS')).toBe('tls--https');
    expect(slugifyHeading('Unitree G1 EDU (Dex3-1)')).toBe('unitree-g1-edu-dex3-1');
  });

  it('lower-cases and keeps digits', () => {
    expect(slugifyHeading('Quick Start (systemd)')).toBe('quick-start-systemd');
  });
});

describe('stripInlineMarkdown', () => {
  it('unwraps code, emphasis and links', () => {
    expect(stripInlineMarkdown('Run `npm run dev` **now**')).toBe('Run npm run dev now');
    expect(stripInlineMarkdown('See [the API](api.md)')).toBe('See the API');
  });
});

describe('extractHeadings', () => {
  const markdown = [
    '# NeoDEM', // 1
    '', // 2
    'Intro text.', // 3
    '', // 4
    '## Services', // 5
    '', // 6
    '```bash', // 7
    '# not a heading', // 8
    '```', // 9
    '', // 10
    '### `robot-agent`', // 11
    '', // 12
    '## Services', // 13
  ].join('\n');

  it('records depth, text and source line', () => {
    const headings = extractHeadings(markdown);
    expect(headings.map((h) => [h.depth, h.text, h.line])).toEqual([
      [1, 'NeoDEM', 1],
      [2, 'Services', 5],
      [3, 'robot-agent', 11],
      [2, 'Services', 13],
    ]);
  });

  it('ignores comment lines inside fenced code', () => {
    expect(extractHeadings(markdown).some((h) => h.text === 'not a heading')).toBe(false);
  });

  it('de-duplicates repeated headings the way GitHub does', () => {
    const ids = extractHeadings(markdown).map((h) => h.id);
    expect(ids).toEqual(['neodem', 'services', 'robot-agent', 'services-1']);
  });

  it('keys ids by source line so repeated headings stay distinct', () => {
    const byLine = headingIdsByLine(extractHeadings(markdown));
    expect(byLine.get(5)).toBe('services');
    expect(byLine.get(13)).toBe('services-1');
  });
});

describe('resolveDocLink', () => {
  it('keeps in-page fragments in the page', () => {
    expect(resolveDocLink('#troubleshooting', 'runbook')).toEqual({
      kind: 'anchor',
      id: 'troubleshooting',
    });
  });

  it('turns a sibling markdown file into a docs route', () => {
    expect(resolveDocLink('architecture.md', 'README')).toEqual({
      kind: 'doc',
      slug: 'architecture',
      hash: null,
    });
  });

  it('carries the fragment across documents', () => {
    expect(resolveDocLink('architecture.md#agent-mode', 'README')).toEqual({
      kind: 'doc',
      slug: 'architecture',
      hash: 'agent-mode',
    });
  });

  it('resolves relative paths against the current document directory', () => {
    expect(resolveDocLink('./prd.md', 'planning/roadmap')).toMatchObject({ slug: 'planning/prd' });
    expect(resolveDocLink('../api.md', 'planning/roadmap')).toMatchObject({ slug: 'api' });
  });

  it('leaves external and absolute links alone', () => {
    expect(resolveDocLink('https://github.com/x', 'README')).toEqual({
      kind: 'external',
      href: 'https://github.com/x',
    });
    expect(resolveDocLink('/robots', 'README')).toEqual({ kind: 'route', to: '/robots' });
  });

  it('treats anything else as an asset', () => {
    expect(resolveDocLink('images/fleet.png', 'README')).toEqual({
      kind: 'asset',
      href: 'images/fleet.png',
    });
  });
});

describe('normalizeCodeLanguage', () => {
  it('falls back to plaintext for an untagged fence', () => {
    expect(normalizeCodeLanguage(undefined)).toBe('plaintext');
    expect(normalizeCodeLanguage('')).toBe('plaintext');
  });

  it('maps the fence tags the docs use onto Prism grammars', () => {
    expect(normalizeCodeLanguage('env')).toBe('ini');
    expect(normalizeCodeLanguage('sh')).toBe('bash');
    expect(normalizeCodeLanguage('ts')).toBe('typescript');
  });

  it('passes through a language Prism already knows', () => {
    expect(normalizeCodeLanguage('bash')).toBe('bash');
  });
});
