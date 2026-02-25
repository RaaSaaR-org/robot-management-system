/**
 * @file PeriodSelector.tsx
 * @description Toggle for selecting evaluation time period (24h/7d/30d)
 * @feature evaluation
 */

import { cn } from '@/shared/utils/cn';
import type { EvaluationPeriod } from '../types';

export interface PeriodSelectorProps {
  value: EvaluationPeriod;
  onChange: (period: EvaluationPeriod) => void;
}

const PERIODS: { value: EvaluationPeriod; label: string }[] = [
  { value: '24h', label: '24h' },
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
];

export function PeriodSelector({ value, onChange }: PeriodSelectorProps) {
  return (
    <div className="flex items-center gap-1 p-1 rounded-lg bg-theme-secondary/10">
      {PERIODS.map((p) => (
        <button
          key={p.value}
          onClick={() => onChange(p.value)}
          className={cn(
            'px-3 py-1.5 text-sm font-medium rounded-md transition-colors',
            value === p.value
              ? 'bg-cobalt text-white shadow-sm'
              : 'text-theme-secondary hover:text-theme-primary hover:bg-theme-hover'
          )}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
