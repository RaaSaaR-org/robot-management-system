/**
 * @file DocsToc.tsx
 * @description "On this page" rail for the docs viewer, with scroll spy
 * @feature docs
 */

import { useEffect, useState, type RefObject } from 'react';
import { Eyebrow } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import type { DocHeading } from './docsMarkdown';

interface DocsTocProps {
  /** Headings to list — already filtered to the depths worth showing */
  headings: DocHeading[];
  /** The element holding the rendered article, where the headings live */
  scrollRef: RefObject<HTMLElement | null>;
  onSelect: (id: string) => void;
  className?: string;
}

/** Right-hand contents rail. Highlights the section under the top of the viewport. */
export function DocsToc({ headings, scrollRef, onSelect, className }: DocsTocProps) {
  const activeId = useActiveHeading(headings, scrollRef);

  if (headings.length < 2) return null;

  return (
    <nav className={cn('w-52 shrink-0', className)} aria-label="On this page">
      <div className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto pb-6">
        <Eyebrow className="mb-3 block">On this page</Eyebrow>
        <ul className="flex flex-col border-l border-line">
          {headings.map((heading) => (
            <li key={heading.id}>
              <a
                href={`#${heading.id}`}
                onClick={(event) => {
                  event.preventDefault();
                  onSelect(heading.id);
                }}
                className={cn(
                  '-ml-px block border-l py-1 text-[13px] leading-snug transition-colors',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                  heading.depth >= 3 ? 'pl-6' : 'pl-3',
                  activeId === heading.id
                    ? 'border-primary text-primary'
                    : 'border-transparent text-ink-tertiary hover:text-ink-primary',
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
 * Tracks which heading is the current section. The page scrolls with the
 * window, so the observer uses the viewport; the margins keep the "current"
 * heading the one nearest the top, below the app's top bar.
 */
function useActiveHeading(headings: DocHeading[], scrollRef: RefObject<HTMLElement | null>): string | null {
  const [activeId, setActiveId] = useState<string | null>(null);
  const ids = headings.map((h) => h.id).join('|');

  useEffect(() => {
    const container = scrollRef.current;
    if (!container || typeof IntersectionObserver === 'undefined') return;

    const idList = ids ? ids.split('|') : [];
    const elements = idList
      .map((id) => container.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`))
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
      { root: null, rootMargin: '-64px 0px -72% 0px', threshold: 0 },
    );

    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [ids, scrollRef]);

  return activeId;
}
