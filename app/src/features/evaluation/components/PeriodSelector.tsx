/**
 * @file PeriodSelector.tsx
 * @description Time period for the evaluation section (24 h / 7 d / 30 d), on the kit's SegmentedControl
 * @feature evaluation
 */

import { SegmentedControl } from '@/shared/components/ui';
import type { EvaluationPeriod } from '../types';

export interface PeriodSelectorProps {
  value: EvaluationPeriod;
  onChange: (period: EvaluationPeriod) => void;
}

const PERIODS: { value: EvaluationPeriod; label: string }[] = [
  { value: '24h', label: '24 h' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
];

export function PeriodSelector({ value, onChange }: PeriodSelectorProps) {
  return <SegmentedControl label="Period" options={PERIODS} value={value} onChange={onChange} />;
}
