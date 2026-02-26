/**
 * @file CreditBalance.tsx
 * @description Displays the user's current credit balance with trophy icon (TASK-065)
 * @feature Data Contribution
 */

import { cn } from '@/shared/utils/cn';

// ============================================================================
// TYPES
// ============================================================================

export interface CreditBalanceProps {
  totalCredits: number;
  className?: string;
}

// ============================================================================
// COMPONENT
// ============================================================================

export function CreditBalance({ totalCredits, className }: CreditBalanceProps) {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-2 px-4 py-2 rounded-lg',
        'bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800',
        className
      )}
    >
      <span className="text-xl" role="img" aria-label="Trophy">
        🏆
      </span>
      <div>
        <p className="text-xs font-medium text-amber-600 dark:text-amber-400 uppercase tracking-wide">
          Credits
        </p>
        <p className="text-lg font-bold text-amber-900 dark:text-amber-100">
          {totalCredits.toLocaleString()}
        </p>
      </div>
    </div>
  );
}
