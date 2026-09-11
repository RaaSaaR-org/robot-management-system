/**
 * @file Skeleton.tsx
 * @description Loading placeholders shaped like the content they stand in for:
 *              Skeleton (one block), SkeletonText (lines) and SkeletonRows
 *              (a list/table body). Never leave a loading area blank.
 * @feature shared
 */

import { cn } from '@/shared/utils/cn';

export interface SkeletonProps {
  /** Size and shape via utilities, e.g. "h-4 w-32" or "h-24 w-full rounded-panel" */
  className?: string;
}

/**
 * @example
 * ```tsx
 * <Skeleton className="h-4 w-40" />
 * ```
 */
export function Skeleton({ className }: SkeletonProps) {
  return <div aria-hidden="true" className={cn('rounded-tag bg-line-subtle motion-safe:animate-pulse', className)} />;
}

export interface SkeletonTextProps {
  /** Number of lines (default 3); the last one is shorter */
  lines?: number;
  className?: string;
}

/**
 * @example
 * ```tsx
 * <SkeletonText lines={2} />
 * ```
 */
export function SkeletonText({ lines = 3, className }: SkeletonTextProps) {
  return (
    <div role="status" aria-label="Loading" className={cn('flex flex-col gap-2', className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn('h-3.5', i === lines - 1 && lines > 1 ? 'w-3/5' : 'w-full')} />
      ))}
    </div>
  );
}

export interface SkeletonRowsProps {
  /** Number of rows (default 5) */
  rows?: number;
  /** Cells per row (default 4) */
  columns?: number;
  /** Tighter rows */
  dense?: boolean;
  className?: string;
}

const CELL_WIDTHS = ['w-2/5', 'w-3/5', 'w-1/2', 'w-1/3', 'w-2/3'];

/**
 * A list-shaped placeholder: hairline-separated rows of cells.
 *
 * @example
 * ```tsx
 * {isLoading ? <SkeletonRows rows={6} columns={4} /> : <List … />}
 * ```
 */
export function SkeletonRows({ rows = 5, columns = 4, dense = false, className }: SkeletonRowsProps) {
  return (
    <div role="status" aria-label="Loading" className={cn('flex flex-col', className)}>
      {Array.from({ length: rows }, (_, r) => (
        <div
          key={r}
          className={cn(
            'grid items-center gap-4 border-b border-line-subtle px-4 last:border-b-0',
            dense ? 'py-2.5' : 'py-3.5',
          )}
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: columns }, (_, c) => (
            <Skeleton key={c} className={cn('h-3.5', CELL_WIDTHS[(r + c) % CELL_WIDTHS.length])} />
          ))}
        </div>
      ))}
    </div>
  );
}
