/**
 * @file Toolbar.tsx
 * @description The row above a list: search (grows), filters, and right-aligned
 *              actions such as a view toggle. Wraps onto more lines when narrow.
 * @feature shared
 */

import type { ReactNode } from 'react';
import { cn } from '@/shared/utils/cn';

export interface ToolbarProps {
  /** Free-form content (use instead of the slots) */
  children?: ReactNode;
  /** Usually a SearchInput; grows to fill the row */
  search?: ReactNode;
  /** Selects, SegmentedControls, ToggleChips */
  filters?: ReactNode;
  /** Pushed to the right: view toggle, export, "Clear filters" */
  actions?: ReactNode;
  className?: string;
}

/**
 * @example
 * ```tsx
 * <Toolbar
 *   search={<SearchInput value={q} onChange={setQ} placeholder="Search robots" />}
 *   filters={<Select fullWidth={false} aria-label="Status" placeholder="All statuses" options={…} />}
 *   actions={<SegmentedControl options={views} value={view} onChange={setView} label="View" />}
 * />
 * ```
 */
export function Toolbar({ children, search, filters, actions, className }: ToolbarProps) {
  return (
    <div className={cn('flex min-w-0 flex-wrap items-center gap-2 sm:gap-3', className)}>
      {search && <div className="min-w-[min(100%,14rem)] flex-[1_1_16rem] sm:max-w-md">{search}</div>}
      {filters && <div className="flex min-w-0 flex-wrap items-center gap-2">{filters}</div>}
      {children}
      {actions && <div className="ml-auto flex min-w-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
