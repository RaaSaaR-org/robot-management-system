/**
 * @file PaginationFooter.tsx
 * @description Server-pagination footer that sits inside a flush table Panel:
 *              "N total · Page x of y" and Previous / Next.
 * @feature incidents
 */

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/shared/components/ui';

export interface PaginationFooterProps {
  page: number;
  totalPages: number;
  total: number;
  /** Noun for the total, singular ("alert") — pluralised with an s */
  noun: string;
  onPrev: () => void;
  onNext: () => void;
  isLoading?: boolean;
}

/** Previous / Next footer for a paged DataTable. */
export function PaginationFooter({
  page,
  totalPages,
  total,
  noun,
  onPrev,
  onNext,
  isLoading = false,
}: PaginationFooterProps) {
  const pages = Math.max(1, totalPages);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-subtle px-4 py-3">
      <span className="text-[13px] tabular-nums text-ink-tertiary">
        {total} {noun}
        {total === 1 ? '' : 's'} · Page {page} of {pages}
      </span>
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          leftIcon={<ChevronLeft className="h-4 w-4" strokeWidth={1.75} />}
          onClick={onPrev}
          disabled={page <= 1 || isLoading}
          aria-label="Previous page"
        >
          Previous
        </Button>
        <Button
          variant="secondary"
          size="sm"
          rightIcon={<ChevronRight className="h-4 w-4" strokeWidth={1.75} />}
          onClick={onNext}
          disabled={page >= pages || isLoading}
          aria-label="Next page"
        >
          Next
        </Button>
      </div>
    </div>
  );
}
