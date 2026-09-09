/**
 * @file DocsArticle.tsx
 * @description Renders one markdown document — headings, links, tables and code blocks
 * @feature docs
 */

import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ExternalLink } from 'lucide-react';
import type { Element as HastElement, ElementContent, RootContent } from 'hast';
import { cn } from '@/shared/utils/cn';
import { DocsCodeBlock } from './DocsCodeBlock';
import { resolveDocLink } from './docsMarkdown';
import { DOC_CONTENT, GITHUB_REPO_URL } from './docsRegistry';
import './docs-prose.css';

interface DocsArticleProps {
  /** Raw markdown source */
  content: string;
  /** Slug of the document being rendered — relative links resolve against it */
  slug: string;
  /** Anchor id for each heading, keyed by its line in `content` */
  idsByLine: Map<number, string>;
  /** Called when a link targets a heading on this page */
  onNavigateToHeading: (id: string) => void;
}

/**
 * The reading surface. Styling lives in docs-prose.css, on top of
 * @tailwindcss/typography; this component owns the structural decisions the
 * plugin cannot make — what is a code block, where an anchor points, whether a
 * link stays in the app.
 */
export function DocsArticle({ content, slug, idsByLine, onNavigateToHeading }: DocsArticleProps) {
  const components = useMemo<Components>(
    () => buildComponents(slug, idsByLine, onNavigateToHeading),
    [slug, idsByLine, onNavigateToHeading],
  );

  return (
    <article className="prose docs-prose">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </article>
  );
}

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

// ---------------------------------------------------------------------------
// Component map
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
