/**
 * @file SessionStatusBadge.tsx
 * @description Status tag for teleoperation sessions: a thin wrapper around
 *              the kit's StatusTag that labels `created` as "Ready" and
 *              pulses while recording.
 * @feature datacollection
 */

import { StatusTag } from '@/shared/components/ui';
import type { TeleoperationStatus } from '../types/datacollection.types';
import { SESSION_STATUS_LABELS } from '../types/datacollection.types';

export interface SessionStatusBadgeProps {
  status: TeleoperationStatus;
  size?: 'sm' | 'md' | 'lg';
  showPulse?: boolean;
  className?: string;
}

export function SessionStatusBadge({ status, size = 'md', showPulse = true, className }: SessionStatusBadgeProps) {
  return (
    <StatusTag
      status={status}
      dot
      pulse={showPulse && status === 'recording'}
      size={size === 'sm' ? 'sm' : 'md'}
      className={className}
    >
      {SESSION_STATUS_LABELS[status] ?? status}
    </StatusTag>
  );
}
