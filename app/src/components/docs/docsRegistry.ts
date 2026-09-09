/**
 * @file docsRegistry.ts
 * @description The set of documents the viewer serves — slugs, titles, categories and source text
 * @feature docs
 */

import type { DocEntry } from './DocsSidebar';

// ---------------------------------------------------------------------------
// Source
// ---------------------------------------------------------------------------

/** Every markdown file under docs/, inlined at build time. */
const docsRaw = import.meta.glob<string>('../../../../docs/**/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
});

export const GITHUB_REPO_URL = 'https://github.com/RaaSaaR-org/robot-management-system';
export const GITHUB_DOCS_URL = `${GITHUB_REPO_URL}/blob/main/docs`;

// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------

/** Extract slug from a glob key, supporting subdirectories.
 *  "../../../../docs/architecture.md" → "architecture"
 *  "../../../../docs/planning/prd.md" → "planning/prd"
 */
export function slugFromKey(key: string): string {
  const match = key.match(/docs\/(.+)\.md$/);
  return match ? match[1] : key;
}

/** Convert a kebab-case filename to a readable title (uses last segment of path) */
export function titleFromSlug(slug: string): string {
  const acronyms = new Set(['vla', 'prd', 'ai', 'gdpr', 'nats', 'a2a', 'api', 'vr', 'ota', 'g1']);
  const parts = slug.split('/');
  const filename = parts[parts.length - 1];

  return filename
    .split('-')
    .map((word) => {
      if (word === '') return '';
      const lower = word.toLowerCase();
      if (acronyms.has(lower)) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

const CATEGORY_MAP: Record<string, string> = {
  'demo-intro': 'Getting Started',
  'demo-day': 'Getting Started',
  'README': 'Getting Started',
  'architecture': 'Architecture',
  'app-architecture': 'Architecture',
  'api': 'Architecture',
  'multi-tenancy': 'Architecture',
  'process-delegation-architecture': 'Architecture',
  'robot-integration-guide': 'Robot Integration',
  'vla-integration-guide': 'Robot Integration',
  'agent-mode': 'Robot Integration',
  'g1-edu-lab-bringup': 'Robot Integration',
  'real-g1-apple-runbook': 'Robot Integration',
  'vr-teleop-data-collection': 'Robot Integration',
  'training-pipeline-testing': 'Training',
  'training-run-export': 'Training',
  'deployment': 'Operations',
  'dev-workflow': 'Operations',
  'operations': 'Operations',
  'runbook': 'Operations',
  'nats-rustfs': 'Operations',
  'regulatory-compliance': 'Compliance',
  'ai-operations-guide': 'Compliance',
  'brand': 'Brand',
};

/** Determine the category for a given slug */
export function categoryFromSlug(slug: string): string {
  // Subdirectory-based category
  const parts = slug.split('/');
  if (parts.length > 1) {
    const dir = parts[0];
    if (dir === 'planning') return 'Planning';
    if (dir === 'research') return 'Research';
    return dir.charAt(0).toUpperCase() + dir.slice(1);
  }
  // Map-based category for root-level docs
  return CATEGORY_MAP[slug] ?? 'Other';
}

// Category display order
const CATEGORY_ORDER = [
  'Getting Started',
  'Architecture',
  'Robot Integration',
  'Training',
  'Operations',
  'Compliance',
  'Brand',
  'Planning',
  'Research',
  'Other',
];

// ---------------------------------------------------------------------------
// Build the registry
// ---------------------------------------------------------------------------

function buildDocEntries(): {
  entries: DocEntry[];
  contentMap: Map<string, string>;
  grouped: Map<string, DocEntry[]>;
} {
  const entries: DocEntry[] = [];
  const contentMap = new Map<string, string>();

  for (const [key, content] of Object.entries(docsRaw)) {
    const slug = slugFromKey(key);
    const category = categoryFromSlug(slug);
    entries.push({ slug, title: titleFromSlug(slug), category });
    contentMap.set(slug, content);
  }

  // Sort: demo-intro first (in demo mode), then README, then alphabetical
  const isDemo = import.meta.env.VITE_DEMO_MODE === 'true';
  entries.sort((a, b) => {
    const aIsDemoIntro = a.slug === 'demo-intro';
    const bIsDemoIntro = b.slug === 'demo-intro';
    const aIsReadme = a.slug.toUpperCase() === 'README';
    const bIsReadme = b.slug.toUpperCase() === 'README';
    if (isDemo && aIsDemoIntro && !bIsDemoIntro) return -1;
    if (isDemo && !aIsDemoIntro && bIsDemoIntro) return 1;
    if (aIsReadme && !bIsReadme) return -1;
    if (!aIsReadme && bIsReadme) return 1;
    return a.title.localeCompare(b.title);
  });

  // Group by category
  const grouped = new Map<string, DocEntry[]>();
  for (const entry of entries) {
    const cat = entry.category ?? 'Other';
    const list = grouped.get(cat) ?? [];
    list.push(entry);
    grouped.set(cat, list);
  }

  return { entries, contentMap, grouped };
}

const { entries, contentMap, grouped } = buildDocEntries();

export const DOC_ENTRIES = entries;
export const DOC_CONTENT = contentMap;
export const DOC_GROUPS = grouped;

/** In demo mode, demo-intro is sorted first; otherwise README is first. */
export const DEFAULT_SLUG = DOC_ENTRIES[0]?.slug ?? '';

/** Ordered categories (only those that have entries). */
export const ORDERED_CATEGORIES = CATEGORY_ORDER.filter((cat) => DOC_GROUPS.has(cat));
