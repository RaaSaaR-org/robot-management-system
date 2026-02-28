/**
 * @file DocsPage.tsx
 * @description Documentation viewer with categorized sidebar, search, and markdown rendering
 * @feature docs
 */

import { useState } from 'react';
import { useParams, Navigate, useLocation } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { cn } from '@/shared/utils/cn';
import { DocsSidebar, type DocEntry } from '@/components/DocsSidebar';

// ---------------------------------------------------------------------------
// Load all markdown files from docs/ including subdirectories
// ---------------------------------------------------------------------------

const docsRaw = import.meta.glob<string>('../../../docs/**/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract slug from a glob key, supporting subdirectories.
 *  "../../../docs/architecture.md" → "architecture"
 *  "../../../docs/planning/prd.md" → "planning/prd"
 */
function slugFromKey(key: string): string {
  const match = key.match(/docs\/(.+)\.md$/);
  return match ? match[1] : key;
}

/** Convert a kebab-case filename to a readable title (uses last segment of path) */
function titleFromSlug(slug: string): string {
  const acronyms = new Set(['vla', 'prd', 'ai', 'gdpr', 'nats', 'a2a', 'api']);
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
// Category mapping
// ---------------------------------------------------------------------------

const CATEGORY_MAP: Record<string, string> = {
  'demo-intro': 'Getting Started',
  'README': 'Getting Started',
  'architecture': 'Architecture',
  'app-architecture': 'Architecture',
  'api': 'Architecture',
  'robot-integration-guide': 'Robot Integration',
  'VLA-integration-guide': 'Robot Integration',
  'deployment': 'Operations',
  'dev-workflow': 'Operations',
  'process-delegation-architecture': 'Operations',
  'nats-rustfs': 'Operations',
  'regulatory-compliance': 'Compliance',
  'ai-operations-guide': 'Compliance',
  'brand': 'Brand',
};

/** Determine the category for a given slug */
function categoryFromSlug(slug: string): string {
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
  'Operations',
  'Compliance',
  'Brand',
  'Planning',
  'Research',
  'Other',
];

// ---------------------------------------------------------------------------
// Build docs list grouped by category
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

const { entries: DOC_ENTRIES, contentMap: DOC_CONTENT, grouped: DOC_GROUPS } = buildDocEntries();

// In demo mode, demo-intro is sorted first; otherwise README is first
const DEFAULT_SLUG = DOC_ENTRIES[0]?.slug ?? '';

// Ordered categories (only those that have entries)
const ORDERED_CATEGORIES = CATEGORY_ORDER.filter((cat) => DOC_GROUPS.has(cat));

// ---------------------------------------------------------------------------
// Custom markdown components
// ---------------------------------------------------------------------------

type CodeProps = React.ComponentProps<'code'> & { inline?: boolean };

function CodeBlock({ inline, className, children, ...props }: CodeProps) {
  const match = /language-(\w+)/.exec(className ?? '');
  const codeString = String(children).replace(/\n$/, '');

  if (!inline && match) {
    return (
      <div className="relative group">
        <span className="absolute top-2 right-3 text-xs text-gray-400 uppercase font-mono opacity-60">
          {match[1]}
        </span>
        <SyntaxHighlighter
          style={oneDark}
          language={match[1]}
          PreTag="div"
          className="!rounded-brand !my-4 !text-sm"
        >
          {codeString}
        </SyntaxHighlighter>
      </div>
    );
  }

  return (
    <code
      className={cn(
        'px-1.5 py-0.5 rounded text-sm',
        'bg-white/10 text-cobalt-300',
        className,
      )}
      {...props}
    >
      {children}
    </code>
  );
}

// ---------------------------------------------------------------------------
// DocsPage Component
// ---------------------------------------------------------------------------

export function DocsPage() {
  const { '*': splat } = useParams();
  const location = useLocation();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  // Extract slug from location — supports both /docs/:slug and /docs/planning/prd
  const slug = splat || '';

  // If no slug given, redirect to default
  if (!slug) {
    // Check if we're at /docs exactly (not /docs/)
    if (location.pathname === '/docs' || location.pathname === '/docs/') {
      return <Navigate to={`/docs/${DEFAULT_SLUG}`} replace />;
    }
  }

  const content = DOC_CONTENT.get(slug);
  const currentDoc = DOC_ENTRIES.find((e) => e.slug === slug);

  return (
    <div className="flex h-[calc(100vh-3.5rem)] overflow-hidden">
      {/* Mobile backdrop */}
      {mobileSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}

      {/* Sidebar – always visible on lg+, drawer on mobile */}
      <div
        className={cn(
          'fixed inset-y-0 left-0 z-50 w-72 transform transition-transform lg:relative lg:translate-x-0',
          mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <DocsSidebar
          docs={DOC_ENTRIES}
          groups={DOC_GROUPS}
          categories={ORDERED_CATEGORIES}
          contentMap={DOC_CONTENT}
          className="h-full"
          onNavigate={() => setMobileSidebarOpen(false)}
        />
      </div>

      {/* Content area */}
      <main className="flex-1 overflow-y-auto">
        {/* Mobile header with menu button */}
        <div className="lg:hidden flex items-center gap-3 p-4 border-b border-theme sticky top-0 section-secondary z-10">
          <button
            onClick={() => setMobileSidebarOpen(true)}
            className="p-1.5 rounded-brand hover:bg-theme-hover transition-colors"
            aria-label="Open navigation"
          >
            <svg className="w-5 h-5 text-theme-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <span className="font-medium text-sm text-theme-primary truncate">
            {currentDoc?.title ?? 'Documentation'}
          </span>
        </div>

        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
          {content ? (
            <article className="prose prose-sm md:prose-base dark:prose-invert max-w-none prose-headings:text-theme-primary prose-headings:scroll-mt-20 prose-h1:text-3xl prose-h1:font-bold prose-h1:border-b prose-h1:border-theme prose-h1:pb-3 prose-h2:text-2xl prose-h2:mt-10 prose-h3:text-xl prose-a:text-cobalt prose-a:no-underline hover:prose-a:underline prose-code:before:content-none prose-code:after:content-none prose-pre:p-0 prose-pre:bg-transparent prose-img:rounded-brand prose-img:max-w-full prose-table:text-sm prose-blockquote:border-l-cobalt prose-blockquote:italic prose-blockquote:text-theme-secondary">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                urlTransform={(url) => {
                  if (url && !url.startsWith('http') && !url.startsWith('/')) {
                    return `${import.meta.env.BASE_URL}${url}`;
                  }
                  return url;
                }}
                components={{ code: CodeBlock as never }}
              >
                {content}
              </ReactMarkdown>
            </article>
          ) : (
            <div className="text-center py-20">
              <h2 className="text-xl font-semibold text-theme-primary mb-2">
                Document not found
              </h2>
              <p className="text-theme-secondary">
                No documentation file matching &ldquo;{slug}&rdquo; was found.
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
