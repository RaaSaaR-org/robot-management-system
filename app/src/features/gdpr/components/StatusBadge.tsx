/**
 * @file StatusBadge.tsx
 * @description Badge component showing request status
 * @feature gdpr
 */

import type { GDPRRequestStatus } from '../types';
import { REQUEST_STATUS_LABELS } from '../types';

export interface StatusBadgeProps {
  status: GDPRRequestStatus;
  className?: string;
}

const STATUS_STYLES: Record<GDPRRequestStatus, string> = {
  pending: 'bg-yellow-500/20 text-yellow-600 dark:text-yellow-400',
  acknowledged: 'bg-blue-500/20 text-blue-600 dark:text-blue-400',
  in_progress: 'bg-blue-500/20 text-blue-600 dark:text-blue-400',
  awaiting_verification: 'bg-orange-500/20 text-orange-600 dark:text-orange-400',
  completed: 'bg-green-500/20 text-green-600 dark:text-green-400',
  rejected: 'bg-red-500/20 text-red-600 dark:text-red-400',
  cancelled: 'bg-gray-500/20 text-gray-600 dark:text-gray-400',
};

export function StatusBadge({ status, className = '' }: StatusBadgeProps) {
  const style = STATUS_STYLES[status] || 'bg-gray-500/20 text-gray-600 dark:text-gray-400';
  const label = REQUEST_STATUS_LABELS[status] || status;

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${style} ${className}`}
    >
      {label}
    </span>
  );
}
