/**
 * @file SafetyBadge.tsx
 * @description Safety classification of an AI decision as a kit StatusTag
 * @feature explainability
 */

import { StatusTag, type StatusTagTone } from '@/shared/components/ui';
import { SAFETY_CLASSIFICATION_LABELS, type SafetyClassification } from '../types';

export interface SafetyBadgeProps {
  classification: SafetyClassification;
  size?: 'sm' | 'md';
  className?: string;
}

const SAFETY_TONES: Record<SafetyClassification, StatusTagTone> = {
  safe: 'live',
  caution: 'gated',
  dangerous: 'stopped',
};

/** Safe → live, caution → gated, dangerous → stopped. */
export function SafetyBadge({ classification, size = 'md', className }: SafetyBadgeProps) {
  return (
    <StatusTag tone={SAFETY_TONES[classification] ?? 'neutral'} size={size} className={className}>
      {SAFETY_CLASSIFICATION_LABELS[classification] ?? classification}
    </StatusTag>
  );
}
