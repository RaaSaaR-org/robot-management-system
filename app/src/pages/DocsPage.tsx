/**
 * @file DocsPage.tsx
 * @description Documentation viewer with categorized sidebar, search, and markdown rendering
 * @feature docs
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, Navigate, useLocation, useNavigate, Link } from 'react-router-dom';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowLeft, ArrowRight, ExternalLink, Github, Menu } from 'lucide-react';
import type { Element as HastElement, ElementContent, RootContent } from 'hast';
import { cn } from '@/shared/utils/cn';
import { DocsSidebar, type DocEntry } from '@/components/docs/DocsSidebar';
import { DocsCodeBlock } from '@/components/docs/DocsCodeBlock';
import { DocsToc } from '@/components/docs/DocsToc';
import {
  extractHeadings,
  headingIdsByLine,
  resolveDocLink,
  type DocHeading,
} from '@/components/docs/docsMarkdown';
import '@/components/docs/docs-prose.css';

// ---------------------------------------------------------------------------
// Load all markdown files from docs/ including subdirectories
// ---------------------------------------------------------------------------

const docsRaw = import.meta.glob<string>('../../../docs/**/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const GITHUB_REPO_URL = 'https://github.com/RaaSaaR-org/robot-management-system';
const GITHUB_DOCS_URL = `${GITHUB_REPO_URL}/blob/main/docs`;

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
// Category mapping
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
  'Training',
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
// Markdown node helpers
// ---------------------------------------------------------------------------

/** Flatten a hast subtree to its text content. */
function nodeText(node: RootContent | ElementContent | undefined): string {
  if (!node) return '';
  if (node.type === 'text') return node.value;
  if (node.type === 'element') return node.children.map(nodeText).join('');
  return '';
}

/** Read `language-xxx` off a hast <code> element's class list. */
function languageOf(node: HastElement): string | undefined {
  const raw = node.properties?.className;
  const classes = Array.isArray(raw) ? raw.map(String) : typeof raw === 'string' ? raw.split(/\s+/) : [];
  for (const cls of classes) {
    const match = /^language-(.+)$/.exec(cls);
    if (match) return match[1];
  }
  return undefined;
}

/**
 * True when a table's header row is entirely blank.
 *
 * Several docs use `| | |` on purpose to get a key/value spec plate rather than
 * a real table (architecture.md alone has eight). Rendering the empty <thead>
 * puts a blank grey bar on top of each one.
 */
function hasBlankHeader(node: HastElement): boolean {
  const thead = node.children.find(
    (child): child is HastElement => child.type === 'element' && child.tagName === 'thead',
  );
  if (!thead) return false;

  const cells: HastElement[] = [];
  for (const row of thead.children) {
    if (row.type !== 'element') continue;
    for (const cell of row.children) {
      if (cell.type === 'element' && cell.tagName === 'th') cells.push(cell);
    }
  }

  return cells.length > 0 && cells.every((cell) => nodeText(cell).trim() === '');
}

/** ~200 wpm, rounded up — enough to tell a reference card from a runbook. */
function readingMinutes(markdown: string): number {
  return Math.max(1, Math.round(markdown.trim().split(/\s+/).length / 200));
}

// ---------------------------------------------------------------------------
// DocsPage Component
// ---------------------------------------------------------------------------

export function DocsPage() {
  const { '*': splat } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const scrollRef = useRef<HTMLElement | null>(null);

  // Extract slug from location — supports both /docs/:slug and /docs/planning/prd
  const slug = splat || '';

  const content = DOC_CONTENT.get(slug);
  const currentDoc = DOC_ENTRIES.find((e) => e.slug === slug);
  const currentIndex = DOC_ENTRIES.findIndex((e) => e.slug === slug);
  const previousDoc = currentIndex > 0 ? DOC_ENTRIES[currentIndex - 1] : undefined;
  const nextDoc = currentIndex >= 0 ? DOC_ENTRIES[currentIndex + 1] : undefined;

  const headings = useMemo(() => (content ? extractHeadings(content) : []), [content]);
  const idsByLine = useMemo(() => headingIdsByLine(headings), [headings]);
  const tocHeadings = useMemo<DocHeading[]>(
    () => headings.filter((h) => h.depth === 2 || h.depth === 3),
    [headings],
  );

  /** Scroll a heading to the top of the reading column (respects scroll-margin). */
  const scrollToHeading = useCallback((id: string) => {
    const container = scrollRef.current;
    if (!container) return;
    const target = container.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`);
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const goToHeading = useCallback(
    (id: string) => {
      scrollToHeading(id);
      navigate({ hash: `#${id}` }, { replace: true });
    },
    [navigate, scrollToHeading],
  );

  // A new document starts at the top; a deep link starts at its anchor. The
  // reading column is the scroll container, so neither happens on its own.
  const hash = location.hash;
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    if (!hash) {
      container.scrollTo({ top: 0 });
      return;
    }
    const id = decodeURIComponent(hash.slice(1));
    const frame = requestAnimationFrame(() => scrollToHeading(id));
    return () => cancelAnimationFrame(frame);
  }, [slug, hash, scrollToHeading]);

  const components = useMemo<Components>(
    () => buildComponents(slug, idsByLine, goToHeading),
    [slug, idsByLine, goToHeading],
  );

  // If no slug given, redirect to default
  if (!slug) {
    // Check if we're at /docs exactly (not /docs/)
    if (location.pathname === '/docs' || location.pathname === '/docs/') {
      return <Navigate to={`/docs/${DEFAULT_SLUG}`} replace />;
    }
  }

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
      <main ref={scrollRef} className="flex-1 overflow-y-auto">
        {/* Mobile header with menu button */}
        <div className="lg:hidden flex items-center gap-3 p-4 border-b border-theme sticky top-0 section-secondary z-10">
          <button
            onClick={() => setMobileSidebarOpen(true)}
            className="p-1.5 rounded-brand hover:bg-theme-hover transition-colors"
            aria-label="Open navigation"
          >
            <Menu className="w-5 h-5 text-theme-primary" />
          </button>
          <span className="font-medium text-sm text-theme-primary truncate">
            {currentDoc?.title ?? 'Documentation'}
          </span>
        </div>

        <div className="mx-auto flex w-full max-w-[76rem] gap-8 px-4 sm:px-8">
          <div className="min-w-0 flex-1 py-8 lg:py-10 xl:max-w-3xl">
            {content ? (
              <>
                {/* Provenance rail: where this page sits, how long it is, and
                    where the file it is rendered from actually lives. */}
                <div className="mb-8 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-theme pb-4 font-mono text-[0.6875rem] uppercase tracking-[0.1em] text-theme-tertiary">
                  <span>{currentDoc?.category ?? 'Documentation'}</span>
                  <span aria-hidden>/</span>
                  <span className="text-theme-secondary">{slug}.md</span>
                  <span aria-hidden>·</span>
                  <span>{readingMinutes(content)} min read</span>
                  <a
                    href={`${GITHUB_DOCS_URL}/${slug}.md`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-auto flex items-center gap-1.5 text-theme-tertiary transition-colors hover:text-theme-primary"
                  >
                    <Github className="h-3.5 w-3.5" />
                    View source
                  </a>
                </div>

                <article className="prose docs-prose">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
                    {content}
                  </ReactMarkdown>
                </article>

                {/* Sequential navigation, in sidebar order */}
                {(previousDoc || nextDoc) && (
                  <nav className="mt-14 grid gap-3 border-t border-theme pt-6 sm:grid-cols-2">
                    {previousDoc ? (
                      <DocsPagerLink doc={previousDoc} direction="previous" />
                    ) : (
                      <span />
                    )}
                    {nextDoc && <DocsPagerLink doc={nextDoc} direction="next" />}
                  </nav>
                )}
              </>
            ) : (
              <div className="py-20 text-center">
                <p className="font-mono text-[0.6875rem] uppercase tracking-[0.1em] text-signal-unknown">
                  Not found
                </p>
                <h2 className="mt-3 text-xl font-semibold text-theme-primary">
                  No document at &ldquo;{slug}&rdquo;
                </h2>
                <p className="mt-2 text-sm text-theme-secondary">
                  It may have been renamed or moved. Pick a page from the sidebar to carry on.
                </p>
                <Link
                  to={`/docs/${DEFAULT_SLUG}`}
                  className="mt-6 inline-flex items-center gap-2 rounded-brand border border-theme px-4 py-2 text-sm text-theme-primary transition-colors hover:bg-theme-hover"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back to {DOC_ENTRIES[0]?.title ?? 'the docs'}
                </Link>
              </div>
            )}
          </div>

          {content && (
            <DocsToc
              headings={tocHeadings}
              scrollRef={scrollRef}
              onSelect={goToHeading}
              className="hidden xl:block"
            />
          )}
        </div>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pager
// ---------------------------------------------------------------------------

function DocsPagerLink({ doc, direction }: { doc: DocEntry; direction: 'previous' | 'next' }) {
  const isNext = direction === 'next';
  return (
    <Link
      to={`/docs/${doc.slug}`}
      className={cn(
        'group flex flex-col gap-1 rounded-brand border border-theme px-4 py-3 transition-colors hover:bg-theme-hover',
        isNext && 'sm:col-start-2 sm:text-right',
      )}
    >
      <span className="font-mono text-[0.6875rem] uppercase tracking-[0.1em] text-theme-tertiary">
        {isNext ? 'Next' : 'Previous'}
      </span>
      <span
        className={cn(
          'flex items-center gap-1.5 text-sm font-medium text-theme-primary',
          isNext && 'sm:justify-end',
        )}
      >
        {!isNext && <ArrowLeft className="h-3.5 w-3.5 text-theme-tertiary" />}
        {doc.title}
        {isNext && <ArrowRight className="h-3.5 w-3.5 text-theme-tertiary" />}
      </span>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Markdown components
// ---------------------------------------------------------------------------

/**
 * Build the renderer overrides for one document.
 *
 * Heading ids are keyed by source line rather than derived from the rendered
 * text, so repeated headings ("Diagnose" appears three times in runbook.md) keep
 * the distinct anchors the table of contents hands out.
 */
function buildComponents(
  currentSlug: string,
  idsByLine: Map<number, string>,
  goToHeading: (id: string) => void,
): Components {
  const heading = (level: 1 | 2 | 3 | 4): Components['h1'] =>
    function Heading({ node, children, ...props }) {
      const Tag = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4';
      const line = node?.position?.start.line;
      const id = line === undefined ? undefined : idsByLine.get(line);

      return (
        <Tag id={id} {...props}>
          {children}
          {id && (
            <a
              href={`#${id}`}
              className="docs-heading-anchor"
              aria-label={`Link to “${node ? nodeText(node) : id}”`}
              onClick={(event) => {
                event.preventDefault();
                goToHeading(id);
              }}
            >
              #
            </a>
          )}
        </Tag>
      );
    };

  return {
    h1: heading(1),
    h2: heading(2),
    h3: heading(3),
    h4: heading(4),

    // Fenced blocks are taken over wholesale at the <pre> level: react-markdown
    // v10 no longer passes an `inline` flag to the `code` component, so the old
    // "does it have a language class" test rendered all 23 language-less fences
    // in docs/ as inline pills.
    pre({ node, children, ...props }) {
      const codeNode = node?.children.find(
        (child): child is HastElement => child.type === 'element' && child.tagName === 'code',
      );
      if (!codeNode) return <pre {...props}>{children}</pre>;

      return (
        <DocsCodeBlock
          code={nodeText(codeNode).replace(/\n$/, '')}
          language={languageOf(codeNode)}
        />
      );
    },

    code({ node: _node, className, children, ...props }) {
      return (
        <code className={cn('docs-inline-code', className)} {...props}>
          {children}
        </code>
      );
    },

    table({ node, children, ...props }) {
      const blankHeader = node ? hasBlankHeader(node) : false;
      return (
        <div className={cn('docs-table-scroll', blankHeader && 'docs-table-plate')}>
          <table {...props}>{children}</table>
        </div>
      );
    },

    // The docs cross-link as bare `architecture.md` / `#anchor`; both have to
    // become real in-app navigation rather than a request for a file.
    a({ node: _node, href, children, ...props }) {
      const link = resolveDocLink(href, currentSlug);

      switch (link.kind) {
        case 'anchor':
          return (
            <a
              href={`#${link.id}`}
              onClick={(event) => {
                event.preventDefault();
                goToHeading(link.id);
              }}
              {...props}
            >
              {children}
            </a>
          );
        case 'doc':
          // A markdown target the viewer does not hold is a source-tree file,
          // not a missing page — agent-mode.md points at robot-agent/AGENTS.md.
          // Send those to the file on GitHub instead of a dead in-app route.
          if (!DOC_CONTENT.has(link.slug)) {
            return (
              <a
                href={`${GITHUB_REPO_URL}/blob/main/${link.slug}.md`}
                target="_blank"
                rel="noopener noreferrer"
                {...props}
              >
                {children}
                <ExternalLink className="ml-0.5 inline h-3 w-3 align-baseline" aria-hidden />
              </a>
            );
          }
          return (
            <Link to={`/docs/${link.slug}${link.hash ? `#${link.hash}` : ''}`} {...props}>
              {children}
            </Link>
          );
        case 'route':
          return (
            <Link to={link.to} {...props}>
              {children}
            </Link>
          );
        case 'external':
          return (
            <a href={link.href} target="_blank" rel="noopener noreferrer" {...props}>
              {children}
              <ExternalLink className="ml-0.5 inline h-3 w-3 align-baseline" aria-hidden />
            </a>
          );
        default:
          return (
            <a href={`${import.meta.env.BASE_URL}${link.href}`} {...props}>
              {children}
            </a>
          );
      }
    },

    img({ node: _node, src, alt, ...props }) {
      const resolved =
        typeof src === 'string' && !/^(https?:)?\/\//.test(src) && !src.startsWith('/')
          ? `${import.meta.env.BASE_URL}${src}`
          : src;
      return <img src={resolved} alt={alt ?? ''} loading="lazy" {...props} />;
    },
  };
}
