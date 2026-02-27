/**
 * @file DocsSidebar.tsx
 * @description Sidebar navigation for the docs viewer with file list and active highlighting
 * @feature docs
 */

import { NavLink } from 'react-router-dom';
import { cn } from '@/shared/utils/cn';

export interface DocEntry {
  slug: string;
  title: string;
}

interface DocsSidebarProps {
  docs: DocEntry[];
  className?: string;
}

/**
 * Sidebar listing all docs with active route highlighting.
 * README is pinned to the top, rest is alphabetical.
 */
export function DocsSidebar({ docs, className }: DocsSidebarProps) {
  return (
    <nav
      className={cn(
        'w-64 shrink-0 border-r border-theme overflow-y-auto section-secondary',
        className,
      )}
    >
      <div className="p-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-theme-tertiary mb-3">
          Documentation
        </h2>
        <ul className="space-y-0.5">
          {docs.map((doc) => (
            <li key={doc.slug}>
              <NavLink
                to={`/docs/${doc.slug}`}
                className={({ isActive }) =>
                  cn(
                    'block px-3 py-2 rounded-brand text-sm transition-colors',
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
      </div>
    </nav>
  );
}
