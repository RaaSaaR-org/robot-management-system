/**
 * @file DocsToc.tsx
 * @description "On this page" rail for the docs viewer, with scroll spy
 * @feature docs
 */

import { useEffect, useState, type RefObject } from 'react';
import { cn } from '@/shared/utils/cn';
import type { DocHeading } from './docsMarkdown';

interface DocsTocProps {
  /** Headings to list — already filtered to the depths worth showing */
  headings: DocHeading[];
  /** The element that actually scrolls, so the observer has the right root */
  scrollRef: RefObject<HTMLElement | null>;
  onSelect: (id: string) => void;
  className?: string;
}

/**
 * Right-hand contents rail. Highlights the section currently under the top of
 * the reading column.
 */
export function DocsToc({ headings, scrollRef, onSelect, className }: DocsTocProps) {
  const activeId = useActiveHeading(headings, scrollRef);

  if (headings.length < 2) return null;

  return (
    <nav className={cn('w-56 shrink-0', className)} aria-label="On this page">
      <div className="sticky top-0 max-h-[calc(100vh-6rem)] overflow-y-auto py-8 pr-4">
        <p className="mb-3 font-mono text-[0.6875rem] uppercase tracking-[0.1em] text-theme-tertiary">
          On this page
        </p>
        <ul className="space-y-0.5 border-l border-theme">
          {headings.map((heading) => (
            <li key={heading.id}>
              <a
                href={`#${heading.id}`}
                onClick={(event) => {
                  event.preventDefault();
                  onSelect(heading.id);
                }}
                className={cn(
                  '-ml-px block border-l py-1 text-sm leading-snug transition-colors',
                  heading.depth >= 3 ? 'pl-6 text-[0.8125rem]' : 'pl-3',
                  activeId === heading.id
                    ? 'border-primary text-theme-primary'
                    : 'border-transparent text-theme-tertiary hover:text-theme-primary',
                )}
              >
                {heading.text}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}

/**
 * Tracks which heading is the current section.
 *
 * The reading column is its own scroll container, not the window, so the
 * observer is rooted on it; the bottom margin keeps the "current" heading the
 * one nearest the top of the viewport rather than whichever is merely visible.
 */
function useActiveHeading(headings: DocHeading[], scrollRef: RefObject<HTMLElement | null>): string | null {
  const [activeId, setActiveId] = useState<string | null>(null);
  const ids = headings.map((h) => h.id).join('|');

  useEffect(() => {
    const root = scrollRef.current;
    if (!root || typeof IntersectionObserver === 'undefined') return;

    const idList = ids ? ids.split('|') : [];
    const elements = idList
      .map((id) => root.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`))
      .filter((el): el is HTMLElement => el !== null);

    if (elements.length === 0) return;

    setActiveId(idList[0] ?? null);

    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }
        const first = idList.find((id) => visible.has(id));
        if (first) setActiveId(first);
      },
      { root, rootMargin: '0px 0px -72% 0px', threshold: 0 },
    );

    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [ids, scrollRef]);

  return activeId;
}
