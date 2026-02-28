/**
 * @file DocsPage.tsx
 * @description Documentation viewer page with sidebar navigation and markdown rendering
 * @feature docs
 */

import { useState } from 'react';
import { useParams, Navigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { cn } from '@/shared/utils/cn';
import { DocsSidebar, type DocEntry } from '@/components/DocsSidebar';

// ---------------------------------------------------------------------------
// Load all markdown files from docs/ at build time (Vite eager glob)
// ---------------------------------------------------------------------------

const docsRaw = import.meta.glob<string>('../../../docs/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract slug from a glob key like "../../../docs/architecture.md" → "architecture" */
function slugFromKey(key: string): string {
  const filename = key.split('/').pop() ?? '';
  return filename.replace(/\.md$/, '');
}

/** Convert a kebab-case filename to a readable title */
function titleFromSlug(slug: string): string {
  // Known acronyms that should stay uppercase
  const acronyms = new Set(['vla', 'prd', 'ai', 'gdpr', 'nats', 'a2a']);

  return slug
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
// Build sorted docs list (README first, then alphabetical)
// ---------------------------------------------------------------------------

function buildDocEntries(): { entries: DocEntry[]; contentMap: Map<string, string> } {
  const entries: DocEntry[] = [];
  const contentMap = new Map<string, string>();

  for (const [key, content] of Object.entries(docsRaw)) {
    const slug = slugFromKey(key);
    entries.push({ slug, title: titleFromSlug(slug) });
    contentMap.set(slug, content);
  }

  // Sort: README/IMPROVEMENT_PLAN first, then alphabetical by title
  entries.sort((a, b) => {
    const aIsReadme = a.slug.toUpperCase() === 'README';
    const bIsReadme = b.slug.toUpperCase() === 'README';
    if (aIsReadme && !bIsReadme) return -1;
    if (!aIsReadme && bIsReadme) return 1;
    return a.title.localeCompare(b.title);
  });

  return { entries, contentMap };
}

const { entries: DOC_ENTRIES, contentMap: DOC_CONTENT } = buildDocEntries();

// Default slug = first entry (README if it exists, otherwise first alphabetically)
const DEFAULT_SLUG = DOC_ENTRIES[0]?.slug ?? '';

// ---------------------------------------------------------------------------
// Custom markdown components
// ---------------------------------------------------------------------------

type CodeProps = React.ComponentProps<'code'> & { inline?: boolean };

function CodeBlock({ inline, className, children, ...props }: CodeProps) {
  const match = /language-(\w+)/.exec(className ?? '');
  const codeString = String(children).replace(/\n$/, '');

  if (!inline && match) {
    return (
      <SyntaxHighlighter
        style={oneDark}
        language={match[1]}
        PreTag="div"
        className="!rounded-brand !my-4 !text-sm"
      >
        {codeString}
      </SyntaxHighlighter>
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
// Mobile sidebar toggle
// ---------------------------------------------------------------------------

function MobileSidebarToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className="md:hidden fixed bottom-4 right-4 z-50 p-3 rounded-full bg-cobalt text-white shadow-lg"
      aria-label={open ? 'Close navigation' : 'Open navigation'}
    >
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        {open ? (
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        ) : (
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        )}
      </svg>
    </button>
  );
}

// ---------------------------------------------------------------------------
// DocsPage Component
// ---------------------------------------------------------------------------

export function DocsPage() {
  const { slug } = useParams<{ slug: string }>();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  // If no slug given, redirect to default
  if (!slug) {
    return <Navigate to={`/docs/${DEFAULT_SLUG}`} replace />;
  }

  const content = DOC_CONTENT.get(slug);

  return (
    <div className="flex h-[calc(100vh-3.5rem)] overflow-hidden">
      {/* Sidebar – always visible on md+, toggleable on mobile */}
      <DocsSidebar
        docs={DOC_ENTRIES}
        className={cn(
          'h-full',
          // Mobile: overlay
          'fixed md:relative z-40 md:z-auto',
          'transition-transform duration-200 md:translate-x-0',
          mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      />

      {/* Mobile backdrop */}
      {mobileSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 md:hidden"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}

      {/* Content area */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-8">
          {content ? (
            <article className="prose prose-sm md:prose-base dark:prose-invert max-w-none prose-headings:text-theme-primary prose-a:text-cobalt prose-a:no-underline hover:prose-a:underline prose-code:before:content-none prose-code:after:content-none prose-pre:p-0 prose-pre:bg-transparent prose-img:rounded-brand prose-table:text-sm">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                urlTransform={(url) => {
                  // Resolve relative screenshot/image paths to public assets
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

      {/* Mobile FAB */}
      <MobileSidebarToggle
        open={mobileSidebarOpen}
        onToggle={() => setMobileSidebarOpen((o) => !o)}
      />
    </div>
  );
}
