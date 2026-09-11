/**
 * @file Pager.tsx
 * @description Previous/next pager for server-paginated tables (local; the kit has none)
 * @feature explainability
 */

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/shared/components/ui';

export interface PagerProps {
  page: number;
  totalPages: number;
  total?: number;
  onPageChange: (page: number) => void;
  disabled?: boolean;
}

export function Pager({ page, totalPages, total, onPageChange, disabled }: PagerProps) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between gap-3 border-t border-line-subtle px-4 py-3">
      <span className="text-[13px] text-ink-tertiary">
        Page {page} of {totalPages}
        {total !== undefined ? ` · ${total} total` : ''}
      </span>
      <div className="flex gap-2">
        <Button
          variant="secondary"
          size="sm"
          leftIcon={<ChevronLeft className="h-4 w-4" strokeWidth={1.75} />}
          disabled={disabled || page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          Previous
        </Button>
        <Button
          variant="secondary"
          size="sm"
          rightIcon={<ChevronRight className="h-4 w-4" strokeWidth={1.75} />}
          disabled={disabled || page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
