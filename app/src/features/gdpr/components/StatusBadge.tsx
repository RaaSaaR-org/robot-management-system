/**
 * @file StatusBadge.tsx
 * @description GDPR request status as a kit StatusTag
 * @feature gdpr
 */

import { StatusTag, type StatusTagTone } from '@/shared/components/ui';
import type { GDPRRequestStatus } from '../types';
import { REQUEST_STATUS_LABELS } from '../types';

export interface StatusBadgeProps {
  status: GDPRRequestStatus;
  className?: string;
}

const TONES: Record<GDPRRequestStatus, StatusTagTone> = {
  pending: 'gated',
  acknowledged: 'info',
  in_progress: 'info',
  awaiting_verification: 'gated',
  completed: 'live',
  rejected: 'stopped',
  cancelled: 'neutral',
};

/** Explicit tones: the kit map does not know acknowledged / awaiting_verification. */
export function StatusBadge({ status, className }: StatusBadgeProps) {
  const label = REQUEST_STATUS_LABELS[status] ?? status;
  return (
    <StatusTag tone={TONES[status] ?? 'neutral'} className={className}>
      {label.charAt(0) + label.slice(1).toLowerCase()}
    </StatusTag>
  );
}
