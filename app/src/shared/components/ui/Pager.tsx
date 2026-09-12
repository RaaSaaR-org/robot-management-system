/**
 * @file Pager.tsx
 * @description Previous / Next pager for server-paged lists: "Page 2 of 7 ·
 *              1,234 entries". DataTable renders it in its footer through the
 *              `pagination` prop; use it alone only under a list that is not a
 *              DataTable. Renders nothing when there is a single page, unless
 *              asked to keep showing the total.
 * @feature shared
 */

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { Button } from './Button';

export interface PagerProps {
  /** Current page, 1-based */
  page: number;
  totalPages: number;
  /** Total number of records across all pages; shown after the page count */
  total?: number;
  /** Singular noun for the total ("entry"). Without it the total reads "57 total". */
  noun?: string;
  /** Plural when adding an "s" is wrong ("entries") */
  nounPlural?: string;
  /** Called with the page to go to */
  onPageChange: (page: number) => void;
  /** Disables both buttons (e.g. while a page loads) */
  disabled?: boolean;
  /** Keep the pager (and the total) visible when there is only one page */
  showSinglePage?: boolean;
  /** Accessible name of the navigation landmark (default "Pagination") */
  label?: string;
  className?: string;
}

function totalText(total: number, noun?: string, nounPlural?: string): string {
  const count = total.toLocaleString();
  if (!noun) return `${count} total`;
  return `${count} ${total === 1 ? noun : (nounPlural ?? `${noun}s`)}`;
}

/**
 * @example
 * ```tsx
 * <Pager page={page} totalPages={totalPages} total={total} noun="entry" nounPlural="entries" onPageChange={setPage} disabled={isLoading} />
 * // usually through the table: <DataTable … pagination={{ page, totalPages, total, onPageChange: setPage }} />
 * ```
 */
export function Pager({
  page,
  totalPages,
  total,
  noun,
  nounPlural,
  onPageChange,
  disabled = false,
  showSinglePage = false,
  label = 'Pagination',
  className,
}: PagerProps) {
  const pages = Math.max(1, totalPages);
  if (pages <= 1 && !showSinglePage) return null;
  const current = Math.min(Math.max(1, page), pages);

  return (
    <nav aria-label={label} className={cn('flex flex-wrap items-center justify-between gap-3', className)}>
      <span className="text-[13px] tabular-nums text-ink-tertiary" aria-live="polite">
        Page {current} of {pages}
        {total !== undefined && ` · ${totalText(total, noun, nounPlural)}`}
      </span>
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          leftIcon={<ChevronLeft className="h-4 w-4" strokeWidth={1.75} />}
          disabled={disabled || current <= 1}
          onClick={() => onPageChange(current - 1)}
          aria-label="Previous page"
        >
          Previous
        </Button>
        <Button
          variant="secondary"
          size="sm"
          rightIcon={<ChevronRight className="h-4 w-4" strokeWidth={1.75} />}
          disabled={disabled || current >= pages}
          onClick={() => onPageChange(current + 1)}
          aria-label="Next page"
        >
          Next
        </Button>
      </div>
    </nav>
  );
}
