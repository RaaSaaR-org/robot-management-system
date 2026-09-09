/**
 * @file DocsPage.tsx
 * @description Documentation viewer — sidebar, reading column, contents rail and navigation
 * @feature docs
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, Navigate, useLocation, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Github, Menu } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { DocsSidebar, type DocEntry } from '@/components/docs/DocsSidebar';
import { DocsArticle } from '@/components/docs/DocsArticle';
import { DocsToc } from '@/components/docs/DocsToc';
import { extractHeadings, headingIdsByLine, type DocHeading } from '@/components/docs/docsMarkdown';
import {
  DEFAULT_SLUG,
  DOC_CONTENT,
  DOC_ENTRIES,
  DOC_GROUPS,
  GITHUB_DOCS_URL,
  ORDERED_CATEGORIES,
} from '@/components/docs/docsRegistry';

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

                <DocsArticle
                  content={content}
                  slug={slug}
                  idsByLine={idsByLine}
                  onNavigateToHeading={goToHeading}
                />

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
        'flex flex-col gap-1 rounded-brand border border-theme px-4 py-3 transition-colors hover:bg-theme-hover',
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
