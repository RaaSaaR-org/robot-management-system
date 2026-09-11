/**
 * @file QualityIndicator.tsx
 * @description Real-time quality feedback for a teleoperation session:
 *              smoothness score, warning and suggestions, on kit tokens.
 * @feature datacollection
 */

import { AlertTriangle, Gauge } from 'lucide-react';
import { ProgressBar, StatusTag, type StatusTagTone } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import type { QualityFeedback } from '../types/datacollection.types';

export interface QualityIndicatorProps {
  feedback: QualityFeedback | null;
  compact?: boolean;
  className?: string;
}

function qualityMeta(score: number): { label: string; tone: StatusTagTone; bar: 'success' | 'warning' | 'error' } {
  if (score >= 0.8) return { label: 'Excellent', tone: 'success', bar: 'success' };
  if (score >= 0.6) return { label: 'Good', tone: 'success', bar: 'success' };
  if (score >= 0.4) return { label: 'Fair', tone: 'warning', bar: 'warning' };
  return { label: 'Poor', tone: 'danger', bar: 'error' };
}

export function QualityIndicator({ feedback, compact = false, className }: QualityIndicatorProps) {
  if (!feedback) {
    return (
      <div className={cn('flex items-center gap-2 text-[13px] text-ink-tertiary', className)}>
        <Gauge className="h-4 w-4 shrink-0" strokeWidth={1.75} />
        Quality is scored while you record.
      </div>
    );
  }

  const score = feedback.currentSmoothnessScore;
  const meta = qualityMeta(score);
  const pct = Math.round(score * 100);

  if (compact) {
    return (
      <StatusTag tone={meta.tone} dot className={className}>
        {pct}%
      </StatusTag>
    );
  }

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] text-ink-secondary">Smoothness</span>
        <StatusTag tone={meta.tone} dot>{meta.label}</StatusTag>
      </div>
      <ProgressBar value={pct} variant={meta.bar} size="sm" label="Smoothness" />

      {feedback.warningMessage && (
        <div className="flex items-start gap-2 rounded-control border border-line-subtle bg-inset p-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-signal-estimated" strokeWidth={1.75} />
          <p className="text-[13px] text-ink-secondary">{feedback.warningMessage}</p>
        </div>
      )}

      {feedback.suggestions && feedback.suggestions.length > 0 && (
        <ul className="flex list-disc flex-col gap-1 pl-5 text-[13px] text-ink-secondary">
          {feedback.suggestions.map((suggestion, idx) => (
            <li key={idx}>{suggestion}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
