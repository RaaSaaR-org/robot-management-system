/**
 * @file CreditBalance.tsx
 * @description The user's credit balance as a neutral badge (e.g. "1,200 credits")
 * @feature Data Contribution
 */

import { Coins } from 'lucide-react';
import { Badge } from '@/shared/components/ui';
import { UI_DATE_LOCALE } from '@/shared/utils/format';

export interface CreditBalanceProps {
  totalCredits: number;
  className?: string;
}

export function CreditBalance({ totalCredits, className }: CreditBalanceProps) {
  return (
    <Badge variant="neutral" size="md" className={className}>
      <Coins className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
      <span className="tabular-nums">{totalCredits.toLocaleString(UI_DATE_LOCALE)}</span> credits
    </Badge>
  );
}
