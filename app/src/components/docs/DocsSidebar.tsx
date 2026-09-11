/**
 * @file DocsSidebar.tsx
 * @description The docs list: search, collapsible categories (eyebrow labels)
 *              and the docs of each, with the active one marked like the shell nav
 * @feature docs
 */

import { useMemo, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { SearchInput } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';

export interface DocEntry {
  slug: string;
  title: string;
  category?: string;
}

interface DocsSidebarProps {
  docs: DocEntry[];
  groups: Map<string, DocEntry[]>;
  categories: string[];
  contentMap: Map<string, string>;
  className?: string;
  onNavigate?: () => void;
}

export function DocsSidebar({ docs, groups, categories, contentMap, className, onNavigate }: DocsSidebarProps) {
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const q = search.trim().toLowerCase();

  const toggleCategory = (cat: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });

  // While searching, regroup only the matching docs (title or body text)
  const shownGroups = useMemo(() => {
    if (!q) return groups;
    const m = new Map<string, DocEntry[]>();
    for (const e of docs) {
      if (!e.title.toLowerCase().includes(q) && !(contentMap.get(e.slug)?.toLowerCase().includes(q) ?? false)) continue;
      const cat = e.category ?? 'Other';
      m.set(cat, [...(m.get(cat) ?? []), e]);
    }
    return m;
  }, [q, docs, groups, contentMap]);

  const shownCategories = categories.filter((cat) => (shownGroups.get(cat)?.length ?? 0) > 0);

  return (
    <nav aria-label="Documentation" className={cn('flex flex-col gap-4', className)}>
      <SearchInput value={search} onChange={setSearch} placeholder="Search docs" size="sm" />

      <div className="flex flex-col gap-3">
        {shownCategories.map((category) => {
          const entries = shownGroups.get(category) ?? [];
          const isCollapsed = collapsed.has(category) && !q;
          return (
            <div key={category}>
              <button
                type="button"
                onClick={() => toggleCategory(category)}
                aria-expanded={!isCollapsed}
                className="flex w-full items-center gap-2 rounded-control px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-tertiary transition-colors hover:text-ink-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                <span className="flex-1 text-left">{category}</span>
                <ChevronDown
                  className={cn('h-3.5 w-3.5 transition-transform', isCollapsed && '-rotate-90')}
                  strokeWidth={1.75}
                  aria-hidden="true"
                />
              </button>
              {!isCollapsed && (
                <ul className="mt-1 flex flex-col gap-0.5">
                  {entries.map((doc) => (
                    <li key={doc.slug}>
                      <NavLink
                        to={`/docs/${doc.slug}`}
                        onClick={onNavigate}
                        className={({ isActive }) =>
                          cn(
                            'relative block rounded-control px-3 py-1.5 text-[13px] transition-colors',
                            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                            isActive
                              ? 'bg-primary/10 font-medium text-primary before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-primary'
                              : 'text-ink-secondary hover:bg-ink-primary/[0.04] hover:text-ink-primary',
                          )
                        }
                      >
                        {doc.title}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      {q && shownCategories.length === 0 && (
        <p className="px-2 text-[13px] text-ink-tertiary">No docs match &ldquo;{search}&rdquo;.</p>
      )}

      <p className="border-t border-line-subtle px-2 pt-3 text-xs text-ink-muted">{docs.length} documents</p>
    </nav>
  );
}
