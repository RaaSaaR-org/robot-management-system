/**
 * @file DocsPage.tsx
 * @description Documentation viewer — PageHeader with the doc's title, a docs
 *              list (sidebar on wide screens, a "Browse docs" modal below lg),
 *              the article and the "On this page" rail
 * @feature docs
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, ExternalLink, FileQuestion, ListTree } from 'lucide-react';
import { Button, EmptyState, LinkButton, Modal, PageHeader, Panel, buttonClasses } from '@/shared/components/ui';
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

const ICON = 'h-4 w-4';

export function DocsPage() {
  const { '*': splat } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [browseOpen, setBrowseOpen] = useState(false);
  const articleRef = useRef<HTMLDivElement | null>(null);

  const slug = splat || '';
  const content = DOC_CONTENT.get(slug);
  const currentDoc = DOC_ENTRIES.find((e) => e.slug === slug);
  const currentIndex = DOC_ENTRIES.findIndex((e) => e.slug === slug);
  const previousDoc = currentIndex > 0 ? DOC_ENTRIES[currentIndex - 1] : undefined;
  const nextDoc = currentIndex >= 0 ? DOC_ENTRIES[currentIndex + 1] : undefined;

  const headings = useMemo(() => (content ? extractHeadings(content) : []), [content]);
  const idsByLine = useMemo(() => headingIdsByLine(headings), [headings]);
  const tocHeadings = useMemo<DocHeading[]>(() => headings.filter((h) => h.depth === 2 || h.depth === 3), [headings]);
  // The first `#` is the document's title: it becomes the page h1 and is not repeated in the body.
  const titleHeading = headings.find((h) => h.depth === 1);
  const title = titleHeading?.text ?? currentDoc?.title ?? 'Documentation';

  const scrollToHeading = useCallback((id: string) => {
    const target = articleRef.current?.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`);
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const goToHeading = useCallback(
    (id: string) => {
      scrollToHeading(id);
      navigate({ hash: `#${id}` }, { replace: true });
    },
    [navigate, scrollToHeading],
  );

  // A new document starts at the top; a deep link starts at its anchor.
  const hash = location.hash;
  useEffect(() => {
    if (!hash) {
      window.scrollTo({ top: 0 });
      return;
    }
    const id = decodeURIComponent(hash.slice(1));
    const frame = requestAnimationFrame(() => scrollToHeading(id));
    return () => cancelAnimationFrame(frame);
  }, [slug, hash, scrollToHeading]);

  if (!slug && (location.pathname === '/docs' || location.pathname === '/docs/')) {
    return <Navigate to={`/docs/${DEFAULT_SLUG}`} replace />;
  }

  const sidebarProps = {
    docs: DOC_ENTRIES,
    groups: DOC_GROUPS,
    categories: ORDERED_CATEGORIES,
    contentMap: DOC_CONTENT,
  };

  const browseButton = (
    <Button
      variant="secondary"
      className="lg:hidden"
      leftIcon={<ListTree className={ICON} strokeWidth={1.75} />}
      onClick={() => setBrowseOpen(true)}
    >
      Browse docs
    </Button>
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="System"
        title={content ? title : 'Doc not found'}
        description={
          content
            ? `${currentDoc?.category ?? 'Documentation'} · ${readingMinutes(content)} min read`
            : 'There is no document at this address.'
        }
        actions={
          <>
            {browseButton}
            {content && (
              <a
                href={`${GITHUB_DOCS_URL}/${slug}.md`}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonClasses({ variant: 'secondary' })}
              >
                <ExternalLink className={ICON} strokeWidth={1.75} aria-hidden="true" />
                View source
              </a>
            )}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[15rem_minmax(0,1fr)_13rem]">
        <aside className="hidden lg:block">
          <div className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto rounded-panel border border-line bg-inset p-3">
            <DocsSidebar {...sidebarProps} />
          </div>
        </aside>

        <div ref={articleRef} className="min-w-0">
          {content ? (
            <>
              <DocsArticle
                content={content}
                slug={slug}
                idsByLine={idsByLine}
                onNavigateToHeading={goToHeading}
                skipHeadingLine={titleHeading?.line}
              />
              {(previousDoc || nextDoc) && (
                <nav aria-label="More docs" className="mt-12 grid max-w-[70ch] gap-3 border-t border-line-subtle pt-6 sm:grid-cols-2">
                  {previousDoc ? <DocsPagerLink doc={previousDoc} direction="previous" /> : <span />}
                  {nextDoc && <DocsPagerLink doc={nextDoc} direction="next" />}
                </nav>
              )}
            </>
          ) : (
            <Panel>
              <EmptyState
                icon={<FileQuestion />}
                title={`No document at “${slug}”`}
                description="It may have been renamed or moved. Pick another doc to carry on."
                action={
                  <LinkButton to={`/docs/${DEFAULT_SLUG}`} variant="secondary" leftIcon={<ArrowLeft className={ICON} strokeWidth={1.75} />}>
                    Back to {DOC_ENTRIES[0]?.title ?? 'the docs'}
                  </LinkButton>
                }
              />
            </Panel>
          )}
        </div>

        {content && (
          <DocsToc headings={tocHeadings} scrollRef={articleRef} onSelect={goToHeading} className="hidden xl:block" />
        )}
      </div>

      <Modal isOpen={browseOpen} onClose={() => setBrowseOpen(false)} title="Browse docs" size="md">
        <DocsSidebar {...sidebarProps} onNavigate={() => setBrowseOpen(false)} />
      </Modal>
    </div>
  );
}

function DocsPagerLink({ doc, direction }: { doc: DocEntry; direction: 'previous' | 'next' }) {
  const isNext = direction === 'next';
  return (
    <Link
      to={`/docs/${doc.slug}`}
      className={cn(
        'flex flex-col gap-1 rounded-control border border-line bg-panel px-4 py-3 transition-colors hover:border-line-strong',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
        isNext && 'sm:col-start-2 sm:text-right',
      )}
    >
      <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-tertiary">
        {isNext ? 'Next' : 'Previous'}
      </span>
      <span className={cn('flex items-center gap-1.5 text-sm font-medium text-ink-primary', isNext && 'sm:justify-end')}>
        {!isNext && <ArrowLeft className="h-3.5 w-3.5 text-ink-tertiary" strokeWidth={1.75} />}
        {doc.title}
        {isNext && <ArrowRight className="h-3.5 w-3.5 text-ink-tertiary" strokeWidth={1.75} />}
      </span>
    </Link>
  );
}
