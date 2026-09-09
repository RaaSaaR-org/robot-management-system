/**
 * @file docsMarkdown.ts
 * @description Pure helpers behind the /docs renderer — heading slugs, the
 *              table of contents, and link resolution between docs
 * @feature docs
 */

// ============================================================================
// TYPES
// ============================================================================

export interface DocHeading {
  /** 1-based line of the heading in the source markdown. Used as the join key
   *  between the table of contents and the rendered <h*>, because react-markdown
   *  hands every component the hast node's source position. Matching on text
   *  would collapse the repeated "Diagnose" / "Recover" headings in runbook.md
   *  onto one anchor. */
  line: number;
  /** 1 for `#`, 2 for `##`, … */
  depth: number;
  /** Heading text with inline markdown stripped */
  text: string;
  /** GitHub-compatible anchor id, de-duplicated within the document */
  id: string;
}

/** Where a markdown link points, once resolved against the current document. */
export type DocLink =
  | { kind: 'anchor'; id: string }
  | { kind: 'doc'; slug: string; hash: string | null }
  | { kind: 'route'; to: string }
  | { kind: 'external'; href: string }
  | { kind: 'asset'; href: string };

// ============================================================================
// HEADINGS
// ============================================================================

/**
 * Slugify a heading the way GitHub does: lower-case, drop everything that is
 * not a letter, digit, space or hyphen, then collapse spaces to hyphens.
 *
 * `## TLS / HTTPS` → `tls--https`, `## 7. Current Limitations` →
 * `7-current-limitations` — both of which the docs already link to.
 */
export function slugifyHeading(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N} -]/gu, '')
    .replace(/ /g, '-');
}

/** Strip the inline markdown that must not end up in a slug or a TOC label. */
export function stripInlineMarkdown(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1') // images → alt text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links → label
    .replace(/`([^`]*)`/g, '$1') // inline code → contents
    .replace(/[*_~]/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Pull every ATX heading out of a markdown document, in source order, skipping
 * anything inside a fenced code block (`## Comment` lines in the shell samples
 * are not headings).
 */
export function extractHeadings(markdown: string): DocHeading[] {
  const headings: DocHeading[] = [];
  const seen = new Map<string, number>();
  let fence: string | null = null;

  const lines = markdown.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (fence === null) {
        fence = marker;
      } else if (fence === marker) {
        fence = null;
      }
      continue;
    }
    if (fence !== null) continue;

    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!match) continue;

    const text = stripInlineMarkdown(match[2]);
    if (!text) continue;

    const base = slugifyHeading(text) || 'section';
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);

    headings.push({
      line: i + 1,
      depth: match[1].length,
      text,
      id: count === 0 ? base : `${base}-${count}`,
    });
  }

  return headings;
}

/** Lookup from source line → anchor id, for the rendered heading components. */
export function headingIdsByLine(headings: DocHeading[]): Map<number, string> {
  return new Map(headings.map((h) => [h.line, h.id]));
}

// ============================================================================
// LINKS
// ============================================================================

/** Resolve a `./`-style relative path against the directory of a doc slug. */
function resolveRelative(fromSlug: string, target: string): string {
  const fromDir = fromSlug.includes('/') ? fromSlug.slice(0, fromSlug.lastIndexOf('/')).split('/') : [];
  const segments = target.split('/');
  const out = [...fromDir];

  for (const segment of segments) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      out.pop();
      continue;
    }
    out.push(segment);
  }

  return out.join('/');
}

/**
 * Work out what a markdown link means inside the docs viewer.
 *
 * The docs cross-reference each other as plain sibling paths (`architecture.md`,
 * `architecture.md#agent-mode`) and link within a page by fragment
 * (`#troubleshooting`). Both used to be rewritten to `${BASE_URL}${href}`, which
 * turned every cross-reference into a 404 and every fragment into a link to the
 * app root.
 */
export function resolveDocLink(href: string | undefined, currentSlug: string): DocLink {
  const raw = (href ?? '').trim();

  if (!raw) return { kind: 'asset', href: '' };
  if (raw.startsWith('#')) return { kind: 'anchor', id: decodeURIComponent(raw.slice(1)) };
  if (raw.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(raw)) return { kind: 'external', href: raw };
  if (raw.startsWith('/')) return { kind: 'route', to: raw };

  const [path, ...hashParts] = raw.split('#');
  const hash = hashParts.length > 0 ? decodeURIComponent(hashParts.join('#')) : null;

  if (/\.md$/i.test(path)) {
    return { kind: 'doc', slug: resolveRelative(currentSlug, path.replace(/\.md$/i, '')), hash };
  }

  return { kind: 'asset', href: raw };
}

// ============================================================================
// CODE
// ============================================================================

/** Prism has no grammar for some of the fence tags the docs use. */
const LANGUAGE_ALIASES: Record<string, string> = {
  env: 'ini',
  dotenv: 'ini',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  console: 'bash',
  js: 'javascript',
  ts: 'typescript',
  tsx: 'tsx',
  yml: 'yaml',
  proto: 'protobuf',
  dockerfile: 'docker',
  text: 'plaintext',
  txt: 'plaintext',
};

/** Map a fence tag onto a Prism language, or `plaintext` when there is none. */
export function normalizeCodeLanguage(language: string | undefined): string {
  const lower = (language ?? '').trim().toLowerCase();
  if (!lower) return 'plaintext';
  return LANGUAGE_ALIASES[lower] ?? lower;
}
