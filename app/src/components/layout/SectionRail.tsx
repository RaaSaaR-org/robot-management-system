/**
 * @file SectionRail.tsx
 * @description The navigation's second level: the rail of the active row,
 *              rendered once by the shell above whatever page is showing. A
 *              segmented track, so it never reads as the underline tab bar the
 *              page draws below it.
 * @feature layout
 */

import type { ReactElement } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { cn } from '@/shared/utils/cn';
import { focusRing } from '@/shared/components/ui';
import { isNavItemActive, useVisibleNavGroups } from './navigation';

// ============================================================================
// TYPES
// ============================================================================

export interface SectionRailProps {
  className?: string;
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * `null` for every row that declares no rail — which is most of them, so the
 * shell can render it unconditionally.
 *
 * The rail belongs to the **row**, not to the page: it shows wherever the
 * owning row is active, detail and editor routes included. That is deliberate —
 * a run detail or a route editor still offers its siblings.
 *
 * @example
 * ```tsx
 * <SectionRail />
 * ```
 */
export function SectionRail({ className }: SectionRailProps): ReactElement | null {
  const groups = useVisibleNavGroups();
  const { pathname } = useLocation();

  // The rail is the active row's own second level, so it is found the same way
  // the sidebar finds the current entry — one model, one rule.
  const row = groups.flatMap((g) => g.items).find((item) => isNavItemActive(item, pathname));
  if (!row?.rail) return null;

  return (
    <nav
      aria-label="Section"
      className={cn(
        'inline-flex max-w-full items-center gap-0.5 self-start overflow-x-auto rounded-control border border-line-subtle bg-inset p-[2px] scrollbar-hide',
        className,
      )}
    >
      {row.rail.map((stop) => {
        const Icon = stop.icon;
        // A stop owns its path and everything under it, exactly like a row.
        const active = isNavItemActive(stop, pathname);
        return (
          <Link
            key={stop.path}
            to={stop.path}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[8px] px-3 text-[13px] font-medium',
              'transition-colors duration-150 ease-[var(--ease-instrument)]',
              focusRing,
              active
                ? 'bg-raised text-ink-primary shadow-[0_1px_2px_rgba(0,0,0,0.18)]'
                : 'text-ink-secondary hover:text-ink-primary',
            )}
          >
            <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
            {stop.label}
          </Link>
        );
      })}
    </nav>
  );
}
