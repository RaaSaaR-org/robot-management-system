/**
 * @file DocsSidebar.tsx
 * @description Sidebar navigation for the docs viewer with categories, search, and collapsible groups
 * @feature docs
 */

import { useState } from 'react';
import { NavLink } from 'react-router-dom';
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

// Category icons
const CATEGORY_ICONS: Record<string, string> = {
  'Getting Started': '\u{1F4DA}',
  'Architecture': '\u{1F3D7}',
  'Robot Integration': '\u{1F916}',
  'Operations': '\u{2699}',
  'Compliance': '\u{1F4CB}',
  'Brand': '\u{1F3A8}',
  'Planning': '\u{1F4CA}',
  'Research': '\u{1F52C}',
  'Other': '\u{1F4C4}',
};

/**
 * Sidebar listing all docs grouped by category with search and collapsible sections.
 */
export function DocsSidebar({
  docs,
  groups,
  categories,
  contentMap,
  className,
  onNavigate,
}: DocsSidebarProps) {
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggleCategory = (cat: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) {
        next.delete(cat);
      } else {
        next.add(cat);
      }
      return next;
    });
  };

  // Filter docs by search query
  const filteredDocs = search.trim()
    ? docs.filter(
        (e) =>
          e.title.toLowerCase().includes(search.toLowerCase()) ||
          (contentMap.get(e.slug)?.toLowerCase().includes(search.toLowerCase()) ?? false),
      )
    : null;

  // Build filtered groups when searching
  const filteredGroups = filteredDocs
    ? (() => {
        const m = new Map<string, DocEntry[]>();
        for (const entry of filteredDocs) {
          const cat = entry.category ?? 'Other';
          const list = m.get(cat) ?? [];
          list.push(entry);
          m.set(cat, list);
        }
        return m;
      })()
    : groups;

  const displayCategories = search.trim()
    ? categories.filter((cat) => filteredGroups.has(cat))
    : categories;

  return (
    <nav
      className={cn(
        'w-72 shrink-0 border-r border-theme overflow-y-auto section-secondary',
        className,
      )}
    >
      <div className="p-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-theme-tertiary mb-3">
          Documentation
        </h2>

        {/* Search */}
        <div className="relative mb-4">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-theme-tertiary"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="search"
            placeholder="Search docs..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm bg-theme-elevated rounded-brand border border-theme outline-none focus:ring-2 focus:ring-cobalt/50 text-theme-primary placeholder:text-theme-tertiary"
          />
        </div>

        {/* Categorized doc list */}
        <div className="space-y-2">
          {displayCategories.map((category) => {
            const entries = filteredGroups.get(category);
            if (!entries || entries.length === 0) return null;
            const icon = CATEGORY_ICONS[category] ?? '\u{1F4C4}';
            const isCollapsed = collapsed.has(category) && !search.trim();

            return (
              <div key={category}>
                <button
                  onClick={() => toggleCategory(category)}
                  className="flex items-center gap-2 w-full px-2 py-1.5 text-xs font-semibold uppercase tracking-wider text-theme-tertiary hover:text-theme-primary transition-colors"
                >
                  <span>{icon}</span>
                  <span className="flex-1 text-left">{category}</span>
                  <svg
                    className={cn(
                      'w-3.5 h-3.5 transition-transform',
                      isCollapsed ? '-rotate-90' : 'rotate-0',
                    )}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {!isCollapsed && (
                  <ul className="space-y-0.5 ml-1">
                    {entries.map((doc) => (
                      <li key={doc.slug}>
                        <NavLink
                          to={`/docs/${doc.slug}`}
                          onClick={onNavigate}
                          className={({ isActive }) =>
                            cn(
                              'block px-3 py-1.5 rounded-brand text-sm transition-colors',
                              isActive
                                ? 'bg-cobalt text-white'
                                : 'text-theme-secondary hover:text-theme-primary hover:bg-theme-hover',
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

        {/* No results */}
        {search.trim() && displayCategories.length === 0 && (
          <p className="text-sm text-theme-tertiary text-center py-4">
            No docs matching &ldquo;{search}&rdquo;
          </p>
        )}

        {/* Doc count */}
        <div className="mt-4 pt-3 border-t border-theme text-xs text-theme-tertiary text-center">
          {docs.length} documents
        </div>
      </div>
    </nav>
  );
}
