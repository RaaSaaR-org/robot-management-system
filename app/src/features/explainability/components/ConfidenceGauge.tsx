/**
 * @file ConfidenceGauge.tsx
 * @description AI confidence as a kit StatusTag (compact) or ProgressBar (detail)
 * @feature explainability
 */

import { ProgressBar, StatusTag, type StatusTagTone } from '@/shared/components/ui';
import { formatConfidence } from '../types';

/** Group-wide thresholds: ≥ 0.8 live, 0.5–0.8 gated, < 0.5 stopped. */
export function confidenceTone(confidence: number): StatusTagTone {
  if (confidence >= 0.8) return 'live';
  if (confidence >= 0.5) return 'gated';
  return 'stopped';
}

export function confidenceLabel(confidence: number): string {
  if (confidence >= 0.8) return 'High';
  if (confidence >= 0.5) return 'Medium';
  return 'Low';
}

const BAR_VARIANT = { live: 'success', gated: 'warning', stopped: 'error' } as const;

export interface ConfidenceGaugeProps {
  confidence: number;
  /** tag: a StatusTag with the percentage; bar: a labelled ProgressBar */
  variant?: 'tag' | 'bar';
  className?: string;
}

export function ConfidenceGauge({ confidence, variant = 'tag', className }: ConfidenceGaugeProps) {
  const tone = confidenceTone(confidence);
  if (variant === 'bar') {
    return (
      <ProgressBar
        className={className}
        value={Math.round(confidence * 100)}
        variant={BAR_VARIANT[tone as keyof typeof BAR_VARIANT]}
        label={`${confidenceLabel(confidence)} confidence`}
      />
    );
  }
  return (
    <StatusTag tone={tone} className={className}>
      {formatConfidence(confidence)}
    </StatusTag>
  );
}
